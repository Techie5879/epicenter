/**
 * Self-contained Yjs sync room for Cloudflare Durable Objects.
 *
 * Everything a room needs lives in this file: SQLite persistence,
 * WebSocket lifecycle, connection management, presence writes, and the
 * `Room` class itself. The only external dependency is `sync-handlers.ts`
 * for the Yjs wire protocol (encode/decode/dispatch).
 *
 * ## Module structure
 *
 * {@link Room}: the Durable Object class wiring persistence and connections together.
 * {@link PresenceWriteForbidden}: thrown by `sync()` RPC when an HTTP
 *   update tries to mutate the reserved presence array
 */

import { DurableObject } from 'cloudflare:workers';
import {
	decodeSyncRequest,
	encodeSyncStep1,
	MAIN_SUBPROTOCOL,
	parseSubprotocols,
	stateVectorsEqual,
} from '@epicenter/sync';
import { type PresenceEntry } from '@epicenter/workspace';
import { PRESENCE_KEY } from '@epicenter/workspace/document/keys';
import { YKeyValueLww } from '@epicenter/workspace/document/y-keyvalue/y-keyvalue-lww';
import * as Y from 'yjs';
import { MAX_PAYLOAD_BYTES } from './constants';
import {
	applyMessage,
	type Connection,
	type RoomContext,
	registerConnection,
	SyncHandlerError,
	updateTouchesPresence,
} from './sync-handlers';

// ============================================================================
// Origins & errors
// ============================================================================

/**
 * Transaction origin for server-owned presence writes.
 *
 * Stamps the `doc.transact(...)` calls inside `upgrade()` and
 * `webSocketClose()` so observers and tests can distinguish presence
 * mutations performed by the server from client-driven sync updates.
 */
const SERVER_ORIGIN = Symbol('SERVER_ORIGIN');

/**
 * Thrown by `sync()` RPC when an inbound HTTP update writes to the
 * reserved `PRESENCE_KEY` array. The Worker layer (`app.ts`) catches it
 * by name and maps it to HTTP 403; the WebSocket path closes the socket
 * with code 4400.
 */
export class PresenceWriteForbidden extends Error {
	override readonly name = 'PresenceWriteForbidden';
	constructor() {
		super(
			'Client SYNC update attempted to write to the reserved presence array',
		);
	}
}

// ============================================================================
// Room
// ============================================================================

/**
 * Yjs sync room backed by a Cloudflare Durable Object.
 *
 * Owns: SQLite update log persistence, WebSocket lifecycle via the
 * Hibernation API, HTTP sync via RPC, connection management, and
 * server-stamped presence writes. Every room runs with `gc: true`.
 * Retained-history policies (Yjs snapshots needing `gc: false`) are
 * deferred and, if they return, will be a per-room policy lookup in
 * this constructor, not a sibling DO class.
 *
 * ## Worker to DO interface
 *
 * The Hono Worker in `app.ts` calls into this DO via two mechanisms:
 *
 * **RPC** (`stub.sync()`, `stub.getDoc()`): for HTTP sync and bootstrap.
 *   Direct method calls avoid Request/Response serialization overhead
 *   for binary payloads. The Worker handles HTTP concerns (status codes,
 *   content-type headers); the DO handles only Yjs logic.
 * **fetch** (`stub.fetch(request)`): for WebSocket upgrades only, since
 *   the 101 Switching Protocols handshake requires HTTP request/response
 *   semantics. After upgrade, all sync traffic flows through the Hibernation
 *   API callbacks (`webSocketMessage`, `webSocketClose`, `webSocketError`).
 *
 * ## Storage model
 *
 * Append-only update log in DO SQLite with opportunistic cold-start
 * compaction. Initialized inside `blockConcurrencyWhile` in the constructor.
 *
 * ## Presence
 *
 * Server-stamped presence rows live in the Yjs doc under `PRESENCE_KEY`,
 * backed by a `YKeyValueLww<PresenceEntry>`. The server writes a row on
 * WebSocket upgrade, deletes it on close, and sweeps orphans on boot. The
 * sync handlers reject any client SYNC update that writes to that array.
 *
 * ## Auth & data isolation
 *
 * Handled upstream by `requireOAuthUser` in app.ts. The Worker validates
 * the session (cookie, or `bearer.<token>` subprotocol for WebSocket) via
 * Better Auth before calling RPC methods or forwarding fetch. The DO
 * itself does not re-validate (it trusts the Worker boundary).
 *
 * DO names are subject-scoped: the Worker constructs
 * `subject:{subject}:rooms:{room}` before calling `idFromName()`. This ensures
 * each owner's data is isolated in separate DO instances, even if multiple
 * subjects access rooms with the same name (e.g., "epicenter.tab-manager").
 *
 * We chose subject-scoped DO names (Google Docs model) over org-scoped names
 * (Vercel/Supabase model) because most rooms hold personal data. For
 * enterprise self-hosted, the deployment itself is the org boundary.
 * See `getRoomStub` in app.ts for the full rationale.
 */
