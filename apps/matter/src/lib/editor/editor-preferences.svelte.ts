import { createPersistedState } from '@epicenter/svelte';
import { type } from 'arktype';

const vimPreference = createPersistedState({
	key: 'matter.editor.vim',
	schema: type('boolean'),
	defaultValue: false,
});

export const editorPreferences = {
	/** Whether Matter body editors should include Vim mode. */
	get vimEnabled() {
		return vimPreference.current;
	},
	/** Persist the Vim mode preference for future editor sessions. */
	setVimEnabled(enabled: boolean): void {
		vimPreference.current = enabled;
	},
};
