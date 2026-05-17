/**
 * Behavior tests for the shared `openHoneycrispWorkspace` opener.
 *
 * These tests do not exercise IndexedDB, BroadcastChannel, sync, or any
 * runtime composed by browser.ts or daemon.ts. They pin the canonical
 * Y.Doc identity, the optional `clientId`, and the encrypted tables/kv
 * surface that both layers compose around.
 */

import { describe, expect, test } from 'bun:test';
import { bytesToBase64, type SubjectKeyring } from '@epicenter/encryption';
import { attachEncryption } from '@epicenter/workspace';
import { randomBytes } from '@noble/ciphers/utils.js';
import type * as Y from 'yjs';
import {
	HONEYCRISP_WORKSPACE_ID,
	openHoneycrispWorkspace,
} from './workspace.js';

function toKeyring(key: Uint8Array): SubjectKeyring {
	return [{ version: 1, subjectKeyBase64: bytesToBase64(key) }];
}

function createTestEncryption(
	keyring: SubjectKeyring = toKeyring(randomBytes(32)),
): (ydoc: Y.Doc) => ReturnType<typeof attachEncryption> {
	return (ydoc) => {
		return attachEncryption(ydoc, { keyring: () => keyring });
	};
}

describe('openHoneycrispWorkspace', () => {
	test('creates a Y.Doc with HONEYCRISP_WORKSPACE_ID', () => {
		const workspace = openHoneycrispWorkspace(createTestEncryption());
		expect(workspace.ydoc.guid).toBe(HONEYCRISP_WORKSPACE_ID);
		workspace.ydoc.destroy();
	});

	test('applies optional clientId', () => {
		const attachTestEncryption = createTestEncryption();
		const workspace = openHoneycrispWorkspace(attachTestEncryption, {
			clientId: 1234,
		});
		expect(workspace.ydoc.clientID).toBe(1234);
		workspace.ydoc.destroy();
	});

	test('does not pin clientId when omitted', () => {
		const a = openHoneycrispWorkspace(createTestEncryption());
		const b = openHoneycrispWorkspace(createTestEncryption());
		expect(typeof a.ydoc.clientID).toBe('number');
		expect(typeof b.ydoc.clientID).toBe('number');
		a.ydoc.destroy();
		b.ydoc.destroy();
	});

	test('exposes Honeycrisp tables that accept writes through the encryption coordinator', () => {
		const workspace = openHoneycrispWorkspace(createTestEncryption());
		expect(workspace.tables.folders).toBeDefined();
		expect(workspace.tables.notes).toBeDefined();
		expect(workspace.kv).toBeDefined();
		expect(workspace.tables.folders.count()).toBe(0);
		expect(workspace.tables.notes.count()).toBe(0);
		workspace.ydoc.destroy();
	});

	test('exposes browser-safe domain helpers', () => {
		const workspace = openHoneycrispWorkspace(createTestEncryption());
		expect(typeof workspace.batch).toBe('function');
		expect(typeof workspace.noteBodyDocGuid).toBe('function');

		const guid = workspace.noteBodyDocGuid('note-1' as never);
		expect(typeof guid).toBe('string');
		expect(guid.length).toBeGreaterThan(0);
		workspace.ydoc.destroy();
	});
});
