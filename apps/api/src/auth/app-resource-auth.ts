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

type ResolverDeps = {
	authorization: string | null;
	audience: string;
	issuer: string;
	jwksUrl: string;
	verifyOAuthAccessToken: VerifyOAuthAccessToken;
	findUserById(userId: string): Promise<User | null>;
};

type RequestOAuthEnv = {
	Bindings: object | undefined;
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
 * "a token good enough to reach an app resource endpoint" means in this
 * codebase.
 *
 * Wrappers project the user differently:
 * - `resolveBearerUser` returns the lean `AuthUser` for the middleware path.
 * - `resolveBearerIdentity` adds derived encryption keys for `/workspace-identity`.
 */
async function verifyBearerToUser(
	deps: ResolverDeps,
): Promise<Result<User, OAuthError>> {
	const accessToken = parseBearer(deps.authorization);
	if (!accessToken) return OAuthError.InvalidToken();

	const payload = await deps
		.verifyOAuthAccessToken(accessToken, {
			verifyOptions: { audience: deps.audience, issuer: deps.issuer },
			jwksUrl: deps.jwksUrl,
		})
		.catch(() => null);
	const userId = typeof payload?.sub === 'string' ? payload.sub : null;
	if (!userId) return OAuthError.InvalidToken();

	if (!hasScope(payload, WORKSPACES_OPEN_SCOPE)) {
		return OAuthError.InsufficientScope({ scope: WORKSPACES_OPEN_SCOPE });
	}

	const user = await deps.findUserById(userId);
	if (!user) return OAuthError.InvalidToken();

	return Ok(user);
}

/**
 * Cheap resolver for the `requireAppAccessToken` middleware that gates
 * `/ai/*`, `/workspaces/*`, `/documents/*`, `/api/billing/*`, and
 * `/api/assets/*`. Skips encryption-key derivation; only the calling user
 * is needed once the scope is proven.
 */
export async function resolveBearerUser(
	deps: ResolverDeps,
): Promise<Result<AuthUser, OAuthError>> {
	const { data: user, error } = await verifyBearerToUser(deps);
	if (error) return Err(error);
	return Ok({ id: user.id, email: user.email });
}

/**
 * Full resolver for `/workspace-identity`. Returns the local-first payload
 * the apps need at boot: the calling user plus the per-user encryption key
 * set derived from the workspace identity secret.
 */
export async function resolveBearerIdentity(
	deps: ResolverDeps & {
		deriveUserEncryptionKeys(userId: string): Promise<EncryptionKeys>;
	},
): Promise<Result<WorkspaceIdentity, OAuthError>> {
	const { data: user, error } = await verifyBearerToUser(deps);
	if (error) return Err(error);
	return Ok({
		user: AuthUser.assert(user),
		encryptionKeys: await deps.deriveUserEncryptionKeys(user.id),
	});
}

/**
 * Resolve the OAuth app access token on the current request to the calling
 * user. Hono adapter around the pure bearer resolver above.
 */
export function resolveRequestAppResourceUser<E extends RequestOAuthEnv>(
	c: Context<E>,
) {
	return resolveBearerUser(createResolverDeps(c));
}

/**
 * Resolve the OAuth app access token on the current request to the full
 * workspace identity payload. Key derivation stays injected so this module
 * remains free of Worker-only imports and easy to test through the pure
 * resolver.
 */
export function resolveRequestWorkspaceIdentity<E extends RequestOAuthEnv>(
	c: Context<E>,
	deriveUserEncryptionKeys: (userId: string) => Promise<EncryptionKeys>,
) {
	return resolveBearerIdentity({
		...createResolverDeps(c),
		deriveUserEncryptionKeys,
	});
}

function createResolverDeps<E extends RequestOAuthEnv>(
	c: Context<E>,
): ResolverDeps {
	const audience = c.var.authBaseURL;
	return {
		authorization: c.req.header('authorization') ?? null,
		audience,
		issuer: createOAuthIssuerURL(audience),
		jwksUrl: createOAuthJwksURL(audience),
		verifyOAuthAccessToken:
			oauthProviderResourceClient().getActions().verifyAccessToken,
		findUserById: async (userId) => {
			const [row] = await c.var.db
				.select()
				.from(schema.user)
				.where(eq(schema.user.id, userId))
				.limit(1);
			return row ?? null;
		},
	};
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
