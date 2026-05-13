# Generic Yjs Sync Rooms And Checkpoints

**Date**: 2026-05-12
**Status**: Draft
**Author**: Braden + Codex

## Overview

Replace product-named server sync room types with one generic Yjs sync room. Keep the default room compact with `gc: true`, add full binary checkpoints as the first history feature, and defer `gc: false` snapshot history until there is a product surface that needs exact historical reconstruction.

The clean sentence:

```txt
Epicenter Server syncs named Y.Docs; apps decide what those docs mean.
```

## Motivation

### Current State

The current API server has two Durable Object classes over the same sync base:

```txt
apps/api/src/base-sync-room.ts
  BaseSyncRoom
    Y.Doc
    Awareness
    WebSocket sync
    HTTP sync
    SQLite update log
    compaction

apps/api/src/workspace-room.ts
  WorkspaceRoom extends BaseSyncRoom
  gc: true

apps/api/src/document-room.ts
  DocumentRoom extends BaseSyncRoom
  gc: false
  snapshot RPCs
```

`apps/api/src/app.ts` routes them separately:

```txt
/workspaces/:workspace
  GET  full doc or WebSocket upgrade
  POST HTTP sync

/documents/:document
  GET  full doc or WebSocket upgrade
  POST HTTP sync

/documents/:document/snapshots
  POST create Yjs snapshot marker
  GET  list snapshot markers

/documents/:document/snapshots/:id
  GET    reconstruct snapshot
  DELETE delete snapshot
```

`packages/workspace` has moved in the opposite direction. The current public model is not "workspace server objects" and "document server objects". It is a direct `Y.Doc` builder with inline attachments:

```ts
const ydoc = new Y.Doc({ guid: 'epicenter.blog' });
const tables = attachTables(ydoc, { posts });
const idb = attachIndexedDb(ydoc);
const sync = attachSync(ydoc, {
	url: toWsUrl(`${APP_URLS.API}/workspaces/${ydoc.guid}`),
	waitFor: idb.whenLoaded,
	openWebSocket,
});
```

This creates problems:

1. **Product nouns leak into sync infrastructure**: `WorkspaceRoom` and `DocumentRoom` are app meanings, not protocol meanings. The server room is a Yjs replication cell.
2. **History is implied by route name**: `/documents/*` currently means `gc: false` and snapshot RPCs, even when no shipped UI consumes version history.
3. **The expensive path is the default for content**: `gc: false` keeps deleted content so snapshots can reconstruct old states. That is useful only when history itself is a feature.
4. **Future generic docs get awkward names**: A file body, note body, canvas, timeline, or table bundle are all Y.Docs. Forcing them through `/workspaces` or `/documents` makes the endpoint vocabulary less true over time.

`apps/epicenter` does not exist in this checkout. Older specs mention it, but the current implementation target is `apps/api/src/app.ts` and the server placeholder in `apps/server`.

### Desired State

The server exposes one generic sync room concept:

```txt
/sync/:room
  GET  full Y.Doc state or WebSocket upgrade
  POST HTTP sync
```

Every room starts as a compact current-state room:

```ts
new Y.Doc({ gc: true });
```

Apps still choose meaningful room ids:

```txt
epicenter.fuji
epicenter.fuji.entries.entry_123.body
epicenter.honeycrisp.notes.note_456.body
```

History arrives later through explicit checkpoint endpoints:

```txt
/sync/:room/checkpoints
  POST create full binary checkpoint
  GET  list checkpoints

/sync/:room/checkpoints/:id
  GET    fetch checkpoint metadata or binary
  DELETE delete checkpoint

/sync/:room/checkpoints/:id/restore
  POST restore checkpoint into the live room
```

`gc: false` snapshot history stays deferred. If it is ever added, it must be a room creation policy, not a query param or per-connection flag.

## Research Findings

### Yjs GC And History

Yjs exposes `gc` as a `Y.Doc` option:

```ts
new Y.Doc({ guid, gc });
```

Grounding from installed Yjs source:

```txt
node_modules/yjs/src/utils/Doc.js
  gc defaults to true
  guid identifies the document
  gcFilter can keep selected deleted items
```

