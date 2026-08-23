import { importPKCS8, SignJWT } from 'jose';

/**
 * "Sign in with Apple" does not use a static client secret. The secret is a
 * short-lived ES256 JWT the server mints from the Apple private key (.p8),
 * signed with the Key ID, issued by the Team ID, and scoped to the Services ID
 * (`clientId`). Better Auth accepts an async `clientSecret` factory for exactly
 * this, so `createAuth` registers Apple as `apple: async () => ({ clientId,
 * clientSecret: await generateAppleClientSecret(...) })`.
 *
 * This is the trusted-origin Apple posts its `form_post` callback to; the auth
 * builder adds it to `trustedOrigins` whenever Apple is configured.
 */
export const APPLE_AUDIENCE = 'https://appleid.apple.com';

/** Apple caps the secret lifetime at ~6 months; 180 days matches Apple's guidance. */
const SECRET_TTL_SECONDS = 180 * 24 * 60 * 60;

/** Regenerate an hour before expiry so a cached token never signs a stale request. */
const REFRESH_SKEW_SECONDS = 60 * 60;

type AppleSecretInputs = {
	/** Apple Services ID; becomes the JWT `sub` and the provider `clientId`. */
	clientId: string;
	/** Apple Team ID; becomes the JWT `iss`. */
	teamId: string;
	/** Key ID of the "Sign in with Apple" key; becomes the JWT header `kid`. */
	keyId: string;
	/** The .p8 private key contents (PKCS#8 PEM). */
	privateKey: string;
};

/**
 * Cached per isolate. Minting the JWT imports the PKCS#8 key and signs on every
 * call; Better Auth may invoke the async factory per request that touches the
 * Apple provider, so cache the token until it nears expiry. Keyed by the inputs
 * so a rotated key or Services ID invalidates the cache.
 */
let cached: { token: string; expiresAt: number; key: string } | null = null;

/**
 * Mint (or return a cached) Apple client-secret JWT. ES256, header `{ alg, kid }`,
 * payload `{ iss: teamId, sub: clientId, aud: appleid.apple.com, iat, exp }`.
 */
export async function generateAppleClientSecret({
	clientId,
	teamId,
	keyId,
	privateKey,
}: AppleSecretInputs): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const cacheKey = `${teamId}:${clientId}:${keyId}`;
	if (
		cached &&
		cached.key === cacheKey &&
		cached.expiresAt - REFRESH_SKEW_SECONDS > now
	) {
		return cached.token;
	}

	// Env/secret managers commonly store the multi-line PEM with escaped "\n";
	// importPKCS8 needs real newlines.
	const pem = privateKey.includes('\\n')
		? privateKey.replace(/\\n/g, '\n')
		: privateKey;
	const signingKey = await importPKCS8(pem, 'ES256');
	const expiresAt = now + SECRET_TTL_SECONDS;
	const token = await new SignJWT({})
		.setProtectedHeader({ alg: 'ES256', kid: keyId })
		.setIssuer(teamId)
		.setSubject(clientId)
		.setAudience(APPLE_AUDIENCE)
		.setIssuedAt(now)
		.setExpirationTime(expiresAt)
		.sign(signingKey);

	cached = { token, expiresAt, key: cacheKey };
	return token;
}
