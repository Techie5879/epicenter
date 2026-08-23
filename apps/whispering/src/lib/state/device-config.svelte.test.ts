/**
 * Whispering Device Config Tests
 *
 * Verifies the device-local Codex OAuth entry at the persisted-map boundary.
 *
 * Key behaviors:
 * - Codex sessions default to null and stay outside the string-secret facade
 * - Valid sessions persist under the device prefix
 * - Invalid stored sessions fall back to null
 */
import { afterAll, expect, mock, test } from 'bun:test';

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return [...this.values.keys()].at(index) ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

type StorageListener = (event: {
	key: string | null;
	newValue: string | null;
}) => void;

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const localStorage = new MemoryStorage();
const storageListeners: StorageListener[] = [];
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: {
		localStorage,
		addEventListener(type: string, listener: StorageListener) {
			if (type === 'storage') storageListeners.push(listener);
		},
	},
});

mock.module('#platform/os', () => ({ os: { isApple: false } }));
mock.module('$lib/constants/audio', () => ({
	BITRATES_KBPS: [64, 128],
	DEFAULT_BITRATE_KBPS: 64,
}));
mock.module('$lib/report', () => ({ report: { error() {} } }));

const { SECRET_KEYS, deviceConfig } = await import('./device-config.svelte.js');

afterAll(() => {
	if (originalWindow) {
		Object.defineProperty(globalThis, 'window', originalWindow);
	} else {
		Reflect.deleteProperty(globalThis, 'window');
	}
});

function setup() {
	deviceConfig.set('auth.codex', null);
	return { deviceConfig, localStorage };
}

function sendStorageValue(value: { accessToken: string }) {
	const raw = JSON.stringify(value);
	for (const listener of storageListeners) {
		listener({ key: 'whispering.device.auth.codex', newValue: raw });
	}
}

test('auth.codex defaults to null and is not a string secret', () => {
	const { deviceConfig } = setup();

	expect(deviceConfig.getDefault('auth.codex')).toBeNull();
	expect(deviceConfig.get('auth.codex')).toBeNull();
	expect(SECRET_KEYS).not.toContain('auth.codex');
});

test('auth.codex persists a complete device-local session', () => {
	const { deviceConfig, localStorage } = setup();
	const session = {
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		expiresAt: 123_456,
		accountId: 'account-id',
		email: 'person@example.com',
	};

	deviceConfig.set('auth.codex', session);

	expect(deviceConfig.get('auth.codex')).toEqual(session);
	expect(
		JSON.parse(localStorage.getItem('whispering.device.auth.codex') ?? 'null'),
	).toEqual(session);
});

test('auth.codex rejects an incomplete stored session', () => {
	const { deviceConfig } = setup();

	sendStorageValue({ accessToken: 'access-token' });

	expect(deviceConfig.get('auth.codex')).toBeNull();
});
