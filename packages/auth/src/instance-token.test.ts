/**
 * Instance-token secret unit tests (ADR-0075).
 *
 * Pins the two pure pieces of the instance bearer that live in `@epicenter/auth`:
 * the entropy gate fails closed on a missing / short / hand-typed token and passes
 * a strong one, and the generator's output always satisfies the gate (the lockstep
 * that lets a boot error point operators at `gen-token`). The VERIFIER side (a
 * presented bearer to a principal) is covered in `@epicenter/server`'s
 * `instance-token.test.ts`.
 */

import { expect, test } from 'bun:test';
import {
	assertStrongToken,
	generateInstanceToken,
	MIN_INSTANCE_TOKEN_CHARS,
} from './instance-token.js';

const TOKEN = 'instance-token-0123456789abcdef0123456789abcdef';

test('generateInstanceToken emits a 256-bit base64url token that clears the gate', () => {
	const token = generateInstanceToken();
	expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
	expect(token.length).toBe(43); // 32 bytes -> 43 base64url chars
	expect(token.length).toBeGreaterThanOrEqual(MIN_INSTANCE_TOKEN_CHARS);
	// Lockstep: the generator must always satisfy the gate, or the boot error
	// would reject a token the operator just generated.
	expect(assertStrongToken(token)).toBe(token);
	expect(generateInstanceToken()).not.toBe(token); // fresh randomness each call
});

test('assertStrongToken fails closed on a missing or empty token', () => {
	expect(() => assertStrongToken(undefined)).toThrow(/not set/);
	expect(() => assertStrongToken('')).toThrow(/not set/);
	expect(() => assertStrongToken('   ')).toThrow(/not set/);
});

test('assertStrongToken fails closed on a short token', () => {
	expect(() => assertStrongToken('letmein')).toThrow(/too weak/);
	expect(() =>
		assertStrongToken('a'.repeat(MIN_INSTANCE_TOKEN_CHARS - 1)),
	).toThrow(/too weak/);
});

test('assertStrongToken fails closed on a passphrase (spaces / control chars)', () => {
	expect(() =>
		assertStrongToken('correct horse battery staple correct horse'),
	).toThrow(/URL-safe/);
});

test('assertStrongToken returns the trimmed token for a strong value', () => {
	expect(assertStrongToken(`  ${TOKEN}  `)).toBe(TOKEN);
});
