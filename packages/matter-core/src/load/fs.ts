/**
 * The Node filesystem boundary: turn a directory on disk into the in-memory {@link TableInput}s
 * that `assess` classifies. The pure transforms (`readTable`, `assess`) never touch disk; this is
 * the one place that does, so the whole pipeline is testable without a filesystem and the listing
 * is not duplicated per surface.
 *
 * This is the single home for the Node disk listing behind the `epicenter matter check` command,
 * instead of the command writing its own copy: list a folder's
 * `.md` files, read each (a read failure becomes an unreadable entry, never a dropped file), and
 * read its `matter.json`. {@link loadTable} loads one folder; {@link loadPath} is the entry point
 * that classifies a path as a marked table or a container of marked children.
 *
 * A `matter.json` MARKS a table (ADR-0029): a folder is a table if and only if it contains one.
 * A container loads only its marked immediate children and skips the rest (an unmarked folder is
 * not data: an attachment bundle, a junk dir, an organizational folder). The marker can be `{}`
 * (an untyped raw grid), a `fields` map (typed), or junk (a claimed-but-broken table); its
 * contents type the table but never decide whether it IS one.
 *
 * It emits {@link TableInput} (the shape `assess` classifies) because a filesystem is exactly
 * where "could not read this folder" originates, and `TableInput`'s `unreadable` variant is the
 * one input that carries that fact into `assess`. A folder whose listing fails (missing,
 * permission) becomes that variant.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { extractErrorMessage } from 'wellcrafted/error';
import type { TableInput } from '../core/integrity';
import { MatterReadError, readTable, type TableEntry } from '../core/table';

/**
 * The folder's `.md` files as {@link TableEntry}s, sorted by name for deterministic output. A
 * per-file read failure becomes an entry carrying its {@link MatterReadError}, so an unreadable
 * file surfaces as such instead of vanishing from the listing.
 */
async function readEntries(dir: string): Promise<TableEntry[]> {
	const fileNames = (await readdir(dir))
		.filter((f) => f.endsWith('.md'))
		.sort();
	return Promise.all(
		fileNames.map(async (fileName): Promise<TableEntry> => {
			try {
				return {
					fileName,
					content: await readFile(join(dir, fileName), 'utf8'),
				};
			} catch (cause) {
				return { fileName, error: MatterReadError.ReadFailed({ cause }).error };
			}
		}),
	);
}

/**
 * The folder's `matter.json` text, or `undefined` when it has none. A missing OR unreadable
 * `matter.json` both collapse to `undefined`; only a PRESENT-but-corrupt contract is a failure,
 * and that is `readTable`'s job to detect from the text it parses, not this boundary's.
 */
async function readContractText(dir: string): Promise<string | undefined> {
	return readFile(join(dir, 'matter.json'), 'utf8').catch(() => undefined);
}

/**
 * Whether a folder is a table: a single `stat` for its `matter.json` (ADR-0029). Cheaper than
 * reading the file, because {@link loadVault} asks this of every immediate child just to decide
 * which ones to load; the marked ones are read in full by {@link loadTable}. A non-existent or
 * unreadable `matter.json` (or one that is somehow not a file) means "not a table."
 */
async function isMarked(dir: string): Promise<boolean> {
	return stat(join(dir, 'matter.json'))
		.then((info) => info.isFile())
		.catch(() => false);
}

/**
 * Load one folder into a {@link TableInput}. The table name is the folder's basename. A folder
 * whose listing fails (missing, permission) becomes the `unreadable` input, which contributes no
 * rows and turns every inbound reference into `missing-target`; otherwise it loads its rows and
 * optional contract into the `readable` input.
 *
 * @param dir the table folder's path.
 */
export async function loadTable(dir: string): Promise<TableInput> {
	const dirPath = resolve(dir);
	const name = basename(dirPath);

	let entries: TableEntry[];
	try {
		entries = await readEntries(dirPath);
	} catch (error) {
		return { name, status: 'unreadable', message: extractErrorMessage(error) };
	}

	const read = readTable(entries, await readContractText(dirPath));
	return { name, status: 'readable', read };
}

/**
 * Load a folder's immediate child tables: every immediate subfolder that is MARKED (contains a
 * `matter.json`, ADR-0029), loaded in sorted order. Unmarked subfolders are skipped (one `stat`
 * each, no tree-walk): they are attachment bundles, junk, or organizational dirs, not data. Loose
 * files at the root (a stray `README.md`) are ignored, because a row exists only inside a table.
 * Hidden directories (`.git`, `.obsidian`) are skipped, so they never become bogus tables. A root
 * with no marked children (or one that cannot be listed) loads as an empty set, not an error.
 *
 * @param root the folder whose marked children to load.
 */
/**
 * Load the marked immediate children of an ALREADY-listed container into tables, sorted. The
 * container branch of {@link loadPath} passes the listing it already read, so the directory is
 * listed exactly once: every immediate subfolder that is MARKED (contains a `matter.json`,
 * ADR-0029) loads; unmarked subfolders are skipped (one `stat` each, no tree-walk) as attachment
 * bundles, junk, or organizational dirs; hidden directories (`.git`, `.obsidian`) and loose files
 * never become tables.
 *
 * @param rootPath the container's resolved path.
 * @param names the container's `readdir` listing.
 */
async function loadMarkedChildren(
	rootPath: string,
	names: string[],
): Promise<TableInput[]> {
	const markedDirs = await Promise.all(
		names.map(async (name): Promise<string | null> => {
			if (name.startsWith('.')) return null;
			const childPath = join(rootPath, name);
			const info = await stat(childPath).catch(() => null);
			if (info === null || !info.isDirectory()) return null;
			return (await isMarked(childPath)) ? name : null;
		}),
	);
	return Promise.all(
		markedDirs
			.filter((name): name is string => name !== null)
			.sort()
			.map((name) => loadTable(join(rootPath, name))),
	);
}

/**
 * Load a path into the tables in its scope (ADR-0029/0032), so `matter check <path>` works
 * whether the user points at one table folder or at a folder of tables. A folder is a table XOR a
 * container of tables, never both (ADR-0032):
 *
 *   - a MARKED path IS a single table (its `.md` files are rows); its subfolders are ignored;
 *   - an UNMARKED path is a container, and its immediate marked child folders are the tables.
 *
 * No recursion either way: depth is reached by pointing `check` at the deeper folder, never by
 * loading two levels at once. An unmarked path with no marked children loads as the empty set ("no
 * tables here"), never an untyped pass. A path that cannot be listed at all is a single unreadable
 * table, so the failure flows through the same pipeline as any other. A lone table
 * (`tables.length === 1`: a marked path opened directly, or a container with a single marked child)
 * has no sibling tables loaded, so the caller surfaces its references as un-evaluable rather than
 * failing (the old `scope` discriminant).
 */
export async function loadPath(path: string): Promise<TableInput[]> {
	const dirPath = resolve(path);

	// Marked folder XOR container of its marked children (ADR-0032); see the contract above. The
	// marked branch reads the folder once (loadTable lists it); the container branch lists once
	// here and hands the listing to loadMarkedChildren, so no path is read twice.
	if (await isMarked(dirPath)) return [await loadTable(dirPath)];

	const names = await readdir(dirPath).catch(() => null);
	// Could not list the path at all (and it is not a marked table): surface it as one unreadable
	// table, so the failure flows through the same pipeline as any other.
	if (names === null) return [await loadTable(dirPath)];
	return loadMarkedChildren(dirPath, names);
}
