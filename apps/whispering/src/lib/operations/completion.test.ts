/**
 * Completion Operation Tests
 *
 * Verifies Codex routing, activation ownership, and pre-request persistence.
 */
import { beforeEach, expect, mock, test } from 'bun:test';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { CodexOAuthSession } from '$lib/services/codex';
import type { WhisperingApp } from '$lib/whispering/app';

let storedSession: CodexOAuthSession | null = null;
const writes: Array<CodexOAuthSession | null> = [];
const ensureActiveSession = mock(
	async (
		session: CodexOAuthSession,
	): Promise<Result<CodexOAuthSession, never>> => Ok(session),
);
const completeCodex = mock(
	async (): Promise<Result<string, { name: string; message: string }>> =>
		Ok('completed'),
);

mock.module('$lib/services', () => ({
	services: {
		codex: {
			ensureActiveSession,
			complete: completeCodex,
		},
	},
}));
mock.module('$lib/state/device-config.svelte', () => ({
	deviceConfig: {
		get(key: string) {
			return key === 'auth.codex' ? storedSession : '';
		},
		set(key: string, value: CodexOAuthSession | null) {
			if (key !== 'auth.codex') throw new Error(`Unexpected key: ${key}`);
			storedSession = value;
			writes.push(value);
		},
	},
}));
mock.module('#platform/http', () => ({ customFetch: mock() }));
mock.module('$lib/operations/completion-target', () => ({
	resolveCompletionStateFromConfig: mock(),
}));

const { completeWithGlobalDefault } = await import('./completion.js');

function session(
	refreshToken: string,
	overrides: Partial<CodexOAuthSession> = {},
): CodexOAuthSession {
	return {
		accessToken: `access-${refreshToken}`,
		refreshToken,
		expiresAt: 100_000,
		accountId: `account-${refreshToken}`,
		...overrides,
	};
}

function app(
	provider: 'Codex' | 'Google' = 'Codex',
	model = 'gpt-5.3-codex-spark',
): WhisperingApp {
	return {
		settings: {
			get(key: string) {
				if (key === 'completionProvider') return provider;
				if (key === 'completionModel') return model;
				throw new Error(`Unexpected setting: ${key}`);
			},
		},
	} as unknown as WhisperingApp;
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

beforeEach(() => {
	storedSession = null;
	writes.length = 0;
	ensureActiveSession.mockClear();
	completeCodex.mockClear();
	ensureActiveSession.mockImplementation(async (value) => Ok(value));
	completeCodex.mockImplementation(async () => Ok('completed'));
});

test('missing Codex session fails before the service is called', async () => {
	const result = await completeWithGlobalDefault(app(), {
		systemPrompt: 'system',
		userPrompt: 'user',
	});

	expect(result.error?.message).toContain('Connect ChatGPT');
	expect(ensureActiveSession).not.toHaveBeenCalled();
	expect(completeCodex).not.toHaveBeenCalled();
});

test('Codex routing forwards the active session, model, prompts, and signal', async () => {
	const captured = session('r0');
	const active = session('r1');
	const controller = new AbortController();
	storedSession = captured;
	ensureActiveSession.mockResolvedValue(Ok(active));

	const result = await completeWithGlobalDefault(app(), {
		systemPrompt: 'system',
		userPrompt: 'user',
		signal: controller.signal,
	});

	expect(result.data).toBe('completed');
	expect(ensureActiveSession).toHaveBeenCalledTimes(1);
	expect(ensureActiveSession).toHaveBeenCalledWith(captured);
	expect(completeCodex).toHaveBeenCalledWith({
		session: active,
		model: 'gpt-5.3-codex-spark',
		systemPrompt: 'system',
		userPrompt: 'user',
		signal: controller.signal,
	});
});

test('rotated credentials persist before a failing Responses call', async () => {
	const captured = session('r0');
	const active = session('r1');
	storedSession = captured;
	ensureActiveSession.mockResolvedValue(Ok(active));
	completeCodex.mockImplementation(async () => {
		expect(storedSession).toEqual(active);
		return Err({ name: 'GenerationFailed', message: 'Generation failed' });
	});

	const result = await completeWithGlobalDefault(app(), {
		systemPrompt: 'system',
		userPrompt: 'user',
	});

	expect(result.error).not.toBeNull();
	expect(storedSession).toEqual(active);
});

test('disconnect during activation prevents completion and cannot restore storage', async () => {
	const captured = session('r0');
	const active = session('r1');
	const activation = deferred<Result<CodexOAuthSession, never>>();
	storedSession = captured;
	ensureActiveSession.mockImplementation(() => activation.promise);
	const completion = completeWithGlobalDefault(app(), {
		systemPrompt: 'system',
		userPrompt: 'user',
	});
	storedSession = null;
	activation.resolve(Ok(active));

	const result = await completion;
	expect(result.error?.message).toContain('account changed');
	expect(storedSession).toBeNull();
	expect(completeCodex).not.toHaveBeenCalled();
});

test('account replacement during activation wins without being overwritten', async () => {
	const captured = session('r0');
	const active = session('r1');
	const replacement = session('other');
	const activation = deferred<Result<CodexOAuthSession, never>>();
	storedSession = captured;
	ensureActiveSession.mockImplementation(() => activation.promise);
	const completion = completeWithGlobalDefault(app(), {
		systemPrompt: 'system',
		userPrompt: 'user',
	});
	storedSession = replacement;
	activation.resolve(Ok(active));

	const result = await completion;
	expect(result.error?.message).toContain('account changed');
	expect(storedSession).toEqual(replacement);
	expect(completeCodex).not.toHaveBeenCalled();
});

test('same-account concurrent activation proceeds without overwriting the winner', async () => {
	const captured = session('r0');
	const active = session('r1');
	const firstActivation = deferred<Result<CodexOAuthSession, never>>();
	const secondActivation = deferred<Result<CodexOAuthSession, never>>();
	storedSession = captured;
	ensureActiveSession
		.mockImplementationOnce(() => firstActivation.promise)
		.mockImplementationOnce(() => secondActivation.promise);
	const first = completeWithGlobalDefault(app(), {
		systemPrompt: 'first system',
		userPrompt: 'first user',
	});
	const second = completeWithGlobalDefault(app(), {
		systemPrompt: 'second system',
		userPrompt: 'second user',
	});
	firstActivation.resolve(Ok(active));
	await Promise.resolve();
	secondActivation.resolve(Ok(active));

	expect((await first).data).toBe('completed');
	expect((await second).data).toBe('completed');
	expect(writes).toEqual([active]);
	expect(completeCodex).toHaveBeenCalledTimes(2);
});
