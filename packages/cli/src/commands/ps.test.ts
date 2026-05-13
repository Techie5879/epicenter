/**
 * Wave 7 unit tests for `epicenter ps`.
 *
 * `runPs` is driven through real daemon-shaped socket behavior so the command
 * body stays free of test-only dependency seams.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	metadataPathFor,
	socketPathFor,
	writeMetadata,
} from '@epicenter/workspace/node';
import { Hono } from 'hono';
import { Ok } from 'wellcrafted/result';
import { runPs } from './ps';

let originalXdg: string | undefined;
let originalHome: string | undefined;
let runtimeRoot: string;
let homeRoot: string;

function servePingDaemon(socketPath: string): Bun.Server<undefined> {
	const app = new Hono().post('/ping', (c) => c.json(Ok('pong' as const)));
	return Bun.serve({ unix: socketPath, fetch: app.fetch });
}

beforeEach(() => {
	originalXdg = process.env.XDG_RUNTIME_DIR;
	originalHome = process.env.HOME;
	runtimeRoot = mkdtempSync(join(tmpdir(), 'ep-ps-'));
	process.env.XDG_RUNTIME_DIR = runtimeRoot;
	mkdirSync(join(runtimeRoot, 'epicenter'), { recursive: true });
	homeRoot = mkdtempSync(join(tmpdir(), 'ep-ps-home-'));
	process.env.HOME = homeRoot;
});

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
	else process.env.XDG_RUNTIME_DIR = originalXdg;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(runtimeRoot, { recursive: true, force: true });
	rmSync(homeRoot, { recursive: true, force: true });
});

describe('runPs', () => {
	test('returns empty list when runtime dir has no metadata', async () => {
		const rows = await runPs();
		expect(rows).toEqual([]);
	});

	test('returns alive daemons and unlinks dead-pid orphans', async () => {
		const aliveDir = mkdtempSync(join(tmpdir(), 'ep-ps-alive-'));
		const deadDir = mkdtempSync(join(tmpdir(), 'ep-ps-dead-'));
		try {
			writeMetadata(aliveDir, {
				pid: process.pid,
				dir: aliveDir,
				startedAt: new Date().toISOString(),
				cliVersion: '0.0.0',
				configMtime: 0,
			});
			writeMetadata(deadDir, {
				pid: 99999999,
				dir: deadDir,
				startedAt: new Date().toISOString(),
				cliVersion: '0.0.0',
				configMtime: 0,
			});
			writeFileSync(socketPathFor(deadDir), '');
			const server = servePingDaemon(socketPathFor(aliveDir));

			try {
				expect(existsSync(metadataPathFor(deadDir))).toBe(true);
				expect(existsSync(socketPathFor(deadDir))).toBe(true);

				const rows = await runPs();

				expect(rows).toHaveLength(1);
				expect(rows[0]?.dir).toBe(aliveDir);
				expect(rows[0]?.pid).toBe(process.pid);

				// Orphan was swept.
				expect(existsSync(metadataPathFor(deadDir))).toBe(false);
				expect(existsSync(socketPathFor(deadDir))).toBe(false);
				// Alive metadata still present.
				expect(existsSync(metadataPathFor(aliveDir))).toBe(true);
			} finally {
				await server.stop(true).catch(() => {
					// best effort
				});
			}
		} finally {
			rmSync(aliveDir, { recursive: true, force: true });
			rmSync(deadDir, { recursive: true, force: true });
		}
	});

	test('drops alive-pid daemons whose socket is unresponsive', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ep-ps-unresp-'));
		try {
			writeMetadata(dir, {
				pid: process.pid,
				dir,
				startedAt: new Date().toISOString(),
				cliVersion: '0.0.0',
				configMtime: 0,
			});
			writeFileSync(socketPathFor(dir), '');
			const rows = await runPs();
			expect(rows).toEqual([]);
			expect(existsSync(metadataPathFor(dir))).toBe(false);
			expect(existsSync(socketPathFor(dir))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