During transaction cleanup, Yjs garbage-collects deleted items only when `doc.gc` is true:

```txt
node_modules/yjs/src/utils/Transaction.js
  if (doc.gc) {
    tryGcDeleteSet(ds, store, doc.gcFilter)
  }
```

`Y.createDocFromSnapshot(originDoc, snapshot)` refuses a GC-enabled origin doc:

```txt
node_modules/yjs/src/utils/Snapshot.js
  if (originDoc.gc) {
    throw new Error('Garbage-collection must be disabled in `originDoc`!')
  }
```

Full state checkpoints use `Y.encodeStateAsUpdateV2(doc)`, which works with normal compact docs:

```txt
node_modules/yjs/src/utils/encoding.js
  encodeStateAsUpdateV2(doc, targetStateVector?)
```

Key finding:

```txt
Normal Yjs update sync does not require matching gc settings.
Yjs snapshot reconstruction requires the origin doc to have gc: false.
Full binary checkpoints work with gc: true.
```

Implication:

```txt
Do not coordinate client and server gc for normal sync.
Make server retention an explicit room policy.
Prefer checkpoints before snapshot history.
```

### Endpoint Shape

The existing client `attachSync` only needs a URL. It does not know whether the URL names a workspace, document, or generic room.

```ts
attachSync(ydoc, {
	url,
	waitFor,
	openWebSocket,
	awareness,
});
```

That is the right abstraction. The server URL names the remote Y.Doc room. The app decides what the local bundle contains.

### Checkpoints Versus Yjs Snapshots

These are different promises:

```txt
Full checkpoint:
  stores full binary state
  works with gc: true
  each checkpoint is self-contained
  restore is simple
  larger per saved version

Yjs snapshot:
  stores a small state-vector/delete-set marker
  requires origin doc gc: false
  origin doc must retain deleted content forever
  restore can reconstruct exact historical state
  smaller marker, larger live document over time
```

The checkpoint path is the better first feature because it keeps the default sync room compact and puts history cost only on saved checkpoints.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Server sync unit | 2 coherence | Generic `SyncRoom` | Yjs syncs Y.Docs. Product nouns belong above the room layer. |
| Default GC | 1 evidence | `gc: true` | Yjs defaults to true. It keeps deleted content compact and supports normal sync. |
| First history feature | 2 coherence | Full binary checkpoints | Checkpoints work with `gc: true` and do not force every room to retain deleted content. |
| `gc: false` support | Deferred | Do not implement now | It is only needed for exact Yjs snapshot reconstruction. No current UI needs that promise. |
| Client GC matching | 1 evidence | Do not require matching | Normal update sync works across different local GC policies. Only snapshot origin docs require `gc: false`. |
| Room policy control | 2 coherence | Server owns persisted retention | A client connection must not be able to silently turn a room into retained-history storage. |
| Route compatibility | 3 taste | Build generic routes first, migrate callers, then delete legacy routes | A clean break is easier to explain than keeping `/workspaces`, `/documents`, and `/sync` as equal long-term shapes. |

## Architecture

### Target Room

```txt
apps/api/src/sync-room.ts
┌────────────────────────────────────────────┐
│ SyncRoom extends BaseSyncRoom              │
│                                            │
│ config:                                    │
│   gc: true                                 │
│                                            │
│ storage:                                   │
│   updates table                            │
│   optional checkpoints table               │
│                                            │
│ protocols:                                 │
│   WebSocket sync                           │
│   HTTP sync                                │
│   checkpoint RPCs                          │
└────────────────────────────────────────────┘
```

### Route Shape

```txt
apps/api/src/app.ts

GET /sync/:room
  if Upgrade: websocket
    auth already resolved
    stub.fetch(request)
  else
    stub.getDoc()

POST /sync/:room
  body: encoded sync request
  stub.sync(body)

POST /sync/:room/checkpoints
  stub.createCheckpoint({ label? })

GET /sync/:room/checkpoints
  stub.listCheckpoints()

GET /sync/:room/checkpoints/:id
  metadata or binary, final response shape to decide in implementation

POST /sync/:room/checkpoints/:id/restore
  stub.restoreCheckpoint(id)

DELETE /sync/:room/checkpoints/:id
  stub.deleteCheckpoint(id)
```

