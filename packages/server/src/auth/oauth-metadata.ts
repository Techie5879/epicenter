import { AUTH_BASE_PATH } from './base-config';

/**
 * Return the issuer URL used in OAuth discovery and JWT verification.
 *
 * Use this anywhere the API needs to compare or publish issuer metadata. The
 * invariant is that the issuer includes Better Auth's base path (`/auth`), so
 * tokens minted by this server are not confused with root-level API URLs.
 */
export function createOAuthIssuerURL(baseURL: string) {
	return `${baseURL.replace(/\/+$/, '')}${AUTH_BASE_PATH}`;
}

// AUTH_BASE_PATH is hardcoded to '/auth'. The OpenID configuration sits
// beneath that path; the auth-server metadata sits at the root with the
// basepath as a trailing segment (RFC 8414 §3.1).
export const OAUTH_OPENID_CONFIGURATION_PATH = `${AUTH_BASE_PATH}/.well-known/openid-configuration`;
export const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH =
	'/.well-known/oauth-authorization-server/auth';
export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
	'/.well-known/oauth-protected-resource';
export const OAUTH_METADATA_CACHE_CONTROL =
	'public, max-age=15, stale-while-revalidate=15, stale-if-error=86400';
