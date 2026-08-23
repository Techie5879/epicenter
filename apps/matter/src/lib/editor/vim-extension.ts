import { Vim, vim } from '@replit/codemirror-vim';

let globalVimMapsConfigured = false;

function configureGlobalVimMaps(): void {
	if (globalVimMapsConfigured) return;
	globalVimMapsConfigured = true;
	Vim.map('j', 'gj', 'normal');
	Vim.map('k', 'gk', 'normal');
}

/** Create Matter's Vim extension after installing its global maps once. */
export function matterVimExtension() {
	configureGlobalVimMaps();
	return vim();
}
