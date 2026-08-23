/**
 * Native Codex Fetch Tests
 *
 * Verifies the narrow adapter that replaces Tauri plugin HTTP for Codex.
 *
 * Key behaviors:
 * - Token and Responses calls map to the typed native command
 * - Browser builds retain a fetch fallback
 * - Caller cancellation stops waiting for the bounded native command
 */
import { expect, mock, test } from 'bun:test';
import { Ok, type Result } from 'wellcrafted/result';
import { createCodexFetch } from './codex-fetch.js';

test('token exchange uses the native token request', async () => {
	const request = mock(async () =>
		Ok({ status: 200, body: '{"access_token":"token"}' }),
	);
	const fetch = createCodexFetch({ request });

	const response = await fetch('https://auth.openai.com/oauth/token', {
		method: 'POST',
		body: 'grant_type=authorization_code',
	});

	expect(request).toHaveBeenCalledWith({
		kind: 'token',
		body: 'grant_type=authorization_code',
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe('{"access_token":"token"}');
});

test('Responses uses the native request with session headers', async () => {
	const request = mock(async () => Ok({ status: 200, body: 'data: [DONE]' }));
	const fetch = createCodexFetch({ request });

	await fetch('https://chatgpt.com/backend-api/codex/responses', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer access-token',
			'ChatGPT-Account-Id': 'account-id',
			'x-openai-internal-codex-residency': 'eu',
		},
		body: '{"model":"gpt-5.3-codex-spark"}',
	});

	expect(request).toHaveBeenCalledWith({
		kind: 'responses',
		accessToken: 'access-token',
		accountId: 'account-id',
		residency: 'eu',
		body: '{"model":"gpt-5.3-codex-spark"}',
	});
});

test('browser builds use the supplied fetch implementation', async () => {
	const browserFetch = mock(async () => new Response('browser'));
	const fetch = createCodexFetch({ request: undefined, browserFetch });

	const response = await fetch('https://example.com');

	expect(browserFetch).toHaveBeenCalledTimes(1);
	expect(await response.text()).toBe('browser');
});

test('caller cancellation stops waiting for the native command', async () => {
	let markStarted: (() => void) | undefined;
	const started = new Promise<void>((resolve) => {
		markStarted = resolve;
	});
	let finish:
		| ((value: Result<{ status: number; body: string }, never>) => void)
		| undefined;
	const request = mock(
		async () =>
			new Promise<Result<{ status: number; body: string }, never>>(
				(resolve) => {
					markStarted?.();
					finish = resolve;
				},
			),
	);
	const fetch = createCodexFetch({ request });
	const controller = new AbortController();
	const pending = fetch('https://auth.openai.com/oauth/token', {
		method: 'POST',
		body: 'grant_type=authorization_code',
		signal: controller.signal,
	});

	await started;
	controller.abort();
	await expect(pending).rejects.toThrow('Request cancelled');
	finish?.(Ok({ status: 200, body: '{}' }));
});

test('an already cancelled request never starts the native command', async () => {
	const request = mock(async () => Ok({ status: 200, body: '{}' }));
	const fetch = createCodexFetch({ request });
	const controller = new AbortController();
	controller.abort();

	await expect(
		fetch('https://auth.openai.com/oauth/token', {
			method: 'POST',
			body: 'grant_type=authorization_code',
			signal: controller.signal,
		}),
	).rejects.toThrow('Request cancelled');
	expect(request).not.toHaveBeenCalled();
});
