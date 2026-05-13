import { expect, test } from 'bun:test';
import { oauthProvider } from '@better-auth/oauth-provider';
import type { EncryptionKeys } from '@epicenter/encryption';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { generateCodeChallenge } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';
import type { Context } from 'hono';
import {
	parseBearer,
	resolveRequestAppAccessTokenUser,
	resolveRequestWorkspaceIdentity,
} from './app-access-token-auth.js';

const redirectUri = 'http://localhost:5174/auth/callback';
const verifier = 'test-verifier-test-verifier-test-verifier';
const encryptionKeys: EncryptionKeys = [
	{
		version: 1,
		userKeyBase64: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
	},
];
let nextAppAccessTokenTestPort = 51_000 + Math.floor(Math.random() * 10_000);

test('parseBearer extracts bearer tokens case-insensitively', () => {
	expect(parseBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
	expect(parseBearer('bearer   abc.def.ghi   ')).toBe('abc.def.ghi');
	expect(parseBearer('BEARER abc.def.ghi')).toBe('abc.def.ghi');
});

test('parseBearer returns null for missing, empty, or non-bearer input', () => {
	expect(parseBearer(null)).toBeNull();
	expect(parseBearer('')).toBeNull();
	expect(parseBearer('Bearer ')).toBeNull();
	expect(parseBearer('Token abc')).toBeNull();
});

test('resolveRequestAppAccessTokenUser resolves a valid scoped token to the calling user', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callUser(setup, accessToken);

		expect(error).toBeNull();
		expect(data).toEqual({
			id: expect.any(String),
			email: 'app-access-token-test@example.com',
		});
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestAppAccessTokenUser rejects tokens missing the workspaces:open scope', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup, {
			scope: 'openid profile email offline_access',
		});
		const { data, error } = await callUser(setup, accessToken);

		expect(data).toBeNull();
		expect(error?.name).toBe('InsufficientScope');
		expect(error?.name === 'InsufficientScope' && error.scope).toBe(
			'workspaces:open',
		);
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestAppAccessTokenUser rejects tokens issued for the wrong audience as InvalidToken', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup, {
			resource: setup.wrongAudience,
		});
		const { data, error } = await callUser(setup, accessToken);

		expect(data).toBeNull();
		expect(error?.name).toBe('InvalidToken');
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestAppAccessTokenUser rejects tokens verified against the wrong auth base URL as InvalidToken', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callUser(setup, accessToken, {
			authBaseURL: `${setup.baseURL}/some-other-resource`,
		});

		expect(data).toBeNull();
		expect(error?.name).toBe('InvalidToken');
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestAppAccessTokenUser rejects malformed bearer input before user lookup', async () => {
	const { data, error } = await resolveRequestAppAccessTokenUser(
		createRequestContext({
			authorization: 'Token not-a-bearer',
			authBaseURL: 'http://localhost:8787',
			selectUsers: async () => {
				throw new Error('user lookup should not run');
			},
		}),
	);

	expect(data).toBeNull();
	expect(error?.name).toBe('InvalidToken');
});

test('resolveRequestAppAccessTokenUser rejects tokens whose user no longer exists as InvalidToken', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		setup.db.user = [];

		const { data, error } = await callUser(setup, accessToken);

		expect(data).toBeNull();
		expect(error?.name).toBe('InvalidToken');
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestWorkspaceIdentity returns user and encryption keys for a valid token', async () => {
	const setup = createAppAccessTokenTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callIdentity(setup, accessToken);

		expect(error).toBeNull();
		expect(data?.user.email).toBe('app-access-token-test@example.com');
		expect(data?.encryptionKeys).toEqual(encryptionKeys);
	} finally {
		setup.server.stop(true);
	}
});

test('resolveRequestWorkspaceIdentity short-circuits user lookup and key derivation on verifier failure', async () => {
	const { data, error } = await resolveRequestWorkspaceIdentity(
		createRequestContext({
			authorization: 'Bearer expired-token',
			authBaseURL: 'http://localhost:8787',
			selectUsers: async () => {
				throw new Error('user lookup should not run');
			},
		}),
		async () => {
			throw new Error('deriveUserEncryptionKeys should not run');
		},
	);

	expect(data).toBeNull();
	expect(error?.name).toBe('InvalidToken');
});

