# Script Surfaces Resolution

**Date**: 2026-05-14
**Status**: Direction (no implementation yet beyond the script.ts cleanup)
**Author**: Braden + Claude
**Supersedes**: parts of `20260430T170000-readonly-table-primitives-and-script-surfaces.md`, the Script column of `20260513T180000-explicit-app-constructor-layers.md`, the script.ts examples in `20260513T190000-schema-on-npm-runtime-on-jsrepo.md`, and the script-surface plan in `20260513T200000-workspace-surface-clean-break-vision.md`.

## One sentence

A script is a Bun file that reads the local SQLite materializer and writes through `connectDaemonActions`; there is no `script.ts` recipe.

## Background

The original plan was a per-app `script.ts` recipe that opened a readonly Y.Doc snapshot of the encrypted yjsLog the daemon writes, plus a typed action proxy for mutations. Fuji shipped that shape correctly. Honeycrisp, Opensidian, and Zhongwen shipped a different shape: each `script.ts` ran its own machine auth, opened its own collaboration WebSocket, and reconstructed its own live Y.Doc, effectively becoming a second daemon for the same workspace.

The first cleanup deleted those three files (the four `apps/*/blocks/script.ts` audit found zero non-spec callers) and left Fuji's `snapshot.ts` + `script.ts` pair as the canonical recipe.

This spec goes further: once you understand how actions are actually mediated today, the snapshot half of the recipe stops earning its keep.

## What we learned during the audit

### Actions stay on the daemon/runtime surface

Actions are not "the daemon's private API." They live on the workspace or daemon runtime bundle and can be projected through local adapters. Both the daemon (`apps/fuji/blocks/daemon-route.ts:54-60`) and the browser (`apps/fuji/src/routes/(signed-in)/fuji/browser.ts:94-101`) register the same `createFujiActions(tables)` registry.

For scripts, only the daemon route matters:

```
CLI / script ──── HTTP over unix socket ──► action runner
                  (POST /run to .epicenter/daemon.sock,
                   daemon invokes in-process,
                   returns Result<T> as JSON)
```

The unix-socket transport is what `connectDaemonActions` already uses (`packages/workspace/src/client/connect-daemon-actions.ts:50-66`). It returns a `Proxy` so `client.fuji.entries_update({...})` becomes `POST /run` with `actionPath: 'fuji.entries_update'`. The script never touches Y.Doc, never opens a WebSocket, never participates in Yjs sync.

### Snapshot is expensive and redundant

Today's `openFujiSnapshot` reconstructs an in-memory Y.Doc by replaying the encrypted yjsLog file from disk. For a workspace with months of edits this is seconds of cold-start every script run. Cron jobs eat that latency every invocation.

Meanwhile the SQLite materializer already exists. The daemon writes it as a read-optimized projection of the same data, at the same `(projectDir, workspaceId)` keying as the yjsLog (`packages/workspace/src/document/workspace-paths.ts:68`). Any process can open that file read-only. Query cost is O(rows-returned), not O(history).

### The script abstraction was wearing three trench coats

"Script" conflates three personas:

| Persona                                           | Best transport                            |
| ------------------------------------------------- | ----------------------------------------- |
| **Report** (cron, weekly digest, CI invariant)    | Read-only SQLite                          |
| **Mutation** (AI agent, ad-hoc data manipulation) | `connectDaemonActions` (typed action RPC) |
| **REPL / agent loop**                             | Both, composed                            |

None of them benefits from holding a Y.Doc in the script process. Reports want SQL. Mutations want typed actions on the singular writer. REPLs compose the two.

## The resolution

There is no `script.ts` recipe. Each app's npm package exports two primitives, and a "script" is just a user-owned Bun file that imports them:

```ts
import Database from "bun:sqlite";
import { findEpicenterDir, sqlitePath } from "@epicenter/workspace/node";
import { connectDaemonActions } from "@epicenter/workspace";
import { FUJI_WORKSPACE_ID, type FujiActions } from "@epicenter/fuji";

const projectDir = findEpicenterDir();

// reads: open the materializer read-only
const db = new Database(sqlitePath(projectDir, FUJI_WORKSPACE_ID), {
  readonly: true,
});
const urgent = db
  .query(
    "SELECT * FROM entries WHERE EXISTS (SELECT 1 FROM json_each(entries.tags) WHERE value = ?)",
  )
  .all("urgent");

// writes: typed proxy over unix socket to the daemon
const daemon = await connectDaemonActions<{ fuji: FujiActions }>({
  projectDir,
});
for (const note of urgent) {
  await daemon.fuji.entries_update({ id: note.id, body: rewrite(note.body) });
}
```

