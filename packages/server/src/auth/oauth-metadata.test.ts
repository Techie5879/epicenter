import { expect, test } from 'bun:test';
import {
	createOAuthIssuerURL,
	OAUTH_AUTHORIZATION_SERVER_METADATA_PATH,
	OAUTH_OPENID_CONFIGURATION_PATH,
	OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
} from './oauth-metadata.js';

test('OAuth metadata paths follow Better Auth issuer-path layout', () => {
	expect(createOAuthIssuerURL('https://api.epicenter.so')).toBe(
		'https://api.epicenter.so/auth',
	);
	expect(OAUTH_OPENID_CONFIGURATION_PATH).toBe(
		'/auth/.well-known/openid-configuration',
	);
	expect(OAUTH_AUTHORIZATION_SERVER_METADATA_PATH).toBe(
		'/.well-known/oauth-authorization-server/auth',
	);
	expect(OAUTH_PROTECTED_RESOURCE_METADATA_PATH).toBe(
		'/.well-known/oauth-protected-resource',
	);
});
