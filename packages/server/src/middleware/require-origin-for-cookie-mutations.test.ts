/**
 * CSRF guard for cookie-auth mutations
 * (specs/20260517T230000-portal-and-auth-collapse.md).
 *
 * `POST/PUT/DELETE/PATCH /api/*` from a non-trusted origin with a forwarded
 * cookie must be rejected, while bearer-auth requests (which are CSRF-immune)
 * skip the check even with no `Origin`. The Hono mounting and request shape
 * mirror `app.ts`; the middleware itself is imported, not duplicated.
 */

import { expect, test } from 'bun:test';
import { APPS, localUrl } from '@epicenter/constants/apps';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requireOriginForCookieMutations } from './require-origin-for-cookie-mutations.js';

const TRUSTED_ORIGIN = localUrl(APPS.API);

test('CSRF guard rejects cookie-auth POST from a non-trusted origin', async () => {
	const app = createCsrfTestApp();
	const res = await app.request('/api/billing/upgrade', {
		method: 'POST',
		headers: {
			cookie: 'better-auth.session_token=abc123',
			origin: 'https://evil.example',
			'content-type': 'application/json',
		},
		body: '{}',
	});
	expect(res.status).toBe(403);
	const body = (await res.json()) as { error: { name: string } };
	expect(body.error.name).toBe('ForbiddenOrigin');
});

test('CSRF guard rejects cookie-auth POST with no Origin header', async () => {
	const app = createCsrfTestApp();
	const res = await app.request('/api/billing/upgrade', {
		method: 'POST',
		headers: {
			cookie: 'better-auth.session_token=abc123',
			'content-type': 'application/json',
		},
		body: '{}',
	});
	expect(res.status).toBe(403);
});

test('CSRF guard admits cookie-auth POST from a trusted origin', async () => {
	const app = createCsrfTestApp();
	const res = await app.request('/api/billing/upgrade', {
		method: 'POST',
		headers: {
			cookie: 'better-auth.session_token=abc123',
			origin: TRUSTED_ORIGIN,
			'content-type': 'application/json',
		},
		body: '{}',
	});
	expect(res.status).toBe(200);
});

test('CSRF guard admits bearer-auth POST without an Origin header', async () => {
	const app = createCsrfTestApp();
	const res = await app.request('/api/billing/upgrade', {
		method: 'POST',
		headers: {
			authorization: 'Bearer not-a-real-token-but-bearer-shape',
			'content-type': 'application/json',
		},
		body: '{}',
	});
	expect(res.status).toBe(200);
});

test('CSRF guard admits GET regardless of origin', async () => {
	const app = createCsrfTestApp();
	const res = await app.request('/api/billing/balance', {
		method: 'GET',
		headers: { origin: 'https://evil.example' },
	});
	expect(res.status).toBe(200);
});

function createCsrfTestApp() {
	const app = new Hono<Env>();
	// The guard checks `c.var.trustedOrigins`, supplied by the deployment. Trust
	// the origin under test (localUrl(APPS.API)) so it is admitted while
	// `https://evil.example` is rejected.
	app.use('/api/*', async (c, next) => {
		c.set('trustedOrigins', [TRUSTED_ORIGIN]);
		await next();
	});
	app.use('/api/*', requireOriginForCookieMutations);
	app.all('/api/billing/*', (c) => c.json({ ok: true }));
	return app;
}
