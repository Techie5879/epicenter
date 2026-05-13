/**
 * OAuth Resource Response Tests
 *
 * Verifies app access token auth failures at the API boundary.
 *
 * Key behaviors:
 * - HTTP `InvalidToken` returns 401 with `WWW-Authenticate: Bearer error="invalid_token"`
 *   and serializes the error object as the JSON body.
 * - WebSocket `InvalidToken` upgrades and immediately closes with 4401.
 * - HTTP `InsufficientScope` returns 403 with `WWW-Authenticate: Bearer
 *   error="insufficient_scope" scope="<scope>"` and serializes the scope in the body.
 * - WebSocket `InsufficientScope` upgrades and immediately closes with 4403.
 */

import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { OAuthError } from './oauth-error.js';
import { createOAuthUnauthorizedResourceResponse } from './oauth-resource.js';

test('HTTP InvalidToken returns 401 with invalid_token challenge', async () => {
	const app = new Hono();
	app.get('/resource', (c) =>
		createOAuthUnauthorizedResourceResponse(c, OAuthError.InvalidToken().error),
	);

	const response = await app.request('/resource');

	expect(response.status).toBe(401);
	expect(response.headers.get('WWW-Authenticate')).toBe(
		'Bearer error="invalid_token"',
	);
	const body = (await response.json()) as { name: string };
	expect(body.name).toBe('InvalidToken');
});

test('WebSocket InvalidToken closes with 4401', async () => {
	const closeCalls: Array<{ code?: number; reason?: string }> = [];
	let accepted = false;
	const server = {
		accept() {
			accepted = true;
		},
		close(code?: number, reason?: string) {
			closeCalls.push({ code, reason });
		},
	} satisfies Pick<WebSocket, 'accept' | 'close'>;
	const app = new Hono();
	app.get('/resource', (c) =>
		createOAuthUnauthorizedResourceResponse(
			c,
			OAuthError.InvalidToken().error,
			{
				createWebSocketPair: () => ({
					0: {} as WebSocket,
					1: server as WebSocket,
				}),
			},
		),
	);

	const response = await app.request('/resource', {
		headers: { upgrade: 'websocket' },
	});

	expect(response.status).toBe(101);
	expect(accepted).toBe(true);
	expect(closeCalls).toHaveLength(1);
	expect(closeCalls[0]?.code).toBe(4401);
	expect(JSON.parse(closeCalls[0]?.reason ?? '{}')).toMatchObject({
		name: 'InvalidToken',
	});
});

test('HTTP InsufficientScope returns 403 with WWW-Authenticate and scope', async () => {
	const app = new Hono();
	app.get('/resource', (c) =>
		createOAuthUnauthorizedResourceResponse(
			c,
			OAuthError.InsufficientScope({ scope: 'workspaces:open' }).error,
		),
	);

	const response = await app.request('/resource');

	expect(response.status).toBe(403);
	expect(response.headers.get('WWW-Authenticate')).toBe(
		'Bearer error="insufficient_scope" scope="workspaces:open"',
	);
	const body = (await response.json()) as { name: string; scope: string };
	expect(body.name).toBe('InsufficientScope');
	expect(body.scope).toBe('workspaces:open');
});

test('WebSocket InsufficientScope closes with 4403 and scope payload', async () => {
	const closeCalls: Array<{ code?: number; reason?: string }> = [];
	let accepted = false;
	const server = {
		accept() {
			accepted = true;
		},
		close(code?: number, reason?: string) {
			closeCalls.push({ code, reason });
		},
	} satisfies Pick<WebSocket, 'accept' | 'close'>;
	const app = new Hono();
	app.get('/resource', (c) =>
		createOAuthUnauthorizedResourceResponse(
			c,
			OAuthError.InsufficientScope({ scope: 'workspaces:open' }).error,
			{
				createWebSocketPair: () => ({
					0: {} as WebSocket,
					1: server as WebSocket,
				}),
			},
		),
	);

	const response = await app.request('/resource', {
		headers: { upgrade: 'websocket' },
	});

	expect(response.status).toBe(101);
	expect(accepted).toBe(true);
	expect(closeCalls).toHaveLength(1);
	expect(closeCalls[0]?.code).toBe(4403);
	expect(JSON.parse(closeCalls[0]?.reason ?? '{}')).toMatchObject({
		name: 'InsufficientScope',
		scope: 'workspaces:open',
	});
});
