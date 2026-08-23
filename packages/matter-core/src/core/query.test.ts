import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { expectOk } from 'wellcrafted/testing';
import { classifyRows } from './conformance';
import { validateContract } from './contract';
import type { Row } from './parse';
import { buildStemQuery } from './query';
import { projectToSqlite } from './sqlite';

describe('buildStemQuery (the SQL shapes)', () => {
	test('no controls is a plain select of every stem', () => {
		expect(buildStemQuery('books', {})).toBe('SELECT "stem" FROM "books"');
	});

	test('a where clause narrows; an order by orders; both compose', () => {
		expect(buildStemQuery('books', { where: "status = 'reading'" })).toBe(
			`SELECT "stem" FROM "books" WHERE status = 'reading'`,
		);
		expect(
			buildStemQuery('books', { sort: { column: 'rating', dir: 'desc' } }),
		).toBe('SELECT "stem" FROM "books" ORDER BY "rating" DESC');
		expect(
			buildStemQuery('books', {
				where: "status = 'reading'",
				sort: { column: 'rating', dir: 'desc' },
			}),
		).toBe(
			`SELECT "stem" FROM "books" WHERE status = 'reading' ORDER BY "rating" DESC`,
		);
	});

	test('a match runs in a rowid+rank subquery joined to the base, ranked, keeping the where', () => {
		const matched =
			`(SELECT rowid, rank FROM "books_fts" WHERE "books_fts" MATCH '"fox"') ` +
			`"_fts_match" ON "books".rowid = "_fts_match".rowid`;
		expect(buildStemQuery('books', { match: 'fox' })).toBe(
			`SELECT "books"."stem" AS stem FROM "books" JOIN ${matched} ORDER BY "_fts_match".rank`,
		);
		// The user's unqualified where rides on the base table; the subquery alias hides the FTS columns.
		expect(
			buildStemQuery('books', { match: 'fox', where: "status = 'reading'" }),
		).toBe(
			`SELECT "books"."stem" AS stem FROM "books" JOIN ${matched} ` +
				`WHERE status = 'reading' ORDER BY "_fts_match".rank`,
		);
		// An explicit ORDER BY overrides the relevance rank.
		expect(
			buildStemQuery('books', {
				match: 'fox',
				sort: { column: 'title', dir: 'asc' },
			}),
		).toBe(
			`SELECT "books"."stem" AS stem FROM "books" JOIN ${matched} ORDER BY "title" ASC`,
		);
	});
});

describe('buildStemQuery (executed against a real projection in bun:sqlite)', () => {
	const contract = expectOk(
		validateContract({
			fields: {
				title: { type: 'string' },
				rating: { type: 'integer' },
				status: { type: 'string', enum: ['reading', 'done'] },
			},
		}),
	);

	const rows: Row[] = [
		{
			fileName: 'dune.md',
			frontmatter: { title: 'Dune', rating: 5, status: 'done' },
			body: 'the spice must flow',
		},
		{
			fileName: 'hobbit.md',
			frontmatter: { title: 'The Hobbit', rating: 4, status: 'reading' },
			body: "don't panic in a hole in the ground",
		},
		{
			fileName: 'sky.md',
			frontmatter: { title: 'Sky', rating: 5, status: 'reading' },
			body: 'a spice trader',
		},
	];

	function freshDb(): Database {
		const conn = new Database(':memory:');
		const {
			schema,
			insert,
			rows: tuples,
		} = projectToSqlite('books', contract, classifyRows(contract.fields, rows));
		conn.exec(schema);
		const stmt = conn.prepare(insert);
		for (const tuple of tuples) stmt.run(...tuple);
		return conn;
	}

	const run = (conn: Database, query: Parameters<typeof buildStemQuery>[1]) =>
		(
			conn.query(buildStemQuery('books', query)).all() as { stem: string }[]
		).map((r) => r.stem);

	test('no controls returns every stem', () => {
		expect(run(freshDb(), {}).sort()).toEqual(['dune', 'hobbit', 'sky']);
	});

	test('filter plus sort returns the matching stems in order', () => {
		expect(
			run(freshDb(), {
				where: "status = 'reading'",
				sort: { column: 'rating', dir: 'desc' },
			}),
		).toEqual(['sky', 'hobbit']);
	});

	test('match searches the body; the where clause still narrows', () => {
		expect(run(freshDb(), { match: 'spice' }).sort()).toEqual(['dune', 'sky']);
		expect(
			run(freshDb(), { match: 'spice', where: "status = 'reading'" }),
		).toEqual(['sky']);
	});

	test('a search term with quotes is escaped, not a syntax error or injection', () => {
		// "don't" carries an apostrophe (SQL string char) and FTS5 would otherwise choke on a bare one.
		expect(run(freshDb(), { match: "don't" })).toEqual(['hobbit']);
	});
});
