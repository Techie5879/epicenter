import { defineErrors, type InferErrors } from 'wellcrafted/error';

/**
 * Required scope for the app access token routes (`/ai/*`,
 * `/workspaces/*`, `/documents/*`, `/api/billing/*`, `/api/assets/*`).
 * The `/workspace-identity` endpoint enforces it for key release;
 * `requireAppAccessToken` enforces it on every other gated path before
 * the route handler runs.
 */
export const WORKSPACES_OPEN_SCOPE = 'workspaces:open';

/**
 * Failure shapes produced by every OAuth app access token resolver in this
 * package.
 *
 * Variants:
 * - `InvalidToken`: bearer was missing, unparseable, failed verification,
 *   or resolved to a user no longer in the database. Per RFC 6750 these
 *   all map to HTTP 401 `invalid_token` at the app access token route gate.
 * - `InsufficientScope`: bearer verified and resolved to a user, but the
 *   required scope is not in the token's `scope` claim. Maps to HTTP 403
 *   `insufficient_scope` with the required scope echoed back.
 *
 * The serialized error object (`{ name, message, ...fields }`) is itself
 * the wire format consumers see; downstream callers reconstruct by
 * branching on `error.name`.
 */
export const OAuthError = defineErrors({
	InvalidToken: () => ({
		message: 'OAuth access token is missing, malformed, or unverifiable.',
	}),
	InsufficientScope: ({ scope }: { scope: string }) => ({
		message: `OAuth access token is missing required scope: ${scope}`,
		scope,
	}),
});
export type OAuthError = InferErrors<typeof OAuthError>;
