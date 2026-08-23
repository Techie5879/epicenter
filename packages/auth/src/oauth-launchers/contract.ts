import type { Result } from 'wellcrafted/result';
import type { OAuthTokenGrant } from '../auth-types.js';

/**
 * Result of a runtime-specific OAuth launch.
 *
 * `completed` means the launcher already has an authorization-code grant for
 * auth core to verify and persist. `launched` means the runtime handed control
 * away, usually through browser navigation, and completion will happen through
 * a later callback invocation.
 */
export type OAuthLaunchResult =
	| { status: 'completed'; grant: OAuthTokenGrant }
	| { status: 'launched' };

/**
 * Runtime-specific OAuth launcher consumed by auth core.
 *
 * A launcher owns the transport mechanics of sign-in: full-page browser
 * redirects, extension web-auth APIs, native-app deep links, or other runtimes.
 * `completed` carries the token grant immediately. `launched` means control has
 * moved to another runtime surface and a later callback will complete sign-in.
 */
export type OAuthLauncher = {
	startSignIn(): Promise<Result<OAuthLaunchResult, unknown>>;
};
