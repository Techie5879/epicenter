/**
 * Per-workspace data layout helpers.
 *
 * Three folders under `<projectDir>/.epicenter/`, each named by what's inside:
 *
 *   yjs/<id>.db     Yjs CRDT update log (durability; replayed by Yjs)
 *   sqlite/<id>.db  Queryable SQL surface (open with `sqlite3`, FTS5)
 *   md/<id>/        Markdown surface (open with your editor)
 *
 * All three are derived state the daemon writes; scripts and other readers
 * open them. The yjs file is the source of truth; sqlite and md are
 * projections the materializer keeps in sync.
 *
 * For daemon-process paths (sockets, log, metadata sidecar), see
 * `daemon/paths.ts`. Different audience, different rationale.
 *
 * Pure helpers: no side effects, no directory creation. Consumers do their
 * own `mkdir` (or rely on the attachments to do it).
 */

import { join } from 'node:path';

function epicenterProjectDir(projectDir: string): string {
	return join(projectDir, '.epicenter');
}

/**
 * Path to a workspace's Yjs CRDT update log.
 *
 * Convention: `<projectDir>/.epicenter/yjs/<workspaceId>.db`. This file is the
 * source of truth: every `updateV2` event lands here as a row, and the
 * file is replayed at startup to reconstruct the Y.Doc. SQLite is the
 * implementation detail; you never query this file with `sqlite3`. For
 * the queryable surface, see `sqlitePath`.
 *
 * `projectDir` is the project root (where `workspaces/` lives);
 * `workspaceId` is `ws.ydoc.guid`.
 *
 * @example
 * ```ts
 * yjsPath('/Users/braden/Code/vault', 'epicenter.fuji')
 * // '/Users/braden/Code/vault/.epicenter/yjs/epicenter.fuji.db'
 * ```
 */
export function yjsPath(projectDir: string, workspaceId: string): string {
	return join(epicenterProjectDir(projectDir), 'yjs', `${workspaceId}.db`);
}

/**
 * Path to a workspace's SQLite mirror file (the queryable SQL surface).
 *
 * Convention: `<projectDir>/.epicenter/sqlite/<workspaceId>.db`. The daemon's
 * `attachSqliteMaterializer` writes this file (in WAL journal mode); script
 * peers open the same path read-only via `openSqliteReader`.
 *
 * Distinct from `yjsPath`: the yjs file is the role (durability of the
 * Y.Doc update log; SQLite is implementation detail and you never open it
 * with `sqlite3`). This file is the surface (you open it with `sqlite3`
 * to run SELECT and FTS5 queries; that's its whole point). Different
 * shape, different concurrency profile, different consumers.
 *
 * @example
 * ```ts
 * sqlitePath('/Users/braden/Code/vault', 'epicenter.fuji')
 * // '/Users/braden/Code/vault/.epicenter/sqlite/epicenter.fuji.db'
 * ```
 */
export function sqlitePath(projectDir: string, workspaceId: string): string {
	return join(epicenterProjectDir(projectDir), 'sqlite', `${workspaceId}.db`);
}

/**
 * Root directory for a workspace's markdown materializer tree.
 *
 * Convention: `<projectDir>/.epicenter/md/<workspaceId>/`. The daemon's
 * `attachMarkdownMaterializer` writes per-table subdirectories of `.md`
 * files under this root. Read it with your editor; there is no markdown
 * reader primitive (markdown is itself the user-facing surface).
 *
 * @example
 * ```ts
 * markdownPath('/Users/braden/Code/vault', 'epicenter.fuji')
 * // '/Users/braden/Code/vault/.epicenter/md/epicenter.fuji'
 * ```
 */
export function markdownPath(projectDir: string, workspaceId: string): string {
	return join(epicenterProjectDir(projectDir), 'md', workspaceId);
}
