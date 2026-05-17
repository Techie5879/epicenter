/**
 * Sync Handler Integration Tests
 *
 * Exercises the slimmed `applyMessage` / `registerConnection` surface that
 * survived the RPC-on-Yjs-state collapse.
 * Only SYNC frames produce traffic; AUTH is a reserved sentinel; client
 * writes to the reserved `PRESENCE_KEY` array are rejected at the boundary.
 */

import { describe, expect, test } from 'bun:test';

import {
	encodeSyncStep1,
	encodeSyncStep2,
	encodeSyncUpdate,
	MESSAGE_TYPE,
	SYNC_MESSAGE_TYPE,
} from '@epicenter/sync';
import { PRESENCE_KEY } from '@epicenter/workspace/document/keys';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import {
	applyMessage,
	type Connection,
	type RoomContext,
	registerConnection,
	SyncHandlerError,
	updateTouchesPresence,
} from './sync-handlers';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Minimal stand-in for a Cloudflare WebSocket. We only care about `send`
 * capturing outbound frames so tests can assert on them; `readyState = 1`
 * matches `WebSocket.OPEN` so any production code probing readiness is happy.
 */
class MockWebSocket {
	sent: Uint8Array[] = [];
	readyState = 1;
	send(data: Uint8Array | string): void {
		if (typeof data === 'string') {
			this.sent.push(new TextEncoder().encode(data));
			return;
		}
		this.sent.push(data);
	}
}

function makeRoom(subject = 'test-user'): RoomContext {
	return { doc: new Y.Doc(), subject };
}

function makeConnection(doc: Y.Doc): {
	ws: MockWebSocket;
	connection: Connection;
} {
	const ws = new MockWebSocket();
	const connection = registerConnection({
		doc,
		ws: ws as unknown as WebSocket,
	});
	return { ws, connection };
}

/** Build a raw SYNC + UPDATE frame around an arbitrary V2 update payload. */
function frameSyncUpdate(update: Uint8Array): Uint8Array {
	return encodeSyncUpdate({ update });
}

/** Build a frame with an arbitrary top-level message type for unknown-type tests. */
function frameSingleByte(messageType: number): Uint8Array {
	return encoding.encode((encoder) => {
		encoding.writeVarUint(encoder, messageType);
	});
}

/** Build a bare AUTH frame: just the AUTH varint with no payload. */
function frameAuth(): Uint8Array {
	return frameSingleByte(MESSAGE_TYPE.AUTH);
}

// ============================================================================
// registerConnection
// ============================================================================

describe('registerConnection', () => {
	test('forwards doc updates from other origins to the socket', () => {
		const room = makeRoom();
		const { ws } = makeConnection(room.doc);

		// Origin is *not* this ws, so the update should be forwarded.
		room.doc.transact(() => {
			room.doc.getMap('data').set('hello', 'world');
		}, 'some-other-origin');

		expect(ws.sent.length).toBe(1);
		// The forwarded frame is a SYNC + UPDATE frame.
		expect(ws.sent[0]?.[0]).toBe(MESSAGE_TYPE.SYNC);
		expect(ws.sent[0]?.[1]).toBe(SYNC_MESSAGE_TYPE.UPDATE);
	});

	test('skips echo when origin is the connection itself', () => {
		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		room.doc.transact(() => {
			room.doc.getMap('data').set('hello', 'world');
		}, connection.ws);

		expect(ws.sent.length).toBe(0);
	});

	test('multiple non-origin updates each produce a frame', () => {
		const room = makeRoom();
		const { ws } = makeConnection(room.doc);

		room.doc.transact(() => {
			room.doc.getMap('data').set('a', 1);
		}, 'origin-1');
		room.doc.transact(() => {
			room.doc.getMap('data').set('b', 2);
		}, 'origin-2');

		expect(ws.sent.length).toBe(2);
	});

	test('unregister stops forwarding doc updates', () => {
		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		room.doc.transact(() => {
			room.doc.getMap('data').set('pre', 1);
		}, 'other-origin');
		expect(ws.sent.length).toBe(1);

		connection.unregister();

		room.doc.transact(() => {
			room.doc.getMap('data').set('post', 2);
		}, 'other-origin');
		expect(ws.sent.length).toBe(1);
	});
});

// ============================================================================
// applyMessage: SYNC
// ============================================================================

describe('applyMessage SYNC STEP1', () => {
	test('replies with a STEP2 frame containing the server diff', () => {
		const room = makeRoom();
		room.doc.getMap('data').set('seed', 'value');

		// Client probes with an empty state vector.
		const clientDoc = new Y.Doc();
		const step1 = encodeSyncStep1({ doc: clientDoc });

		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: step1,
			room,
			connection,
		});

		expect(result.error).toBeNull();
		expect(result.data).not.toBeNull();
		expect(result.data?.action).toBe('reply');
		const reply = result.data?.data;
		expect(reply).toBeInstanceOf(Uint8Array);
		expect(reply?.[0]).toBe(MESSAGE_TYPE.SYNC);
		expect(reply?.[1]).toBe(SYNC_MESSAGE_TYPE.STEP2);
	});
});

