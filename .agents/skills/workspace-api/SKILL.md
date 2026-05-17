---
name: workspace-api
description: Workspace API: defineTable, defineKv, attach* primitives, openCollaboration, defineQuery/Mutation, connectWorkspace. Use for workspace schemas and attachments.
metadata:
  author: epicenter
  version: '6.0'
---

# Workspace API

## Reference Repositories

- [Yjs](https://github.com/yjs/yjs) — CRDT framework (foundation of workspace data layer)

Type-safe schema definitions for tables and KV stores.

> **Related Skills**: See `yjs` for Yjs CRDT patterns and shared types. See `svelte` for reactive wrappers (`fromTable`, `fromKv`) and the **commit-on-blur pattern**, the preferred way to wire Svelte text inputs to workspace string fields without writing N transactions per keystroke. See `attach-primitive` for the full contract and invariants every `attach*` function must follow.

## When to Apply This Skill

- Defining a new table or KV store with `defineTable()` or `defineKv()`
- Adding a new version to an existing table definition
- Writing table migration functions
- Reading, writing, or observing table/KV data
- Composing a live document with a direct builder plus `attach*` primitives
- Adding `createDisposableCache(builder)` for per-row or otherwise fan-out documents
- Attaching persistence (`attachIndexedDb`, `attachYjsLog`), opening collaboration (`openCollaboration`), or materializers (`attachSqliteMaterializer`, `attachMarkdownMaterializer`) inline
- Writing server-side Bun scripts with `connectWorkspace()`
## Tables

### Shorthand (Single Version)

Use when a table has only one version:

```typescript
import { defineTable } from '@epicenter/workspace';
import { type } from 'arktype';

const usersTable = defineTable(type({ id: UserId, email: 'string', _v: '1' }));
export type User = InferTableRow<typeof usersTable>;
```

Every table schema must include `_v` with a number literal. The type system enforces this — passing a schema without `_v` to `defineTable()` is a compile error.

### Variadic (Multiple Versions)

Use when you need to evolve a schema over time:

```typescript
const posts = defineTable(
	type({ id: 'string', title: 'string', _v: '1' }),
	type({ id: 'string', title: 'string', views: 'number', _v: '2' }),
).migrate((row) => {
	switch (row._v) {
		case 1:
			return { ...row, views: 0, _v: 2 };
		case 2:
			return row;
	}
});
```

### Row Type Inference

**Always derive row types with `InferTableRow<typeof X>` against the table definition.** Export the type from the same file that calls `defineTable()`. Consumers `import type` it directly — never re-derive.

```typescript
// ✅ Correct — schema is the single source of truth
const postsTable = defineTable(/* ... */);
export type Post = InferTableRow<typeof postsTable>;
```

```typescript
// ❌ Wrong — goes through the runtime Table instance
type Post = ReturnType<typeof workspace.tables.posts.getAllValid>[number];

// ❌ Wrong — same smell with different method
type Post = ReturnType<typeof workspace.tables.posts.getAll>[number];
```

Why `InferTableRow` is better:
- Source of truth is the schema, not a method signature.
- Doesn't require importing/building the runtime client (works in workers, server code, isomorphic modules).
- Survives method renames and signature changes.
- Matches the convention used across every app in this repo.

**Don't relay types through state files.** Reactive state files (e.g. `*.svelte.ts`) should `import type` from the workspace definition module, not redefine or re-export the row type. Other consumers should also import the type directly from the workspace module — not from the state file. State files export runtime values; the workspace module exports types.

```typescript
// state/posts.svelte.ts
import type { Post } from '$lib/workspace';     // ✅ import directly
// export type { Post };                         // ❌ pass-through re-export

// some-component.svelte
import { posts } from '$lib/state/posts.svelte';  // runtime
import type { Post } from '$lib/workspace';        // type — same source as state file
```

## KV Stores

KV stores use `defineKv(schema, defaultValue)`. No versioning, no migration—invalid stored data falls back to the default.

```typescript
import { defineKv } from '@epicenter/workspace';
import { type } from 'arktype';

const sidebar = defineKv(type({ collapsed: 'boolean', width: 'number' }), { collapsed: false, width: 300 });
const fontSize = defineKv(type('number'), 14);
const enabled = defineKv(type('boolean'), true);
```

### KV Design Convention: One Scalar Per Key

Use dot-namespaced keys for logical groupings of scalar values:

```typescript
// ✅ Correct — each preference is an independent scalar
'theme.mode': defineKv(type("'light' | 'dark' | 'system'"), 'light'),
'theme.fontSize': defineKv(type('number'), 14),

// ❌ Wrong — structured object invites migration needs
'theme': defineKv(type({ mode: "'light' | 'dark'", fontSize: 'number' }), { mode: 'light', fontSize: 14 }),
```

With scalar values, schema changes either don't break validation (widening `'light' | 'dark'` to `'light' | 'dark' | 'system'` still validates old data) or the default fallback is acceptable (resetting a toggle takes one click).

Exception: discriminated unions and `Record<string, T> | null` are acceptable when they represent a single atomic value.

## Branded Table IDs (Required)

Every table's `id` field and every string foreign key field MUST use a branded type instead of plain `'string'`. This prevents accidental mixing of IDs from different tables at compile time.

### Pattern

Define a branded type + arktype validator + generator in the same file as the workspace definition:

```typescript
import type { Brand } from 'wellcrafted/brand';
import { type } from 'arktype';
import { generateId, type Id } from '@epicenter/workspace';

// 1. Branded type + arktype validator (co-located with workspace definition)
export type ConversationId = Id & Brand<'ConversationId'>;
export const ConversationId = type('string').as<ConversationId>();

// 2. Generator function — the ONLY place with the cast
export const generateConversationId = (): ConversationId =>
	generateId() as ConversationId;

// 3. Use in defineTable + co-locate type export
const conversationsTable = defineTable(
	type({
		id: ConversationId,              // Primary key — branded
		title: 'string',
		'parentId?': ConversationId.or('undefined'),  // Self-referencing FK
		_v: '1',
	}),
);
export type Conversation = InferTableRow<typeof conversationsTable>;

// 4. At call sites — use the generator, never cast directly
const newId = generateConversationId();  // Good
// const newId = generateId() as string as ConversationId;  // Bad
```

## Actions

Actions wrap table operations as `defineMutation` (writes) or `defineQuery` (reads). Build them in a small factory that closes over `tables` and `batch`, then attach the result to the bundle returned from your workspace builder.

```typescript
import { defineMutation, defineQuery } from '@epicenter/workspace';

export function createBlogActions({ tables, batch }) {
	return {
		/**
		 * Mark a post as published and record the publication timestamp.
		 *
		 * Separated from a raw `tables.posts.update()` call because publish
		 * involves setting multiple fields atomically and may trigger side
		 * effects (notifications, RSS rebuild) in future versions.
		 */
		publish: defineMutation({
			description: 'Publish a draft post',
			input: type({ id: PostId }),
			handler: ({ id }) => {
				batch(() => {
					tables.posts.update({ id, published: true, publishedAt: Date.now() });
				});
			},
		}),
	};
}

// Inside openBlog() or a createDisposableCache(...) builder:
//   const actions = createBlogActions({ tables, batch });
//   return { id, ydoc, tables, actions, batch, /* ... */ };
```

### Return shapes — local vs. remote contract

Actions have **two** type surfaces depending on how they're invoked. **Local**
callers see the handler's signature verbatim — sync stays sync, raw stays raw,
throws throw. **Remote** callers (via `collaboration.dispatch()`)
always get `Promise<Result<T, DispatchError>>`: the transport wraps raw values
in `Ok` and converts thrown errors or returned `Err`s into
`Err(DispatchError.ActionFailed)`.

**Rule of thumb:**

- **Return `Err(TypedError)`** for failures local callers should branch on.
- **Throw** for bugs / invariants. On the wire, throws become `ActionFailed`
  — the caller loses the stack and can only say "something broke."
- **Return raw** when failure isn't a meaningful concept for the operation.

Remote peer calls currently expose `DispatchError`, not each handler's typed
error union. If a remote caller needs a narrower failure contract, add an
explicit action surface for that workflow.

For the full matrix (every caller's view of every handler shape, all the
decision trees, and the normalization boundaries), read
[references/action-return-shapes.md](references/action-return-shapes.md).

### JSDoc on Action Methods

Every action method inside the `actions` object returned from the workspace builder should have a JSDoc comment. The JSDoc and the `description` field serve **different audiences**:

- **`description`**: consumed by MCP servers, CLI help text, and OpenAPI specs. Keep it short and declarative ("Import skills from disk").
- **JSDoc**: consumed by developers hovering in an IDE. Explain *why* the action exists as a separate operation, what non-obvious behavior it has, or what assumptions it makes.

```typescript
// ❌ Parrots the description
/** Import skills from an agentskills.io-compliant directory. */
importFromDisk: defineMutation({ description: 'Import skills from an agentskills.io-compliant directory', ... })

// ✅ Adds distinct value
/**
 * Scan a directory of SKILL.md files and upsert them into the workspace.
 *
 * Skills without a `metadata.id` in their frontmatter get one generated
 * and written back to the file, so future imports produce stable IDs
 * across machines.
 */
importFromDisk: defineMutation({ description: 'Import skills from an agentskills.io-compliant directory', ... })
```

## Workspace File Structure

Each app splits workspace code into an **isomorphic `workspace/` folder** and a **runtime-specific `client.ts`**:

```
src/lib/
│
├── workspace/                          ← 100% isomorphic (safe for Node, Bun, browser)
│   ├── definition.ts                   ← Schema: defineTable, defineKv, branded IDs
│   ├── actions.ts                      ← Isomorphic action factory: createXActions({ tables, batch })
│   └── index.ts                        ← Barrel: re-exports definition + actions only
│
└── client.ts                           ← Runtime singleton: openX() builder composing
                                           attachTables, attachIndexedDb/attachYjsLog,
                                           openCollaboration,
                                           attachEncryption, and runtime-specific actions
```

```
                    ┌─────────────────────────┐
                    │     definition.ts        │
                    │  tables, KV, branded IDs │
                    └────────────┬────────────┘
                                 │ imports
                    ┌────────────▼────────────┐
                    │     actions.ts           │
                    │  createXActions factory  │
                    │  ({ tables, batch })     │
                    └────────────┬────────────┘
                                 │ imports
   ┌─────────────────────────────┼─────────────────────────────┐
   │                             │                             │
   ▼                             ▼                             ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ client.ts    │   │ server-client.ts │   │ cli-client.ts    │
│ (browser)    │   │ (Node/Bun)       │   │ (CLI)            │
│ attachIndex… │   │ attachYjsLog     │   │ attachYjsLog     │
│ openCollab   │   │ openCollab       │   │ (no sync)        │
│ Chrome APIs  │   │ Node fs APIs     │   │                  │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

### Layering Rules

1. **`definition.ts`** — Pure schema. `defineTable()`, `defineKv()`, branded ID types and generators. Isomorphic.
2. **`actions.ts`** — Factory that takes `{ tables, batch }` and returns an action tree of `defineQuery`/`defineMutation`. Isomorphic — no browser/Node APIs.
3. **`index.ts`** — Barrel that re-exports from `definition.ts` and `actions.ts` only. **Never re-exports from `client.ts`.** This is the import path for `$lib/workspace` and the package.json subpath export.
4. **`client.ts`**: Lives **outside** the `workspace/` folder at `src/lib/client.ts`. Exposes an `openX()` builder where runtime-specific attachments are composed (IndexedDB vs SQLite, browser vs Node APIs) and the full bundle is assembled, including runtime-specific actions. Singleton apps export the opened bundle directly (`export const workspace = openX()`). Per-row document caches use `createDisposableCache(builder)` beside that singleton.

### Import Convention

```typescript
// Components/state that need the live workspace instance:
import { workspace, auth } from '$lib/client';

// Components that only need types or the definition:
import { type Note, NoteId } from '$lib/workspace';

// Other packages in the monorepo:
import { createHoneycrisp } from '@epicenter/honeycrisp/workspace';
import { honeycrisp } from '@epicenter/honeycrisp/definition';
```

### Package.json Subpath Exports

Each app exports a single `./workspace` subpath pointing to the barrel:

```json
{
  "exports": {
    "./workspace": "./src/lib/workspace/index.ts"
  }
}
```

The barrel is 100% isomorphic, so this single subpath is safe for any consumer (server, CLI, other apps). The separate `./definition` subpath is no longer needed since the barrel already re-exports everything from `definition.ts`.

### Isomorphic vs Runtime-Specific Actions

Isomorphic actions (table reads/writes, portable logic) belong in the exported `actions.ts` factory. Runtime-specific actions, whether browser APIs, Chrome extension APIs, Node/Bun filesystem calls, or Tauri commands, live in the `client.ts` builder where the relevant attachments and APIs are in scope.

```typescript
// workspace/actions.ts: isomorphic actions (exported via barrel)
export function createMyAppActions({ tables, batch }) {
  return {
    devices: {
      list: defineQuery({
        title: 'List Devices',
        description: 'List all synced devices.',
        input: Type.Object({}),
        handler: () => ({ devices: tables.devices.getAllValid() }),
      }),
    },
  };
}

// src/lib/client.ts: browser-specific attachments + runtime actions
function openMyApp() {
  const ydoc = new Y.Doc({ guid: 'epicenter.myapp' });
  const tables = attachTables(ydoc, myAppTables);
  const idb = attachIndexedDb(ydoc);
  const batch = (fn) => ydoc.transact(fn);

  const actions = defineActions({
    ...createMyAppActions({ tables, batch }),
    tabs_close: defineMutation({
      title: 'Close Tabs',
      description: 'Close browser tabs by ID.',
      input: Type.Object({ tabIds: Type.Array(Type.Number()) }),
      handler: async ({ tabIds }) => {
        await browser.tabs.remove(tabIds);  // Chrome API
        return { closedCount: tabIds.length };
      },
    }),
  });
  const collaboration = openCollaboration(ydoc, {
    url,
    waitFor: idb.whenLoaded,
    openWebSocket,
    replicaId,
    actions,
  });

  return { ydoc, tables, idb, collaboration, actions, batch, /* whenReady, ... */ };
}

export const workspace = openMyApp();
```

## Attachment Ordering

Attachments compose through plain lexical scope, so ordering is explicit: if `openCollaboration` needs to wait for local state, its `waitFor` option reads `idb.whenLoaded`, and `idb` must be defined first.

| Attachment | Typical `waitFor` | Behavior |
|---|---|---|
| `attachYjsLog` | — | Starts loading the Yjs update log immediately |
| `attachIndexedDb` | — | Starts loading IndexedDB immediately |
| `attachEncryption` | (none, sync) | Reads `encryptionKeys()` synchronously at each registration site |
| `openCollaboration` | `idb.whenLoaded` (or another local-load promise) | Opens WebSocket after local replay |

The standard shape is **persistence first, then collaboration with `waitFor`**:

```
attachIndexedDb  ────────────→ idb.whenLoaded resolves
                                       ↓
openCollaboration({ waitFor: idb.whenLoaded }) ────→ WebSocket opens → synced
```

This ordering matters because sync only exchanges the delta between local state and the server. Without persistence loading first, every cold start downloads the full document.

```typescript
// Correct: persistence loads first, collaboration waits for idb, exchanges delta only
createDisposableCache((id) => {
  const ydoc = new Y.Doc({ guid: id });
  const tables = attachTables(ydoc, myTables);
  const idb = attachIndexedDb(ydoc);
  const collaboration = openCollaboration(ydoc, {
    url: toWsUrl(`${serverUrl}/workspaces/${ydoc.guid}`),
    waitFor: idb.whenLoaded,
    openWebSocket,
    replicaId,
  });
  return { id, ydoc, tables, idb, collaboration, /* ... */ };
});

// Wrong: collaboration starts before local state is loaded, downloads full document
createDisposableCache((id) => {
  const ydoc = new Y.Doc({ guid: id });
  const collaboration = openCollaboration(ydoc, { url, openWebSocket, replicaId });
  const idb = attachIndexedDb(ydoc);
  return { id, ydoc, idb, collaboration, /* ... */ };
});
```

### `connectWorkspace` (CLI/Script Shortcut)

For server-side Bun scripts, `connectWorkspace` from `@epicenter/cli` handles the unlock to sync chain automatically. It is **ephemeral by design: no local persistence**, so a script can coexist with a long-running `epicenter start` daemon without fighting over the same SQLite file:

```typescript
import { connectWorkspace } from '@epicenter/cli';
import { createFujiWorkspace } from '@epicenter/fuji/workspace';

const workspace = await connectWorkspace(createFujiWorkspace);
// Ready. Authenticated. Syncing. Full doc downloaded from server.

const entries = workspace.tables.entries.getAllValid();
await workspace.dispose();
```

Writes propagate through sync to the daemon, which owns the materializer (markdown, SQLite mirror, etc.).

Use `connectWorkspace` for one-off scripts and agent-written automation. Use a folder-routed `workspaces/<route>/daemon.ts` (`defineDaemonWorkspace({ open })`) for long-running daemons and materializers that need persistence and custom workspace-specific extensions.


## The `_v` Convention

- `_v` is a **number** discriminant field (`'1'` in arktype = the literal number `1`)
- **Required for tables** — enforced at the type level via `CombinedStandardSchema<{ id: string; _v: number }>`
- **Not used by KV stores** — KV has no versioning; `defineKv(schema, defaultValue)` is the only pattern
- In arktype schemas: `_v: '1'`, `_v: '2'`, `_v: '3'` (number literals)
- In migration returns: `_v: 2` (TypeScript narrows automatically, `as const` is unnecessary)
- Convention: `_v` goes last in the object (`{ id, ...fields, _v: '1' }`)

## References

Load these on demand based on what you're working on:

- If working with **table migrations** (migration function rules, direct-to-latest strategy, migration anti-patterns, `as const` note), read [references/table-migrations.md](references/table-migrations.md)
- If working with **table/KV CRUD or observation** (`get`, `set`, `update`, `observe`, Svelte observer guidance), read [references/table-kv-crud-observation.md](references/table-kv-crud-observation.md)
- If working with **per-row or standalone Y.Docs** (raw `new Y.Doc({ guid, gc })` + `attachRichText`/`attachPlainText`, `attachIndexedDb`, `openCollaboration`, `whenLoaded` vs `whenConnected`), read [references/primitive-api.md](references/primitive-api.md)
- If working with **action return shapes, throw vs `Err`, remote error envelopes, `collaboration.dispatch()`, `DispatchError`, or the local/remote type-surface split**, read [references/action-return-shapes.md](references/action-return-shapes.md)

Code references:

- `packages/workspace/src/document/define-table.ts`
- `packages/workspace/src/document/define-kv.ts`
- `packages/workspace/src/cache/disposable-cache.ts`
- `packages/workspace/src/document/attach-table.ts`
- `packages/workspace/src/document/attach-kv.ts`
- `packages/workspace/src/document/open-collaboration.ts`
- `packages/workspace/src/document/attach-indexed-db.ts`
- `packages/workspace/src/document/attach-yjs-log.ts`
