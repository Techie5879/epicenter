/**
 * Reactive folder state for Honeycrisp.
 *
 * Manages folder CRUD operations and the reactive folder list. Backed by
 * a Y.Doc CRDT table, so folders sync across devices. Clears URL search
 * param selections when the active folder is deleted.
 *
 * @example
 * ```svelte
 * <script>
 *   import { requireHoneycrisp } from '$lib/session';
 *
 *   const honeycrisp = requireHoneycrisp();
 * </script>
 *
 * {#each honeycrisp.state.folders.all as folder (folder.id)}
 *   <p>{folder.name}</p>
 * {/each}
 * <button onclick={() => honeycrisp.state.folders.create()}>New Folder</button>
 * ```
 */

import type { FolderId } from '@epicenter/honeycrisp';
import { fromTable } from '@epicenter/svelte';
import { generateId } from '@epicenter/workspace';
import type { HoneycrispBrowser } from '../../../browser';
import { searchParams } from './search-params.svelte';

export function createFolders(honeycrisp: HoneycrispBrowser) {
	// ─── Reactive State ──────────────────────────────────────────────────

	const foldersMap = fromTable(honeycrisp.tables.folders);

	const all = $derived([...foldersMap.values()]);

	// ─── Public API ──────────────────────────────────────────────────────

	return {
		[Symbol.dispose]() {
			foldersMap[Symbol.dispose]();
		},

		/**
		 * Look up a folder by ID. Returns `undefined` if not found.
		 */
		get(id: FolderId) {
			return foldersMap.get(id);
		},

		get all() {
			return all;
		},

		/**
		 * Create a new folder with the default name "New Folder".
		 *
		 * The folder is added to the end of the folder list and can be renamed
		 * immediately. Use this when the user clicks "New Folder" in the sidebar.
		 *
		 * @example
		 * ```typescript
		 * app.state.folders.create();
		 * // Folder appears in sidebar with name "New Folder"
		 * ```
		 */
		create() {
			const id = generateId() as FolderId;
			honeycrisp.tables.folders.set({
				id,
				name: 'New Folder',
				sortOrder: foldersMap.size,
				_v: 1,
			});
		},

		/**
		 * Rename an existing folder.
		 *
		 * Updates the folder name in the sidebar and all references. The folder
		 * must exist; if it doesn't, the update is silently ignored.
		 *
		 * @example
		 * ```typescript
		 * app.state.folders.rename(folderId, 'Work');
		 * ```
		 */
		rename(folderId: FolderId, name: string) {
			honeycrisp.tables.folders.update(folderId, { name });
		},

		/**
		 * Delete a folder and move all its notes to unfiled.
		 *
		 * The folder is removed from the sidebar. All notes that were in this
		 * folder are moved to the unfiled section (folderId set to undefined).
		 * If the deleted folder was selected, the folder and note selections are cleared.
		 *
		 * @example
		 * ```typescript
		 * app.state.folders.delete(folderId);
		 * // Folder disappears from sidebar, its notes move to "All Notes"
		 * ```
		 */
		delete(folderId: FolderId) {
			honeycrisp.collaboration.actions.folders_delete({ folderId });
			if (searchParams.folder === folderId) {
				searchParams.update({ folder: null, note: null });
			}
		},
	};
}
