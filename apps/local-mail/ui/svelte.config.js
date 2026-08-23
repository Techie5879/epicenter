import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The SPA is served at the loopback origin root by `local-mail app`, which
		// reads bytes from `ui/dist`. `fallback` makes every deep link resolve to
		// the same shell (client-only routing).
		adapter: staticAdapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html',
		}),
	},
	preprocess: vitePreprocess(),
};

export default config;
