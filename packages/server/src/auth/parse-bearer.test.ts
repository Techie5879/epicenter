import { expect, test } from 'bun:test';
import { parseBearer } from './parse-bearer.js';

test('parseBearer extracts the token from a Bearer header', () => {
	expect(parseBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
});

test('parseBearer is case-insensitive on the scheme and trims whitespace', () => {
	expect(parseBearer('bearer   abc.def.ghi   ')).toBe('abc.def.ghi');
	expect(parseBearer('BEARER abc.def.ghi')).toBe('abc.def.ghi');
});

test('parseBearer returns null for missing, empty, or non-bearer input', () => {
	expect(parseBearer(null)).toBeNull();
	expect(parseBearer('')).toBeNull();
	expect(parseBearer('Bearer ')).toBeNull();
	expect(parseBearer('Token abc')).toBeNull();
});