### Room Naming

Room names should stay opaque to the server:

```txt
server sees:
  room = "epicenter.fuji.entries.entry_123.body"

server does not infer:
  app = fuji
  collection = entries
  row = entry_123
  field = body
```

The current user-scoped Durable Object naming still applies:

```txt
user:{userId}:sync:{room}
```

This keeps isolation unchanged while removing the workspace/document branch.

## Implementation Plan

The first PR is Phases 1 through 3. Phase 4 (checkpoints) and Phase 5 (snapshot history) are explicitly out of scope for the first PR and only land when a real product surface needs them. Treat them as future specs, not deferred sub-tasks of this one.

```txt
First PR commit graph (one logical change per commit):

  1. server: add SyncRoom DO + /sync/:room routes (no client changes)
  2. clients: switch attachSync URLs to /sync/:room (one commit per app, or one batched commit)
  3. server: remove /workspaces and /documents routes + DocumentRoom snapshot RPCs

Each commit must be independently shippable:
  - After commit 1, no behavior changes for clients.
  - After commit 2, all clients use /sync/:room; legacy routes still answer for rollback safety.
  - Commit 3 lands only after metrics show zero traffic on /workspaces/* and /documents/*.
```

### Phase 1: Build Generic Sync Room

- [ ] **1.1** Add `apps/api/src/sync-room.ts` that extends `BaseSyncRoom` with `{ gc: true }`.
- [ ] **1.2** Export `SyncRoom` from `apps/api/src/app.ts` alongside the existing `WorkspaceRoom`/`DocumentRoom` re-exports for Wrangler type generation.
- [ ] **1.3** Add `SYNC_ROOM` Durable Object binding in `apps/api/wrangler.jsonc`. Add a new migration tag (for example `v2`) with `new_sqlite_classes: ["SyncRoom"]`. Do not touch the existing `v1` migration. Do not list `WorkspaceRoom` or `DocumentRoom` under `deleted_classes` or `renamed_classes`; that path destroys all existing user instance data.
- [ ] **1.4** Regenerate Cloudflare binding types so `c.env.SYNC_ROOM` is typed.
- [ ] **1.5** Add `getSyncStub(c)` in `apps/api/src/app.ts` using DO names shaped as `user:{userId}:sync:{room}`.
- [ ] **1.6** Add `GET /sync/:room` and `POST /sync/:room` routes with the same auth, payload limit, storage tracking, and response behavior as the current workspace/document routes.
- [ ] **1.7** Add `'sync'` to the `DoType` union in `apps/api/src/db/schema.ts` and use it for `upsertDoInstance` calls on the new routes. Old rows with `doType: 'workspace' | 'document'` stay valid; no Postgres data migration is required.
- [ ] **1.8** Add tests that prove WebSocket and HTTP sync still work through `/sync/:room`.

### Phase 2: Prove Generic Callers

Concrete call sites (verified in `apps/`, `packages/`, `examples/`, and `playground/`):

```txt
workspace doc URL:
  apps/fuji/src/routes/(signed-in)/fuji/daemon.ts
  apps/fuji/src/routes/(signed-in)/fuji/browser.ts
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/daemon.ts
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/script.ts
  apps/opensidian/src/lib/opensidian/daemon.ts
  apps/opensidian/src/lib/opensidian/browser.ts
  apps/opensidian/src/lib/opensidian/script.ts
  apps/zhongwen/src/routes/(signed-in)/zhongwen/daemon.ts
  apps/zhongwen/src/routes/(signed-in)/zhongwen/script.ts
  apps/tab-manager/src/lib/tab-manager/extension.ts
  examples/notes-cross-peer/notes.ts
  playground/tab-manager-e2e/epicenter.config.ts
  playground/opensidian-e2e/epicenter.config.ts

child content doc URL (currently /documents/*):
  apps/fuji/src/routes/(signed-in)/fuji/browser.ts (entry body, gc: false)
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts (note body, gc: false)
```

