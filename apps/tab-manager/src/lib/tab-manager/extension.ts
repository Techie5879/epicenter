/**
 * Live browser state (tabs, windows, tab groups) is NOT stored here.
 * Chrome is the sole authority for ephemeral browser state. See
 * `browser-state.svelte.ts`.
 */

import { APP_URLS } from '@epicenter/constants/vite';
import {
	type LocalOwner,
	type OpenWebSocket,
	openCollaboration,
	roomWsUrl,
} from '@epicenter/workspace';
import * as Y from 'yjs';
import { createTabManagerActions } from '$lib/workspace/actions';
import { type DeviceId, tabManagerTables } from '$lib/workspace/definition';

/**
 * Build the tab-manager binding. Synchronous: callers must resolve the
 * replica id before invoking (the extension's replica id comes from
 * `chrome.storage.local` and from `createDeviceProfile()` in `device.ts`).
 *
 * Consumers gate UI render on `tabManager.idb.whenLoaded`; sync (the
 * WebSocket) is independent and connects whenever the network allows.
 */
export function openTabManagerBrowser({
	owner,
	replicaId,
	openWebSocket,
}: {
	owner: LocalOwner;
	replicaId: DeviceId;
	openWebSocket?: OpenWebSocket;
}) {
	const ydoc = new Y.Doc({ guid: 'epicenter.tab-manager', gc: false });
	const encryption = owner.attachEncryption(ydoc);
	const tables = encryption.attachTables(tabManagerTables);
	const kv = encryption.attachKv({});
	const batch = (fn: () => void) => ydoc.transact(fn);

	const idb = owner.attachLocal(ydoc);

	const actions = createTabManagerActions({
		tables,
		batch,
		deviceId: Promise.resolve(replicaId),
	});

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl(APP_URLS.API, ydoc.guid),
		waitFor: idb.whenLoaded,
		openWebSocket,
		replicaId,
		actions,
	});

	return {
		ydoc,
		tables,
		kv,
		batch,
		idb,
		collaboration,
		async wipe() {
			ydoc.destroy();
			await Promise.all([idb.whenDisposed, collaboration.whenDisposed]);
			await owner.wipeLocalYjsData([ydoc.guid]);
		},
		[Symbol.dispose]() {
			ydoc.destroy();
		},
	};
}

export type TabManagerBrowser = ReturnType<typeof openTabManagerBrowser>;
