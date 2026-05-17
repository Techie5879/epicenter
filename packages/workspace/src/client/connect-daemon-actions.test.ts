/**
 * Unit tests for `connectDaemonActions`. We don't bind a real daemon; pinging a
 * non-existent socket is enough to exercise the failure path. The success
 * path is covered indirectly by `daemon-actions.test.ts` (which stubs the client
 * directly) and end-to-end by the daemon test suite.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DaemonError } from '../daemon/client.js';
import type { ProjectDir } from '../shared/types.js';
import { connectDaemonActions } from './connect-daemon-actions.js';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'connect-daemon-'));
	mkdirSync(join(root, 'workspaces'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('connectDaemonActions', () => {
	test('throws DaemonError.MissingConfig when explicit project has no workspaces directory', async () => {
		rmSync(join(root, 'workspaces'), { recursive: true, force: true });

		let caught: unknown;
		try {
			await connectDaemonActions({
				route: 'demo',
				projectDir: root as ProjectDir,
			});
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeDefined();
		const e = caught as Extract<DaemonError, { name: 'MissingConfig' }>;
		expect(e.name).toBe('MissingConfig');
		expect(e.projectDir).toBe(root);
	});

	test('throws DaemonError.Required when no daemon is listening', async () => {
		let caught: unknown;
		try {
			await connectDaemonActions({
				route: 'demo',
				projectDir: root as ProjectDir,
			});
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		const e = caught as Extract<DaemonError, { name: 'Required' }>;
		expect(e.name).toBe('Required');
		expect(e.projectDir).toBe(root);
	});
});
