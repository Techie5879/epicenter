import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import yargs from 'yargs';

import { projectOption } from './common-options.js';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function tempProject() {
	const root = mkdtempSync(join(tmpdir(), 'ep-cli-project-'));
	roots.push(root);
	mkdirSync(join(root, 'workspaces'));
	const nested = join(root, 'nested', 'child');
	mkdirSync(nested, { recursive: true });
	return { root, nested };
}

describe('projectOption', () => {
	test('discovers the nearest Epicenter project from a start directory', () => {
		const { root, nested } = tempProject();
		const argv = yargs().option('C', projectOption).parseSync(['-C', nested]);

		expect(argv.C).toBe(root);
	});

	test('falls back to an absolute start path when discovery misses', () => {
		const root = mkdtempSync(join(tmpdir(), 'ep-cli-no-project-'));
		roots.push(root);
		const argv = yargs().option('C', projectOption).parseSync(['-C', root]);

		expect(argv.C).toBe(resolve(root));
	});
});
