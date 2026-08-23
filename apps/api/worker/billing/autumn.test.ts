/**
 * Autumn adapter translation + discrimination tests.
 *
 * Any thrown provider failure collapses to one opaque
 * `BillingError.ProviderRequestFailed` with a fixed user-facing message
 * (the original error's detail is logged for operators, never put on the wire).
 * These pin that total mapping and, critically, that `isProviderError` narrows
 * BOTH provider class families: `AutumnError` (HTTP non-2xx) AND the
 * `HTTPClientError` network family. A discriminator that only checked
 * `AutumnError` would let a network outage on a dashboard read fall through to a
 * generic 500 instead of the fail-closed 503 billing envelope.
 */

import { expect, test } from 'bun:test';
import { AutumnError, ConnectionError } from 'autumn-js';
import { isProviderError, mapAutumnError, tryAutumn } from './autumn.js';

const FIXED_MESSAGE = 'Billing is temporarily unavailable. Please try again.';

function makeAutumnError(message: string, status: number): AutumnError {
	const body = JSON.stringify({ message });
	return new AutumnError(message, {
		response: new Response(body, { status }),
		request: new Request('https://api.useautumn.com/check'),
		body,
	});
}

test('an AutumnError maps to the fixed opaque message, not the provider wording', () => {
	const { error } = mapAutumnError(makeAutumnError('Autumn API error', 500));
	expect(error).toMatchObject({
		name: 'ProviderRequestFailed',
		message: FIXED_MESSAGE,
	});
});

test('an HTTPClientError maps to the fixed opaque message, fail closed', () => {
	const { error } = mapAutumnError(
		new ConnectionError('Unable to make request'),
	);
	expect(error.message).toBe(FIXED_MESSAGE);
});

test('tryAutumn maps provider failures into BillingError', async () => {
	const { error } = await tryAutumn(async () => {
		throw new ConnectionError('Unable to make request');
	});

	expect(error).toMatchObject({
		name: 'ProviderRequestFailed',
		message: FIXED_MESSAGE,
	});
});

test('tryAutumn rethrows programming bugs instead of mapping them', async () => {
	await expect(
		tryAutumn(async () => {
			throw new TypeError('cannot read x of undefined');
		}),
	).rejects.toThrow('cannot read x of undefined');
});

test('isProviderError narrows an HTTP non-2xx (AutumnError)', () => {
	expect(isProviderError(makeAutumnError('boom', 503))).toBe(true);
});

test('isProviderError narrows a network failure (HTTPClientError family)', () => {
	// Regression: a ConnectionError is NOT an AutumnError. A discriminator that
	// only checked `instanceof AutumnError` would 500 a provider outage on a
	// dashboard read instead of failing closed to 503.
	expect(isProviderError(new ConnectionError('Unable to make request'))).toBe(
		true,
	);
});

test('isProviderError rejects programming bugs so they stay real 500s', () => {
	expect(isProviderError(new Error('a bug in a handler'))).toBe(false);
	expect(isProviderError(new TypeError('cannot read x of undefined'))).toBe(
		false,
	);
	expect(isProviderError('500 Internal Server Error')).toBe(false);
});
