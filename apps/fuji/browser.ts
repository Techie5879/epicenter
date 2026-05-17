/**
 * Fuji browser runtime composition.
 *
 * Wraps `openFujiWorkspace(owner.attachEncryption)` with browser-only
 * attachments (encrypted IndexedDB, BroadcastChannel, root collaboration) and
 * a disposable cache of per-entry rich-text body sub-docs that each open their
 * own IDB/BroadcastChannel/sync. The action set comes from the shared
 * workspace opener so daemon-side and browser-side action surfaces stay
 * identical without a second factory call here.
 *
 * The bundle's `wipe()` drops every encrypted IDB database for this owner;
 * `Symbol.dispose` tears down the root + cached child Y.Docs without
 * touching local storage.
 */

import { APP_URLS } from '@epicenter/constants/vite';
import { type EntryId, openFujiWorkspace } from '@epicenter/fuji';
import {
	attachRichText,
	createDisposableCache,
	DateTimeString,
	type LocalOwner,
	type OpenWebSocket,
	onLocalUpdate,
	openCollaboration,
	roomWsUrl,
} from '@epicenter/workspace';
import * as Y from 'yjs';

export function openFujiBrowser({
	owner,
	replicaId,
	openWebSocket,
}: {
	owner: LocalOwner;
	replicaId: string;
	openWebSocket?: OpenWebSocket;
}) {
	const workspace = openFujiWorkspace(owner.attachEncryption);
	const { ydoc: rootYdoc, tables, kv } = workspace;

	const idb = owner.attachLocal(rootYdoc);

	const entryContentDocs = createDisposableCache((entryId: EntryId) => {
		const ydoc = new Y.Doc({
			guid: workspace.entryContentDocGuid(entryId),
			gc: false,
		});
		const body = attachRichText(ydoc);
		const childIdb = owner.attachLocal(ydoc);
		// Each rich-text body is its own Y.Doc (its own sync room keyed by the
		// content guid), so opening a per-body WebSocket here is intentional:
		// the server multiplexes by room, not by client. Tear-down lives in
		// the cache's `Symbol.dispose`.
		const childSync = openCollaboration(ydoc, {
			url: roomWsUrl(APP_URLS.API, ydoc.guid),
			waitFor: childIdb.whenLoaded,
			openWebSocket,
			replicaId,
			actions: {},
		});

		onLocalUpdate(ydoc, () => {
			tables.entries.update(entryId, {
				updatedAt: DateTimeString.now(),
			});
		});

		return {
			ydoc,
			body,
			idb: childIdb,
			sync: childSync,
			/**
			 * child disposer rejections do not propagate; bundle.wipe() relies on
			 * IDB's deleteDatabase native blocking as belt-and-suspenders for
			 * storage deletion.
			 */
			[Symbol.dispose]() {
				ydoc.destroy();
			},
		};
	});

	const collaboration = openCollaboration(rootYdoc, {
		url: roomWsUrl(APP_URLS.API, rootYdoc.guid),
		waitFor: idb.whenLoaded,
		openWebSocket,
		replicaId,
		actions: workspace.actions,
	});

	return {
		ydoc: rootYdoc,
		tables,
		kv,
		batch: workspace.batch,
		idb,
		entryContentDocs,
		collaboration,
		async wipe() {
			const fallbackGuids = [
				rootYdoc.guid,
				...tables.entries
					.getAllValid()
					.map((entry) => workspace.entryContentDocGuid(entry.id)),
			];
			entryContentDocs[Symbol.dispose]();
			rootYdoc.destroy();
			await Promise.all([idb.whenDisposed, collaboration.whenDisposed]);
			await owner.wipeLocalYjsData(fallbackGuids);
		},
		[Symbol.dispose]() {
			entryContentDocs[Symbol.dispose]();
			rootYdoc.destroy();
		},
	};
}

export type FujiBrowser = ReturnType<typeof openFujiBrowser>;
