import { OAUTH_ROUTES } from '@epicenter/constants/oauth-routes';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { AuthFetch } from './auth-contract.js';
import type { OAuthTokenGrant } from './auth-types.js';

/**
 * Shape-level failures rejecting an OAuth token endpoint payload before it
 * becomes a persisted grant. Each variant maps to one invariant in
 * {@link parseOAuthTokenGrant}: missing or non-string fields, a wrong
 * `token_type`, or a non-object payload.
 */
const OAuthTokenResponseError = defineErrors({
	InvalidResponse: () => ({
		message: 'Expected OAuth token response to be an object.',
	}),
	InvalidTokenType: ({ tokenType }: { tokenType: unknown }) => ({
		message: `Expected token_type to be bearer, got ${JSON.stringify(tokenType)}.`,
		tokenType,
	}),
	MissingAccessToken: () => ({
		message: 'Expected access_token to be a string.',
	}),
	MissingRefreshToken: () => ({
		message: 'Expected refresh_token to be a string.',
	}),
	MissingExpiresIn: () => ({
		message: 'Expected expires_in to be a positive finite number.',
	}),
});

type OAuthTokenResponseError = InferErrors<typeof OAuthTokenResponseError>;

/**
 * Normalize an OAuth token endpoint payload into Epicenter's persisted grant.
 *
 * Use this immediately after authorization-code and refresh-token exchanges.
 * It enforces the client-side token invariant before anything is written to
 * storage: grants must be bearer tokens with an access token, a refresh token
 * (or refresh fallback during rotation), and a positive `expires_in` value that
 * becomes an absolute refresh hint.
 *
 * `fallbackRefreshToken` is only for refresh-token rotation. Some OAuth servers
 * omit `refresh_token` when the existing refresh token remains valid; initial
 * authorization-code exchanges must not pass a fallback.
 */
export function parseOAuthTokenGrant(
	payload: unknown,
	{
		now,
		fallbackRefreshToken,
	}: {
		now: () => number;
		fallbackRefreshToken?: string;
	},
): Result<OAuthTokenGrant, OAuthTokenResponseError> {
	if (
		payload === null ||
		typeof payload !== 'object' ||
		Array.isArray(payload)
	) {
		return OAuthTokenResponseError.InvalidResponse();
	}
	const record = payload as Record<string, unknown>;
	const tokenType = record['token_type'];
	if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
		return OAuthTokenResponseError.InvalidTokenType({ tokenType });
	}

	const accessToken = record['access_token'];
	if (typeof accessToken !== 'string') {
		return OAuthTokenResponseError.MissingAccessToken();
	}

	const refreshToken = record['refresh_token'];
	if (refreshToken != null && typeof refreshToken !== 'string') {
		return OAuthTokenResponseError.MissingRefreshToken();
	}
	const nextRefreshToken = refreshToken ?? fallbackRefreshToken;
	if (nextRefreshToken === undefined) {
		return OAuthTokenResponseError.MissingRefreshToken();
	}

	const expiresIn = record['expires_in'];
	if (
		typeof expiresIn !== 'number' ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		return OAuthTokenResponseError.MissingExpiresIn();
	}

	return Ok({
		accessToken,
		refreshToken: nextRefreshToken,
		accessTokenExpiresAt: now() + expiresIn * 1000,
	});
}

/**
 * Exchange a refresh token at the OAuth token endpoint and normalize the
 * response into a fresh grant. Throws on a non-OK response or an invalid
 * payload; callers treat a throw as "refresh failed, pause network auth".
 */
export async function refreshOAuthTokenWithEndpoint({
	baseURL,
	clientId,
	grant,
	fetch,
	now,
}: {
	baseURL: string;
	clientId: string;
	grant: OAuthTokenGrant;
	fetch: AuthFetch;
	now: () => number;
}): Promise<OAuthTokenGrant> {
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: grant.refreshToken,
		client_id: clientId,
		resource: baseURL,
	});
	const response = await fetch(OAUTH_ROUTES.token.url(baseURL), {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		credentials: 'omit',
	});
	if (!response.ok) {
		throw new Error(`OAuth refresh failed with ${response.status}.`);
	}
	const data = await response.json();
	const { data: parsed, error } = parseOAuthTokenGrant(data, {
		now,
		fallbackRefreshToken: grant.refreshToken,
	});
	if (error) {
		throw new Error(
			`OAuth refresh produced an invalid grant: ${error.message}`,
			{ cause: error },
		);
	}
	return parsed;
}

/**
 * Best-effort revoke of a refresh token at the OAuth revoke endpoint. Throws
 * on a non-OK response; sign-out swallows that because local auth is already
 * cleared by the time this runs.
 */
export async function revokeOAuthRefreshTokenWithEndpoint({
	baseURL,
	clientId,
	refreshToken,
	fetch,
}: {
	baseURL: string;
	clientId: string;
	refreshToken: string;
	fetch: AuthFetch;
}) {
	const body = new URLSearchParams({
		client_id: clientId,
		token: refreshToken,
		token_type_hint: 'refresh_token',
	});
	const response = await fetch(OAUTH_ROUTES.revoke.url(baseURL), {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		credentials: 'omit',
	});
	if (!response.ok) {
		throw new Error(`OAuth revoke failed with ${response.status}.`);
	}
}
