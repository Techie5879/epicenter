/**
 * Loader tests for the one filesystem boundary, under the declared-store model (ADR-0029): a
 * `matter.json` marks a table. Hermetic temp-dir cases pin the precise behaviors (name from
 * basename, readable vs unreadable, the `{}` untyped marker, unmarked folders skipped, a folder is
 * a table XOR a container of its marked children), and one case over the bundled example vault
 * proves the loader feeds `assess` end to end.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { assess } from '../core/integrity';
import { loadPath, loadTable } from './fs';

/** Resolve the bundled example vault by walking up from this file until it appears, so the path holds
 *  wherever in the repo this test lives, not at a fixed offset from `import.meta.dir`. */
function findExampleVault(): string {
	let dir = import.meta.dir;
	for (;;) {
		const candidate = resolve(dir, 'examples/matter/content-vault');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir)
			throw new Error('examples/matter/content-vault not found');
		dir = parent;
	}
}

/** A scratch directory, cleaned up after `body` runs. */
async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'matter-load-'));
	try {
		return await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** A typed marker. */
const pagesModel = JSON.stringify({ fields: { title: { type: 'string' } } });
/** The canonical untyped marker: a folder that is a table but declares no fields. */
const untypedMarker = '{}';

/** Create a marked table folder with the given marker text and one `.md` row. */
async function makeTable(
	dir: string,
	marker: string,
	row = '---\ntitle: X\n---',
): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'matter.json'), marker);
	await writeFile(join(dir, 'x.md'), row);
}

describe('loadTable', () => {
	test('reads a typed folder into a readable table named for its basename', async () => {
		await withTempDir(async (root) => {
			const dir = join(root, 'pages');
			await mkdir(dir);
			await writeFile(join(dir, 'matter.json'), pagesModel);
			await writeFile(join(dir, 'p1.md'), '---\ntitle: Hello\n---');

			const table = await loadTable(dir);
			expect(table.name).toBe('pages');
			if (table.status !== 'readable') throw new Error('expected readable');
			expect(table.read.view.mode).toBe('typed');
			expect(table.read.rows.map((r) => r.fileName)).toEqual(['p1.md']);
		});
	});

	test('a folder marked with {} loads as a valid untyped table', async () => {
		await withTempDir(async (root) => {
			const dir = join(root, 'notes');
			await mkdir(dir);
			await writeFile(join(dir, 'matter.json'), untypedMarker);
			await writeFile(join(dir, 'n1.md'), '---\ntag: idea\n---');

			const table = await loadTable(dir);
			if (table.status !== 'readable') throw new Error('expected readable');
			expect(table.read.view.mode).toBe('untyped');
		});
	});

	test('only .md files become rows; matter.json and other files are not rows', async () => {
		await withTempDir(async (root) => {
			const dir = join(root, 'pages');
			await mkdir(dir);
			await writeFile(join(dir, 'matter.json'), pagesModel);
			await writeFile(join(dir, 'p1.md'), '---\ntitle: Hello\n---');
			await writeFile(join(dir, 'notes.txt'), 'ignore me');

			const table = await loadTable(dir);
			if (table.status !== 'readable') throw new Error('expected readable');
			expect(table.read.rows.map((r) => r.fileName)).toEqual(['p1.md']);
		});
	});

	test('a folder that cannot be listed is an unreadable table carrying a message', async () => {
		await withTempDir(async (root) => {
			const table = await loadTable(join(root, 'does-not-exist'));
			expect(table.name).toBe('does-not-exist');
			expect(table.status).toBe('unreadable');
			if (table.status !== 'unreadable') throw new Error('unreachable');
			expect(table.message.length).toBeGreaterThan(0);
		});
	});
});

