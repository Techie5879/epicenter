/**
 * The Better Auth browser client for the hosted SPA.
 *
 * Ownership boundary (deliberate, not incidental): Better Auth owns account
 * linking, passkeys, account rows, and cookie sessions, so its own browser
 * flows are driven by ITS client here. Epicenter owns identity, principal
 * resolution, bearer/workspace/WebSocket auth, and every non-browser client;
 * that lives in {@link $lib/platform/auth} ($lib/platform/auth.ts) and the
 * `@epicenter/auth` package. The dashboard legitimately uses both because they
 * answer different questions:
 *
 *   "Who is signed into Epicenter?"                  -> Epicenter auth client
 *   "What login methods are attached to this user?"  -> this Better Auth client
 *
 * `basePath: '/auth'` matches where the deployment mounts Better Auth (not the
 * library default `/api/auth`); same-origin so the first-party cookie rides on
 * every request. The passkey plugin client runs the WebAuthn ceremonies with
 * `@simplewebauthn/browser` internally, so nothing here hand-rolls them.
 */

import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
	baseURL: window.location.origin,
	basePath: '/auth',
	plugins: [passkeyClient()],
});

/** The browser exposes WebAuthn. The Better Auth server always has the plugin;
 *  this capability is the per-client gate the sign-in and account pages check. */
export function supportsPasskeys(): boolean {
	return typeof PublicKeyCredential !== 'undefined';
}

/** Better Auth's `{ data, error }` error arm. Its union has members that carry
 *  only some of these, so all are optional; the helpers below read what they
 *  need. */
export type AuthError = {
	status?: number;
	statusText?: string;
	message?: string;
	code?: string;
};

/**
 * A 401/403 on a login-method mutation means "sign in again": the session is
 * gone (401) or too old for the fresh-session gate (403 SESSION_NOT_FRESH, from
 * either this deployment's hook or Better Auth's own fresh middleware on
 * unlink). Both remedy the same way, so the callers branch on this, not on a
 * code string (Better Auth's unlink fresh-error carries no stable code).
 */
export function requiresReauth(error: AuthError | null): boolean {
	return error?.status === 401 || error?.status === 403;
}

/** The passkey client reports a dismissed/aborted browser prompt with these
 *  codes; callers reset quietly instead of showing an error. Takes the whole
 *  error because Better Auth's error union has arms without a `code`. */
export function isPasskeyCancellation(error: AuthError | null): boolean {
	const code = error?.code;
	return code === 'AUTH_CANCELLED' || code === 'ERROR_CEREMONY_ABORTED';
}
