/**
 * Tab Manager actions: AI-callable operations that mix Chrome extension
 * APIs with Y.Doc writes.
 *
 * Live browser state (tabs, windows, tab groups) is NOT stored in the
 * workspace; Chrome is the sole authority. See `browser-state.svelte.ts`.
 */

import {
	defineActions,
	defineMutation,
	defineQuery,
	type Tables,
} from '@epicenter/workspace';
import Type from 'typebox';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Err, Ok, tryAsync } from 'wellcrafted/result';
import {
	type DeviceId,
	generateBookmarkId,
	generateSavedTabId,
	type tabManagerTables,
} from './definition';

export const TabError = defineErrors({
	BrowserApiFailed: ({
		operation,
		cause,
	}: {
		operation: string;
		cause: unknown;
	}) => ({
		message: `Browser API '${operation}' failed: ${extractErrorMessage(cause)}`,
		operation,
		cause,
	}),
	/**
	 * The saved-tab record was written successfully, but `browser.tabs.remove`
	 * failed during the close-source-tab step. The save is intact in the
	 * workspace; only the cleanup half failed. Surfaced as the `closeResult`
	 * channel on `saved_tabs_save`'s mixed return so callers can warn the user
	 * without losing the success of the save.
	 */
	SaveCloseFailed: ({
		url,
		browserTabId,
		cause,
	}: {
		url: string;
		browserTabId: number;
		cause: unknown;
	}) => ({
		message: `Saved '${url}' but couldn't close tab ${browserTabId}: ${extractErrorMessage(cause)}`,
		url,
		browserTabId,
		cause,
	}),
});
export type TabError = InferErrors<typeof TabError>;
export type BrowserApiFailed = Extract<TabError, { name: 'BrowserApiFailed' }>;
export type SaveCloseFailed = Extract<TabError, { name: 'SaveCloseFailed' }>;

