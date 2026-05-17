import { createSession } from '@epicenter/svelte';
import { createReplicaId } from '@epicenter/workspace';
import { auth } from '$platform/auth';
import { openFujiBrowser } from '../../browser';
import { createEntriesState } from './entries-state.svelte';

export const session = createSession({
	auth,
	build: ({ owner }) => {
		const fuji = openFujiBrowser({
			owner,
			replicaId: createReplicaId({ storage: localStorage }),
			openWebSocket: auth.openWebSocket,
		});
		const entries = createEntriesState(fuji);
		return {
			...fuji,
			entries,
			[Symbol.dispose]() {
				entries[Symbol.dispose]();
				fuji[Symbol.dispose]();
			},
		};
	},
});

export const requireFuji = session.require;

if (import.meta.hot) {
	import.meta.hot.dispose(() => session[Symbol.dispose]());
}
