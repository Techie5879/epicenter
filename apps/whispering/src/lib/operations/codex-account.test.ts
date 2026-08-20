/**
 * Codex Account Operation Tests
 *
 * Verifies desktop OAuth orchestration, web refusal, persistence, and disconnect.
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { CodexOAuthSession } from '$lib/services/codex';

const authorization = {
	authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=state-value',
	verifier: 'pkce-verifier',
	state: 'state-value',
};
const connectedSession: CodexOAuthSession = {
	accessToken: 'access-token',
	refreshToken: 'refresh-token',
	expiresAt: 123_456,
	accountId: 'account-id',
	email: 'person@example.com',
};
let storedSession: CodexOAuthSession | null = null;
const createAuthorization = mock(
	async (): Promise<
		Result<typeof authorization, { name: string; message: string }>
	> => Ok(authorization),
);
const exchangeAuthorizationCode = mock(async () => Ok(connectedSession));
const clearSessionCache = mock(() => {});
const completeOAuthLogin = mock(async () => Ok('authorization-code'));

mock.module('$lib/services', () => ({
	services: {
		codex: {
			createAuthorization,
			exchangeAuthorizationCode,
			clearSessionCache,
		},
	},
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: {
		get: () => storedSession,
		set(key: string, value: CodexOAuthSession | null) {
			if (key !== 'auth.codex') throw new Error(`Unexpected key: ${key}`);
			storedSession = value;
		},
	},
}));
mock.module('#platform/tauri', () => ({ tauri: null }));

const { createCodexAccountOperations } = await import('./codex-account.js');

function setup(native = true) {
	const operations = createCodexAccountOperations({
		codex: {
			createAuthorization,
			exchangeAuthorizationCode,
			clearSessionCache,
		} as never,
		getTauri: () =>
			native ? ({ codex: { completeOAuthLogin } } as never) : null,
		setSession: (session) => {
			storedSession = session;
		},
	});
	return operations;
}

beforeEach(() => {
	storedSession = null;
	createAuthorization.mockClear();
	exchangeAuthorizationCode.mockClear();
	clearSessionCache.mockClear();
	completeOAuthLogin.mockClear();
	createAuthorization.mockResolvedValue(Ok(authorization));
	exchangeAuthorizationCode.mockResolvedValue(Ok(connectedSession));
	completeOAuthLogin.mockResolvedValue(Ok('authorization-code'));
});

test('desktop connect passes authorization values, exchanges the verifier, and persists', async () => {
	const result = await setup().connect();

	expect(result.data).toEqual(connectedSession);
	expect(completeOAuthLogin).toHaveBeenCalledWith(
		authorization.authorizeUrl,
		authorization.state,
	);
	expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
		code: 'authorization-code',
		verifier: authorization.verifier,
	});
	expect(storedSession).toEqual(connectedSession);
});

test('web connect fails safely before preparing authorization', async () => {
	const result = await setup(false).connect();

	expect(result.error?.message).toBe(
		'Connecting ChatGPT is available in the desktop app.',
	);
	expect(createAuthorization).not.toHaveBeenCalled();
});

test('connect maps private service failures to safe app copy', async () => {
	createAuthorization.mockResolvedValue(
		Err({ name: 'PrivateFailure', message: 'private token response details' }),
	);

	const result = await setup().connect();

	expect(result.error?.message).toBe('Could not connect ChatGPT. Try again.');
	expect(JSON.stringify(result.error)).not.toContain('private token response');
	expect(storedSession).toBeNull();
});

test('disconnect clears refresh state and device storage', () => {
	storedSession = connectedSession;

	setup().disconnect();

	expect(clearSessionCache).toHaveBeenCalledTimes(1);
	expect(storedSession).toBeNull();
});
