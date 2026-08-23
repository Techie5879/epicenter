import { expect, test } from 'bun:test';
import { humanize } from './humanize';

test('humanize converts tagged error variants into human titles', () => {
	expect(humanize('PayloadTooLarge')).toBe('Payload too large');
	expect(humanize('Unauthorized')).toBe('Unauthorized');
	expect(humanize('MissingApiKey')).toBe('Missing API key');
	expect(humanize('OAuthFlowFailed')).toBe('OAuth flow failed');
	expect(humanize('HTTP500')).toBe('HTTP 500');
});
