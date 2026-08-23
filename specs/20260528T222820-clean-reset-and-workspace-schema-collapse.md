# Clean Reset and Workspace Schema Collapse

**Date**: 2026-05-28
**Status**: In Progress
**Owner**: Braden
**Branch**: codex/clean-reset-schema-collapse

## One Sentence

Reset Epicenter as a prelaunch deployment and collapse current app table history to latest-only schemas, while keeping the workspace package's hidden row-version mechanism for future local-first migrations.

## How To Read This Spec

Read first:

- Current Shape
- Target Shape
- Execution Plan
- Verification
- Reset Runbook

Read if changing the architecture:

- Design Decisions
- Rejected Alternatives
- Risk Register

## Current Shape

The hosted API and local-first app data are split across several stores:

```txt
Postgres
  Better Auth identity, sessions, OAuth clients, tokens, JWKS
  asset metadata
  Durable Object room metadata and accounting

Cloudflare KV
  Better Auth session cache

Durable Objects
  actual Yjs room update logs

R2
  actual asset bytes

Autumn
  billing customers, balances, subscriptions keyed by user.id

Local devices
  IndexedDB and app-local replicas
```

The workspace table API is already mostly in the clean shape:

```ts
const rows = defineTable({
	id: column.string(),
	title: column.string(),
});
```

`_v` is library-managed. App code no longer declares `_v`, writes `_v`, or reads `_v`. The original spec identified two production app tables with old schema history:

```txt
apps/fuji/src/lib/workspace/index.ts
  entries: v1 -> v2 -> v3

apps/whispering/src/lib/workspace/definition.ts
  recordings: v1 -> v2
```

Execution also found one app workspace definition outside that original list:

```txt
apps/honeycrisp/honeycrisp.ts
  notes: v1 -> v2
```

## Target Shape

After the code cleanup, every app workspace table in this repo should be latest-only:

```txt
apps/fuji/src/lib/workspace/index.ts
  entries: current shape only

apps/whispering/src/lib/workspace/definition.ts
  recordings: current shape only

apps/honeycrisp/honeycrisp.ts
  notes: current shape only
```

The workspace package still supports future table evolution:

```ts
const rows = defineTable(v1, v2).migrate(({ value, version }) => {
	switch (version) {
		case 1:
			return upgrade(value);
		case 2:
			return value;
	}
});
```

That API is dormant after the cleanup, not deleted.

## Design Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Collapse Fuji and Whispering table history | Yes | Existing data is disposable, so old app schemas are not load-bearing. |
| Delete `.migrate(...)` from app definitions | Yes | No app should pay migration complexity for data we are clearing. |
| Remove `defineTable(v1, v2).migrate(...)` from `@epicenter/workspace` | No | Local-first apps will need read-time migration again. The API is already hidden unless a table has multiple versions. |
| Keep hidden `_v` in stored rows | Yes | It preserves a self-describing storage format and future evolution without leaking versioning to app code. |
| Reset data in separate step from code cleanup | Yes | Code cleanup is safe and reviewable. Remote deletion needs a final explicit confirmation. |
| Use Drizzle migrations for Postgres rebuild | Yes | Remote schema should follow the migration journal, not `push`. |
| Collapse API Drizzle history after reset decision | Yes | The production Postgres schema is being rebuilt from empty during the prelaunch reset, so historical transition migrations are no longer load-bearing. |

## Rejected Alternatives

### Delete table versioning entirely

This is tempting because no app should have a migration after the cleanup. It is still the wrong clean break.

Without hidden row versions, the next schema change has two bad options:

```txt
Option A: reintroduce row versioning later
  -> new storage transition
  -> compatibility pressure returns

Option B: add ad hoc app repair code
  -> migration logic leaks into apps
  -> worse than the current library-owned API
```

The current package shape already refuses the visible tax for single-version tables. Keep it.

### Reset only Postgres

Postgres-only reset leaves orphaned state in Durable Objects, R2, KV, Autumn, and local IndexedDB. If this is a real reset, those stores must be cleared or intentionally abandoned together.

### Collapse Drizzle history on a live shared database

Drizzle history should stay append-only for any database that has already
recorded those migration tags and must keep its data. This cleanup is different:
the reset explicitly drops the hosted Postgres schema and rebuilds from empty,
so the API migration directory can become a fresh baseline.

## Execution Plan

### Phase 0: Safety Setup

- [x] Create or switch to a branch with the standard prefix, for example `codex/clean-reset-schema-collapse`.
- [ ] Confirm the worktree is clean before editing.
  - The worktree was not clean before edits: `main` was ahead 1 and behind 4, and `.claude/settings.json`, `apps/whispering/specs/20260530T150000-sound-cue-customization.md`, and this spec were untracked.
- [x] Record current `.migrate(...)` call sites.
  - Initial app hits: Fuji, Whispering, and Honeycrisp. Remaining package hits were workspace docs, implementation, specs, and migration tests.
- [x] Do not run destructive remote commands in this phase.

### Phase 1: Collapse App Table History

