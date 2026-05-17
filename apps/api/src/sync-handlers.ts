/**
 * Yjs sync protocol handlers, tailored for Cloudflare Durable Objects.
 *
 * Inlined from the generic @epicenter/sync-server package. Narrowed to CF
 * WebSocket types: no framework-agnostic indirection, no WeakMap tricks.
 *
 * ## API surface
 *
 * {@link registerConnection}: side-effectful, registers doc update listener.
 * {@link applyMessage}: mutates doc, returns additional effects.
 *
 * ## Error handling rationale (grounded in Yjs internals)
 *
 * `Y.applyUpdateV2` is resilient by design: it never throws on malformed
 * data. Missing dependencies are stored in `doc.store.pendingStructs` and
 * automatically retried when future updates arrive.
 *
 * However, `lib0/decoding` functions (readVarUint, readVarUint8Array) DO
 * throw on buffer underflow. Since WebSocket messages are untrusted input,
 * `applyMessage` wraps the decode+dispatch path with `trySync` to catch
 * these at the system boundary.
 *
 * Inbound `SYNC` updates that touch `PRESENCE_KEY` are rejected: only the
 * server writes presence rows, so a client mutation of that reserved array
 * is a protocol violation. `applyMessage` decodes such payloads into a
 * scratch `Y.Doc` for the validation check and returns
 * `Err(SyncHandlerError.PresenceWriteForbidden)`; the caller closes the
 * socket with code `4400` and reason `'presence-write-forbidden'`.
 */

import {
	encodeSyncStep1,
	encodeSyncUpdate,
	handleSyncPayload,
	MESSAGE_TYPE,
	SYNC_MESSAGE_TYPE,
	type SyncMessageType,
} from '@epicenter/sync';
import { PRESENCE_KEY } from '@epicenter/workspace/document/keys';
import * as decoding from 'lib0/decoding';
import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
import { Ok, trySync } from 'wellcrafted/result';
import * as Y from 'yjs';

// ============================================================================
// Errors
// ============================================================================

/**
 * Errors from the sync handler layer.
 *
 * `MessageDecode` covers all failures when processing untrusted WebSocket
 *   binary frames: lib0 buffer underflow (truncated messages) and any other
 *   decode-time exceptions.
 * `PresenceWriteForbidden` is returned when a client `SYNC` update writes
 *   to the reserved `PRESENCE_KEY` array. Only the server writes presence;
 *   the caller closes the socket with `4400` and reason
 *   `'presence-write-forbidden'`.
 */
export const SyncHandlerError = defineErrors({
	MessageDecode: ({ cause }: { cause: unknown }) => ({
		message: `Failed to decode WebSocket message: ${extractErrorMessage(cause)}`,
		cause,
	}),
	PresenceWriteForbidden: (_: Record<string, never>) => ({
		message:
			'Client SYNC update attempted to write to the reserved presence array',
	}),
});

// ============================================================================
// Types
// ============================================================================

/**
 * Shared room state: the doc and auth-derived subject that all connections
 * in a room share. The DO is user-scoped (DO name encodes the owning user
 * id), so every connection in this room carries the same `subject`. The
 * server stamps `subject` onto `PresenceEntry` rows it writes on connect.
 */
export type RoomContext = {
	doc: Y.Doc;
	subject: string;
};

/**
 * Per-connection state stored in `Map<WebSocket, Connection>`.
 *
 * Contains only per-connection data: the socket and an `unregister` closure
 * that removes the doc update listener registered by
 * {@link registerConnection}.
 */
export type Connection = {
	ws: WebSocket;
	/** Removes the `doc.on('updateV2')` listener for this connection. */
	unregister: () => void;
};

/**
 * Result of handling a single WebSocket message.
 *
 * Discriminated union on `action`. Each variant maps to one routing pattern
 * in the DO caller:
 *
 * `reply`: Send data back to the sender only.
 * `broadcast`: Fan out to all other connections.
 *
 * `applyMessage` returns `Result<MessageResult | null>`: `null` means valid
 * message with no action needed (AUTH, unknown types).
 */
export type MessageResult =
	| { action: 'reply'; data: Uint8Array }
	| { action: 'broadcast'; data: Uint8Array };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Decode an inbound update into a scratch doc and check whether it writes
 * to the reserved `PRESENCE_KEY` array.
 *
 * Only the server writes presence rows; a client mutation of that array is
 * a protocol violation. The scratch doc uses `gc: true` to keep the check
 * lightweight: we only need to know whether the presence array received
 * any items, not preserve history.
 */
