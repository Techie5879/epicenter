import type { HoneycrispBrowser } from '../../../browser';
import { createFolders } from './folders.svelte';
import { createNotes } from './notes.svelte';
import { createView } from './view.svelte';

export function createHoneycrispState(honeycrisp: HoneycrispBrowser) {
	const folders = createFolders(honeycrisp);
	const notes = createNotes({ folders, honeycrisp });
	const view = createView({ folders, notes });

	return {
		folders,
		notes,
		view,
		[Symbol.dispose]() {
			view[Symbol.dispose]();
			notes[Symbol.dispose]();
			folders[Symbol.dispose]();
		},
	};
}