- [x] Update `apps/fuji/src/lib/workspace/index.ts`.
  - Replace `entriesTable = defineTable(v1, v2, v3).migrate(...)` with a single `defineTable({ ...current v3 columns... })`.
  - Keep the current `date` plus `dateZone` shape.
  - Keep `rating`.
  - Remove `IanaTimeZone` import if it becomes unused.

- [x] Update `apps/whispering/src/lib/workspace/definition.ts`.
  - Replace `recordings = defineTable(v1, v2).migrate(...)` with a single `defineTable({ ...current v2 columns... })`.
  - Keep `recordedAt`, `transcript`, and nullable `duration`.
  - Drop old `timestamp`, `createdAt`, and `transcribedText` schema history.

- [x] Update `apps/honeycrisp/honeycrisp.ts`.
  - Execution discovery: the app grep found `notes = defineTable(v1, v2).migrate(...)`.
  - Replaced it with the current notes schema containing `deletedAt` and nullable `wordCount`.

- [x] Re-run `rg "\\.migrate\\(" apps packages`.
  - Expected result: no app workspace definitions use `.migrate(...)`.
  - The workspace package implementation and docs may still mention `.migrate(...)`.

### Phase 2: Documentation Cleanup

- [x] Update comments near the collapsed tables so they describe the current schema, not old version history.
- [x] Update `packages/workspace/src/document/README.md` only if needed.
  - It may still describe schema versioning as a package capability.
  - It should not imply Fuji or Whispering currently carry old data after the reset.
- [x] Leave historical specs alone unless they actively mislead the current path.

### Phase 3: Verification

- [x] Run targeted typechecks.

```bash
bun run --cwd apps/fuji typecheck
bun run --cwd apps/whispering typecheck
bun run --cwd packages/workspace typecheck
```

- [x] Run targeted tests.

```bash
bun run --cwd packages/workspace test
bun run --cwd apps/fuji test
bun run --cwd apps/whispering test
```

- [x] If package scripts differ, inspect `package.json` and run the closest available package-local check.
  - Whispering has no `test` script. `bun run --cwd apps/whispering test` falls through to `/bin/test`, so `bun test` was run from `apps/whispering`.
- [x] Re-run the app grep.

```bash
rg "\.migrate\(" apps packages
```

### Phase 4: Post-Implementation Review

- [x] Run a second pass over touched files.
- [x] Check that the collapse removed real history and did not change current row shapes.
- [x] Check imports, comments, and docs for stale old-version language.
- [x] Add a short implementation note to this spec with:
  - Changed files
  - Verification commands
  - Remaining reset steps

## Implementation Notes

**Completed**: 2026-05-31
**Branch**: `codex/clean-reset-schema-collapse`

Changed files:

```txt
apps/
|-- fuji/src/lib/workspace/index.ts
|-- honeycrisp/honeycrisp.ts
`-- whispering/src/lib/workspace/definition.ts

specs/
|-- 20260528T222820-clean-reset-and-workspace-schema-collapse.md
`-- 20260531T205543-prelaunch-reset-runbook.md

apps/api/drizzle/
|-- 0000_thin_the_captain.sql
`-- meta/
    |-- 0000_snapshot.json
    `-- _journal.json
```

What landed:

- Fuji `entries` now declares only the current schema: `date`, `dateZone`, and `rating` are first-class columns.
- Whispering `recordings` now declares only the current schema: `recordedAt`, `transcript`, `transcriptionStatus`, and nullable `duration`.
- Honeycrisp `notes` was also collapsed after the required grep found an app workspace migration outside the original two-table list.
- `@epicenter/workspace` migration support was not removed. The library still owns `_v`, still exposes `defineTable(v1, v2).migrate(...)`, and still has migration tests.
- API Drizzle migrations were collapsed into one fresh baseline after the reset plan made all existing API Postgres data disposable.

Verification output:

```txt
rg "\.migrate\(" apps packages
  pass: no matches under apps
  remaining matches: packages/workspace docs, specs, implementation, and tests

bun run --cwd apps/fuji typecheck
  pass: svelte-check found 0 errors and 0 warnings

bun run --cwd apps/whispering typecheck
  pass: svelte-check found 0 errors and 11 pre-existing warnings

bun run --cwd apps/honeycrisp typecheck
  pass: svelte-check found 0 errors and 0 warnings

bun run --cwd packages/workspace typecheck
  pass

bun run --cwd packages/workspace test
  pass: 511 pass, 0 fail

bun run --cwd apps/fuji test
  pass: 2 pass, 0 fail

bun test (from apps/whispering)
  pass: 1 pass, 0 fail

bun run --cwd apps/honeycrisp test
  pass: 1 pass, 0 fail

DATABASE_URL=postgres://postgres:postgres@localhost:5432/epicenter_baseline_test bun x drizzle-kit migrate (from apps/api)
  pass: baseline migration applied successfully to a disposable empty local Postgres database

DATABASE_URL=postgres://postgres:postgres@localhost:5432/epicenter_baseline_test SEED_TARGET=prod bun scripts/seed-oauth-clients.ts (from apps/api)
  pass: seeded 6 first-party OAuth clients

psql postgres://postgres:postgres@localhost:5432/epicenter_baseline_test -c "\dt public.*"
  pass: 11 public tables created

psql postgres://postgres:postgres@localhost:5432/epicenter_baseline_test -c "SELECT count(*) FROM drizzle.__drizzle_migrations"
  pass: 1 migration row

bun x drizzle-kit check (from apps/api)
  pass: Everything's fine

bun run --cwd apps/api typecheck
  pass

bun run --cwd apps/api test
  pass: 16 pass, 0 fail
```

