/**
 * LocalOwner behavior tests.
 *
 * Covers the identity-scoped surfaces exposed by `createLocalOwner`:
 * - `attachLocal`: paired encrypted IndexedDB persistence + cross-tab
 *   BroadcastChannel sync keyed by `(ownerId, ydoc.guid)`. Round-trip,
 *   guid-bound storage key, and owner-scoped channel-name invariants.
 * - `wipeLocalYjsData`: deletes known guids and enumerated owner-scoped
 *   databases, leaves other owners and unscoped local docs alone.
 *
 * These tests pin the durable IndexedDB prefix at `epicenter.owner.`
 * so any accidental rename of the storage label is caught here.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	base64ToBytes,
	bytesToBase64,
	decryptBytes,
	deriveWorkspaceKey,
	type EncryptedBlob,
	type SubjectKeyring,
} from '@epicenter/encryption';
import { randomBytes } from '@noble/ciphers/utils.js';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createLocalOwner } from './local-owner.js';

Object.assign(globalThis, { indexedDB, IDBKeyRange });

function toKeyring(key: Uint8Array): SubjectKeyring {
	return [{ version: 1, subjectKeyBase64: bytesToBase64(key) }];
}

const noKeys: () => SubjectKeyring = () => toKeyring(randomBytes(32));

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readEncryptedUpdates(dbName: string): Promise<EncryptedBlob[]> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(dbName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	try {
		const transaction = db.transaction(['updates'], 'readonly');
		const store = transaction.objectStore('updates');
		return await new Promise<EncryptedBlob[]>((resolve, reject) => {
			const request = store.getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result as EncryptedBlob[]);
		});
	} finally {
		db.close();
	}
}

function keyringForGuid(
	keyring: SubjectKeyring,
	guid: string,
): Map<number, Uint8Array> {
	return new Map(
		keyring.map(({ version, subjectKeyBase64 }) => [
			version,
			deriveWorkspaceKey(base64ToBytes(subjectKeyBase64), guid),
		]),
	);
}

async function createDatabase(name: string): Promise<void> {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	database.close();
}

async function deleteDatabase(name: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
		request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
	});
}

async function databaseNames(): Promise<string[]> {
	const databases = await indexedDB.databases();
	return databases
		.map((database) => database.name)
		.filter((name): name is string => typeof name === 'string');
}

describe('LocalOwner.attachLocal', () => {
	test('throws when keyring throws', () => {
		const ydoc = new Y.Doc({ guid: 'encrypted-idb-no-keys', gc: false });
		const owner = createLocalOwner({
			ownerId: 'user-no-keys',
			keyring: () => {
				throw new Error('not signed-in');
			},
		});

		expect(() => owner.attachLocal(ydoc)).toThrow('not signed-in');
		ydoc.destroy();
	});

	test('round trips encrypted Yjs updates through IndexedDB at the owner prefix', async () => {
		const ownerId = `user-${crypto.randomUUID()}`;
		const databaseName = `epicenter.owner.${ownerId}.yjs.encrypted-idb-roundtrip`;
		const keyring = toKeyring(randomBytes(32));

		const firstDoc = new Y.Doc({
			guid: 'encrypted-idb-roundtrip',
			gc: false,
		});
		const firstOwner = createLocalOwner({
			ownerId,
			keyring: () => keyring,
		});
		const firstIdb = firstOwner.attachLocal(firstDoc);
		await firstIdb.whenLoaded;
		firstDoc.getText('body').insert(0, 'stored ciphertext');
		await tick();
		firstDoc.destroy();
		await firstIdb.whenDisposed;

		const rawUpdates = await readEncryptedUpdates(databaseName);
		expect(rawUpdates.length).toBeGreaterThan(0);
		expect(rawUpdates.every((update) => update[0] === 1)).toBe(true);

		const secondDoc = new Y.Doc({
			guid: 'encrypted-idb-roundtrip',
			gc: false,
		});
		const secondOwner = createLocalOwner({
			ownerId,
			keyring: () => keyring,
		});
		const secondIdb = secondOwner.attachLocal(secondDoc);
		await secondIdb.whenLoaded;

		expect(secondDoc.getText('body').toString()).toBe('stored ciphertext');
		secondDoc.destroy();
		await secondIdb.whenDisposed;
		await secondIdb.clearLocal();
	});

	test('target guid changes the derived storage key', async () => {
		const ownerId = `user-${crypto.randomUUID()}`;
		const databaseName = `epicenter.owner.${ownerId}.yjs.encrypted-idb-guid-a`;
		const keyring = toKeyring(randomBytes(32));
		const ydoc = new Y.Doc({ guid: 'encrypted-idb-guid-a', gc: false });
		const owner = createLocalOwner({ ownerId, keyring: () => keyring });
		const idb = owner.attachLocal(ydoc);
		await idb.whenLoaded;
		ydoc.getText('body').insert(0, 'guid bound');
		await tick();
		ydoc.destroy();
		await idb.whenDisposed;

		const rawUpdates = await readEncryptedUpdates(databaseName);
		const updateWithContent = rawUpdates.at(-1);
		expect(updateWithContent).toBeDefined();
		expect(() =>
			decryptBytes({
				keyring: keyringForGuid(keyring, 'encrypted-idb-guid-b'),
				blob: updateWithContent as EncryptedBlob,
				aad: new TextEncoder().encode('yjs-update-v2:encrypted-idb-guid-a'),
			}),
		).toThrow();
		await idb.clearLocal();
	});

	test('clearLocal clears the encrypted IndexedDB database', async () => {
		const ownerId = `user-${crypto.randomUUID()}`;
		const keyring = toKeyring(randomBytes(32));

		const firstDoc = new Y.Doc({ guid: 'encrypted-idb-clear', gc: false });
		const firstOwner = createLocalOwner({
			ownerId,
			keyring: () => keyring,
		});
		const firstIdb = firstOwner.attachLocal(firstDoc);
		await firstIdb.whenLoaded;
		firstDoc.getText('body').insert(0, 'clear me');
		await tick();
		firstDoc.destroy();
		await firstIdb.whenDisposed;
		await firstIdb.clearLocal();

		const secondDoc = new Y.Doc({ guid: 'encrypted-idb-clear', gc: false });
		const secondOwner = createLocalOwner({
			ownerId,
			keyring: () => keyring,
		});
		const secondIdb = secondOwner.attachLocal(secondDoc);
		await secondIdb.whenLoaded;

		expect(secondDoc.getText('body').toString()).toBe('');
		secondDoc.destroy();
		await secondIdb.whenDisposed;
		await secondIdb.clearLocal();
	});
});

const originalBroadcastChannel = globalThis.BroadcastChannel;

class FakeBroadcastChannel {
	static names: string[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(public name: string) {
		FakeBroadcastChannel.names.push(name);
	}

	postMessage(_message: unknown): void {}
	close(): void {}
}

describe('LocalOwner.attachLocal BroadcastChannel naming', () => {
	beforeEach(() => {
		FakeBroadcastChannel.names = [];
		Object.assign(globalThis, {
			BroadcastChannel:
				FakeBroadcastChannel as unknown as typeof BroadcastChannel,
		});
	});

	afterEach(() => {
		Object.assign(globalThis, { BroadcastChannel: originalBroadcastChannel });
	});

	test('uses an owner-scoped channel key without changing ydoc.guid', () => {
		const ydoc = new Y.Doc({ guid: 'epicenter.fuji' });
		const owner = createLocalOwner({
			ownerId: 'user-123',
			keyring: noKeys,
		});

		owner.attachLocal(ydoc);

		expect(FakeBroadcastChannel.names).toEqual([
			'yjs.epicenter.owner.user-123.yjs.epicenter.fuji',
		]);
		expect(ydoc.guid).toBe('epicenter.fuji');
		ydoc.destroy();
	});
});

describe('LocalOwner.wipeLocalYjsData', () => {
	afterEach(async () => {
		await Promise.all(
			(await databaseNames()).map((name) => deleteDatabase(name)),
		);
	});

	test('clears known scoped document keys at the owner prefix', async () => {
		await createDatabase('epicenter.owner.user-1.yjs.doc-a');
		await createDatabase('epicenter.owner.user-1.yjs.doc-b');

		const owner = createLocalOwner({
			ownerId: 'user-1',
			keyring: noKeys,
		});
		await owner.wipeLocalYjsData(['doc-a', 'doc-b']);

		const remaining = await databaseNames();
		expect(remaining).not.toContain('epicenter.owner.user-1.yjs.doc-a');
		expect(remaining).not.toContain('epicenter.owner.user-1.yjs.doc-b');
	});

	test('also clears enumerated scoped database names and leaves others alone', async () => {
		await createDatabase('epicenter.owner.user-1.yjs.doc-a');
		await createDatabase('epicenter.owner.user-1.yjs.doc-b');
		await createDatabase('epicenter.owner.user-2.yjs.doc-c');
		await createDatabase('unscoped-doc');

		const owner = createLocalOwner({
			ownerId: 'user-1',
			keyring: noKeys,
		});
		await owner.wipeLocalYjsData(['doc-a']);

		const remaining = await databaseNames();
		expect(remaining).not.toContain('epicenter.owner.user-1.yjs.doc-a');
		expect(remaining).not.toContain('epicenter.owner.user-1.yjs.doc-b');
		expect(remaining).toContain('epicenter.owner.user-2.yjs.doc-c');
		expect(remaining).toContain('unscoped-doc');
	});
});
