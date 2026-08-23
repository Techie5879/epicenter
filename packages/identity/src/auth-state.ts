import type { PrincipalId } from './identity.js';

/**
 * Current auth state for local-first workspace clients.
 *
 * `principalId` is present in `signed-in` and `reauth-required` because it is
 * the local partition key. Even when an OAuth grant needs reauth, the cached
 * principal id still picks the right local storage partition.
 *
 * This is capability state, not credential state. It lives in the MIT toolkit
 * so the MIT workspace and the AGPL auth client can share one definition
 * without workspace importing auth across the license firewall.
 */
export type AuthState =
	| { status: 'signed-out' }
	| { status: 'signed-in'; principalId: PrincipalId }
	| { status: 'reauth-required'; principalId: PrincipalId };
