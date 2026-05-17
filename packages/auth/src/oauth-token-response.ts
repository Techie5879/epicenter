import type { OAuthTokenGrant } from './auth-types.js';

type OAuthTokenResponseIssue =
	| 'missing_access_token'
	| 'missing_refresh_token'
	| 'missing_expires_in'
	| 'invalid_token_type'
	| 'invalid_response';

export class OAuthTokenResponseError extends Error {
	constructor(
		readonly issue: OAuthTokenResponseIssue,
		message: string,
	) {
		super(message);
		this.name = 'OAuthTokenResponseError';
	}
}

export function parseOAuthTokenGrant(
	payload: unknown,
	{
		now,
		fallbackRefreshToken,
	}: {
		now: () => number;
		fallbackRefreshToken?: string;
	},
): OAuthTokenGrant {
	if (
		payload === null ||
		typeof payload !== 'object' ||
		Array.isArray(payload)
	) {
		throw new OAuthTokenResponseError(
			'invalid_response',
			'Expected OAuth token response to be an object.',
		);
	}
	const record = payload as Record<string, unknown>;
	const tokenType = record['token_type'];
	if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
		throw new OAuthTokenResponseError(
			'invalid_token_type',
			`Expected token_type to be bearer, got ${JSON.stringify(tokenType)}.`,
		);
	}

	const accessToken = record['access_token'];
	if (typeof accessToken !== 'string') {
		throw new OAuthTokenResponseError(
			'missing_access_token',
			'Expected access_token to be a string.',
		);
	}

	const refreshToken = record['refresh_token'];
	if (refreshToken != null && typeof refreshToken !== 'string') {
		throw new OAuthTokenResponseError(
			'missing_refresh_token',
			'Expected refresh_token to be a string.',
		);
	}
	if (refreshToken == null && fallbackRefreshToken === undefined) {
		throw new OAuthTokenResponseError(
			'missing_refresh_token',
			'Expected refresh_token to be a string.',
		);
	}

	const expiresIn = record['expires_in'];
	if (
		typeof expiresIn !== 'number' ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		throw new OAuthTokenResponseError(
			'missing_expires_in',
			'Expected expires_in to be a positive finite number.',
		);
	}

	return {
		accessToken,
		refreshToken: refreshToken ?? fallbackRefreshToken!,
		accessTokenExpiresAt: now() + expiresIn * 1000,
	};
}
