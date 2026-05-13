/**
 * Trusted OAuth Client Tests
 *
 * Verifies the first-party OAuth client registry and the Better Auth client
 * rows generated from it.
 *
 * Key behaviors:
 * - Trusted registry clients are projected as public PKCE clients
 * - Trusted clients skip consent during authorization
 * - Registered non-trusted clients still require consent
 */

import { expect, test } from 'bun:test';
import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { generateCodeChallenge } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins/bearer';
import * as schema from '../db/schema.js';
import {
	ensureTrustedOAuthClients,
	trustedOAuthClientIds,
} from './trusted-oauth-clients.js';

const redirectUri = 'http://localhost:5174/auth/callback';
const verifier = 'test-verifier-test-verifier-test-verifier';

test('trusted OAuth client seeding writes public PKCE client rows', async () => {
	const rows: unknown[] = [];
	const updates: unknown[] = [];
	const db = {
		insert(table: unknown) {
			expect(table).toBe(schema.oauthClient);
			return {
				values(row: unknown) {
					rows.push(row);
					return {
						onConflictDoUpdate(update: unknown) {
							updates.push(update);
							return Promise.resolve();
						},
					};
				},
			};
		},
	} as never;

	await ensureTrustedOAuthClients(db);

	const row = rows.find(
		(value): value is { clientId: string } =>
			typeof value === 'object' &&
			value !== null &&
			'clientId' in value &&
			value.clientId === 'epicenter-dashboard',
	);

	expect(row).toMatchObject({
		id: 'epicenter-dashboard',
		clientId: 'epicenter-dashboard',
		tokenEndpointAuthMethod: 'none',
		grantTypes: ['authorization_code'],
		responseTypes: ['code'],
		scopes: ['openid', 'profile', 'email', 'offline_access', 'workspaces:open'],
		public: true,
		type: 'user-agent-based',
		requirePKCE: true,
		skipConsent: true,
	});
	expect(updates).toHaveLength(rows.length);
});

test('trusted OAuth client skips consent during authorization', async () => {
	const setup = createTrustedClientTestAuth();

	const cookie = await signUpTestUser(setup.auth, setup.baseURL);
	const code = await authorize(setup, {
		clientId: 'trusted-client-1',
		cookie,
	});

	expect(code).toBeTruthy();
});

test('registered non-trusted OAuth client requires consent', async () => {
	const setup = createTrustedClientTestAuth();

	const cookie = await signUpTestUser(setup.auth, setup.baseURL);
	const response = await authorizeResponse(setup, {
		clientId: 'registered-client-1',
		cookie,
	});
	const location = response.headers.get('location');

	expect(response.status).toBe(302);
	expect(location).toBeTruthy();
	expect(new URL(location ?? setup.baseURL, setup.baseURL).pathname).toBe(
		'/consent',
	);
});

function createTrustedClientTestAuth() {
	const baseURL = 'http://localhost:47878';
	const trustedClient = testOAuthClientRow({
		clientId: 'trusted-client-1',
		name: 'Trusted Client',
		runtime: 'browser',
		redirectUris: [redirectUri],
	});
	const registeredClient = {
		...testOAuthClientRow({
			clientId: 'registered-client-1',
			name: 'Registered Client',
			runtime: 'browser',
			redirectUris: [redirectUri],
		}),
		skipConsent: false,
	};
	const db: MemoryDB = {
		user: [],
		session: [],
		account: [],
		verification: [],
		oauthClient: [trustedClient, registeredClient],
		oauthAccessToken: [],
		oauthConsent: [],
		oauthRefreshToken: [],
		jwks: [],
	};

	const auth = betterAuth({
		database: memoryAdapter(db),
		emailAndPassword: { enabled: true },
		basePath: '/auth',
		baseURL,
		secret: 'test-secret-test-secret-test-secret',
		plugins: [
			bearer(),
			jwt(),
			oauthProvider({
				loginPage: '/sign-in',
				consentPage: '/consent',
				requirePKCE: true,
				cachedTrustedClients: new Set([
					...trustedOAuthClientIds,
					trustedClient.clientId,
				]),
				validAudiences: [baseURL],
				allowDynamicClientRegistration: false,
				scopes: [
					'openid',
					'profile',
					'email',
					'offline_access',
					'workspaces:open',
				],
				silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
			}),
		],
	});

	return { auth, baseURL };
}

function testOAuthClientRow({
	clientId,
	name,
	runtime,
	redirectUris,
}: {
	clientId: string;
	name: string;
	runtime: 'browser' | 'extension' | 'device';
	redirectUris: string[];
}) {
	return {
		id: clientId,
		clientId,
		disabled: false,
		skipConsent: true,
		scopes: ['openid', 'profile', 'email', 'offline_access', 'workspaces:open'],
		createdAt: new Date(),
		updatedAt: new Date(),
		name,
		redirectUris,
		tokenEndpointAuthMethod: 'none',
		grantTypes: ['authorization_code'],
		responseTypes: ['code'],
		public: true,
		type: runtime === 'device' ? 'native' : 'user-agent-based',
		requirePKCE: true,
	};
}

async function signUpTestUser(
	auth: ReturnType<typeof createTrustedClientTestAuth>['auth'],
	baseURL: string,
) {
	const response = await auth.handler(
		new Request(`${baseURL}/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: `trusted-client-${crypto.randomUUID()}@example.com`,
				password: 'password123',
				name: 'Trusted Client Test',
			}),
		}),
	);
	const cookie = response.headers.get('set-cookie');
	expect(cookie).toBeTruthy();
	return cookie ?? '';
}

async function authorize(
	setup: ReturnType<typeof createTrustedClientTestAuth>,
	input: { clientId: string; cookie: string },
) {
	const response = await authorizeResponse(setup, input);
	const location = response.headers.get('location');
	expect(location).toBeTruthy();
	return new URL(location ?? redirectUri).searchParams.get('code');
}

async function authorizeResponse(
	{ auth, baseURL }: ReturnType<typeof createTrustedClientTestAuth>,
	{ clientId, cookie }: { clientId: string; cookie: string },
) {
	const authorizeUrl = new URL(`${baseURL}/auth/oauth2/authorize`);
	for (const [key, value] of Object.entries({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'openid profile email offline_access',
		state: 'state-1',
		code_challenge: await generateCodeChallenge(verifier),
		code_challenge_method: 'S256',
		resource: baseURL,
	})) {
		authorizeUrl.searchParams.set(key, value);
	}

	return auth.handler(
		new Request(authorizeUrl.toString(), { headers: { cookie } }),
	);
}
