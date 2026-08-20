/**
 * Codex Account Operation Tests
 *
 * Verifies OAuth orchestration and operation ownership through connect,
 * replacement, and disconnect.
 *
 * Key behaviors:
 * - Desktop connect exchanges and persists one session
 * - Web and private service failures return safe app-owned errors
 * - Disconnect and a newer connect prevent an older exchange from persisting
 */
import { expect, mock, test } from 'bun:test';
import { Err, Ok, type Result } from 'wellcrafted/result';
import { expectErr, expectOk } from 'wellcrafted/testing';
import type { CodexOAuthSession } from '$lib/services/codex';

type TestError = { name: string; message: string };
type Authorization = {
	authorizeUrl: string;
	verifier: string;
	state: string;
};

const authorization: Authorization = {
	authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=state-value',
	verifier: 'pkce-verifier',
	state: 'state-value',
};

function session(name: string): CodexOAuthSession {
	return {
		accessToken: `access-${name}`,
		refreshToken: `refresh-${name}`,
		expiresAt: 123_456,
		accountId: `account-${name}`,
		email: `${name}@example.com`,
	};
}

const connectedSession = session('connected');

mock.module('$lib/services', () => ({
	services: {
		codex: {
			createAuthorization: async () => Ok(authorization),
			exchangeAuthorizationCode: async () => Ok(connectedSession),
			clearSessionCache() {},
		},
	},
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: { set() {} },
}));
mock.module('#platform/tauri', () => ({ tauri: null }));

const { createCodexAccountOperations } = await import('./codex-account.js');

function setup({
	native = true,
	initialSession = null,
}: {
	native?: boolean;
	initialSession?: CodexOAuthSession | null;
} = {}) {
	const storage = { session: initialSession };
	const createAuthorization = mock(
		async (): Promise<Result<Authorization, TestError>> => Ok(authorization),
	);
	const exchangeAuthorizationCode = mock(
		async (_input: {
			code: string;
			verifier: string;
		}): Promise<Result<CodexOAuthSession, TestError>> => Ok(connectedSession),
	);
	const clearSessionCache = mock(() => {});
	const completeOAuthLogin = mock(
		async (
			_authorizeUrl: string,
			_expectedState: string,
		): Promise<Result<string, TestError>> => Ok('authorization-code'),
	);
	const operations = createCodexAccountOperations({
		codex: {
			createAuthorization,
			exchangeAuthorizationCode,
			clearSessionCache,
		} as never,
		getTauri: () =>
			native ? ({ codex: { completeOAuthLogin } } as never) : null,
		setSession: (nextSession) => {
			storage.session = nextSession;
		},
	});

	return {
		clearSessionCache,
		completeOAuthLogin,
		createAuthorization,
		exchangeAuthorizationCode,
		operations,
		storage,
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

test('desktop connect passes authorization values, exchanges the verifier, and persists', async () => {
	const { completeOAuthLogin, exchangeAuthorizationCode, operations, storage } =
		setup();

	expect(expectOk(await operations.connect())).toEqual(connectedSession);
	expect(completeOAuthLogin).toHaveBeenCalledWith(
		authorization.authorizeUrl,
		authorization.state,
	);
	expect(exchangeAuthorizationCode).toHaveBeenCalledWith({
		code: 'authorization-code',
		verifier: authorization.verifier,
	});
	expect(storage.session).toEqual(connectedSession);
});

test('web connect fails safely before preparing authorization', async () => {
	const { createAuthorization, operations } = setup({ native: false });

	const error = expectErr(await operations.connect());

	expect(error.message).toBe(
		'Connecting ChatGPT is available in the desktop app.',
	);
	expect(createAuthorization).not.toHaveBeenCalled();
});

test('connect maps private service failures to safe app copy', async () => {
	const { createAuthorization, operations, storage } = setup();
	createAuthorization.mockResolvedValue(
		Err({ name: 'PrivateFailure', message: 'private token response details' }),
	);

	const error = expectErr(await operations.connect());

	expect(error.message).toBe('Could not connect ChatGPT. Try again.');
	expect(JSON.stringify(error)).not.toContain('private token response');
	expect(storage.session).toBeNull();
});

test('disconnect clears refresh state and device storage', () => {
	const { clearSessionCache, operations, storage } = setup({
		initialSession: connectedSession,
	});

	operations.disconnect();

	expect(clearSessionCache).toHaveBeenCalledTimes(1);
	expect(storage.session).toBeNull();
});

test('disconnect during token exchange prevents the late session from persisting', async () => {
	const { exchangeAuthorizationCode, operations, storage } = setup();
	const exchange = deferred<Result<CodexOAuthSession, TestError>>();
	const exchangeStarted = deferred<void>();
	exchangeAuthorizationCode.mockImplementation(async () => {
		exchangeStarted.resolve(undefined);
		return exchange.promise;
	});
	const connecting = operations.connect();
	await exchangeStarted.promise;

	operations.disconnect();
	exchange.resolve(Ok(session('late')));
	const error = expectErr(await connecting);

	expect(error.name).toBe('Superseded');
	expect(error.message).toBe('This ChatGPT connection attempt was replaced.');
	expect(storage.session).toBeNull();
});

test('older token exchange cannot overwrite a newer connected account', async () => {
	const { completeOAuthLogin, exchangeAuthorizationCode, operations, storage } =
		setup();
	const olderExchange = deferred<Result<CodexOAuthSession, TestError>>();
	const newerExchange = deferred<Result<CodexOAuthSession, TestError>>();
	const olderStarted = deferred<void>();
	const newerStarted = deferred<void>();
	completeOAuthLogin
		.mockResolvedValueOnce(Ok('older-code'))
		.mockResolvedValueOnce(Ok('newer-code'));
	exchangeAuthorizationCode.mockImplementation(async ({ code }) => {
		if (code === 'older-code') {
			olderStarted.resolve(undefined);
			return olderExchange.promise;
		}
		newerStarted.resolve(undefined);
		return newerExchange.promise;
	});

	const olderConnect = operations.connect();
	await olderStarted.promise;
	const newerConnect = operations.connect();
	await newerStarted.promise;
	const newerSession = session('newer');
	newerExchange.resolve(Ok(newerSession));
	expect(expectOk(await newerConnect)).toEqual(newerSession);
	expect(storage.session).toEqual(newerSession);

	olderExchange.resolve(Ok(session('older')));
	const olderError = expectErr(await olderConnect);

	expect(olderError.name).toBe('Superseded');
	expect(olderError.message).toBe(
		'This ChatGPT connection attempt was replaced.',
	);
	expect(storage.session).toEqual(newerSession);
});
