import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
	completeAuthorization,
	refreshAccessToken,
	runAuthorizationFlow,
} from '../src/oauth.ts';
import type { TokenSet } from '../src/tokens.ts';
import { makeConfig } from './helpers.ts';
import { type MockQbServer, startMockQbServer } from './mock-qb-server.ts';

let server: MockQbServer;
const NOW = Date.parse('2026-06-21T12:00:00.000Z');

beforeAll(() => {
	server = startMockQbServer();
});
afterAll(() => server.stop());

function callback(state: string, params: Record<string, string> = {}): URL {
	const url = new URL('http://localhost:8765/callback');
	url.searchParams.set('code', 'auth-code');
	url.searchParams.set('state', state);
	url.searchParams.set('realmId', server.realmId);
	for (const [key, value] of Object.entries(params))
		url.searchParams.set(key, value);
	return url;
}

test('authorization-code exchange yields a token set', async () => {
	const config = makeConfig({
		tokenUrl: server.tokenUrl,
		realmOverride: server.realmId,
	});
	const { data, error } = await completeAuthorization(
		config,
		{ callbackUrl: callback('s1'), state: 's1' },
		() => NOW,
	);
	expect(error).toBeNull();
	expect(data?.realmId).toBe(server.realmId);
	expect(data?.accessToken).toStartWith('access-');
	expect(Date.parse(data!.accessTokenExpiresAt)).toBe(NOW + 3600 * 1000);
	expect(server.hits.token).toBeGreaterThanOrEqual(1);
});

test('a forged callback (state mismatch) is rejected, not exchanged', async () => {
	const config = makeConfig({
		tokenUrl: server.tokenUrl,
		realmOverride: server.realmId,
	});
	const before = server.hits.token;
	const { error } = await completeAuthorization(
		config,
		{ callbackUrl: callback('attacker-state'), state: 'expected-state' },
		() => NOW,
	);
	expect(error).not.toBeNull();
	expect(server.hits.token).toBe(before); // never reached the token endpoint
});

test('refresh exchange mints a new token set', async () => {
	const config = makeConfig({
		tokenUrl: server.tokenUrl,
		realmOverride: server.realmId,
	});
	const before = server.hits.token;
	const token: TokenSet = {
		realmId: server.realmId,
		environment: 'sandbox',
		accessToken: 'old-access',
		refreshToken: 'old-refresh',
		accessTokenExpiresAt: new Date(NOW).toISOString(),
		refreshTokenExpiresAt: new Date(NOW + 8726400 * 1000).toISOString(),
		obtainedAt: new Date(NOW).toISOString(),
	};
	const { data, error } = await refreshAccessToken(config, token, () => NOW);
	expect(error).toBeNull();
	expect(data?.accessToken).not.toBe('old-access');
	expect(server.hits.token).toBe(before + 1);
});

test('callbackPort decouples the local listener from a portless HTTPS redirect', async () => {
	// Intuit production rejects localhost, so the redirect is a public HTTPS
	// tunnel with no port; the tunnel forwards to callbackPort on this machine.
	const PORT = 18765;
	const config = makeConfig({
		tokenUrl: server.tokenUrl,
		realmOverride: server.realmId,
		redirectUri: 'https://books.example.trycloudflare.com/callback',
		callbackPort: PORT,
	});
	const { data, error } = await runAuthorizationFlow(config, {
		now: () => NOW,
		timeoutMs: 5000,
		// Stand in for the browser: bounce the authorize request straight at the
		// local callback server on PORT, the way the tunnel would.
		openBrowser: (url) => {
			const state = new URL(url).searchParams.get('state') ?? '';
			const cb = new URL(`http://localhost:${PORT}/callback`);
			cb.searchParams.set('code', 'auth-code');
			cb.searchParams.set('state', state);
			cb.searchParams.set('realmId', server.realmId);
			// The server force-stops the instant it catches the callback, resetting
			// this connection; that reset is expected, not a failure.
			void fetch(cb).catch(() => {});
		},
	});
	expect(error).toBeNull();
	expect(data?.realmId).toBe(server.realmId);
	expect(data?.accessToken).toStartWith('access-');
});

test('a missing client secret is reported, not thrown, and names the qualified var', async () => {
	// Unset the sandbox secret for this test only; the resolver (ADR-0108) must
	// return MissingCredentials naming the exact env-qualified variable rather than
	// throwing, and the flow must surface it before any network call.
	const saved = process.env.QB_SANDBOX_CLIENT_SECRET;
	delete process.env.QB_SANDBOX_CLIENT_SECRET;
	try {
		const config = makeConfig({ tokenUrl: server.tokenUrl });
		const { error } = await completeAuthorization(
			config,
			{ callbackUrl: callback('s2'), state: 's2' },
			() => NOW,
		);
		expect(error?.name).toBe('MissingCredentials');
		expect(error?.message).toContain('QB_SANDBOX_CLIENT_SECRET');
	} finally {
		process.env.QB_SANDBOX_CLIENT_SECRET = saved;
	}
});
