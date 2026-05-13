import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { AuthUser, type WorkspaceIdentity } from '@epicenter/auth';
import type { EncryptionKeys } from '@epicenter/encryption';
import type { User } from 'better-auth';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Context } from 'hono';
import { Err, Ok, type Result } from 'wellcrafted/result';
import * as schema from '../db/schema';
import { OAuthError, WORKSPACES_OPEN_SCOPE } from './oauth-error.js';
import { createOAuthIssuerURL, createOAuthJwksURL } from './oauth-metadata.js';

type VerifyOAuthAccessToken = ReturnType<
	ReturnType<typeof oauthProviderResourceClient>['getActions']
>['verifyAccessToken'];

type RequestOAuthEnv = {
	Variables: {
		authBaseURL: string;
		db: NodePgDatabase<typeof schema>;
	};
};

/**
 * Extract the token from an HTTP `Authorization: Bearer <token>` header value.
 * Case-insensitive on the scheme; trims surrounding whitespace; returns null
 * for missing, empty, or non-bearer inputs.
 *
 * Shared with `app-access-token.ts` so the normalize layer and the verify
 * layer agree on what counts as a bearer.
 */
export function parseBearer(value: string | null): string | null {
	if (!value) return null;
	const match = value.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

/**
 * Verify an OAuth app access token, enforce the `workspaces:open` scope, and
 * resolve the calling Better Auth user. The single source of truth for what
 * "a token good enough to reach an app access token route" means in this
 * codebase.
 *
 * Wrappers project the user differently:
 * - `resolveRequestAppAccessTokenUser` returns the lean `AuthUser` for middleware.
 * - `resolveRequestWorkspaceIdentity` adds derived keys for `/workspace-identity`.
 */
async function verifyRequestBearerToUser<E extends RequestOAuthEnv>(
	c: Context<E>,
): Promise<Result<User, OAuthError>> {
	const accessToken = parseBearer(c.req.header('authorization') ?? null);
	if (!accessToken) return OAuthError.InvalidToken();

	const audience = c.var.authBaseURL;
	const payload = await verifyOAuthAccessToken(accessToken, {
		verifyOptions: {
			audience,
			issuer: createOAuthIssuerURL(audience),
		},
		jwksUrl: createOAuthJwksURL(audience),
	}).catch(() => null);
	const userId = typeof payload?.sub === 'string' ? payload.sub : null;
	if (!userId) return OAuthError.InvalidToken();

	if (!hasScope(payload, WORKSPACES_OPEN_SCOPE)) {
		return OAuthError.InsufficientScope({ scope: WORKSPACES_OPEN_SCOPE });
	}

	const [user] = await c.var.db
		.select()
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.limit(1);
	if (!user) return OAuthError.InvalidToken();

	return Ok(user);
}

const verifyOAuthAccessToken: VerifyOAuthAccessToken =
	oauthProviderResourceClient().getActions().verifyAccessToken;

/**
 * Cheap resolver for the `requireAppAccessToken` middleware that gates
 * `/ai/*`, `/workspaces/*`, `/documents/*`, `/api/billing/*`, and
 * `/api/assets/*`. Skips encryption-key derivation; only the calling user
 * is needed once the scope is proven.
 */
export async function resolveRequestAppAccessTokenUser<
	E extends RequestOAuthEnv,
>(c: Context<E>): Promise<Result<AuthUser, OAuthError>> {
	const { data: user, error } = await verifyRequestBearerToUser(c);
	if (error) return Err(error);
	return Ok({ id: user.id, email: user.email });
}

/**
 * Full resolver for `/workspace-identity`. Returns the local-first payload
 * the apps need at boot: the calling user plus the per-user encryption key
 * set derived from the workspace identity secret.
 */
export async function resolveRequestWorkspaceIdentity<
	E extends RequestOAuthEnv,
>(
	c: Context<E>,
	deriveUserEncryptionKeys: (userId: string) => Promise<EncryptionKeys>,
): Promise<Result<WorkspaceIdentity, OAuthError>> {
	const { data: user, error } = await verifyRequestBearerToUser(c);
	if (error) return Err(error);
	return Ok({
		user: AuthUser.assert(user),
		encryptionKeys: await deriveUserEncryptionKeys(user.id),
	});
}

/**
 * Read the `scope` claim from a verified access-token payload and check
 * whether the required scope is present. Treats anything that is not a
 * space-separated string of scopes as "no scopes granted".
 */
function hasScope(payload: unknown, required: string): boolean {
	if (payload === null || typeof payload !== 'object') return false;
	const raw = (payload as { scope?: unknown }).scope;
	if (typeof raw !== 'string') return false;
	return raw.split(/\s+/).filter(Boolean).includes(required);
}