Post-implementation review:

```txt
Files read
apps/
|-- fuji/src/lib/workspace/index.ts
|-- honeycrisp/honeycrisp.ts
`-- whispering/src/lib/workspace/definition.ts

packages/workspace/src/document/
|-- define-table.ts
|-- table.ts
`-- create-table.test.ts

apps/api/
`-- drizzle/
    |-- 0000_thin_the_captain.sql
    `-- meta/
        |-- 0000_snapshot.json
        `-- _journal.json
```

Review result:

- Collapsed app tables keep the latest row shapes exactly.
- No stale imports were left behind.
- Version-history comments near the collapsed app tables were removed or rewritten.
- Workspace library migration behavior remains present and covered by tests.
- The new API Drizzle baseline matches the current schema: no transitional `device_code` table, no `do_type` column, current `owner_id` columns, and asset `visibility` present from the start.

Remaining reset steps:

- Review and explicitly approve `specs/20260531T205543-prelaunch-reset-runbook.md`.
- Run the reset only after final approval, because it deletes or abandons production and local data.
- Do not run any remote cleanup from this code cleanup branch without that approval.

## Reset Runbook

This section is intentionally separate from the code cleanup. Every command here is destructive or operational. Execute only after the code phase is merged or ready to deploy.

Detailed runbook: `specs/20260531T205543-prelaunch-reset-runbook.md`.

### Preconditions

- [ ] Final human confirmation that all current cloud and local app data is disposable.
- [ ] Current code is deployed or ready to deploy immediately after reset.
- [ ] OAuth client seed script is known-good.
- [ ] Infisical access works locally.
- [ ] Wrangler auth works locally.
- [ ] Autumn customer cleanup path is known.

### Data Stores

Postgres:

- [ ] Drop or recreate the production database using the admin URL.
- [ ] Run the single baseline Drizzle migration from zero.
- [ ] Reseed OAuth clients.
- [ ] Verify tables and counts.

KV:

- [ ] Clear `SESSION_KV` keys or recreate the namespace.
- [ ] Verify no old Better Auth cache keys remain.

Durable Objects:

- [ ] Decide whether to delete existing room namespaces or abandon old objects.
- [ ] If deletion tooling is available, clear room storage.
- [ ] If deletion tooling is not available, document the abandonment and start from new owner IDs and room names.

R2:

- [ ] List `epicenter-assets`.
- [ ] Delete existing objects if any.
- [ ] Verify the bucket is empty.

Autumn:

- [ ] Find customers keyed by old `user.id`.
- [ ] Delete or archive those customers according to Autumn's supported workflow.
- [ ] Verify new sign-in creates a fresh customer.

Local devices:

- [ ] Clear app IndexedDB/local storage for Fuji, Whispering, Tab Manager, and any other workspace apps used during development.
- [ ] Sign in again.
- [ ] Confirm new workspaces sync from empty state.

## Verification After Reset

- [ ] Hosted API health endpoint returns 200.
- [ ] Sign-in works.
- [ ] OAuth clients can complete PKCE.
- [ ] `/api/session` returns a new user and owner keyring.
- [ ] Fuji opens with no entries.
- [ ] Honeycrisp opens with no notes.
- [ ] Whispering opens with no recordings.
- [ ] Creating a Fuji entry writes the current latest row shape.
- [ ] Creating a Honeycrisp note writes the current latest row shape.
- [ ] Creating a Whispering recording writes the current latest row shape.
- [ ] Sync works across two browser/device contexts.
- [ ] Billing dashboard creates or reads a new Autumn customer.
- [ ] No old `ownerId` appears in Postgres app tables.

## Risk Register

| Risk | Mitigation |
| --- | --- |
| Postgres reset but DO/R2/KV remain | Treat reset as all-store runbook, not DB-only. |
| OAuth clients missing after reset | Run `oauth:seed:remote` before opening the app. |
| Old local IndexedDB merges stale rows back into fresh cloud rooms | Clear local app storage before reconnecting clients. |
| Autumn customers are stranded by new `user.id` values | Clean Autumn customer state or accept it as archived prelaunch residue. |
| Removing library versioning blocks future schema evolution | Keep hidden `_v` and `defineTable(v1, v2).migrate(...)`. |
| App collapse accidentally changes current row shape | Compare latest old schema to new single schema before editing; typecheck app call sites. |

## Done Criteria

- [x] Fuji `entriesTable` is single-version.
- [x] Whispering `recordings` is single-version.
- [x] Honeycrisp `notesTable` is single-version.
- [x] App code has no `.migrate(...)` call sites.
- [x] Workspace package still supports future multi-version tables.
- [x] Targeted typechecks and tests pass.
- [ ] Reset runbook has been reviewed separately before any destructive command runs.
