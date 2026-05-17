# Scripting

A script is a Bun file that reads the local SQLite materializer and writes through `connectDaemonActions`. There is no `script.ts` recipe to copy. The daemon is the single writer; the script is a short-lived reader plus an IPC client.

## The whole shape

```ts
import { connectDaemonActions } from '@epicenter/workspace';
import { findEpicenterDir, openWorkspaceSqlite } from '@epicenter/workspace/node';
import { FUJI_WORKSPACE_ID, type FujiActions } from '@epicenter/fuji';

const projectDir = findEpicenterDir();

// reads: open the materializer read-only
const db = openWorkspaceSqlite(projectDir, FUJI_WORKSPACE_ID);
const urgent = db.query('SELECT * FROM entries WHERE tag = ?').all('urgent');

// writes: typed proxy over unix socket to the daemon
const fuji = await connectDaemonActions<FujiActions>({ route: 'fuji', projectDir });
for (const note of urgent) {
  await fuji.entries_update({ id: note.id, tags: ['triaged'] });
}

db.close();
```

That is the whole API. No machine auth in the script process, no encryption setup, no Y.Doc reconstruction, no WebSocket.

## Reads: the SQLite materializer

`openWorkspaceSqlite(projectDir, workspaceId)` returns a `bun:sqlite` `Database` opened against `.epicenter/sqlite/<workspaceId>.db`. The daemon's `attachSqliteMaterializer` keeps that file fresh; the script opens it read-only with `PRAGMA query_only = 1`, so an errant `INSERT` fails at the driver instead of silently diverging.

The materializer is the same SQL surface the daemon serves to the SPA: column-typed rows, FTS5 indexes, normal joins. Query cost is `O(rows-returned)` rather than `O(history)`, so cron jobs do not pay the seconds-of-Y.Doc-replay tax that an in-process snapshot would cost.

For ranked search with snippets, use `openSqliteReader({ filePath: sqlitePath(...) })`; it wraps the same database and exposes a `search()` helper. For typed Drizzle queries, pass the returned `db` to `drizzle(db, { schema })` (the per-app schema lives in the app's npm package).

## Writes: typed actions through the daemon

`connectDaemonActions<TActions>({ route, projectDir })` returns a typed proxy. `route` is the daemon route name (`'fuji'` for the Fuji example); the proxy translates `fuji.entries_update({ ... })` into a `POST /run` over the unix socket at `.epicenter/daemon.sock`. The daemon invokes the action in-process against the live Y.Doc and returns a JSON `Result<T>`.

Two consequences fall out:

- **Strong read-after-write happens inside the action.** If a script wants the side effect to be visible to its next read, it should await the action result rather than reading SQLite again immediately. The action handler sees fresh in-memory state; the materializer is eventually consistent.
- **Type safety is opt-in.** `TActions` is the registry type the app's npm package exports (`FujiActions`, `HoneycrispActions`, etc.). The runtime never imports app code into the script process; only the type information flows across.

`projectDir` defaults to `findEpicenterDir()`, which walks up from `process.cwd()` looking for a `workspaces/` directory or a `.epicenter/` directory. Pass an explicit `projectDir` to opt out (cron jobs that run from `/` should).

## What if the daemon is not running?

Reads succeed: SQLite is just a file on disk, opening it does not require any running process.

Writes fail with `DaemonError.Required` because `connectDaemonActions` first does a health check against the socket and surfaces a clear error when no daemon is listening. There is no auto-spawn from the script process; explicit lifecycle is the contract. Start one with `epicenter daemon up`, or wrap the invocation in a CLI affordance like `epicenter run-with-daemon ./script.ts`.

A script that only reads should not call `connectDaemonActions` at all. A script that only writes still needs the daemon up, but does not need to open SQLite. Compose the two when both are needed.
