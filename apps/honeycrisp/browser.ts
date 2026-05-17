/**
 * Honeycrisp browser runtime composition.
 *
 * Wraps `openHoneycrispWorkspace(owner.attachEncryption)` with browser-only
 * attachments (encrypted IndexedDB, BroadcastChannel, root collaboration) and
 * a disposable cache of per-note rich-text body sub-docs that each open their
 * own IDB/BroadcastChannel/sync. The action set comes from the shared
 * workspace opener so daemon-side and browser-side action surfaces stay
 * identical without a second factory call here.
 *
 * The bundle's `wipe()` drops every encrypted IDB database for this owner;
 * `Symbol.dispose` tears down the root + cached child Y.Docs without
 * touching local storage.
 */

import { APP_URLS } from '@epicenter/constants/vite';
import { type NoteId, openHoneycrispWorkspace } from '@epicenter/honeycrisp';
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

export function openHoneycrispBrowser({
	owner,
	replicaId,
	openWebSocket,
}: {
	owner: LocalOwner;
	replicaId: string;
	openWebSocket?: OpenWebSocket;
}) {
	const workspace = openHoneycrispWorkspace(owner.attachEncryption);
	const { ydoc: rootYdoc, tables, kv } = workspace;

	const idb = owner.attachLocal(rootYdoc);

	const noteBodyDocs = createDisposableCache((noteId: NoteId) => {
		const ydoc = new Y.Doc({
			guid: workspace.noteBodyDocGuid(noteId),
			gc: false,
		});
		const body = attachRichText(ydoc);
		const childIdb = owner.attachLocal(ydoc);
		// Each rich-text body is its own Y.Doc (its own sync room keyed by the
		// body guid), so opening a per-body WebSocket here is intentional:
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
			tables.notes.update(noteId, {
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
		noteBodyDocs,
		collaboration,
		async wipe() {
			const fallbackGuids = [
				rootYdoc.guid,
				...tables.notes
					.getAllValid()
					.map((note) => workspace.noteBodyDocGuid(note.id)),
			];
			noteBodyDocs[Symbol.dispose]();
			rootYdoc.destroy();
			await Promise.all([idb.whenDisposed, collaboration.whenDisposed]);
			await owner.wipeLocalYjsData(fallbackGuids);
		},
		[Symbol.dispose]() {
			noteBodyDocs[Symbol.dispose]();
			rootYdoc.destroy();
		},
	};
}

export type HoneycrispBrowser = ReturnType<typeof openHoneycrispBrowser>;
