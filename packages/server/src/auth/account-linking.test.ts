/**
 * The fresh-session gate on login-method mutations
 * (`requireFreshSessionForLoginChanges`).
 *
 * `/link-social` and `/passkey/delete-passkey` must demand a session no older
 * than `freshAge` (24h), matching what upstream already enforces on
 * `/unlink-account` and passkey registration. A stale session is refused
 * `SESSION_NOT_FRESH`; a fresh one passes the gate. The linking-policy config
 * values themselves are pinned in base-config.test.ts.
 */

import { expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { createOAuthTestDb } from '../test-helpers/oauth.js';
import { BASE_AUTH_CONFIG } from './base-config.js';
import { authPlugins } from './plugins.js';

const baseURL = 'http://localhost:47878';
const FRESH_AGE_SECONDS = 60 * 60 * 24;

test('a fresh session passes the /link-social gate (redirects to the provider)', async () => {
	const setup = createLinkingTestAuth();
	const cookie = await signUpTestUser(setup);

	const response = await postLinkSocial(setup, cookie);
	const body = (await response.json().catch(() => ({}))) as { url?: unknown };

	// Past the gate: the endpoint hands back a provider redirect URL, not a 403.
	expect(response.status).not.toBe(403);
	expect(typeof body.url).toBe('string');
});

test('a stale session is refused SESSION_NOT_FRESH on /link-social', async () => {
	const setup = createLinkingTestAuth();
	const cookie = await signUpTestUser(setup);
	staleTheSession(setup.db);

	const response = await postLinkSocial(setup, cookie);
	const body = (await response.json().catch(() => ({}))) as { code?: unknown };

	expect(response.status).toBe(403);
	expect(body.code).toBe('SESSION_NOT_FRESH');
});

test('a stale session is refused SESSION_NOT_FRESH on /passkey/delete-passkey', async () => {
	const setup = createLinkingTestAuth();
	const cookie = await signUpTestUser(setup);
	staleTheSession(setup.db);

	const response = await setup.auth.handler(
		new Request(`${baseURL}/auth/passkey/delete-passkey`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			body: JSON.stringify({ id: 'any-passkey-id' }),
		}),
	);
	const body = (await response.json().catch(() => ({}))) as { code?: unknown };

	expect(response.status).toBe(403);
	expect(body.code).toBe('SESSION_NOT_FRESH');
});

test('an unauthenticated /link-social request is rejected before linking', async () => {
	const setup = createLinkingTestAuth();

	const response = await postLinkSocial(setup, undefined);

	expect(response.status).toBe(401);
});

function createLinkingTestAuth() {
	// The passkey plugin needs its own table alongside the shared OAuth shape.
	const db: MemoryDB = { ...createOAuthTestDb(), passkey: [] };

	const auth = betterAuth({
		...BASE_AUTH_CONFIG,
		// Override to email/password so the test can mint a real session without a
		// live OAuth round-trip; the linking policy and the fresh-session hook come
		// straight from the spread BASE_AUTH_CONFIG.
		emailAndPassword: { enabled: true },
		database: memoryAdapter(db),
		baseURL,
		secret: 'test-secret-test-secret-test-secret',
		// A configured provider so a fresh /link-social produces a redirect URL
		// rather than an "unknown provider" error, making the pass case observable.
		socialProviders: {
			google: { clientId: 'test-client', clientSecret: 'test-secret' },
		},
		plugins: authPlugins(baseURL),
	});

	return { auth, db };
}

type LinkingTestAuth = ReturnType<typeof createLinkingTestAuth>;

async function signUpTestUser({ auth }: LinkingTestAuth) {
	const response = await auth.handler(
		new Request(`${baseURL}/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: `linker-${crypto.randomUUID()}@example.com`,
				password: 'password123',
				name: 'Linker Test',
			}),
		}),
	);
	const cookie = response.headers.get('set-cookie');
	expect(cookie).toBeTruthy();
	return cookie ?? '';
}

/** Age the single session row past `freshAge` so the gate must refuse it. */
function staleTheSession(db: MemoryDB) {
	const session = db.session?.[0];
	if (!session) throw new Error('Expected a session row to stale');
	session.createdAt = new Date(Date.now() - (FRESH_AGE_SECONDS + 3600) * 1000);
}

function postLinkSocial({ auth }: LinkingTestAuth, cookie: string | undefined) {
	return auth.handler(
		new Request(`${baseURL}/auth/link-social`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(cookie ? { cookie } : {}),
			},
			body: JSON.stringify({ provider: 'google', callbackURL: baseURL }),
		}),
	);
}
