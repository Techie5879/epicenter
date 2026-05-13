/**
 * Better Auth Cookie Config Tests
 *
 * Verifies that the API auth factory chooses browser-compatible cookie
 * attributes for local development while preserving the production cookie
 * scope used by api.epicenter.so.
 *
 * Key behaviors:
 * - Localhost uses host-only, Lax, non-secure cookies
 * - Production uses .epicenter.so, SameSite=None, Secure cookies
 */

import { expect, test } from 'bun:test';
import type { BetterAuthOptions } from 'better-auth';
import { getCookies } from 'better-auth/cookies';
import { createCookieAdvancedConfig } from './cookie-config.js';

test('localhost cookies are host-only, Lax, and non-secure', () => {
	const advanced = createCookieAdvancedConfig('http://localhost:8787');
	const cookie = sessionTokenCookie('http://localhost:8787');

	expect(advanced.crossSubDomainCookies).toBeUndefined();
	expect(cookie.name).toBe('better-auth.session_token');
	expect(cookie.attributes.secure).toBe(false);
	expect(cookie.attributes.sameSite).toBe('lax');
	expect('domain' in cookie.attributes).toBe(false);
});

test('loopback cookies use localhost-compatible attributes', () => {
	const advanced = createCookieAdvancedConfig('http://127.0.0.1:8787');
	const cookie = sessionTokenCookie('http://127.0.0.1:8787');

	expect(advanced.crossSubDomainCookies).toBeUndefined();
	expect(cookie.name).toBe('better-auth.session_token');
	expect(cookie.attributes.secure).toBe(false);
	expect(cookie.attributes.sameSite).toBe('lax');
	expect('domain' in cookie.attributes).toBe(false);
});

test('IPv6 localhost cookies use localhost-compatible attributes', () => {
	const advanced = createCookieAdvancedConfig('http://[::1]:8787');
	const cookie = sessionTokenCookie('http://[::1]:8787');

	expect(advanced.crossSubDomainCookies).toBeUndefined();
	expect(cookie.name).toBe('better-auth.session_token');
	expect(cookie.attributes.secure).toBe(false);
	expect(cookie.attributes.sameSite).toBe('lax');
	expect('domain' in cookie.attributes).toBe(false);
});

test('production API cookies are cross-subdomain, SameSite=None, and secure', () => {
	const advanced = createCookieAdvancedConfig('https://api.epicenter.so');
	const cookie = sessionTokenCookie('https://api.epicenter.so');

	expect(advanced.crossSubDomainCookies).toEqual({
		enabled: true,
		domain: '.epicenter.so',
	});
	expect(cookie.name).toBe('__Secure-better-auth.session_token');
	expect(cookie.attributes.secure).toBe(true);
	expect(cookie.attributes.sameSite).toBe('none');
	expect(cookie.attributes.domain).toBe('.epicenter.so');
});

function sessionTokenCookie(baseURL: string) {
	const options = {
		baseURL,
		basePath: '/auth',
		advanced: createCookieAdvancedConfig(baseURL),
	} satisfies BetterAuthOptions;
	return getCookies(options).sessionToken;
}
