import { expect, test } from 'bun:test';
import { createTokenManager } from '../src/token-manager.ts';
import type { TokenSet } from '../src/tokens.ts';
import { createMemoryTokenStore, makeConfig } from './helpers.ts';

/**
 * The provider-environment assertion (ADR-0108 rule 3). A token records the
 * environment it was minted for; the manager refuses to hand it out under a
 * different requested environment, so a sandbox token can never be refreshed with
 * the production client secret (which Intuit would reject opaquely).
 */

const NOW = Date.parse('2026-06-21T12:00:00.000Z');

function tokenFor(environment: TokenSet['environment']): TokenSet {
	return {
		realmId: 'realm-1',
		environment,
		accessToken: 'access',
		refreshToken: 'refresh',
		accessTokenExpiresAt: new Date(NOW + 3600 * 1000).toISOString(),
		refreshTokenExpiresAt: new Date(NOW + 8726400 * 1000).toISOString(),
		obtainedAt: new Date(NOW).toISOString(),
	};
}

test('refuses a token minted for a different environment than requested', () => {
	const config = makeConfig({ environment: 'production' });
	expect(() =>
		createTokenManager({
			config,
			store: createMemoryTokenStore(),
			token: tokenFor('sandbox'),
			now: () => NOW,
		}),
	).toThrow(
		/minted for the "sandbox" environment, but this command targets "production"/,
	);
});

test('accepts a token whose environment matches the request', () => {
	const config = makeConfig({ environment: 'sandbox' });
	const manager = createTokenManager({
		config,
		store: createMemoryTokenStore(),
		token: tokenFor('sandbox'),
		now: () => NOW,
	});
	expect(manager.current().environment).toBe('sandbox');
});