export function updateTouchesPresence(payload: Uint8Array): boolean {
	const scratch = new Y.Doc({ gc: true });
	Y.applyUpdateV2(scratch, payload);
	return scratch.getArray(PRESENCE_KEY).length > 0;
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Register a WebSocket connection's doc update listener.
 *
 * Side-effectful: registers a `doc.on('updateV2')` handler that forwards
 * updates to the WebSocket. Returns a {@link Connection} with an
 * `unregister` closure that removes the listener when the socket closes.
 *
 * @param options.doc: The shared Yjs document
 * @param options.ws: The WebSocket to register the listener for
 * @returns Per-connection state with cleanup handle
 */
export function registerConnection({
	doc,
	ws,
}: {
	doc: Y.Doc;
	ws: WebSocket;
}): Connection {
	// Forward V2 doc updates to this connection (skip echo via identity check)
	const updateHandler = (update: Uint8Array, origin: unknown) => {
		if (origin === ws) return;
		trySync({
			try: () => ws.send(encodeSyncUpdate({ update })),
			catch: () => Ok(undefined), // connection already dead
		});
	};
	doc.on('updateV2', updateHandler);

	return {
		ws,
		unregister() {
			doc.off('updateV2', updateHandler);
		},
	};
}

/**
 * Dispatch an incoming binary WebSocket message.
 *
 * Mutates `room.doc` via `applyUpdateV2`, then returns a `Result`: `Ok`
 * with a {@link MessageResult} describing what the caller should do,
 * `Err(SyncHandlerError.MessageDecode)` if the binary frame is malformed,
 * or `Err(SyncHandlerError.PresenceWriteForbidden)` if the inbound update
 * writes to the reserved `PRESENCE_KEY` array.
 *
 * The `trySync` wrapper catches lib0 decoder throws (buffer underflow on
 * truncated messages). Yjs's own `applyUpdateV2` is resilient and won't
 * throw: it stores unresolved dependencies in `doc.store.pendingStructs`
 * automatically.
 *
 * @param options.data: Raw binary WebSocket message
 * @param options.room: The shared room context (doc + subject)
 * @param options.connection: The per-connection state (ws + cleanup)
 */
export function applyMessage({
	data,
	room,
	connection,
}: {
	data: Uint8Array;
	room: RoomContext;
	connection: Connection;
}) {
	const decoded = trySync({
		try: (): { result: MessageResult | null; forbidden: boolean } => {
			const decoder = decoding.createDecoder(data);
			const messageType = decoding.readVarUint(decoder);

			switch (messageType) {
				case MESSAGE_TYPE.SYNC: {
					const syncType = decoding.readVarUint(decoder) as SyncMessageType;
					const payload = decoding.readVarUint8Array(decoder);

					// STEP1 is a state-vector probe with no doc mutation, so it
					// needs no validation. STEP2 and UPDATE both call
					// Y.applyUpdateV2 inside handleSyncPayload; reject early if
					// the payload would write to the reserved presence array.
					if (
						syncType === SYNC_MESSAGE_TYPE.STEP2 ||
						syncType === SYNC_MESSAGE_TYPE.UPDATE
					) {
						if (updateTouchesPresence(payload)) {
							return { result: null, forbidden: true };
						}
					}

					const response = handleSyncPayload({
						syncType,
						payload,
						doc: room.doc,
						origin: connection.ws,
					});
					return {
						result: response ? { action: 'reply', data: response } : null,
						forbidden: false,
					};
				}

				case MESSAGE_TYPE.AUTH: {
					// Auth is handled at the Worker boundary (Better Auth middleware).
					// Receiving AUTH on an already-authenticated WS is unexpected:
					// log for observability but don't close the connection.
					console.warn(
						'[sync] Unexpected AUTH message on authenticated WebSocket',
					);
					return { result: null, forbidden: false };
				}

				default:
					console.warn(`[sync] Unknown WS message type: ${messageType}`);
					return { result: null, forbidden: false };
			}
		},
		catch: (cause) => SyncHandlerError.MessageDecode({ cause }),
	});

	if (decoded.error) return decoded;
	if (decoded.data.forbidden) {
		return SyncHandlerError.PresenceWriteForbidden({});
	}
	return Ok(decoded.data.result);
}
