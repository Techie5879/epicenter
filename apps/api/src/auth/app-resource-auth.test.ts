import { oauthProvider } from '@better-auth/oauth-provider';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import type { EncryptionKeys } from '@epicenter/encryption';
import { expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { generateCodeChallenge } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';
import {
	parseBearer,
	resolveBearerIdentity,
	resolveBearerUser,
} from './app-resource-auth.js';

const redirectUri = 'http://localhost:5174/auth/callback';
const verifier = 'test-verifier-test-verifier-test-verifier';
const encryptionKeys: EncryptionKeys = [
	{
		version: 1,
		userKeyBase64: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
	},
];
let nextBoundaryTestPort = 51_000 + Math.floor(Math.random() * 10_000);

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

test('resolveBearerUser resolves a valid scoped token to the calling user', async () => {
	const setup = createBoundaryTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callUser(setup, accessToken);

		expect(error).toBeNull();
		expect(data).toEqual({
			id: expect.any(String),
			email: 'boundary-test@example.com',
		});
	} finally {
		setup.server.stop(true);
	}
});

test('resolveBearerUser rejects tokens missing the workspaces:open scope', async () => {
	const setup = createBoundaryTestServer();
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

test('resolveBearerUser rejects tokens issued for the wrong audience as InvalidToken', async () => {
	const setup = createBoundaryTestServer();
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

test('resolveBearerUser rejects tokens verified against the wrong issuer as InvalidToken', async () => {
	const setup = createBoundaryTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callUser(setup, accessToken, {
			issuer: `${setup.baseURL}/some-other-issuer`,
		});

		expect(data).toBeNull();
		expect(error?.name).toBe('InvalidToken');
	} finally {
		setup.server.stop(true);
	}
});

test('resolveBearerUser rejects malformed bearer input before calling the verifier', async () => {
	let verifierCalls = 0;
	const { data, error } = await resolveBearerUser({
		authorization: 'Token not-a-bearer',
		audience: 'http://localhost:8787',
		issuer: 'http://localhost:8787/auth',
		jwksUrl: 'http://localhost:8787/auth/jwks',
		verifyOAuthAccessToken: async () => {
			verifierCalls += 1;
			return null as never;
		},
		findUserById: async () => {
			throw new Error('findUserById should not run');
		},
	});

	expect(data).toBeNull();
	expect(error?.name).toBe('InvalidToken');
	expect(verifierCalls).toBe(0);
});

test('resolveBearerUser rejects tokens whose user no longer exists as InvalidToken', async () => {
	const setup = createBoundaryTestServer();
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

test('resolveBearerIdentity returns user and encryption keys for a valid token', async () => {
	const setup = createBoundaryTestServer();
	try {
		const { accessToken } = await issueOAuthTokens(setup);
		const { data, error } = await callIdentity(setup, accessToken);

		expect(error).toBeNull();
		expect(data?.user.email).toBe('boundary-test@example.com');
		expect(data?.encryptionKeys).toEqual(encryptionKeys);
	} finally {
		setup.server.stop(true);
	}
});

test('resolveBearerIdentity short-circuits user lookup and key derivation on verifier failure', async () => {
	const { data, error } = await resolveBearerIdentity({
		authorization: 'Bearer expired-token',
		audience: 'http://localhost:8787',
		issuer: 'http://localhost:8787/auth',
		jwksUrl: 'http://localhost:8787/auth/jwks',
		verifyOAuthAccessToken: async () => {
			throw new Error('JWTExpired');
		},
		findUserById: async () => {
			throw new Error('findUserById should not run');
		},
		deriveUserEncryptionKeys: async () => {
			throw new Error('deriveUserEncryptionKeys should not run');
		},
	});

	expect(data).toBeNull();
	expect(error?.name).toBe('InvalidToken');
});

function createBoundaryTestServer() {
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
		const port = nextBoundaryTestPort++;
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

	throw new Error('Failed to find an available app-resource-auth test port.');
}

function isAddressInUse(error: unknown) {
	return (
		error instanceof Error &&
		'code' in error &&
		(error as { code?: unknown }).code === 'EADDRINUSE'
	);
}

function commonResolverDeps(
	setup: ReturnType<typeof createBoundaryTestServer>,
	accessToken: string,
	overrides: { audience?: string; issuer?: string } = {},
) {
	const resource = oauthProviderResourceClient();
	return {
		authorization: `Bearer ${accessToken}`,
		audience: overrides.audience ?? setup.baseURL,
		issuer: overrides.issuer ?? `${setup.baseURL}/auth`,
		jwksUrl: `${setup.baseURL}/auth/jwks`,
		verifyOAuthAccessToken: resource.getActions().verifyAccessToken,
		findUserById: async (userId: string) =>
			setup.db.user?.find((user) => user.id === userId) ?? null,
	};
}

async function callUser(
	setup: ReturnType<typeof createBoundaryTestServer>,
	accessToken: string,
	overrides: { audience?: string; issuer?: string } = {},
) {
	return resolveBearerUser(commonResolverDeps(setup, accessToken, overrides));
}

async function callIdentity(
	setup: ReturnType<typeof createBoundaryTestServer>,
	accessToken: string,
	overrides: { audience?: string; issuer?: string } = {},
) {
	return resolveBearerIdentity({
		...commonResolverDeps(setup, accessToken, overrides),
		deriveUserEncryptionKeys: async () => encryptionKeys,
	});
}

async function issueOAuthTokens(
	{ auth, baseURL }: ReturnType<typeof createBoundaryTestServer>,
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
				email: 'boundary-test@example.com',
				password: 'password123',
				name: 'Boundary Test',
			}),
		}),
	);
	const cookie = signUpResponse.headers.get('set-cookie');
	expect(cookie).toBeTruthy();

	const client = (await auth.api.adminCreateOAuthClient({
		body: {
			client_name: 'App Resource Auth Test',
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
