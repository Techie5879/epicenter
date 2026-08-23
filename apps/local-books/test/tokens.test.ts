import { describe, expect, test } from 'bun:test';
import {
	accessTokenTtlMs,
	isAccessTokenExpired,
	isRefreshTokenExpired,
	tokenSetFromGrant,
} from '../src/tokens.ts';

const NOW = Date.parse('2026-06-21T12:00:00.000Z');

const validGrant = {
	token_type: 'bearer',
	access_token: 'access-abc',
	refresh_token: 'refresh-xyz',
	expires_in: 3600,
	x_refresh_token_expires_in: 8726400,
};

describe('tokenSetFromGrant', () => {
	test('converts relative expiries into absolute timestamps', () => {
		const { data, error } = tokenSetFromGrant(validGrant, {
			realmId: '123',
			environment: 'sandbox',
			now: NOW,
		});
		expect(error).toBeNull();
		expect(data?.accessToken).toBe('access-abc');
		expect(data?.refreshToken).toBe('refresh-xyz');
		expect(Date.parse(data!.accessTokenExpiresAt)).toBe(NOW + 3600 * 1000);
		expect(Date.parse(data!.refreshTokenExpiresAt)).toBe(NOW + 8726400 * 1000);
	});

	test('rejects a non-bearer token type', () => {
		const { error } = tokenSetFromGrant(
			{ ...validGrant, token_type: 'mac' },
			{ realmId: '1', environment: 'sandbox', now: NOW },
		);
		expect(error?.name).toBe('InvalidGrant');
	});

	test('falls back to the prior refresh token during rotation', () => {
		const { data, error } = tokenSetFromGrant(
			{ ...validGrant, refresh_token: undefined },
			{
				realmId: '1',
				environment: 'sandbox',
				now: NOW,
				fallbackRefreshToken: 'old-refresh',
			},
		);
		expect(error).toBeNull();
		expect(data?.refreshToken).toBe('old-refresh');
	});

	test('rejects a missing access token', () => {
		const { error } = tokenSetFromGrant(
			{ ...validGrant, access_token: undefined },
			{ realmId: '1', environment: 'sandbox', now: NOW },
		);
		expect(error?.name).toBe('InvalidGrant');
	});
});

describe('expiry helpers', () => {
	const token = tokenSetFromGrant(validGrant, {
		realmId: '1',
		environment: 'sandbox',
		now: NOW,
	}).data!;

	test('access token is live right after issue', () => {
		expect(isAccessTokenExpired(token, NOW, 0)).toBe(false);
		expect(accessTokenTtlMs(token, NOW)).toBe(3600 * 1000);
	});

	test('access token is treated as expired within the skew window', () => {
		// 1 minute before the hard expiry, with a 2-minute skew.
		const justBefore = NOW + 3600 * 1000 - 60 * 1000;
		expect(isAccessTokenExpired(token, justBefore)).toBe(true);
		expect(isAccessTokenExpired(token, justBefore, 0)).toBe(false);
	});

	test('refresh token expiry is honored', () => {
		expect(isRefreshTokenExpired(token, NOW)).toBe(false);
		expect(isRefreshTokenExpired(token, NOW + 8726400 * 1000 + 1)).toBe(true);
	});
});