- [ ] **2.1** Update app sync URLs from `/workspaces/${doc.ydoc.guid}` to `/sync/${encodeURIComponent(doc.ydoc.guid)}` via a shared `syncRoomUrl()` helper exported from `@epicenter/workspace` next to `toWsUrl`. A single helper keeps the encoding rule in one place.
- [ ] **2.2** Update child content doc URLs from `/documents/${ydoc.guid}` to the same helper. The local docs stay `gc: false` (clients still want history-capable RAM model); the server side becomes `gc: true`. This is the documented "client `gc: false`, server `gc: true`" edge case and is acceptable.
- [ ] **2.3** Update the example URL in `packages/workspace/src/index.ts` JSDoc and any other references to `/workspaces/*` or `/documents/*` as sync endpoints in docs and guides.
- [ ] **2.4** Run targeted typecheck and tests for `apps/api`, `packages/workspace`, and every app whose URL changed.
- [ ] **2.5** Keep old `/workspaces/*` and `/documents/*` routes alive through this phase. Deletion is a separate commit gated on traffic verification.

### Phase 3: Remove Product-Named Room Types

Critical constraint: do not let Wrangler delete the `WorkspaceRoom` or `DocumentRoom` SQLite classes. Marking them under `deleted_classes` (or removing them from `new_sqlite_classes` without a replacement migration) is a permanent, irreversible destruction of every existing user instance's data. The first PR removes only the routes and the route-bound code paths. The DO classes themselves stay registered until a follow-up confirms zero remaining instances.

- [ ] **3.1** Confirm before deletion that no shipped UI calls the `/documents/:document/snapshots*` endpoints. Verified during spec review: only `apps/api/src/app.ts` references them; no client app, package, or example does. The auto-save in `DocumentRoom.onAllDisconnected` writes snapshots that nothing reads.
- [ ] **3.2** Delete the four `/documents/:document/snapshots*` routes from `apps/api/src/app.ts`.
- [ ] **3.3** Delete the `/workspaces/:workspace` and `/documents/:document` routes (GET and POST) from `apps/api/src/app.ts`.
- [ ] **3.4** Remove the `app.use('/workspaces/*', requireAppAccessToken)` and `app.use('/documents/*', requireAppAccessToken)` middlewares.
- [ ] **3.5** Delete `getWorkspaceStub` and `getDocumentStub` helpers in `apps/api/src/app.ts`.
- [ ] **3.6** Leave `WorkspaceRoom` and `DocumentRoom` exports, the `WORKSPACE_ROOM`/`DOCUMENT_ROOM` Wrangler bindings, and the `v1` migration entry in place. The classes still hold user data; deleting them is a separate retirement decision with its own data plan, not part of the route migration.
- [ ] **3.7** Decide before merging whether to drop the `'workspace'` and `'document'` values from `DoType`. Recommendation: leave them in the union so historical `durable_object_instance` rows continue to type-check. Stop writing them in new code.

### Phase 4: Add Checkpoints Later (separate spec, separate PR)

Out of scope for this spec's first PR. Move to its own spec when there is a real consumer (restore UI, import safety, user-visible version list). Listed below for reference only.

- [ ] **4.1** Add a `checkpoints` table to `SyncRoom` storage:

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data BLOB NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_state_vector BLOB NOT NULL
);
```

- [ ] **4.2** Add `createCheckpoint(label?)` using `Y.encodeStateAsUpdateV2(this.doc)`.
- [ ] **4.3** Add `listCheckpoints()` with metadata only.
- [ ] **4.4** Add `getCheckpoint(id)` for binary export or preview tooling.
- [ ] **4.5** Add `restoreCheckpoint(id)` with a clear implementation choice:

```txt
Option A:
  Clear room storage and replace live doc with checkpoint state.

Option B:
  Apply checkpoint into current doc as an update.

Recommendation:
  Use Option A for restore semantics. A checkpoint restore should mean "make the room equal this saved state", not "merge old state into current state".
