/**
 * Read a table's folder of markdown into the contract, then classify it.
 *
 * This is the pure transform: given each file's path and raw content (and an
 * optional `matter.json` text), it produces the readable rows, the unreadable
 * files (kept separate, never dropped), and EITHER a typed classification (a
 * valid `matter.json` was supplied) OR a raw untyped view (no contract, or junk
 * contract). The actual disk listing lives at the boundary (`table.svelte.ts` in
 * the app, `loadPath` for the `epicenter matter check` command), so this transform
 * is testable without any filesystem.
 *
 * The contract is the foundation, never inference: a usable `matter.json` classifies
 * the folder against a contract; without one, the folder is shown as RAW text
 * (no type guessing). A junk contract degrades to the raw view with a diagnostic the
 * UI can show as a non-blocking banner. The headless check command is stricter
 * about missing or junk contracts because it has to certify the folder.
 */

import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { classifyRows, type RowConformance } from './conformance';
import {
	type Contract,
	type ContractError,
	type ParsedContract,
	parseContract,
} from './contract';
import { type MatterParseError, parseEntry, type Row } from './parse';

export type TableEntry =
	| { fileName: string; content: string }
	| { fileName: string; error: MatterReadError };

/**
 * Why a file could not be read as text at all, before any parse is attempted:
 * the read-level failure (non-UTF-8 / permission) the watcher reports for a file
 * it cannot decode. Parse-level failures are {@link MatterParseError}; both land
 * in the same "Can't read" bucket.
 */
export const MatterReadError = defineErrors({
	Undecodable: () => ({
		message: 'File is not readable as UTF-8 text',
	}),
	ReadFailed: ({ cause }: { cause: unknown }) => ({
		message: `File could not be read: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type MatterReadError = InferErrors<typeof MatterReadError>;

/** A file that could not become a row, with the failure that stopped it. */
export type UnreadableFile = {
	fileName: string;
	error: MatterParseError | MatterReadError;
};

/**
 * The folder is classified against an explicit contract: rows split into valid /
 * needs-attention by per-cell conformance.
 */
export type TypedView = {
	mode: 'typed';
	contract: Contract;
	conformance: RowConformance[];
};

/**
 * No usable contract: the folder is shown as a RAW untyped grid (every value as
 * plain text, no type inference). `columns` is the deterministic union of
 * frontmatter keys. `contractError` is set when a `matter.json` existed but was junk
 * (so the UI can say "couldn't read your contract"), and unset when there simply is
 * no contract.
 */
export type UntypedView = {
	mode: 'untyped';
	columns: string[];
	contractError?: ContractError;
};

export type TableRead = {
	rows: Row[];
	unreadable: UnreadableFile[];
	view: TypedView | UntypedView;
};

/**
 * The ordered column keys of an untyped folder: the union of every row's
 * frontmatter keys, most-frequent first then first-seen, so the raw grid is
 * deterministic across opens. No type inference: a folder without a contract is
 * shown as raw text, never guessed into kinds.
 */
function frontmatterColumns(rows: readonly Row[]): string[] {
	const count = new Map<string, number>();
	const firstSeen: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row.frontmatter)) {
			if (!count.has(key)) firstSeen.push(key);
			count.set(key, (count.get(key) ?? 0) + 1);
		}
	}
	return firstSeen
		.map((key, index) => ({ key, index, count: count.get(key) ?? 0 }))
		.sort((a, b) => b.count - a.count || a.index - b.index)
		.map((c) => c.key);
}

/**
 * Read and classify a folder.
 *
 * @param entries the folder's `.md` files (basename + raw content).
 * @param contractText the raw text of the folder's `matter.json`, if present.
 */
export function readTable(
	entries: readonly TableEntry[],
	contractText?: string,
): TableRead {
	const rows: Row[] = [];
	const unreadable: UnreadableFile[] = [];

	for (const entry of entries) {
		if ('error' in entry) {
			unreadable.push({ fileName: entry.fileName, error: entry.error });
			continue;
		}

		const { fileName, content } = entry;
		const { data, error } = parseEntry(fileName, content);
		if (error) {
			unreadable.push({ fileName, error });
			continue;
		}
		rows.push(data);
	}

	return {
		rows,
		unreadable,
		view: buildView(rows, loadContract(contractText)),
	};
}

/**
 * Parse AND compile a folder's `matter.json` into its {@link ParsedContract} classification, ONCE.
 * `validateContract` is where compilation (`Schema.Compile`) happens, so memoize this off the
 * contract text (a `$derived` in the live vault) and pass the result to {@link buildView}; a
 * single-file change then reclassifies against the cached fields without recompiling.
 *
 * No `matter.json` text maps to `untyped` (the raw grid), identical to a `{}` marker: this is the
 * one thing it adds to {@link parseContract}, which only takes present text. A real declared table
 * always has a marker (the loader only reads marked folders), so the no-text case is only the
 * TOCTOU race where the marker vanished between the stat and the read, or a direct pure-transform
 * call; either way the raw grid is the honest view, so it needs no distinct state of its own.
 */
export function loadContract(contractText: string | undefined): ParsedContract {
	if (contractText === undefined) return { kind: 'untyped' };
	return parseContract(contractText);
}

/**
 * Classify a set of in-memory rows against an already-loaded contract. Split out
 * from {@link readTable} so the live vault can reclassify after a single-file
 * change without re-parsing the folder or recompiling the contract.
 */
export function buildView(
	rows: readonly Row[],
	parsed: ParsedContract,
): TypedView | UntypedView {
	if (parsed.kind === 'typed') {
		return {
			mode: 'typed',
			contract: parsed.contract,
			conformance: classifyRows(parsed.contract.fields, rows),
		};
	}
	// No usable contract: the raw untyped view, carrying the diagnostic if a matter.json existed
	// but was junk. Exhaustive over the remaining 'untyped' | 'error' so a new ParsedContract
	// variant fails to compile here instead of silently rendering as an empty grid. An untyped
	// marker (`{}`, or no marker text at all) renders as the raw grid; only 'error' carries a
	// diagnostic.
	const columns = frontmatterColumns(rows);
	switch (parsed.kind) {
		case 'untyped':
			return { mode: 'untyped', columns };
		case 'error':
			return { mode: 'untyped', columns, contractError: parsed.error };
		default:
			return parsed satisfies never;
	}
}
