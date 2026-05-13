/**
 * Wave 5 unit-level tests for `epicenter up`.
 *
 * These tests run `runUp` in-process with a fake `DaemonRuntime` /
 * `SyncAttachment` so we never spawn a child or call `process.exit`. The
 * cross-process e2e (real CLI binary, real relay) lands in Wave 8.
 *
 * Key behaviors:
 * - happy path writes metadata, binds the socket, and replies to ping
 * - startup failures release the claimed daemon lease
 * - responsive legacy sockets return AlreadyRunning and dispose started routes
 * - held SQLite leases short-circuit before config import or route startup
 * - orphan socket files are swept and replaced by a fresh daemon
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
	claimDaemonLease,
	metadataPathFor,
	pingDaemon,
	socketPathFor,
	writeMetadata,
} from '@epicenter/workspace/node';
import { Hono } from 'hono';
import { Ok, type Result } from 'wellcrafted/result';
import { runUp } from './up';

let originalXdg: string | undefined;
let runtimeRoot: string;
let workDir: string;
let homeRoot: string;

function servePingDaemon(socketPath: string): Bun.Server<undefined> {
	const app = new Hono().post('/ping', (c) => c.json(Ok('pong' as const)));
	return Bun.serve({ unix: socketPath, fetch: app.fetch });
}

function expectOk<T>(result: Result<T, unknown>): T {
	expect(result.error).toBeNull();
	if (result.error !== null) throw result.error;
	return result.data as T;
}

function configPath() {
	return join(workDir, 'epicenter.config.ts');
}

function writeRouteConfig({
	route = 'default',
	disposeMarker,
	importMarker,
	startBody,
}: {
	route?: string;
	disposeMarker?: string;
	importMarker?: string;
	startBody?: string;
} = {}) {
	const markerImport = importMarker
		? `await Bun.write(${JSON.stringify(importMarker)}, 'imported');`
		: '';
	const body =
		startBody ??
		`return {
			actions: {},
			async [Symbol.asyncDispose]() {
				${
					disposeMarker
						? `await Bun.write(${JSON.stringify(disposeMarker)}, 'disposed');`
						: ''
				}
			},
			sync: {
				whenConnected: new Promise(() => {}),
				status: { phase: 'connected' },
				onStatusChange: () => () => {},
			},
			awareness: {
				peers: () => new Map(),
				observe: () => () => {},
			},
			remote: {
				invoke: async () => ({ data: null, error: null }),
			},
		};`;
	writeFileSync(
		configPath(),
		`${markerImport}
export default {
	daemon: {
		routes: [
			{
				route: ${JSON.stringify(route)},
				start: async () => {
					${body}
				},
			},
		],
	},
};
`,
	);
}

let originalHome: string | undefined;

beforeEach(() => {
	originalXdg = process.env.XDG_RUNTIME_DIR;
	originalHome = process.env.HOME;

	runtimeRoot = mkdtempSync(join(tmpdir(), 'ep-up-'));
	process.env.XDG_RUNTIME_DIR = runtimeRoot;
	mkdirSync(join(runtimeRoot, 'epicenter'), { recursive: true });

	homeRoot = mkdtempSync(join(tmpdir(), 'ep-home-'));
	process.env.HOME = homeRoot;

	workDir = mkdtempSync(join(tmpdir(), 'ep-dir-'));
	writeRouteConfig();
});

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
	else process.env.XDG_RUNTIME_DIR = originalXdg;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;

	rmSync(runtimeRoot, { recursive: true, force: true });
	rmSync(homeRoot, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

describe('runUp: happy path', () => {
	test('writes metadata, binds socket, replies to ping', async () => {
		const handle = expectOk(
			await runUp({
				projectDir: workDir,
				quiet: true,
			}),
		);
		try {
			// Metadata was written.
			expect(existsSync(metadataPathFor(workDir))).toBe(true);
			expect(handle.metadata.pid).toBe(process.pid);
			expect(handle.runtimes).toHaveLength(1);
			expect(handle.runtimes[0]?.route).toBe('default');

			// Socket is bound; ping it via a fresh connect using the real client.
			const sockPath = socketPathFor(workDir);
			expect(existsSync(sockPath)).toBe(true);
			const ok = await pingDaemon(sockPath, 1000);
			expect(ok).toBe(true);
		} finally {
			await handle.teardown();
		}
		// Cleanup: metadata and socket gone.
		const sockPath = socketPathFor(workDir);
		expect(existsSync(metadataPathFor(workDir))).toBe(false);
		expect(existsSync(sockPath)).toBe(false);
	});
});

describe('runUp: failure cleanup', () => {
	test('releases the daemon lease when config loading fails', async () => {
		writeFileSync(configPath(), 'export default {};\n');

		const { error } = await runUp({
			projectDir: workDir,
			quiet: true,
		});

		expect(error?.name).toBe('InvalidConfig');
		const lease = expectOk(claimDaemonLease(workDir));
		lease.release();
	});

	test('releases the daemon lease when route startup fails', async () => {
		writeRouteConfig({
			startBody: "throw new Error('route failed');",
		});

		const { error } = await runUp({
			projectDir: workDir,
			quiet: true,
		});

		expect(error?.name).toBe('RouteFailed');
		const lease = expectOk(claimDaemonLease(workDir));
		lease.release();
	});

	test('returns MetadataWriteFailed and tears down when metadata path is blocked', async () => {
		mkdirSync(metadataPathFor(workDir));

		const { error } = await runUp({
			projectDir: workDir,
			quiet: true,
		});

		expect(error?.name).toBe('MetadataWriteFailed');
		expect(existsSync(socketPathFor(workDir))).toBe(false);
		const lease = expectOk(claimDaemonLease(workDir));
		lease.release();
	});
});

describe('runUp: already running', () => {
	test('returns AlreadyRunning when a responsive legacy socket is detected', async () => {
		const sockPath = socketPathFor(workDir);
		mkdirSync(join(runtimeRoot, 'epicenter'), { recursive: true });

		const server = servePingDaemon(sockPath);

		writeMetadata(workDir, {
			pid: process.pid,
			dir: workDir,
			startedAt: new Date().toISOString(),
			cliVersion: '0.0.0',
			configMtime: 0,
		});

		const disposeMarker = join(workDir, 'disposed.txt');
		writeRouteConfig({ disposeMarker });

		try {
			const { error } = await runUp({
				projectDir: workDir,
				quiet: true,
			});
			expect(error).toMatchObject({
				name: 'AlreadyRunning',
				pid: process.pid,
			});
			expect(existsSync(disposeMarker)).toBe(true);
		} finally {
			await server.stop(true).catch(() => {
				// best-effort
			});
		}
	});

	test('does not import config when the daemon lease is held', async () => {
		const lease = expectOk(claimDaemonLease(workDir));
		const importMarker = join(workDir, 'imported.txt');
		writeRouteConfig({ importMarker });

		try {
			const { error } = await runUp({
				projectDir: workDir,
				quiet: true,
			});

			expect(error?.name).toBe('AlreadyRunning');
			expect(existsSync(importMarker)).toBe(false);
		} finally {
			lease.release();
		}
	});
});

describe('runUp: orphan path', () => {
	test('proceeds cleanly when metadata pid is dead and socket is phantom', async () => {
		const sockPath = socketPathFor(workDir);
		mkdirSync(join(runtimeRoot, 'epicenter'), { recursive: true });

		// Phantom (regular file, not a real socket) + dead-pid metadata.
		writeFileSync(sockPath, '');
		writeMetadata(workDir, {
			pid: 99999999,
			dir: workDir,
			startedAt: new Date().toISOString(),
			cliVersion: '0.0.0',
			configMtime: 0,
		});

		const handle = expectOk(
			await runUp({
				projectDir: workDir,
				quiet: true,
			}),
		);

		try {
			// Daemon came up; fresh metadata for *this* pid was written.
			expect(handle.metadata.pid).toBe(process.pid);
			expect(existsSync(socketPathFor(workDir))).toBe(true);
		} finally {
			await handle.teardown();
		}
	});
});
