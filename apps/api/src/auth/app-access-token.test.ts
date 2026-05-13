import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { normalizeAppAccessToken } from './app-access-token.js';

function createTestApp() {
	const app = new Hono();
	app.use('*', normalizeAppAccessToken);
	app.get('/', (c) =>
		c.json({
			authorization: c.req.header('authorization') ?? null,
			cookie: c.req.header('cookie') ?? null,
			subprotocol: c.req.header('sec-websocket-protocol') ?? null,
		}),
	);
	return app;
}

test('cookie-only requests pass through unchanged', async () => {
	const res = await createTestApp().request('/', {
		headers: { cookie: 'theme=dark; better-auth.session_token=session-1' },
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.cookie).toContain('better-auth.session_token=session-1');
	expect(body.authorization).toBeNull();
});

test('HTTP bearer requests pass through unchanged', async () => {
	const res = await createTestApp().request('/', {
		headers: { authorization: 'Bearer token-1' },
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.authorization).toBe('Bearer token-1');
	expect(body.cookie).toBeNull();
});

test('WebSocket bearer is lifted into Authorization and stripped from protocols', async () => {
	const res = await createTestApp().request('/', {
		headers: { 'sec-websocket-protocol': 'epicenter, bearer.token-1' },
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.authorization).toBe('Bearer token-1');
	expect(body.subprotocol).toBe('epicenter');
});

test('WebSocket bearer with no remaining protocols drops the header', async () => {
	const res = await createTestApp().request('/', {
		headers: { 'sec-websocket-protocol': 'bearer.token-1' },
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.authorization).toBe('Bearer token-1');
	expect(body.subprotocol).toBeNull();
});

test('duplicate WebSocket bearers are rejected as multiple_credentials', async () => {
	const res = await createTestApp().request('/', {
		headers: {
			'sec-websocket-protocol':
				'epicenter, bearer.token-1, bearer.token-2',
		},
	});

	expect(res.status).toBe(400);
});

test('matching HTTP and WebSocket bearers are accepted', async () => {
	const res = await createTestApp().request('/', {
		headers: {
			authorization: 'Bearer token-1',
			'sec-websocket-protocol': 'epicenter, bearer.token-1',
		},
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.authorization).toBe('Bearer token-1');
	expect(body.subprotocol).toBe('epicenter');
});

test('distinct HTTP and WebSocket bearers are rejected', async () => {
	const res = await createTestApp().request('/', {
		headers: {
			authorization: 'Bearer token-1',
			'sec-websocket-protocol': 'epicenter, bearer.token-2',
		},
	});

	expect(res.status).toBe(400);
});

test('cookie with bearer is accepted because only bearer authorizes app resources', async () => {
	const res = await createTestApp().request('/', {
		headers: {
			authorization: 'Bearer token-1',
			cookie: 'better-auth.session_token=session-1',
		},
	});

	expect(res.status).toBe(200);
	const body = (await res.json()) as Record<string, string | null>;
	expect(body.authorization).toBe('Bearer token-1');
	expect(body.cookie).toContain('better-auth.session_token=session-1');
});