describe('loadPath: a folder is a table XOR a container of tables', () => {
	test('a container loads its marked children, sorted, and skips unmarked sibling dirs', async () => {
		await withTempDir(async (root) => {
			// Created out of order to prove the loader sorts.
			await makeTable(join(root, 'pages'), pagesModel);
			await makeTable(join(root, 'adaptations'), pagesModel);
			// An unmarked sibling (an attachment bundle / junk dir): no matter.json, so not loaded.
			const assets = join(root, 'assets');
			await mkdir(assets);
			await writeFile(join(assets, 'cover.md'), '---\ncaption: hi\n---');
			await writeFile(join(root, 'README.md'), '# not a table');

			const tables = await loadPath(root);
			expect(tables.map((t) => t.name)).toEqual(['adaptations', 'pages']);
			expect(tables.every((t) => t.status === 'readable')).toBe(true);
		});
	});

	test('a marked folder with no marked children is a lone table', async () => {
		await withTempDir(async (root) => {
			const dir = join(root, 'pages');
			await makeTable(dir, pagesModel);

			const tables = await loadPath(dir);
			expect(tables.map((t) => t.name)).toEqual(['pages']);
			// A lone table (length 1) is what the CLI treats as "references un-evaluable".
			expect(tables).toHaveLength(1);
		});
	});

	test('an unmarked folder yields just its marked children, sorted', async () => {
		await withTempDir(async (root) => {
			// The root itself is not marked; it is just a container of tables.
			await makeTable(join(root, 'pages'), pagesModel);
			await makeTable(join(root, 'adaptations'), pagesModel);
			await writeFile(join(root, 'README.md'), '# loose file, ignored');

			const tables = await loadPath(root);
			expect(tables.map((t) => t.name)).toEqual(['adaptations', 'pages']);
		});
	});

	test('a marked folder is just itself, even when its subfolders are marked', async () => {
		await withTempDir(async (root) => {
			// XOR (ADR-0032): a marked folder IS the table; its subfolders are ignored, even when
			// marked. The sharp edge: marking a container hides its child tables.
			const parent = join(root, 'pages');
			await makeTable(parent, pagesModel);
			await makeTable(join(parent, 'drafts'), pagesModel);
			await makeTable(join(parent, 'archive'), pagesModel);

			const tables = await loadPath(parent);
			expect(tables.map((t) => t.name)).toEqual(['pages']);
		});
	});

	test('an unmarked subfolder under a marked folder is ignored', async () => {
		await withTempDir(async (root) => {
			const parent = join(root, 'pages');
			await makeTable(parent, pagesModel);
			// A marked folder's subfolders are ignored regardless (ADR-0032), so an attachment
			// bundle never becomes a table.
			const images = join(parent, 'images');
			await mkdir(images);
			await writeFile(join(images, 'cover.md'), '---\ncaption: hi\n---');

			const tables = await loadPath(parent);
			expect(tables.map((t) => t.name)).toEqual(['pages']);
		});
	});

	test('an unmarked folder with no marked children loads nothing (no tables here)', async () => {
		await withTempDir(async (root) => {
			const dir = join(root, 'notes');
			await mkdir(dir);
			await writeFile(join(dir, 'n1.md'), '---\ntag: idea\n---');
			await mkdir(join(dir, 'images')); // also unmarked

			const tables = await loadPath(dir);
			expect(tables).toEqual([]);
		});
	});

	test('a hidden marked child of a container is never a table', async () => {
		await withTempDir(async (root) => {
			// The container branch is where the hidden-skip bites: a hidden marked dir is dropped
			// before the marker check, while a real sibling table still loads.
			await makeTable(join(root, 'pages'), pagesModel);
			await makeTable(join(root, '.obsidian'), pagesModel); // hidden: skipped

			const tables = await loadPath(root);
			expect(tables.map((t) => t.name)).toEqual(['pages']);
		});
	});

	test('a path that cannot be listed is one unreadable table', async () => {
		await withTempDir(async (root) => {
			const tables = await loadPath(join(root, 'nope'));
			expect(tables).toHaveLength(1);
			expect(tables[0]?.status).toBe('unreadable');
		});
	});
});

describe('loadPath feeds the pipeline', () => {
	const exampleVault = findExampleVault();

	test('the bundled content-vault loads three typed tables that assess', async () => {
		const tables = await loadPath(exampleVault);
		expect(tables.map((t) => t.name)).toEqual([
			'adaptations',
			'pages',
			'publications',
		]);

		// The whole point of the loader: its output is exactly what `assess` consumes.
		const integrity = assess(tables);
		expect(integrity.tables.map((t) => t.status)).toEqual([
			'typed',
			'typed',
			'typed',
		]);
	});

	test('loadTable on a single table folder names it for the folder', async () => {
		const table = await loadTable(join(exampleVault, 'pages'));
		expect(table.name).toBe(basename(join(exampleVault, 'pages')));
		expect(table.name).toBe('pages');
		expect(table.status).toBe('readable');
	});
});
