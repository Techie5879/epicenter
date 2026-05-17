import type { BetterAuthOptions } from 'better-auth';

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
		crossSubDomainCookies: {
			enabled: true,
			domain: '.epicenter.so',
		},
		defaultCookieAttributes: {
			sameSite: 'none',
			secure: true,
		},
	} satisfies NonNullable<BetterAuthOptions['advanced']>;
}
