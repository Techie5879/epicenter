/**
 * Rate-limit policy tests.
 *
 * Pin the two properties the burn-rate cap exists for: it actually denies past
 * the limit within a window (the OpenAI 429 the inference client can branch on),
 * and it buckets per principal partition (so one partition's spend cannot exhaust
 * another's). Both are deterministic with a long window, so no time waits.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { rateLimit } from './rate-limit.js';

/** Mount `rateLimit` behind a middleware that pins `c.var.principal`, like auth does upstream. */
function createTestApp(opts: { requests: number; principalId: string }) {
	const app = new Hono<Env>();
	app.use('*', async (c, next) => {
		c.set('principal', {
			id: opts.principalId as Env['Variables']['principal']['id'],
		});
		await next();
	});
	app.use('*', rateLimit({ requests: opts.requests, windowSeconds: 60 }));
	app.get('/', (c) => c.text('ok'));
	return app;
}

describe('rateLimit()', () => {
	test('allows up to the limit, then denies with a 429 OpenAI envelope', async () => {
		const app = createTestApp({ requests: 2, principalId: 'instance' });

		expect((await app.request('/')).status).toBe(200);
		expect((await app.request('/')).status).toBe(200);

		const denied = await app.request('/');
		expect(denied.status).toBe(429);
		expect(denied.headers.get('retry-after')).toBeTruthy();
		const body = (await denied.json()) as {
			error: { message: string; code: string };
		};
		expect(body).toEqual({
			error: {
				message: 'Rate limit exceeded. Try again shortly.',
				code: 'rate_limit_exceeded',
			},
		});
	});

	test('buckets per principal partition: one partition cannot exhaust another', async () => {
		// Two partitions share one limiter instance (one app), so the counter must
		// key on principalId, not be global.
		const app = new Hono<Env>();
		let principalId = 'alice';
		app.use('*', async (c, next) => {
			c.set('principal', {
				id: principalId as Env['Variables']['principal']['id'],
			});
			await next();
		});
		app.use('*', rateLimit({ requests: 1, windowSeconds: 60 }));
		app.get('/', (c) => c.text('ok'));

		principalId = 'alice';
		expect((await app.request('/')).status).toBe(200);
		expect((await app.request('/')).status).toBe(429);

		// bob has spent nothing; alice exhausting her bucket does not touch his.
		principalId = 'bob';
		expect((await app.request('/')).status).toBe(200);
	});
});
