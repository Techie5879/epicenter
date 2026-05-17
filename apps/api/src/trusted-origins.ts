import { APPS } from '@epicenter/constants/apps';

/**
 * Tooling-only exception for `wrangler dev`.
 *
 * Wrangler serves the API custom domain over plain HTTP locally, so requests
 * it makes report `Origin: http://api.epicenter.so`. In production Cloudflare
 * upgrades the domain to HTTPS, so a real browser never sends this Origin
 * against the deployed worker; it is a dev-loop artifact, not a
 * browser-production origin.
 *
 * Exported because `app.ts` also matches against this exact string to rewrite
 * the Better Auth `baseURL` to localhost during `wrangler dev`. Naming the
 * constant in one place keeps "this is the wrangler shim" defined exactly
 * once.
 */
export const WRANGLER_DEV_API_ORIGIN = `http://${new URL(APPS.API.urls[0]).host}`;

/**
 * Origins permitted by both CORS and Better Auth's CSRF check.
 *
 * Invariants (no wildcards, HTTPS-only production hosts, single pinned
 * chrome-extension, etc.) are pinned in `trusted-origins.test.ts` as
 * black-box assertions against this exported list.
 */
// Typed as mutable `string[]` because Better Auth's `BetterAuthOptions.trustedOrigins`
// is typed `string[] | (request) => ...` and rejects `readonly string[]`. Treat the
// array as read-only at every call site (cors origin check, includes() lookups,
// trustedOrigins handoff): no caller currently mutates it.
export const TRUSTED_ORIGINS: string[] = [
	// Production browser apps. Derived from `APPS` so adding a new app
	// auto-extends both CORS and CSRF. Every entry MUST be HTTPS; the test
	// invariant pins this so a future `APPS` entry cannot silently introduce
	// an `http://` production origin. The Set dedupes APPS entries that
	// intentionally share an origin (today: DASHBOARD shares `api.epicenter.so`
	// with API because the dashboard SPA is served by the API worker).
	...new Set(Object.values(APPS).flatMap((app) => app.urls)),

	// Local development origins. Trusted in production by design so devs can
	// run Vite locally against the deployed API. Session cookies are
	// origin-scoped, so granting CORS+CSRF to localhost does not let any
	// other origin lift them: a different origin still sees a missing cookie.
	// No Set wrap here: every APPS entry has a distinct port by construction;
	// a future port collision is itself a bug we want surfaced by the
	// "no duplicates" test invariant.
	...Object.values(APPS).map((app) => `http://localhost:${app.port}`),

	// Tauri WebView origin used by Whispering and any future Tauri app.
	// Custom scheme reported by the browser as tauri://localhost; not a
	// network address and not reachable from the public internet.
	'tauri://localhost',

	// Tab-manager Chrome extension. Stable across installs because
	// `apps/tab-manager/wxt.config.ts` pins the manifest `key`. This exact
	// origin replaces an earlier `chrome-extension://*` wildcard that
	// defeated CSRF protection.
	'chrome-extension://mkbnicfhpacdofmoocppnjjmdfmkkgda',

	WRANGLER_DEV_API_ORIGIN,
];