```

- [ ] **4.6** Broadcast restored state to connected clients or close/reconnect clients after restore. Pick one behavior and test it.
- [ ] **4.7** Add retention controls before enabling automatic checkpoints:

```txt
max checkpoints per room
max bytes per room
delete oldest first
manual delete endpoint
```

### Phase 5: Defer Snapshot History

Do not implement unless exact historical reconstruction becomes a product requirement.

- [ ] **5.1** Add a room metadata table before adding `gc: false`:

```txt
room_policy:
  room id
  retention: current | checkpoints | snapshots
  created_at
```

- [ ] **5.2** Make policy immutable after room creation.
- [ ] **5.3** Create `Y.Doc({ gc: false })` only for `retention: snapshots`.
- [ ] **5.4** Add snapshot marker endpoints under a history namespace, not the default sync path.
- [ ] **5.5** Add quota and retention UI before allowing snapshot-history rooms in production.

## Backwards Compatibility Hazards

### DO data lives under the old class name

`/workspaces/${guid}` resolves to a Durable Object named `user:{userId}:workspace:{guid}` of class `WorkspaceRoom`. `/sync/${guid}` resolves to a different Durable Object named `user:{userId}:sync:{guid}` of class `SyncRoom`. The two share no storage. Switching a client to the new URL means the server starts that room from empty state.

In practice this is recoverable but visible:

```txt
warm device (has IndexedDB):
  client opens /sync/${guid}, server returns empty doc
  client pushes its full state on first STEP2/UPDATE
  server is hydrated; all peers converge

cold device (no IndexedDB, e.g. fresh sign-in on a new machine):
  client opens /sync/${guid}, server returns empty doc
  client has nothing to push; user sees a blank workspace
  recovery requires another peer (warm device) to come online first
```

For the affected products (Fuji, Honeycrisp, Opensidian, Zhongwen, Tab Manager) almost every device today is warm. Still, the spec must be honest about the cold-device case. If we want to avoid even that, a one-shot data copy from the WorkspaceRoom DO into a same-named SyncRoom DO is required, and that is a separate engineering effort. Recommendation: ship the cutover, accept the cold-device gap for the small population it affects, and document the recovery procedure ("sign in on a device that already has the workspace").

### Wrangler migrations are one-way

```txt
SAFE in this PR:
  add a v2 migration with new_sqlite_classes: ["SyncRoom"]

NEVER in this PR (or ever, lightly):
  add WorkspaceRoom or DocumentRoom to deleted_classes
  remove WorkspaceRoom or DocumentRoom from any prior migration
