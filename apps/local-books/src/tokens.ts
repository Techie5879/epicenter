import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';
import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import { type QbEnvironment, QbEnvironmentSchema } from './config.ts';

/**
 * A persisted QuickBooks OAuth2 token set, stored verbatim in the token file
 * keyed by `realmId`. Expiries are absolute ISO timestamps (not the relative
 * `expires_in` QuickBooks returns) so a process that starts hours later can
 * still decide whether the access token is live without knowing when it was
 * issued. This schema is the single source of truth: `TokenSet` derives from it,
 * and the file token store validates disk bytes against it on read.
 */
export const TokenSetSchema = Type.Object({
	realmId: Type.String({ minLength: 1 }),
	environment: QbEnvironmentSchema,
	accessToken: Type.String({ minLength: 1 }),
	refreshToken: Type.String({ minLength: 1 }),
	accessTokenExpiresAt: Type.String({ minLength: 1 }),
	refreshTokenExpiresAt: Type.String({ minLength: 1 }),
	obtainedAt: Type.String({ minLength: 1 }),
});
export type TokenSet = Static<typeof TokenSetSchema>;

/**
 * The fields we read off a raw QuickBooks bearer-token grant. Unknown fields are
 * preserved by TypeBox (no `additionalProperties: false`), so a new grant field
 * never trips validation. `token_type` is `bearer` case-insensitively, checked
 * after the shape passes since a literal cannot express the case-fold.
 */
const TokenGrantSchema = Type.Object({
	token_type: Type.String({ minLength: 1 }),
	access_token: Type.String({ minLength: 1 }),
	refresh_token: Type.Optional(Type.String({ minLength: 1 })),
	expires_in: Type.Number({ exclusiveMinimum: 0 }),
	x_refresh_token_expires_in: Type.Optional(
		Type.Number({ exclusiveMinimum: 0 }),
	),
});
export type TokenGrant = Static<typeof TokenGrantSchema>;

export const TokenGrantError = defineErrors({
	InvalidGrant: ({ reason }: { reason: string }) => ({
		message: `QuickBooks token response was malformed: ${reason}`,
		reason,
	}),
});
export type TokenGrantError = InferErrors<typeof TokenGrantError>;

/** QuickBooks refresh tokens live ~100 days; assume the floor when absent. */
const REFRESH_TOKEN_FLOOR_SECONDS = 100 * 24 * 60 * 60;

/**
 * Normalize a raw token-endpoint payload into a {@link TokenSet}, converting the
 * relative `expires_in` seconds into an absolute timestamp anchored at `now`.
 *
 * `fallbackRefreshToken` covers refresh-token rotation: QuickBooks may omit
 * `refresh_token` on a refresh when the existing one stays valid, so the caller
 * threads the prior token through. An authorization-code exchange must not pass
 * one (there is no prior token to fall back to).
 */
export function tokenSetFromGrant(
	payload: unknown,
	{
		realmId,
		environment,
		now,
		fallbackRefreshToken,
	}: {
		realmId: string;
		environment: QbEnvironment;
		now: number;
		fallbackRefreshToken?: string;
	},
): Result<TokenSet, TokenGrantError> {
	if (!Value.Check(TokenGrantSchema, payload)) {
		const [first] = Value.Errors(TokenGrantSchema, payload);
		const reason = first
			? `${first.message} at ${first.instancePath || '/'}`
			: 'unexpected shape';
		return TokenGrantError.InvalidGrant({ reason });
	}

	if (payload.token_type.toLowerCase() !== 'bearer') {
		return TokenGrantError.InvalidGrant({
			reason: `expected token_type "bearer", got ${JSON.stringify(payload.token_type)}`,
		});
	}

	const refreshToken = payload.refresh_token ?? fallbackRefreshToken;
	if (!refreshToken) {
		return TokenGrantError.InvalidGrant({ reason: 'missing refresh_token' });
	}

	const refreshExpiresIn =
		payload.x_refresh_token_expires_in ?? REFRESH_TOKEN_FLOOR_SECONDS;
	return Ok({
		realmId,
		environment,
		accessToken: payload.access_token,
		refreshToken,
		accessTokenExpiresAt: new Date(
			now + payload.expires_in * 1000,
		).toISOString(),
		refreshTokenExpiresAt: new Date(
			now + refreshExpiresIn * 1000,
		).toISOString(),
		obtainedAt: new Date(now).toISOString(),
	});
}

/** Default skew: refresh a little early so an in-flight request never races expiry. */
export const ACCESS_TOKEN_SKEW_MS = 2 * 60 * 1000;

export function accessTokenTtlMs(token: TokenSet, now: number): number {
	return Date.parse(token.accessTokenExpiresAt) - now;
}

export function isAccessTokenExpired(
	token: TokenSet,
	now: number,
	skewMs: number = ACCESS_TOKEN_SKEW_MS,
): boolean {
	return accessTokenTtlMs(token, now) <= skewMs;
}

export function isRefreshTokenExpired(token: TokenSet, now: number): boolean {
	return Date.parse(token.refreshTokenExpiresAt) <= now;
}
