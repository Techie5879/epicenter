import {
	type AuthClient,
	type CreateOAuthAppAuthConfig,
	createOAuthAppAuth as createCoreOAuthAppAuth,
} from '@epicenter/auth';
import { createSubscriber } from 'svelte/reactivity';

/**
 * Svelte 5 wrapper around `@epicenter/auth`.
 *
 * Spreads the closure-bound client and overrides `state` with a getter that
 * calls `subscribe()` so reads inside `$derived` / `$effect` track changes.
 */
export function createOAuthAppAuth(
	config: CreateOAuthAppAuthConfig,
): AuthClient {
	const auth = createCoreOAuthAppAuth(config);
	const subscribe = createSubscriber((update) => auth.onStateChange(update));
	return {
		...auth,
		get state() {
			subscribe();
			return auth.state;
		},
	};
}
