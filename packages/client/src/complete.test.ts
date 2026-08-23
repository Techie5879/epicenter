import { afterEach, describe, expect, test } from 'bun:test';
import { complete } from './complete.js';
import { resolveConnection } from './connection.js';

describe('complete over the OpenAI chat wire', () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function captureRequest(response: Response) {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			seen.push({ url: String(url), init });
			return response;
		}) as unknown as typeof fetch;
		return seen;
	}

	test('posts system + user messages to /chat/completions and returns the content', async () => {
		const seen = captureRequest(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'refined' } }] }),
				{ status: 200 },
			),
		);

		const { data, error } = await complete(
			resolveConnection({ baseUrl: 'http://localhost:11434/v1' }),
			{ model: 'llama3', systemPrompt: 'be terse', userPrompt: 'hello' },
		);

		expect(error).toBeNull();
		expect(data).toBe('refined');
		expect(seen[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
		expect(seen[0]?.init?.method).toBe('POST');
		const body = JSON.parse(seen[0]?.init?.body as string);
		expect(body.model).toBe('llama3');
		expect(body.messages).toEqual([
			{ role: 'system', content: 'be terse' },
			{ role: 'user', content: 'hello' },
		]);
		expect(body.stream).toBe(false);
	});

	test('attaches the user key as a Bearer through the resolved transport', async () => {
		const seen = captureRequest(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
				{ status: 200 },
			),
		);

		await complete(
			resolveConnection({
				baseUrl: 'https://api.openai.com/v1',
				apiKey: 'sk-test',
			}),
			{ model: 'gpt-4o-mini', systemPrompt: '', userPrompt: 'hi' },
		);

		const headers = new Headers(seen[0]?.init?.headers);
		expect(headers.get('Authorization')).toBe('Bearer sk-test');
		expect(headers.get('content-type')).toBe('application/json');
	});

	test('tolerates a trailing slash on the base, never posting to a double slash', async () => {
		const seen = captureRequest(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
				{ status: 200 },
			),
		);

		await complete(
			resolveConnection({ baseUrl: 'http://localhost:11434/v1/' }),
			{
				model: 'llama3',
				systemPrompt: '',
				userPrompt: 'hi',
			},
		);

		expect(seen[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
	});

	test('routes through an injected base fetch, not globalThis.fetch', async () => {
		// A native app (Whispering on Tauri) injects its platform fetch so the
		// request leaves from the native side, not the webview. Prove the resolved
		// transport wraps the injected fetch and never touches globalThis.fetch.
		globalThis.fetch = (async () => {
			throw new Error('globalThis.fetch must not be called');
		}) as unknown as typeof fetch;

		const seen: { url: string; auth: string | null }[] = [];
		const baseFetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			seen.push({
				url: String(url),
				auth: new Headers(init?.headers).get('Authorization'),
			});
			return new Response(
				JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const { data, error } = await complete(
			resolveConnection(
				{ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
				baseFetch,
			),
			{ model: 'gpt-4o', systemPrompt: '', userPrompt: 'hi' },
		);

		expect(error).toBeNull();
		expect(data).toBe('ok');
		expect(seen[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
		// The Bearer still wraps the injected transport.
		expect(seen[0]?.auth).toBe('Bearer sk-test');
	});

	test('a non-2xx becomes a RequestFailed carrying the status', async () => {
		captureRequest(new Response('nope', { status: 401 }));

		const { data, error } = await complete(
			resolveConnection({
				baseUrl: 'https://api.openai.com/v1',
				apiKey: 'bad',
			}),
			{ model: 'gpt-4o', systemPrompt: '', userPrompt: 'hi' },
		);

		expect(data).toBeNull();
		expect(error?.name).toBe('RequestFailed');
		if (error?.name === 'RequestFailed') {
			expect(error.status).toBe(401);
			expect(error.detail).toBe('nope');
		}
	});

	test('a 2xx body with no content becomes Malformed', async () => {
		captureRequest(
			new Response(
				JSON.stringify({ choices: [{ message: { content: '' } }] }),
				{
					status: 200,
				},
			),
		);

		const { data, error } = await complete(
			resolveConnection({ baseUrl: 'http://localhost:11434/v1' }),
			{ model: 'llama3', systemPrompt: '', userPrompt: 'hi' },
		);

		expect(data).toBeNull();
		expect(error?.name).toBe('Malformed');
	});

	test('forwards an abort signal into the underlying request', async () => {
		const seen = captureRequest(
			new Response(
				JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
				{ status: 200 },
			),
		);
		const controller = new AbortController();

		await complete(
			resolveConnection({ baseUrl: 'http://localhost:11434/v1' }),
			{
				model: 'llama3',
				systemPrompt: '',
				userPrompt: 'hi',
				signal: controller.signal,
			},
		);

		// The signal rides on the real request init, so the HTTP call is genuinely
		// cancellable: the Polish HUD's "ship raw" aborts the in-flight completion
		// instead of merely abandoning the promise.
		expect(seen[0]?.init?.signal).toBe(controller.signal);
	});
});
