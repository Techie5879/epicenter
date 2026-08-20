/**
 * Inference Catalog Tests
 *
 * Verifies the fixed Codex subscription catalog and provider-switch model rule.
 */
import { expect, test } from 'bun:test';
import { completionModelAfterProviderChange, INFERENCE } from './inference';

test('Codex models stay fixed in product order', () => {
	expect(INFERENCE.Codex.models).toEqual([
		'gpt-5.3-codex-spark',
		'gpt-5.4-mini',
		'gpt-5.4',
		'gpt-5.5',
	]);
});

test('switching to Codex always selects Spark', () => {
	expect(completionModelAfterProviderChange('Codex', 'gemini-2.5-flash')).toBe(
		'gpt-5.3-codex-spark',
	);
	expect(completionModelAfterProviderChange('Codex', 'gpt-5.4')).toBe(
		'gpt-5.3-codex-spark',
	);
});

test('free-form providers preserve the current model', () => {
	expect(completionModelAfterProviderChange('Custom', 'local-model')).toBe(
		'local-model',
	);
});
