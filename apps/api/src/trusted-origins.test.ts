/**
 * Trusted-origin invariants.
 *
 * Black-box assertions against the exported `TRUSTED_ORIGINS` list. Each
 * test pins a rule the list must obey, not the literal contents: the list
 * grows naturally as `APPS` grows, but no future entry can silently break
 * an invariant like "no wildcards" or "no cleartext production host."
 *
 * If you are adding a new app and a test here fails, that's the test doing
 * its job: read the failing message, fix the `APPS` entry, and the policy
 * holds.
 */

import { describe, expect, test } from 'bun:test';
import { APPS } from '@epicenter/constants/apps';
import { TRUSTED_ORIGINS, WRANGLER_DEV_API_ORIGIN } from './trusted-origins.js';

describe('TRUSTED_ORIGINS', () => {
	// Fails if a contributor adds `chrome-extension://*`, `https://*.foo.com`,
	// or any other wildcard to TRUSTED_ORIGINS or to an APPS entry.
	test('contains no wildcards', () => {
		for (const origin of TRUSTED_ORIGINS) {
			expect(origin).not.toContain('*');
		}
	});

	// Fails if a contributor pastes an empty string or a malformed origin
	// like `https://` (no host), which would silently match `Origin:` or
	// produce undefined behavior in downstream URL parsing.
	test('every entry is a syntactically valid URL with a host', () => {
		for (const origin of TRUSTED_ORIGINS) {
			expect(() => new URL(origin)).not.toThrow();
			expect(new URL(origin).host.length).toBeGreaterThan(0);
		}
	});

	// Fails if the composition accidentally repeats an entry (e.g. an APPS
	// url that also matches a hand-added literal). Duplicates aren't unsafe
	// on their own but signal a logic error in how the list is built.
	test('contains no duplicates', () => {
		expect(TRUSTED_ORIGINS.length).toBe(new Set(TRUSTED_ORIGINS).size);
	});

	// Fails if a contributor adds an origin using an exotic scheme such as
	// `file://`, `data:`, or `javascript:`, none of which should ever pass
	// CORS or CSRF here.
	test('only uses approved URL schemes', () => {
		const allowed = new Set(['https:', 'http:', 'tauri:', 'chrome-extension:']);
		for (const origin of TRUSTED_ORIGINS) {
			expect(allowed.has(new URL(origin).protocol)).toBe(true);
		}
	});
});

describe('HTTPS origins', () => {
	const httpsOrigins = TRUSTED_ORIGINS.filter((o) => o.startsWith('https://'));

	// Sanity check so the assertions below can't pass vacuously.
	test('is non-empty', () => {
		expect(httpsOrigins.length).toBeGreaterThan(0);
	});

	// Fails if a contributor hand-edits a stray HTTPS origin like
	// `https://attacker.com` directly into TRUSTED_ORIGINS without adding a
	// corresponding APPS entry. This is the core CSRF defense for production.
	test('every HTTPS origin is exactly an APPS url', () => {
		const declared = new Set(
			Object.values(APPS).flatMap((app) => app.urls as readonly string[]),
		);
		for (const origin of httpsOrigins) {
			expect(declared.has(origin)).toBe(true);
		}
	});

	// Fails if the composition is refactored in a way that drops the APPS
	// expansion (e.g. someone replaces the spread with a hardcoded subset).
	test('every APPS url is included', () => {
		for (const url of Object.values(APPS).flatMap((app) => app.urls)) {
			expect(TRUSTED_ORIGINS).toContain(url);
		}
	});

	// Fails if an APPS entry sneaks in a localhost or raw-IP URL on the
	// HTTPS list (those belong on the localhost http:// list, not here).
	test('no HTTPS origin uses localhost or a raw IP', () => {
		for (const origin of httpsOrigins) {
			const { hostname } = new URL(origin);
			expect(hostname).not.toBe('localhost');
			expect(hostname).not.toBe('127.0.0.1');
			expect(hostname).not.toBe('0.0.0.0');
		}
	});
});

describe('localhost http:// origins', () => {
	const localhostOrigins = TRUSTED_ORIGINS.filter((o) => {
		const url = new URL(o);
		return url.protocol === 'http:' && url.hostname === 'localhost';
	});

	// Sanity check so the assertions below can't pass vacuously.
	test('is non-empty', () => {
		expect(localhostOrigins.length).toBeGreaterThan(0);
	});

	// Fails if a contributor adds a bare `http://localhost` (no port), a
	// path suffix, or an `https://localhost` entry.
	test('each is http://localhost:<port> with no path', () => {
		for (const origin of localhostOrigins) {
			const url = new URL(origin);
			expect(url.protocol).toBe('http:');
			expect(url.port).not.toBe('');
			expect(url.pathname).toBe('/');
		}
	});

	// Fails if a contributor adds `http://localhost:9999` for a port that
	// no APPS entry actually serves.
	test('every port matches an APPS entry', () => {
		const ports = new Set(Object.values(APPS).map((app) => String(app.port)));
		for (const origin of localhostOrigins) {
			expect(ports.has(new URL(origin).port)).toBe(true);
		}
	});

	// Fails if the composition is refactored in a way that drops the
	// localhost expansion (parity with the HTTPS-APPS test above).
	test('every APPS port has a localhost origin', () => {
		const localhostPorts = new Set(
			localhostOrigins.map((o) => new URL(o).port),
		);
		for (const app of Object.values(APPS)) {
			expect(localhostPorts.has(String(app.port))).toBe(true);
		}
	});
});

describe('chrome-extension origins', () => {
	const chromeExt = TRUSTED_ORIGINS.filter((o) =>
		o.startsWith('chrome-extension://'),
	);

	// Fails if a contributor adds a second extension, restores the old
	// `chrome-extension://*` wildcard, or adds an extension with an invalid
	// (non 32-char a-p) ID.
	test('exactly one entry, pinned to a 32-char a-p extension ID', () => {
		expect(chromeExt.length).toBe(1);
		const [only] = chromeExt;
		if (!only) throw new Error('unreachable');
		expect(new URL(only).hostname).toMatch(/^[a-p]{32}$/);
	});
});

describe('tauri:// origins', () => {
	// Fails if the Tauri origin is removed (breaks Whispering and future
	// Tauri apps) or replaced with the wrong scheme.
	test('at least one and all use the tauri: scheme', () => {
		const tauri = TRUSTED_ORIGINS.filter((o) => o.startsWith('tauri://'));
		expect(tauri.length).toBeGreaterThan(0);
		for (const origin of tauri) {
			expect(new URL(origin).protocol).toBe('tauri:');
		}
	});
});

describe('WRANGLER_DEV_API_ORIGIN', () => {
	// Fails if WRANGLER_DEV_API_ORIGIN drifts away from the canonical API
	// host (e.g. someone hand-edits it to `http://attacker.so` or refactors
	// it to read from a different APPS entry).
	test('is the http:// form of the canonical API URL', () => {
		const apiHost = new URL(APPS.API.urls[0]).host;
		expect(WRANGLER_DEV_API_ORIGIN).toBe(`http://${apiHost}`);
	});

	// Fails if any other cleartext production origin (e.g. `http://foo.com`)
	// sneaks into the list. The wrangler shim is the one exception.
	test('is the only non-localhost http:// origin in TRUSTED_ORIGINS', () => {
		const cleartextNonLocal = TRUSTED_ORIGINS.filter((origin) => {
			const url = new URL(origin);
			return url.protocol === 'http:' && url.hostname !== 'localhost';
		});
		expect(cleartextNonLocal).toEqual([WRANGLER_DEV_API_ORIGIN]);
	});
});
