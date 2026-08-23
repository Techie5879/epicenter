/**
 * `mountCloudDb`: the cloud's per-request Postgres lifecycle + after-response drain.
 *
 * This is the second half of the cloud-only relational layer (the first is
 * {@link mountCloudAuth}). Only the hosted cloud composes it: Better Auth reads
 * `c.var.db` and billing pushes Autumn charges onto `c.var.afterResponseQueue`.
 * The single-partition instance reads neither, so it never calls this and composes
 * no Postgres (ADR-0076). That is why it lives OUTSIDE `createServerApp` (which
 * stays portable, on the base {@link Env}) and is installed by the cloud onto its
 * own `Hono<CloudEnv>`, before `mountCloudAuth` so `c.var.db` is set when the auth
 * context is built.
 *
 * `connect` and `afterResponse` are injected because acquisition and keep-alive are
 * the genuinely runtime-specific parts: the Cloudflare cloud passes a per-request
 * `pg.Client` over Hyperdrive and `executionCtx.waitUntil`; a cloud-on-Bun host
 * passes a shared `pg.Pool` checkout and a no-op (the live process outlives the
 * response on its own). The library owns the queue and the drain shape; this injects
 * only how a handle is acquired and how the drain is kept alive. They travel together
 * because either alone is a bug: a `connect` with no drain leaks the handle.
 */

import type { Context, Hono } from 'hono';
import type { Db } from './db/create-db.js';
import type { ServerBindings } from './server-bindings.js';
import type { CloudEnv } from './types.js';

export function mountCloudDb(
	app: Hono<CloudEnv>,
	opts: {
		/**
		 * Acquire a per-request database handle and how to close it. The returned
		 * `close` runs after the after-response queue drains. The library depends on
		 * the portable `pg`/drizzle wire (ADR-0066), never a binding shape: the
		 * Cloudflare cloud casts `c.env` to its own `Cloudflare.Env` at the edge.
		 */
		connect: (
			env: ServerBindings,
		) => Promise<{ db: Db; close: () => Promise<void> }>;
		/**
		 * Keep fire-and-forget work alive past the HTTP response. Cloudflare hands the
		 * drain to `c.executionCtx.waitUntil(work)` (holds the isolate open); a Bun
		 * host does nothing (the live process runs it).
		 */
		afterResponse: (c: Context<CloudEnv>, work: Promise<unknown>) => void;
	},
): void {
	app.use('*', async (c, next) => {
		const { db, close } = await opts.connect(c.env);
		const queue: Promise<unknown>[] = [];
		try {
			c.set('db', db);
			c.set('afterResponseQueue', queue);
			await next();
		} finally {
			opts.afterResponse(
				c,
				Promise.allSettled(queue).then(() => close()),
			);
		}
	});
}