export class Room extends DurableObject {
	/**
	 * The shared Yjs document for this room.
	 *
	 * Initialized inside `ctx.blockConcurrencyWhile()` in the constructor.
	 * The definite assignment assertion (`!`) is safe because of two
	 * guarantees working together:
	 *
	 * 1. **Cloudflare runtime guarantee**: `blockConcurrencyWhile` prevents
	 *    the DO from receiving any incoming requests (`fetch`, `webSocketMessage`,
	 *    etc.) until the initialization promise resolves. So no method on this
	 *    class can run before `doc` is set.
	 *
	 * 2. **Synchronous async callback**: The callback passed to
	 *    `blockConcurrencyWhile` contains no `await`, so it executes to
	 *    completion synchronously. This means `doc` is assigned before the
	 *    constructor returns.
	 *
	 * If an `await` is ever added to the `blockConcurrencyWhile` callback,
	 * guarantee (2) breaks.
	 *
	 * @see {@link https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile | blockConcurrencyWhile docs}
	 */
	private doc!: Y.Doc;

	/** Shared room state: the Yjs doc and auth-derived subject. */
	private room!: RoomContext;

	/** Server-writable presence rows, persisted in the shared Y.Doc. */
	private presence!: YKeyValueLww<PresenceEntry>;

	/** Active WebSocket connections and their per-connection sync state. */
	private connections = new Map<WebSocket, Connection>();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair('ping', 'pong'),
		);

		ctx.blockConcurrencyWhile(async () => {
			this.doc = new Y.Doc({ gc: true });
			this.room = {
				doc: this.doc,
				subject: subjectFromDoName(ctx.id.name),
			};

			// --- Update log: DDL + cold-start load + compaction + live persist ---

			ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS updates (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					data BLOB NOT NULL
				)
			`);

			const rows = ctx.storage.sql
				.exec('SELECT data FROM updates ORDER BY id')
				.toArray();

			for (const row of rows) {
				Y.applyUpdateV2(this.doc, new Uint8Array(row.data as ArrayBuffer));
			}
			compactUpdateLog(ctx, this.doc);

			this.doc.on('updateV2', (update: Uint8Array) => {
				ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', update);
			});

			// --- Presence: wrap the reserved Y.Array ---
			// Constructed AFTER the SQL replay so initial entries (if any) are
			// already in the array when YKeyValueLww builds its in-memory index.
			this.presence = new YKeyValueLww<PresenceEntry>(
				this.doc.getArray(PRESENCE_KEY),
			);

			// --- Restore connections that survived hibernation ---
			// Iterates ctx.getWebSockets(), deserializes each attachment to recover
			// the connId, and re-registers sync handlers. No initial messages: the
			// client already received them before hibernation.
			for (const ws of ctx.getWebSockets()) {
				const attachment = ws.deserializeAttachment() as WsAttachment | null;
				if (!attachment) continue;

				const connection = registerConnection({ doc: this.doc, ws });
				this.connections.set(ws, connection);
			}

			// --- Boot orphan sweep ---
			// If a DO eviction skipped `webSocketClose`, a presence row may linger
			// for a connId that no surviving socket owns. Sweep them now using the
			// live socket set we just re-registered above.
			const live = new Set<string>();
			for (const ws of ctx.getWebSockets()) {
				const att = ws.deserializeAttachment() as WsAttachment | null;
				if (att?.connId) live.add(att.connId);
			}
			const orphans: string[] = [];
			for (const [connId] of this.presence.entries()) {
				if (!live.has(connId)) orphans.push(connId);
			}
			if (orphans.length > 0) {
				this.doc.transact(() => {
					for (const connId of orphans) this.presence.delete(connId);
				}, SERVER_ORIGIN);
			}
		});
	}

	// --- fetch: WebSocket upgrades only ---

	/**
	 * Only handles WebSocket upgrades. HTTP sync operations are
	 * exposed as RPC methods called directly on the stub, avoiding the overhead
	 * of constructing/parsing Request/Response objects for binary payloads.
	 */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.upgrade(request);
		}
		return new Response('Method not allowed', { status: 405 });
	}

	/**
	 * Accept a WebSocket upgrade via the Hibernation API.
	 *
	 * Creates a `WebSocketPair`, registers the server side with the Cloudflare
	 * runtime for hibernation, writes a server-stamped `PresenceEntry` for this
	 * connection, runs the initial Yjs sync handshake (SyncStep1), and returns
	 * the 101 Switching Protocols response.
	 *
	 * The `replicaId` and `connId` query parameters are required: `replicaId`
	 * is the client's install id (human-meaningful identity), `connId` is the
	 * per-socket routing address used by `dispatch({ to })`. Missing either
	 * yields a 400.
	 *
	 * Cancels any pending compaction alarm: a new client just connected, so
	 * compacting now would be wasteful.
	 *
	 * The client offers `sec-websocket-protocol: <MAIN_SUBPROTOCOL>, bearer.<token>`;
	 * we echo only the main subprotocol to complete the handshake. The bearer
	 * entry is consumed by `singleCredential` earlier in the chain and must not
	 * round-trip.
	 */
	private upgrade(request: Request): Response {
		const url = new URL(request.url);
		const replicaId = url.searchParams.get('replicaId');
		const connId = url.searchParams.get('connId');
		if (!replicaId || !connId) {
			return new Response('missing replicaId or connId', { status: 400 });
		}

		void this.ctx.storage.deleteAlarm();

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		this.ctx.acceptWebSocket(server);

		server.serializeAttachment({ connId } satisfies WsAttachment);

		this.doc.transact(() => {
			this.presence.set(connId, {
				connId,
				replicaId,
				subject: this.room.subject,
			});
		}, SERVER_ORIGIN);

		const connection = registerConnection({ doc: this.doc, ws: server });
		this.connections.set(server, connection);

		server.send(encodeSyncStep1({ doc: this.doc }));

		const responseHeaders = new Headers();
		const offered = parseSubprotocols(
			request.headers.get('sec-websocket-protocol'),
		);
		if (offered.includes(MAIN_SUBPROTOCOL)) {
			responseHeaders.set('sec-websocket-protocol', MAIN_SUBPROTOCOL);
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
			headers: responseHeaders,
		});
	}

	// --- RPC methods (called via stub.sync() / stub.getDoc()) ---

	/**
	 * HTTP sync via RPC.
	 *
	 * Binary body format: `[length-prefixed stateVector][length-prefixed update]`
	 * (encoded via `encodeSyncRequest` from sync-core).
	 *
	 * 1. Validates the client update does not write to the reserved
	 *    `PRESENCE_KEY` array (only the server writes presence). Throws
	 *    {@link PresenceWriteForbidden} on violation.
	 * 2. Applies client update to the live doc (triggers `updateV2` then SQLite
	 *    persist + broadcast to WebSocket peers).
	 * 3. Compares state vectors: returns `null` if already in sync (caller
	 *    maps to 204 No Content).
	 * 4. Otherwise returns the binary diff the client is missing.
	 */
	async sync(
		body: Uint8Array,
	): Promise<{ diff: Uint8Array | null; storageBytes: number }> {
		const { stateVector: clientSV, update } = decodeSyncRequest(body);

		if (update.byteLength > 0) {
			if (updateTouchesPresence(update)) {
				throw new PresenceWriteForbidden();
			}
			Y.applyUpdateV2(this.doc, update, 'http');
		}

		const serverSV = Y.encodeStateVector(this.doc);
		const diff = stateVectorsEqual(serverSV, clientSV)
			? null
			: Y.encodeStateAsUpdateV2(this.doc, clientSV);

		return { diff, storageBytes: this.ctx.storage.sql.databaseSize };
	}

	/**
	 * Snapshot bootstrap via RPC.
	 *
	 * Returns the full doc state via `Y.encodeStateAsUpdateV2`. Clients apply
	 * this with `Y.applyUpdateV2` to hydrate their local doc before opening a
	 * WebSocket, reducing the initial sync payload size.
	 */
	async getDoc(): Promise<{ data: Uint8Array; storageBytes: number }> {
		return {
			data: Y.encodeStateAsUpdateV2(this.doc),
			storageBytes: this.ctx.storage.sql.databaseSize,
		};
	}

	/** Delete all storage for this DO. Used for cleanup of renamed/orphaned rooms. */
	async deleteStorage(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}

	// --- WebSocket lifecycle ---

	/**
	 * Handle an incoming WebSocket message.
	 *
	 * Validates payload size against {@link MAX_PAYLOAD_BYTES}, converts the
	 * raw message to a `Uint8Array`, then delegates to `applyMessage` from
	 * `sync-handlers.ts` for protocol decoding. Routes the result:
	 *
	 * `reply`: Send data back to the sender only.
	 * `broadcast`: Fan out to all other connections.
	 *
	 * A `PresenceWriteForbidden` error closes the socket with code `4400`
	 * and reason `'presence-write-forbidden'`: only the server writes
	 * presence, so a client mutation of that reserved array is a protocol
	 * violation.
	 */
	override async webSocketMessage(
		ws: WebSocket,
		message: ArrayBuffer | string,
	): Promise<void> {
		const connection = this.connections.get(ws);
		if (!connection) return;

		const byteLength =
			message instanceof ArrayBuffer ? message.byteLength : message.length;
		if (byteLength > MAX_PAYLOAD_BYTES) {
			ws.close(1009, 'Message too large');
			return;
		}

		const data =
			message instanceof ArrayBuffer
				? new Uint8Array(message)
				: new TextEncoder().encode(message);

		const { data: result, error } = applyMessage({
			data,
			room: this.room,
			connection,
		});
		if (error) {
			if (error.name === SyncHandlerError.PresenceWriteForbidden.name) {
				ws.close(4400, 'presence-write-forbidden');
				return;
			}
			console.error(error.message);
			return;
		}
		if (!result) return;

		switch (result.action) {
			case 'reply':
				ws.send(result.data);
				break;
			case 'broadcast':
				for (const [peer] of this.connections) {
					if (peer !== ws && peer.readyState === WebSocket.OPEN) {
						try {
							peer.send(result.data);
						} catch {
							/* Socket may have died between readyState check and send.
							   Safe to ignore: the close event will fire and trigger
							   proper cleanup via webSocketClose(). */
						}
					}
				}
				break;
		}
	}

	/**
	 * Clean up a closed WebSocket connection.
	 *
	 * Deletes the server-stamped presence row for this socket (if its
	 * attachment is still readable), unregisters Yjs doc update handlers,
	 * removes the connection from the states map, and attempts to close the
	 * underlying socket (no-op if already closed by the remote end).
	 * Presence deletion stays here because it needs the room's `presence`
	 * store and the `SERVER_ORIGIN` transaction tag.
	 *
	 * When the last connection leaves, schedules a deferred compaction alarm.
	 */
	override async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		const connection = this.connections.get(ws);
		if (!connection) return;

		const att = ws.deserializeAttachment() as WsAttachment | null;
		if (att?.connId) {
			const orphanConnId = att.connId;
			this.doc.transact(() => {
				this.presence.delete(orphanConnId);
			}, SERVER_ORIGIN);
		}

		connection.unregister();
		this.connections.delete(ws);

		try {
			ws.close(code, reason);
		} catch {
			/* Already closed by the remote end. Cleanup above (handler
			   deregistration, presence delete) completed regardless. */
		}

		if (this.connections.size === 0) {
			void this.ctx.storage.setAlarm(Date.now() + COMPACTION_DELAY_MS);
		}
	}

	/**
	 * Handle a WebSocket error by closing with status 1011 (Internal Error).
	 *
	 * Delegates to {@link webSocketClose} so the same cleanup path
	 * (handler deregistration, presence delete, compaction scheduling)
	 * runs regardless of whether the socket closed cleanly or errored.
	 */
	override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		await this.webSocketClose(ws, 1011, 'WebSocket error', false);
	}

	// --- Alarm: deferred compaction ---

	/**
	 * Compact the update log after all clients disconnect.
	 *
	 * Scheduled 30s after the last WebSocket closes via `ctx.storage.setAlarm`.
	 * Cancelled if a client reconnects before the alarm fires (see `upgrade()`).
	 *
	 * If the DO is evicted before the alarm fires, the alarm still wakes it:
	 * the constructor re-runs `blockConcurrencyWhile` which does cold-start
	 * compaction, so the alarm handler finds <= 1 row and no-ops.
	 *
	 * @see {@link https://developers.cloudflare.com/durable-objects/api/alarms/ | Durable Objects Alarms}
	 */
	override async alarm(): Promise<void> {
		if (this.connections.size > 0) return;
		compactUpdateLog(this.ctx, this.doc);
	}
}

// ============================================================================
// Subject parser
// ============================================================================

/**
 * Extract the owning subject from the DO name.
 *
 * DO names are formatted by `getRoomStub` in app.ts as
 * `subject:{subject}:rooms:{room}`. Every connection to this DO shares the
 * same auth context, so `subject` is room-scoped, not connection-scoped.
 * Parsing once at construction lets the value survive hibernation without
 * extra plumbing through `WsAttachment`.
 *
 * Throws on an unrecognized shape so misconfigured deployments (test rigs
 * using `idFromString` / `newUniqueId`, or a future name builder regressing
 * the format) fail loudly at boot rather than silently broadcasting an empty
 * subject on every presence row.
 */
function subjectFromDoName(name: string | undefined): string {
	const match = name?.match(/^subject:([^:]+):/);
	if (!match) {
		throw new Error(
			`[room] DO name does not match expected ` +
				`"subject:{subject}:rooms:{room}" format: ${JSON.stringify(name)}`,
		);
	}
	return match[1] as string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Max compacted update size (2 MB). Cloudflare DO SQLite enforces a hard
 * 2 MB per-row BLOB limit.
 *
 * During compaction (cold-start or alarm), the current doc state is encoded
 * via `Y.encodeStateAsUpdateV2`. If the result fits under this limit, all
 * update rows are atomically replaced with a single compacted row. This
 * collapses thousands of tiny keystroke-level updates into one row,
 * dramatically improving future cold-start load times.
 */
const MAX_COMPACTED_BYTES = 2 * 1024 * 1024;

/**
 * Delay before alarm-based compaction fires (30 seconds).
 *
 * Long enough to skip reconnect storms (user refresh, network blip),
 * short enough to fire before DO eviction (~60s idle timeout).
 */
const COMPACTION_DELAY_MS = 30_000;

/**
 * Per-connection metadata persisted via `ws.serializeAttachment` to survive
 * hibernation. Only the server-issued `connId` is stored: it identifies
 * which presence row this socket owns for delete-on-close and the boot
 * orphan sweep.
 */
type WsAttachment = {
	connId: string;
};

// ============================================================================
// compactUpdateLog
// ============================================================================

/**
 * Compact the SQLite update log into a single row.
 *
 * Encodes the current doc state via `Y.encodeStateAsUpdateV2`: produces
 * smaller output than `Y.mergeUpdatesV2` because deleted items become
 * lightweight GC structs (with `gc: true`) and struct merging is more
 * thorough (with `gc: false`). Also avoids the exponential performance
 * edge case documented in yjs#710.
 *
 * No-ops if the log already has <= 1 row or the compacted blob exceeds
 * the 2 MB per-row BLOB limit.
 *
 * @see {@link https://github.com/yjs/yjs/issues/710 | yjs#710 mergeUpdatesV2 performance}
 */
function compactUpdateLog(ctx: DurableObjectState, doc: Y.Doc): void {
	const rowCount = ctx.storage.sql
		.exec('SELECT COUNT(*) as count FROM updates')
		.one().count as number;
	if (rowCount <= 1) return;

	const compacted = Y.encodeStateAsUpdateV2(doc);
	if (compacted.byteLength > MAX_COMPACTED_BYTES) return;

	ctx.storage.transactionSync(() => {
		ctx.storage.sql.exec('DELETE FROM updates');
		ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', compacted);
	});

	console.log(`[compaction] ${rowCount} rows to ${compacted.byteLength} bytes`);
}
