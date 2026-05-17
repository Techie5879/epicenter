import { createSession } from '@epicenter/svelte';
import { createReplicaId } from '@epicenter/workspace';
import { auth } from '$platform/auth';
import { openHoneycrispBrowser } from '../../browser';
import { createHoneycrispState } from '../routes/(signed-in)/state';

export const session = createSession({
	auth,
	build: ({ owner }) => {
		const honeycrisp = openHoneycrispBrowser({
			owner,
			replicaId: createReplicaId({ storage: localStorage }),
			openWebSocket: auth.openWebSocket,
		});
		const state = createHoneycrispState(honeycrisp);
		return {
			...honeycrisp,
			state,
			[Symbol.dispose]() {
				state[Symbol.dispose]();
				honeycrisp[Symbol.dispose]();
			},
		};
	},
});

export const requireHoneycrisp = session.require;

if (import.meta.hot) {
	import.meta.hot.dispose(() => session[Symbol.dispose]());
}
