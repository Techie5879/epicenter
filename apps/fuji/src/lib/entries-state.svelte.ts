import type { EntryId } from '@epicenter/fuji';
import { fromTable } from '@epicenter/svelte';
import type { FujiBrowser } from '../../browser';

/**
 * Reactive entries selectors derived from the fuji binding's entries table.
 *
 * Components read this through `requireFuji().entries`; the active and
 * deleted lists update reactively as entries change. Disposed alongside the
 * session.
 */
export function createEntriesState(fuji: FujiBrowser) {
	const entriesMap = fromTable(fuji.tables.entries);
	const active = $derived(
		[...entriesMap.values()].filter((e) => e.deletedAt === undefined),
	);
	const deleted = $derived(
		[...entriesMap.values()].filter((e) => e.deletedAt !== undefined),
	);
	return {
		get: (id: EntryId) => entriesMap.get(id),
		get active() {
			return active;
		},
		get deleted() {
			return deleted;
		},
		[Symbol.dispose]() {
			entriesMap[Symbol.dispose]();
		},
	};
}
