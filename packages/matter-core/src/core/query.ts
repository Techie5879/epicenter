/**
 * The read-only query builder for a folder's mirror table: the SQL behind the grid's filter, search,
 * and sort, and the home any headless query verb (a future `epicenter matter query`, an MCP
 * `matter_search`) will share. It returns each matching row's `stem` IN QUERY ORDER, so the caller can
 * render cells from its own in-memory rows in that order (ADR-0065: SQL drives the query; the in-memory
 * map drives the cells). This sits beside the projector because both build matter's SQL from one
 * quoting implementation.
 */

import { ftsTableName, quoteIdent, quoteString } from './sqlite';

/**
 * Build a safe FTS5 MATCH literal from user search text: wrap it as ONE quoted phrase so FTS5 reads it
 * as literal terms (not its query operators), doubling embedded double quotes, then wrap that as a SQL
 * string literal, doubling embedded single quotes. The mirror's `query_mirror` runs raw SQL with no
 * bound parameters, so the term is inlined here rather than parameterized, and this escaping is what
 * keeps a search box from being an injection or a syntax error.
 */
function ftsMatchLiteral(term: string): string {
	const phrase = `"${term.replace(/"/g, '""')}"`;
	return quoteString(phrase);
}

/** A column sort: which column, ascending or descending. The column is a known header name (not free
 *  text), quoted into the `ORDER BY` fragment inside {@link buildStemQuery}. */
export type Sort = { column: string; dir: 'asc' | 'desc' };

/** The grid's query controls: a SQL `WHERE` fragment, full-text search text, and a column sort. All
 *  optional; an all-empty query is just `SELECT "stem" FROM <table>`. */
export type StemQuery = {
	/** A raw SQL boolean expression for the `WHERE` clause (the user's own filter box). */
	where?: string;
	/** Plain search text, matched full-text against the folder's FTS5 index. */
	match?: string;
	/** The active column sort (a clicked header), or omitted for relevance / natural order. */
	sort?: Sort;
};

/**
 * Build the read-only `SELECT "stem"` the grid runs. Without a `match`, it is a plain filtered, ordered
 * select over the base table. With a `match`, the full-text search runs in a derived subquery that
 * exposes ONLY `rowid` and `rank`, joined back to the base table; that subquery is what keeps the FTS
 * index's columns (`status`, `title`, ...) from shadowing the base table's columns of the same name, so
 * the user's unqualified `where`/`sort` never hit an "ambiguous column" error. Relevance (`rank`)
 * orders the results unless an explicit `sort` is given. `sort` names a known header column, quoted
 * into the `ORDER BY` here; `where` is the user's own clause against their own read-only db, where the
 * worst a bad clause does is return an error.
 */
export function buildStemQuery(
	tableName: string,
	{ where, match, sort }: StemQuery,
): string {
	const table = quoteIdent(tableName);
	const orderBy = sort
		? `${quoteIdent(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`
		: undefined;

	// The base select differs by mode, but the WHERE and ORDER BY tail is shared. A matched query also
	// falls back to relevance (`rank`) when the caller gives no explicit sort.
	let sql = `SELECT "stem" FROM ${table}`;
	let defaultOrder: string | undefined;
	if (match) {
		const fts = quoteIdent(ftsTableName(tableName));
		// The match subquery projects only rowid + rank, so its alias contributes no column that could
		// collide with a base column in the user's where/order by. `_fts_match` is a synthetic alias.
		const matched = `(SELECT rowid, rank FROM ${fts} WHERE ${fts} MATCH ${ftsMatchLiteral(match)})`;
		sql =
			`SELECT ${table}."stem" AS stem FROM ${table} ` +
			`JOIN ${matched} "_fts_match" ON ${table}.rowid = "_fts_match".rowid`;
		defaultOrder = '"_fts_match".rank';
	}
	if (where) sql += ` WHERE ${where}`;
	const order = orderBy ?? defaultOrder;
	if (order) sql += ` ORDER BY ${order}`;
	return sql;
}
