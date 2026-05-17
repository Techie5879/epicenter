import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	type DaemonMetadata,
	readMetadata,
	unlinkMetadata,
	writeMetadata,
} from './metadata';
import { metadataPathFor } from './paths';

let originalXdg: string | undefined;
let runtimeRoot: string;
let workDir: string;

beforeEach(() => {
	originalXdg = process.env.XDG_RUNTIME_DIR;
	runtimeRoot = mkdtempSync(join(tmpdir(), 'epicenter-meta-test-'));
	process.env.XDG_RUNTIME_DIR = runtimeRoot;
	mkdirSync(join(runtimeRoot, 'epicenter'), { recursive: true });

	workDir = mkdtempSync(join(tmpdir(), 'epicenter-meta-dir-'));
});

afterEach(() => {
	if (originalXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
	else process.env.XDG_RUNTIME_DIR = originalXdg;
	rmSync(runtimeRoot, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

const sampleMeta = (
	overrides: Partial<DaemonMetadata> = {},
): DaemonMetadata => ({
	pid: process.pid,
	dir: workDir,
	startedAt: new Date(0).toISOString(),
	cliVersion: '0.0.0-test',
	discoveredAt: new Date(0).toISOString(),
	...overrides,
});

describe('readMetadata / writeMetadata / unlinkMetadata', () => {
	test('round-trips write → read', () => {
		const meta = sampleMeta();
		writeMetadata(workDir, meta);
		expect(readMetadata(workDir)).toEqual(meta);
	});

	test('readMetadata returns null when sidecar absent', () => {
		expect(readMetadata(workDir)).toBeNull();
	});

	test('unlinkMetadata removes the sidecar; second call is a no-op', () => {
		writeMetadata(workDir, sampleMeta());
		expect(existsSync(metadataPathFor(workDir))).toBe(true);
		unlinkMetadata(workDir);
		expect(existsSync(metadataPathFor(workDir))).toBe(false);
		unlinkMetadata(workDir);
	});
});
