/** Mount Whispering's device-local model administration window. */

import '@epicenter/ui/app.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, {
	// biome-ignore lint/style/noNonNullAssertion: index.html always ships the mount node.
	target: document.getElementById('app')!,
});
