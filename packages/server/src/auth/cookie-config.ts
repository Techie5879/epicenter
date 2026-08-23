import type { BetterAuthOptions } from 'better-auth';

/**
 * Choose Better Auth cookie transport settings for the current API origin.
 *
 * Use this from the auth server factory, not from client code. Localhost uses
 * host-only, non-secure Lax cookies so the Vite auth proxy can work during
 * development. Deployed API origins use host-only, secure Lax cookies: the only
 * cookie consumer is the dashboard the API serves from its own origin
 * (ADR-0079's exception rule), and every cross-origin app client is a bearer
 * client that sends `credentials: 'omit'`, so nothing needs a cookie to travel
 * cross-site. Lax survives the whole OAuth flow because every cross-site leg is
 * a top-level GET navigation (the authorize entry and the Google callback) and
 * the sign-in/consent POSTs are same-origin fetches from the API's own pages.
 *
 * There is deliberately no cross-subdomain knob: a `Domain=` cookie shared
 * across subdomains is the halfway cookie ADR-0079 forbids (it widens CSRF
 * surface and blurs audience boundaries), and it had zero consumers.
 */
export function createCookieAdvancedConfig(baseURL: string) {
	const { hostname } = new URL(baseURL);
	if (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '[::1]'
	) {
		return {
			useSecureCookies: false,
			defaultCookieAttributes: {
				sameSite: 'lax',
				secure: false,
			},
		} satisfies NonNullable<BetterAuthOptions['advanced']>;
	}

	return {
		useSecureCookies: true,
		defaultCookieAttributes: {
			sameSite: 'lax',
			secure: true,
		},
	} satisfies NonNullable<BetterAuthOptions['advanced']>;
}