export function createTabManagerActions({
	tables,
	batch,
	deviceId,
}: {
	tables: Tables<typeof tabManagerTables>;
	batch: (fn: () => void) => void;
	deviceId: Promise<DeviceId>;
}) {
	return defineActions({
		devices_list: defineQuery({
			title: 'List Devices',
			description:
				'List all synced devices with their names, browsers, and online status.',
			handler: () => {
				const devices = tables.devices.getAllValid();
				return {
					devices: devices.map((d) => ({
						id: d.id,
						name: d.name,
						browser: d.browser,
						lastSeen: d.lastSeen,
					})),
				};
			},
		}),
		tabs_list: defineQuery({
			title: 'List Open Tabs',
			description:
				'List all currently open browser tabs on this device. Returns live tab state from Chrome, not stored in the workspace.',
			handler: async () => {
				const tabs = await browser.tabs.query({});
				return tabs.map((t) => ({
					id: t.id ?? -1,
					url: t.url ?? '',
					title: t.title ?? '',
					active: t.active,
					pinned: t.pinned,
					windowId: t.windowId,
				}));
			},
		}),
		tabs_close: defineMutation({
			title: 'Close Tabs',
			description: 'Close one or more tabs by their IDs.',
			input: Type.Object({ tabIds: Type.Array(Type.Number()) }),
			handler: async ({ tabIds }) => {
				const { error } = await tryAsync({
					try: () => browser.tabs.remove(tabIds),
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.remove',
							cause,
						}),
				});
				if (error) return Err(error);
				return Ok({ closedCount: tabIds.length });
			},
		}),
		tabs_open: defineMutation({
			title: 'Open Tab',
			description: 'Open a new tab with the given URL on the current device.',
			input: Type.Object({ url: Type.String() }),
			handler: async ({ url }) =>
				tryAsync({
					try: async () => {
						const tab = await browser.tabs.create({ url });
						return { tabId: tab.id ?? -1 };
					},
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.create',
							cause,
						}),
				}),
		}),
		tabs_activate: defineMutation({
			title: 'Activate Tab',
			description: 'Activate (focus) a specific tab by its ID.',
			input: Type.Object({ tabId: Type.Number() }),
			handler: async ({ tabId }) =>
				tryAsync({
					try: async () => {
						await browser.tabs.update(tabId, { active: true });
						return { activated: true };
					},
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.update',
							cause,
						}),
				}),
		}),
		tabs_save: defineMutation({
			title: 'Save Tabs',
			description: 'Save tabs for later. Optionally close them after saving.',
			input: Type.Object({
				tabIds: Type.Array(Type.Number()),
				close: Type.Optional(Type.Boolean()),
			}),
			handler: async ({ tabIds, close }) => {
				const sourceDeviceId = await deviceId;
				const results = await Promise.allSettled(
					tabIds.map((id) => browser.tabs.get(id)),
				);
				const validTabs = results.flatMap((r) => {
					if (r.status !== 'fulfilled' || !r.value.url) return [];
					return [{ ...r.value, url: r.value.url }];
				});
				for (const tab of validTabs) {
					tables.savedTabs.set({
						id: generateSavedTabId(),
						url: tab.url,
						title: tab.title || 'Untitled',
						favIconUrl: tab.favIconUrl,
						pinned: tab.pinned ?? false,
						sourceDeviceId,
						savedAt: Date.now(),
						_v: 1,
					});
				}
				if (close) {
					const idsToClose = validTabs
						.map((t) => t.id)
						.filter((id) => id !== undefined);
					await tryAsync({
						try: () => browser.tabs.remove(idsToClose),
						catch: () => Ok(undefined),
					});
				}
				return { savedCount: validTabs.length };
			},
		}),
		tabs_group: defineMutation({
			title: 'Group Tabs',
			description: 'Group tabs together with an optional title and color.',
			input: Type.Object({
				tabIds: Type.Array(Type.Number()),
				title: Type.Optional(Type.String()),
				color: Type.Optional(Type.String()),
			}),
			handler: async ({ tabIds, title, color }) =>
				tryAsync({
					try: async () => {
						const groupId = await browser.tabs.group({
							tabIds: tabIds as [number, ...number[]],
						});
						if (title || color) {
							const updateProps: Browser.tabGroups.UpdateProperties = {};
							if (title) updateProps.title = title;
							if (color)
								updateProps.color = color as `${Browser.tabGroups.Color}`;
							await browser.tabGroups.update(groupId, updateProps);
						}
						return { groupId };
					},
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.group',
							cause,
						}),
				}),
		}),
		tabs_pin: defineMutation({
			title: 'Pin Tabs',
			description: 'Pin or unpin tabs.',
			input: Type.Object({
				tabIds: Type.Array(Type.Number()),
				pinned: Type.Boolean(),
			}),
			handler: async ({ tabIds, pinned }) => {
				const results = await Promise.allSettled(
					tabIds.map((id) => browser.tabs.update(id, { pinned })),
				);
				return {
					pinnedCount: results.filter((r) => r.status === 'fulfilled').length,
				};
			},
		}),
		tabs_mute: defineMutation({
			title: 'Mute Tabs',
			description: 'Mute or unmute tabs.',
			input: Type.Object({
				tabIds: Type.Array(Type.Number()),
				muted: Type.Boolean(),
			}),
			handler: async ({ tabIds, muted }) => {
				const results = await Promise.allSettled(
					tabIds.map((id) => browser.tabs.update(id, { muted })),
				);
				return {
					mutedCount: results.filter((r) => r.status === 'fulfilled').length,
				};
			},
		}),
		tabs_reload: defineMutation({
			title: 'Reload Tabs',
			description: 'Reload one or more tabs.',
			input: Type.Object({ tabIds: Type.Array(Type.Number()) }),
			handler: async ({ tabIds }) => {
				const results = await Promise.allSettled(
					tabIds.map((id) => browser.tabs.reload(id)),
				);
				return {
					reloadedCount: results.filter((r) => r.status === 'fulfilled').length,
				};
			},
		}),
		/**
		 * Save a single tab by its metadata: snapshot to Y.Doc and close the
		 * browser tab. Used by the UI where the BrowserTab object is already
		 * available. Silently no-ops for tabs without a URL.
		 */
		saved_tabs_save: defineMutation({
			title: 'Save Tab',
			description:
				'Save a tab for later by its metadata, then close the source tab. The save always succeeds (modulo CRDT errors); the close is best-effort and reported separately on `closeResult`.',
			input: Type.Object({
				browserTabId: Type.Number(),
				url: Type.String(),
				title: Type.String(),
				favIconUrl: Type.Optional(Type.String()),
				pinned: Type.Boolean(),
			}),
			handler: async ({ browserTabId, url, title, favIconUrl, pinned }) => {
				const sourceDeviceId = await deviceId;
				tables.savedTabs.set({
					id: generateSavedTabId(),
					url,
					title,
					favIconUrl,
					pinned,
					sourceDeviceId,
					savedAt: Date.now(),
					_v: 1,
				});
				// The save (Y.Doc write) always succeeded by here. The close
				// is partial-success: surface its own Result so callers can
				// distinguish "saved and closed" from "saved but tab still
				// open" without losing the fact that the save itself worked.
				const closeResult = await tryAsync({
					try: () => browser.tabs.remove(browserTabId),
					catch: (cause) =>
						TabError.SaveCloseFailed({ url, browserTabId, cause }),
				});
				return { saved: true as const, closeResult };
			},
		}),
		saved_tabs_restore: defineMutation({
			title: 'Restore Saved Tab',
			description: 'Re-open a saved tab in the browser and delete the record.',
			input: Type.Object({
				id: Type.String(),
				url: Type.String(),
				pinned: Type.Boolean(),
			}),
			handler: async ({ id, url, pinned }) => {
				// Only delete the saved record once the browser tab has actually
				// been re-created: otherwise a failed `tabs.create` silently
				// loses the saved URL.
				const { error } = await tryAsync({
					try: () => browser.tabs.create({ url, pinned }),
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.create',
							cause,
						}),
				});
				if (error) return Err(error);
				tables.savedTabs.delete(id);
				return Ok({ restored: true });
			},
		}),
		saved_tabs_restore_all: defineMutation({
			title: 'Restore All Saved Tabs',
			description: 'Re-open all saved tabs and delete their records.',
			handler: async () => {
				const all = tables.savedTabs.getAllValid();
				if (!all.length) return { restoredCount: 0 };
				const createPromises = all.map((tab) =>
					browser.tabs.create({ url: tab.url, pinned: tab.pinned }),
				);
				batch(() => {
					for (const tab of all) tables.savedTabs.delete(tab.id);
				});
				await Promise.allSettled(createPromises);
				return { restoredCount: all.length };
			},
		}),
		saved_tabs_remove: defineMutation({
			title: 'Remove Saved Tab',
			description: 'Delete a saved tab without restoring it.',
			input: Type.Object({ id: Type.String() }),
			handler: ({ id }) => {
				tables.savedTabs.delete(id);
				return { removed: true };
			},
		}),
		saved_tabs_remove_all: defineMutation({
			title: 'Remove All Saved Tabs',
			description: 'Delete all saved tabs without restoring them.',
			handler: () => {
				const all = tables.savedTabs.getAllValid();
				batch(() => {
					for (const tab of all) tables.savedTabs.delete(tab.id);
				});
				return { removedCount: all.length };
			},
		}),
		bookmarks_toggle: defineMutation({
			title: 'Toggle Bookmark',
			description:
				'Add or remove a bookmark for a URL. If the URL is already bookmarked, removes all matching bookmarks; otherwise creates a new bookmark.',
			input: Type.Object({
				url: Type.String(),
				title: Type.String(),
				favIconUrl: Type.Optional(Type.String()),
			}),
			handler: async ({ url, title, favIconUrl }) => {
				const allMatching = tables.bookmarks
					.getAllValid()
					.filter((b) => b.url === url);
				if (allMatching.length > 0) {
					for (const match of allMatching) tables.bookmarks.delete(match.id);
					return {
						action: 'removed' as const,
						removedCount: allMatching.length,
					};
				}
				const sourceDeviceId = await deviceId;
				tables.bookmarks.set({
					id: generateBookmarkId(),
					url,
					title,
					favIconUrl,
					description: undefined,
					sourceDeviceId,
					createdAt: Date.now(),
					_v: 1,
				});
				return { action: 'added' as const, removedCount: 0 };
			},
		}),
		bookmarks_open: defineMutation({
			title: 'Open Bookmark',
			description:
				'Open a bookmarked URL in a new browser tab. The bookmark is not deleted.',
			input: Type.Object({ url: Type.String() }),
			handler: async ({ url }) =>
				tryAsync({
					try: async () => {
						const tab = await browser.tabs.create({ url });
						return { tabId: tab.id ?? -1 };
					},
					catch: (cause) =>
						TabError.BrowserApiFailed({
							operation: 'tabs.create',
							cause,
						}),
				}),
		}),
		bookmarks_remove: defineMutation({
			title: 'Remove Bookmark',
			description: 'Delete a bookmark by its ID.',
			input: Type.Object({ id: Type.String() }),
			handler: ({ id }) => {
				tables.bookmarks.delete(id);
				return { removed: true };
			},
		}),
		bookmarks_remove_all: defineMutation({
			title: 'Remove All Bookmarks',
			description: 'Delete every bookmark.',
			handler: () => {
				const all = tables.bookmarks.getAllValid();
				batch(() => {
					for (const bookmark of all) tables.bookmarks.delete(bookmark.id);
				});
				return { removedCount: all.length };
			},
		}),
	});
}

export type TabManagerActions = ReturnType<typeof createTabManagerActions>;