```

A `deleted_classes` entry destroys every existing instance's storage permanently. That is the user's data. The first PR keeps both classes registered.

### In-flight clients during the route swap

```txt
commit 1 lands  : both /workspaces and /sync answer
commit 2 lands  : new client builds talk to /sync; old tabs still open keep talking to /workspaces
commit 3 lands  : /workspaces and /documents return 404
```

Open tabs and unupdated installs (the published Tab Manager extension, Whispering desktop builds, anyone with a stale browser tab) may keep talking to the legacy routes. Commit 3 is a hard break. Before merging it, verify:

```txt
- production access logs show zero successful traffic on /workspaces/* and /documents/*
  for at least one full release cycle
- the Tab Manager extension auto-update has reached >X% of installs (pick a number)
- no Whispering or other desktop build in active distribution still ships old URLs
```

If any of those fail, hold commit 3. Do not keep a deprecation lane in this spec; either prove the callers are gone or write a separate compatibility spec with an owner and removal date.

### Snapshot RPCs have no consumers

Confirmed by grep: nothing outside `apps/api/` calls `saveSnapshot`, `listSnapshots`, `getSnapshot`, or `deleteSnapshot`. The auto-save in `DocumentRoom.onAllDisconnected` writes data nothing reads. Deleting the snapshot routes (Phase 3.2) is safe today. The DocumentRoom class still exists per Phase 3.6, so the snapshot table on disk is preserved for any future migration.

### `DoType` enum

`durable_object_instance.do_type` is a Postgres `text` column constrained at the type level by `DoType = 'workspace' | 'document'`. Adding `'sync'` is a TypeScript-only change; no SQL migration is needed. Old rows keep their existing values; new rows on the new routes write `'sync'`.

### URL encoding

Existing call sites pass `${doc.ydoc.guid}` raw. Guids generated by `docGuid()` look like `epicenter.fuji.entries.entry_123.body`, all dot-separated and ASCII-safe. Switching to `encodeURIComponent` is a behavioral no-op for current guid shapes, and a defensive correctness win for any future guid that contains `?`, `#`, or `/`. Use the helper from day one so individual call sites cannot drift.

## Edge Cases

### Client Uses `gc: false`, Server Uses `gc: true`

Expected behavior:

```txt
normal sync works
client may retain local deleted content
server does not retain deleted content for Yjs snapshot restore
```

This is acceptable. Local client retention is not a server history promise.

### Client Uses `gc: true`, Server Uses `gc: false`

Expected behavior:

```txt
normal sync works
server can retain history
client does not retain local deleted content
```

This is acceptable only for explicit snapshot-history rooms.

### Restore While Clients Are Connected

Checkpoint restore is not just another edit if the intended semantics are "replace the room with this old state".

Implementation must choose one:

```txt
close and reconnect:
  easier to reason about
  clients reload from restored state

broadcast replacement:
  smoother UX
  harder to prove because CRDT updates merge rather than delete unknown future structs
```

Recommendation: close and reconnect for the first restore implementation.

### Unknown Room

Generic sync can create rooms on first access, but auth still decides who can access the room.

Current hosted behavior should stay user-scoped:

```txt
same room string + different user id = different Durable Object
```

### Room Name Encoding

Room ids may contain slashes or punctuation if derived from document paths. Provide a helper that encodes room ids consistently.

```ts
function syncRoomUrl(apiUrl: string, roomId: string) {
	return toWsUrl(`${apiUrl}/sync/${encodeURIComponent(roomId)}`);
}
```

## Testing Plan

- [ ] `apps/api` route tests cover `GET /sync/:room`, `POST /sync/:room`, and WebSocket upgrade.
- [ ] Existing sync handler tests continue to pass.
- [ ] A browser-style client can sync a doc through `/sync/:room`.
- [ ] Two clients with the same user and room converge.
- [ ] Two users with the same room string do not share a Durable Object.
- [ ] Storage tracking records `doType: sync` or an equivalent new type.
- [ ] Old `/workspaces/*` and `/documents/*` routes are unused before deletion.
- [ ] Checkpoint tests, when Phase 4 happens, cover create, list, fetch, delete, restore, and retention limits.

## Open Questions

1. Should the public route be `/sync/:room` or `/rooms/:room`?
   Recommendation: `/sync/:room` in the hosted API because it names the capability. `/rooms/:room` is also fine for a pure local sync server.

2. Should `GET /sync/:room/checkpoints/:id` return metadata, binary data, or content negotiation?
   Recommendation: list returns metadata; binary export can be `/data` if needed.

3. Should restore be implemented by replacing the DO storage or by appending a CRDT update?
   Recommendation: replace storage and force reconnect for first implementation.

4. Should checkpoint creation be manual only or automatic on last disconnect?
   Recommendation: manual only at first. Add automatic checkpoints after there is a retention policy and UI.

5. Should room policies be stored in Postgres, Durable Object SQLite, or both?
   Recommendation: Postgres for control-plane policy and billing visibility; DO SQLite for room-local data.

## Non-Goals

- Do not add `gc=false` query params.
- Do not make clients negotiate server GC.
- Do not preserve `/workspaces/*` and `/documents/*` as permanent aliases after migration.
- Do not add snapshot-history endpoints until the product needs exact historical reconstruction.
- Do not make checkpoints automatic before quota and retention behavior exist.

## Success Criteria

- One server room class handles all Yjs sync.
- App sync URLs no longer encode `workspace` or `document` as server room types.
- Default rooms use `gc: true`.
- No client-facing API can casually create a `gc: false` room.
- Future checkpoints can be added without changing the sync protocol.
- Future snapshot history has a clear, explicit policy path if it becomes necessary.
