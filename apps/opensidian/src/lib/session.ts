import { createSession } from '@epicenter/svelte';
import { createReplicaId } from '@epicenter/workspace';
import { auth } from '$platform/auth';
import { createAiChatState } from './chat/chat-state.svelte';
import { openOpensidianBrowser } from './opensidian/browser';
import { createEditorState } from './state/editor-state.svelte';
import { createFilesState } from './state/files-state.svelte';
import { createPaletteSearchState } from './state/palette-search-state.svelte';
import { createSidebarSearchState } from './state/sidebar-search-state.svelte';
import { createSkillState } from './state/skill-state.svelte';
import { createTerminalState } from './state/terminal-state.svelte';
import { createSampleDataLoader } from './utils/load-sample-data.svelte';

export const session = createSession({
	auth,
	build: ({ owner }) => {
		const opensidian = openOpensidianBrowser({
			owner,
			replicaId: createReplicaId({ storage: localStorage }),
			openWebSocket: auth.openWebSocket,
		});
		const editor = createEditorState();
		const files = createFilesState({ binding: opensidian });
		const paletteSearch = createPaletteSearchState({
			files,
			binding: opensidian,
		});
		const sidebarSearch = createSidebarSearchState({ binding: opensidian });
		const terminal = createTerminalState({ files, binding: opensidian });
		const skills = createSkillState({ binding: opensidian });
		const chat = createAiChatState({
			auth,
			binding: opensidian,
			skills,
		});
		const sampleData = createSampleDataLoader(opensidian);
		const state = {
			editor,
			files,
			paletteSearch,
			sidebarSearch,
			terminal,
			skills,
			chat,
			sampleData,
		};

		return {
			...opensidian,
			state,
			[Symbol.dispose]() {
				chat[Symbol.dispose]();
				skills[Symbol.dispose]();
				sidebarSearch[Symbol.dispose]();
				paletteSearch[Symbol.dispose]();
				files[Symbol.dispose]();
				opensidian[Symbol.dispose]();
			},
		};
	},
});

export const requireOpensidian = session.require;

if (import.meta.hot) {
	import.meta.hot.dispose(() => session[Symbol.dispose]());
}
