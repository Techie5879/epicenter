/**
 * Discovery tests for folder-routed daemon extensions.
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

import { discoverWorkspaceApps } from './discover.js';

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(join(tmpdir(), 'workspace-apps-discover-'));
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

function isCaseSensitiveFs(dir: string): boolean {
	const probe = join(dir, 'cAsE-pRoBe');
	try {
		mkdirSync(probe, { recursive: true });
		const lower = join(dir, 'case-probe');
		const result = !existsSync(lower);
		rmSync(probe, { recursive: true, force: true });
		return result;
	} catch {
		return false;
	}
}

function makeWorkspace(
	route: string,
	{ withDaemon = true }: { withDaemon?: boolean } = {},
): string {
	const dir = join(projectDir, 'workspaces', route);
	mkdirSync(dir, { recursive: true });
	if (withDaemon) {
		writeFileSync(join(dir, 'daemon.ts'), 'export default {};\n');
	}
	return dir;
}

describe('discoverWorkspaceApps', () => {
	test('returns an empty list when workspaces/ does not exist', () => {
		const result = discoverWorkspaceApps(projectDir);
		expect(result.error).toBeNull();
		expect(result.data).toEqual([]);
	});

	test('resolves each workspace folder with its execution paths', () => {
		const fujiDir = makeWorkspace('fuji');
		const opensidianDir = makeWorkspace('opensidian');

		const result = discoverWorkspaceApps(projectDir);
		expect(result.error).toBeNull();
		const entries = result.data!.slice().sort((a, b) =>
			a.route.localeCompare(b.route),
		);
		expect(entries).toEqual([
			{
				route: 'fuji',
				daemonEntryPath: join(fujiDir, 'daemon.ts'),
			},
			{
				route: 'opensidian',
				daemonEntryPath: join(opensidianDir, 'daemon.ts'),
			},
		]);
	});

	test('skips dotfile folders silently', () => {
		makeWorkspace('fuji');
		makeWorkspace('.archive');
		makeWorkspace('.DS_Store', { withDaemon: false });

		const result = discoverWorkspaceApps(projectDir);
		expect(result.error).toBeNull();
		expect(result.data!.map((entry) => entry.route)).toEqual(['fuji']);
	});

	test('skips a workspace folder missing daemon.ts', () => {
		makeWorkspace('fuji');
		makeWorkspace('headless', { withDaemon: false });

		const result = discoverWorkspaceApps(projectDir);
		expect(result.error).toBeNull();
		expect(result.data!.map((entry) => entry.route)).toEqual(['fuji']);
	});

	test('rejects invalid folder names before requiring daemon.ts', () => {
		mkdirSync(join(projectDir, 'workspaces', '__proto__'), {
			recursive: true,
		});
		writeFileSync(
			join(projectDir, 'workspaces', '__proto__', 'daemon.ts'),
			'export default {};\n',
		);

		const result = discoverWorkspaceApps(projectDir);
		expect(result.data).toBeNull();
		expect(result.error?.name).toBe('WorkspaceFolderInvalid');
		expect(result.error).toMatchObject({
			folderName: '__proto__',
			reason: 'invalid-name',
		});
	});

	test.skipIf(!isCaseSensitiveFs(tmpdir()))(
		'rejects case-insensitive route collisions',
		() => {
			makeWorkspace('fuji');
			makeWorkspace('Fuji');

			const result = discoverWorkspaceApps(projectDir);
			expect(result.data).toBeNull();
			expect(result.error?.name).toBe('WorkspaceFolderCollision');
			expect(result.error).toMatchObject({ route: 'fuji' });
			const folderNames = (result.error as {
				folderNames: readonly string[];
			}).folderNames;
			expect(folderNames.slice().sort()).toEqual(['Fuji', 'fuji']);
		},
	);
});
