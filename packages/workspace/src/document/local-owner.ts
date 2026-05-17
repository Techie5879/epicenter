/// <reference lib="dom" />

/**
 * Browser-local owner facade for an authenticated workspace session.
 *
 * Auth calls the server-issued identity label a `subject` because it derives
 * a `SubjectKeyring`. This package calls the same value `ownerId` once it is
 * used to name IndexedDB, BroadcastChannel, and wipe boundaries.
 *
 * Auth exposes this value as `auth.state.localIdentity.subject`. The workspace
 * layer receives the same string as `ownerId`. The rename is intentional: auth
 * names where the value comes from, while workspace names what the value owns
 * locally.
 *
 * Daemons do not construct an owner. They call `attachEncryption` directly
 * with `keyring` and persist through the filesystem instead of IndexedDB.
 */

import type { SubjectKeyring } from '@epicenter/encryption';
import { clearDocument } from 'y-indexeddb';
import type * as Y from 'yjs';
import { attachBroadcastChannel } from './attach-broadcast-channel.js';
import { attachEncryptedIndexedDb } from './attach-encrypted-indexed-db.js';
import { attachEncryption } from './attach-encryption.js';
import { createOwnedYjsKey, getOwnedYjsPrefix } from './local-yjs-key.js';

export type LocalOwner = ReturnType<typeof createLocalOwner>;

export function createLocalOwner({
	ownerId,
	keyring,
}: {
	/**
	 * Stable owner label for browser-local workspace data.
	 *
	 * The auth package exposes this value as `localIdentity.subject`; workspace
	 * code receives the same string as `ownerId`. This scopes IndexedDB
	 * databases, BroadcastChannel names, and wipe boundaries so two accounts in
	 * the same browser profile do not share local workspace data.
	 */
	ownerId: string;
	keyring: () => SubjectKeyring;
}) {
	return {
		/**
		 * Attach per-ydoc encrypted tables and KV. Thin delegate to the free
		 * `attachEncryption(ydoc, { keyring })`; browsers go through the owner
		 * so the keyring callback never has to be re-passed.
		 */
		attachEncryption(ydoc: Y.Doc) {
			return attachEncryption(ydoc, { keyring });
		},
		/**
		 * Attach owner-scoped browser-local Yjs wiring: encrypted IndexedDB
		 * persistence plus cross-tab BroadcastChannel sync. Both names are
		 * `createOwnedYjsKey(ownerId, ydoc.guid)`, so two signed-in subjects in
		 * the same browser profile neither share local storage nor exchange
		 * plaintext updates over BroadcastChannel.
		 *
		 * Always paired in browser bundles, so the facade exposes one call
		 * instead of two. Returns the IDB attachment for `whenLoaded` /
		 * `whenDisposed` barriers.
		 */
		attachLocal(ydoc: Y.Doc) {
			const databaseName = createOwnedYjsKey(ownerId, ydoc.guid);
			const idb = attachEncryptedIndexedDb(ydoc, { databaseName, keyring });
			attachBroadcastChannel(ydoc, databaseName);
			return idb;
		},
		/**
		 * Delete every owner-scoped IndexedDB database currently visible to
		 * this browser profile, plus any explicitly named ones. Use from
		 * `wipe()` paths on sign-out so the next signed-in subject starts
		 * from a clean slate.
		 */
		async wipeLocalYjsData(ydocGuids: Iterable<string> = []) {
			const prefix = getOwnedYjsPrefix(ownerId);
			const names = new Set<string>();

			for (const guid of ydocGuids) {
				names.add(createOwnedYjsKey(ownerId, guid));
			}

			if ('databases' in indexedDB) {
				const databases = await indexedDB.databases().catch(() => []);
				for (const database of databases) {
					if (typeof database.name !== 'string') continue;
					if (!database.name.startsWith(prefix)) continue;
					names.add(database.name);
				}
			}

			await Promise.all([...names].map((name) => clearDocument(name)));
		},
	};
}