function createAppAccessTokenTestServer() {
	const db: MemoryDB = {
		user: [],
		session: [],
		account: [],
		verification: [],
		oauthClient: [],
		oauthAccessToken: [],
		oauthConsent: [],
		oauthRefreshToken: [],
		jwks: [],
	};

	for (let attempt = 0; attempt < 40; attempt += 1) {
		const port = nextAppAccessTokenTestPort++;
		const baseURL = `http://localhost:${port}`;
		const wrongAudience = `${baseURL}/other-resource`;
		const auth = betterAuth({
			database: memoryAdapter(db),
			emailAndPassword: { enabled: true },
			basePath: '/auth',
			baseURL,
			secret: 'test-secret-test-secret-test-secret',
			plugins: [
				jwt(),
				oauthProvider({
					loginPage: '/sign-in',
					consentPage: '/consent',
					requirePKCE: true,
					validAudiences: [baseURL, wrongAudience],
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

		try {
			const server = Bun.serve({
				port,
				fetch: async (request) => auth.handler(request),
			});

			return { auth, baseURL, db, server, wrongAudience };
		} catch (error) {
			if (isAddressInUse(error)) continue;
			throw error;
		}
	}

	throw new Error(
		'Failed to find an available app-access-token-auth test port.',
	);
}

function isAddressInUse(error: unknown) {
	return (
		error instanceof Error &&
		'code' in error &&
		(error as { code?: unknown }).code === 'EADDRINUSE'
	);
}

type RequestContextOptions = {
	authorization: string;
	authBaseURL: string;
	selectUsers(): Promise<unknown[]>;
};

function createRequestContext({
	authorization,
	authBaseURL,
	selectUsers,
}: RequestContextOptions): Context<{
	Variables: {
		authBaseURL: string;
		db: never;
	};
}> {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === 'authorization' ? authorization : undefined,
		},
		var: {
			authBaseURL,
			db: {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () => selectUsers(),
						}),
					}),
				}),
			},
		},
	} as never;
}

function createAppAccessTokenContext(
	setup: ReturnType<typeof createAppAccessTokenTestServer>,
	accessToken: string,
	overrides: { authBaseURL?: string } = {},
) {
	return createRequestContext({
		authorization: `Bearer ${accessToken}`,
		authBaseURL: overrides.authBaseURL ?? setup.baseURL,
		selectUsers: async () => setup.db.user ?? [],
	});
}

async function callUser(
	setup: ReturnType<typeof createAppAccessTokenTestServer>,
	accessToken: string,
	overrides: { authBaseURL?: string } = {},
) {
	return resolveRequestAppAccessTokenUser(
		createAppAccessTokenContext(setup, accessToken, overrides),
	);
}

async function callIdentity(
	setup: ReturnType<typeof createAppAccessTokenTestServer>,
	accessToken: string,
	overrides: { authBaseURL?: string } = {},
) {
	return resolveRequestWorkspaceIdentity(
		createAppAccessTokenContext(setup, accessToken, overrides),
		async () => encryptionKeys,
	);
}

async function issueOAuthTokens(
	{ auth, baseURL }: ReturnType<typeof createAppAccessTokenTestServer>,
	{
		resource = baseURL,
		scope = 'openid profile email offline_access workspaces:open',
	}: { resource?: string; scope?: string } = {},
) {
	const signUpResponse = await auth.handler(
		new Request(`${baseURL}/auth/sign-up/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: 'app-access-token-test@example.com',
				password: 'password123',
				name: 'App Access Token Test',
			}),
		}),
	);
	const cookie = signUpResponse.headers.get('set-cookie');
	expect(cookie).toBeTruthy();

	const client = (await auth.api.adminCreateOAuthClient({
		body: {
			client_name: 'App Access Token Auth Test',
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			scope: 'openid profile email offline_access workspaces:open',
			skip_consent: true,
			require_pkce: true,
		},
	})) as { client_id: string };
	const authorizeUrl = new URL(`${baseURL}/auth/oauth2/authorize`);
	for (const [key, value] of Object.entries({
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: redirectUri,
		scope,
		state: 'state-1',
		code_challenge: await generateCodeChallenge(verifier),
		code_challenge_method: 'S256',
		resource,
	})) {
		authorizeUrl.searchParams.set(key, value);
	}

	const authorizeResponse = await auth.handler(
		new Request(authorizeUrl.toString(), {
			headers: { cookie: cookie ?? '' },
		}),
	);
	const location = authorizeResponse.headers.get('location');
	expect(location).toBeTruthy();
	const code = new URL(location ?? redirectUri).searchParams.get('code');
	expect(code).toBeTruthy();

	const tokenResponse = await auth.handler(
		new Request(`${baseURL}/auth/oauth2/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: client.client_id,
				redirect_uri: redirectUri,
				code: code ?? '',
				code_verifier: verifier,
				resource,
			}),
		}),
	);
	expect(tokenResponse.status).toBe(200);
	const tokenBody = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
	};
	return {
		accessToken: tokenBody.access_token,
		refreshToken: tokenBody.refresh_token ?? null,
	};
}