describe('applyMessage SYNC STEP2 / UPDATE', () => {
	test('STEP2 payload applies state to the target doc', () => {
		const source = new Y.Doc();
		source.getMap('data').set('shared', 'yes');
		const step2 = encodeSyncStep2({ doc: source });

		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: step2,
			room,
			connection,
		});

		expect(result.error).toBeNull();
		expect(result.data).toBeNull(); // STEP2 has no reply.
		expect(room.doc.getMap('data').get('shared')).toBe('yes');
	});

	test('UPDATE payload applies state to the target doc', () => {
		const source = new Y.Doc();
		source.getMap('data').set('hello', 'world');
		const update = Y.encodeStateAsUpdateV2(source);
		const frame = frameSyncUpdate(update);

		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: frame,
			room,
			connection,
		});

		expect(result.error).toBeNull();
		expect(result.data).toBeNull();
		expect(room.doc.getMap('data').get('hello')).toBe('world');
	});
});

// ============================================================================
// Presence write rejection
// ============================================================================

describe('applyMessage presence write rejection', () => {
	test('rejects UPDATE frames that touch the reserved PRESENCE_KEY array', () => {
		const offender = new Y.Doc();
		offender.getArray(PRESENCE_KEY).push(['spoofed-presence-row']);
		const update = Y.encodeStateAsUpdateV2(offender);
		const frame = frameSyncUpdate(update);

		const room = makeRoom();
		const beforeSv = Y.encodeStateVector(room.doc);
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: frame,
			room,
			connection,
		});

		expect(result.data).toBeNull();
		expect(result.error).not.toBeNull();
		expect(result.error?.name).toBe('PresenceWriteForbidden');

		// Doc must not be mutated.
		const afterSv = Y.encodeStateVector(room.doc);
		expect(afterSv.byteLength).toBe(beforeSv.byteLength);
		for (let i = 0; i < afterSv.byteLength; i++) {
			expect(afterSv[i]).toBe(beforeSv[i] as number);
		}
		expect(room.doc.getArray(PRESENCE_KEY).length).toBe(0);
	});

	test('rejects STEP2 frames that touch the reserved PRESENCE_KEY array', () => {
		const offender = new Y.Doc();
		offender.getArray(PRESENCE_KEY).push(['spoofed-presence-row']);
		const frame = encodeSyncStep2({ doc: offender });

		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: frame,
			room,
			connection,
		});

		expect(result.error?.name).toBe('PresenceWriteForbidden');
		expect(room.doc.getArray(PRESENCE_KEY).length).toBe(0);
	});

	test('matches the variant factory output for SyncHandlerError', () => {
		// Sanity: the factory returns an Err-wrapped tagged error; `.error.name`
		// is the discriminator the dispatcher matches on.
		const sample = SyncHandlerError.PresenceWriteForbidden({});
		expect(sample.error?.name).toBe('PresenceWriteForbidden');
	});
});

// ============================================================================
// updateTouchesPresence helper
// ============================================================================

describe('updateTouchesPresence', () => {
	test('returns true when the update writes to PRESENCE_KEY', () => {
		const doc = new Y.Doc();
		doc.getArray(PRESENCE_KEY).push(['row-a']);
		const update = Y.encodeStateAsUpdateV2(doc);
		expect(updateTouchesPresence(update)).toBe(true);
	});

	test('returns false when the update writes to some other Y.Array key', () => {
		const doc = new Y.Doc();
		doc.getArray('table:posts').push(['unrelated-row']);
		const update = Y.encodeStateAsUpdateV2(doc);
		expect(updateTouchesPresence(update)).toBe(false);
	});

	test('returns false when the update is purely Y.Map writes', () => {
		const doc = new Y.Doc();
		doc.getMap('data').set('key', 'value');
		const update = Y.encodeStateAsUpdateV2(doc);
		expect(updateTouchesPresence(update)).toBe(false);
	});
});

// ============================================================================
// AUTH and unknown message types
// ============================================================================

describe('applyMessage AUTH', () => {
	test('AUTH frame is a no-op (null result, no error)', () => {
		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: frameAuth(),
			room,
			connection,
		});

		expect(result.error).toBeNull();
		expect(result.data).toBeNull();
	});
});

describe('applyMessage unknown message type', () => {
	test('unknown top-level type is a no-op (null result, no error)', () => {
		const room = makeRoom();
		const ws = new MockWebSocket();
		const connection = registerConnection({
			doc: room.doc,
			ws: ws as unknown as WebSocket,
		});

		const result = applyMessage({
			data: frameSingleByte(99),
			room,
			connection,
		});

		expect(result.error).toBeNull();
		expect(result.data).toBeNull();
	});
});