This is the whole script. No `openFujiScript`, no `openFujiSnapshot`, no Y.Doc, no WebSocket, no encryption setup, no jsrepo recipe.

### Recipes that survive

`apps/<app>/blocks/`:

- `workspace.ts` (schema contract; can't be inlined, must match across peers).
- `daemon-route.ts` (writer recipe; consumers fork it to add materializers, custom auth, etc.).

### Recipes that go away

- `apps/fuji/blocks/snapshot.ts` and `apps/fuji/blocks/script.ts`: deleted.
- The `epicenter/<app>/snapshot` and `epicenter/<app>/script` jsrepo blocks: removed from `jsrepo.config.ts`.

The non-Fuji `script.ts` files are already gone (commit landed in the prior pass).

## What needs to ship to make this real

1. **Stable `connectDaemonActions` ergonomics for scripts.**
   - Already exists at `packages/workspace/src/client/connect-daemon-actions.ts`. Verify it auto-discovers `projectDir` via `findEpicenterDir()` so scripts don't have to pass it.
   - Verify the returned proxy types correctly when the caller supplies an action manifest type (`{ fuji: FujiActions }` in the example above).

2. **Convenient read-only SQLite helper.**
   - Export from `@epicenter/workspace/node` something like:
     ```ts
     export function openWorkspaceSqlite(
       projectDir: ProjectDir,
       workspaceId: string,
     ): Database;
     ```
     opens the file at `sqlitePath(projectDir, workspaceId)` read-only with the right pragmas (e.g., `journal_mode = WAL`, `query_only = 1`).
   - Alternative: ship a typed Drizzle handle per app (`@epicenter/fuji/sqlite`) so scripts get column-typed queries. Decide whether the typed handle is per-app or generic.

3. **Delete Fuji's snapshot and script blocks.**
   - `rm apps/fuji/blocks/snapshot.ts apps/fuji/blocks/script.ts`.
   - Remove `'snapshot'` and `'script'` from `jsrepo.config.ts` `fuji:` block list.
   - Update `apps/README.md` per-app layout diagram: only `workspace.ts` and `daemon-route.ts` are blocks; "script" is a docs example, not a block.
   - Add `docs/scripting.md` or extend the existing app-level READMEs with the three-import example above.

4. **Update spec references.**
   - The four predecessor specs already carry superseded notes pointing here.
   - When the implementation phases land, append "Implemented in <commit>" notes to this spec.

## Open questions

- **Should the typed action client live next to or separate from `@epicenter/workspace`?** Today `connectDaemonActions` is in `@epicenter/workspace/src/client/`. That's fine for the generic shape. For per-app type narrowing, do consumers parameterize at call site (`connectDaemonActions<{ fuji: FujiActions }>`) or do app packages re-export a pre-typed `connectFujiDaemon`? Lean toward call-site generic parameterization; the per-app wrapper was 23 lines of nothing.

- **SQLite materializer lag.** The materializer is eventually consistent with the yjsLog. For most reports this is fine (milliseconds). For a read-then-write script that wants strong read-after-write, document that the right pattern is "issue the action and await its result" rather than "read SQLite then write." Action handlers running in the daemon see fresh in-memory state.

- **Read access without a daemon running.** SQLite reads work whether the daemon is up or not. Writes do not. The script either succeeds (daemon up, action runs), fails with a clear error (daemon down), or auto-starts the daemon if we want that UX. Lean toward fail with clear error. Auto-start is a CLI affordance (`epicenter run-with-daemon ./script.ts`), not a script-process concern.

- **AI safety surface.** The interesting part of "let AI write TypeScript to mutate user data" is not in script.ts at all. It's in the daemon: dry-run mode, transactional batches, audit log, quotas. Out of scope here; tracked in a separate spec when we get there.

- **Per-workspace single daemon coexistence.** When the daemon becomes one process for many workspaces (see `20260514T170000-single-daemon-multi-workspace.md`), the same `connectDaemonActions` proxy can address `daemon.fuji.x` and `daemon.honeycrisp.y` from one connection. The `/run` dispatcher already prefixes action paths with the route name, so this falls out for free.

## Verification

```bash
# zero references to deleted script symbols outside specs
rg "openFujiScript|openFujiSnapshot|openHoneycrispScript|openOpensidianScript|openZhongwenScript" --glob '!specs/**'

# manifest no longer lists snapshot/script for any app
bunx jsrepo build
grep -c "fuji/script\|fuji/snapshot" registry.json # expect 0

# scripting docs example typechecks
bun run typecheck
```
