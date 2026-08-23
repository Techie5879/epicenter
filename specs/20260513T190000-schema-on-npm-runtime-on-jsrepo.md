# Schema on npm, Runtime on jsrepo

**Date**: 2026-05-13
**Status**: Partially superseded (script-recipe portion)
**Superseded by**: `20260514T160000-script-surfaces-resolution.md`
**Still live**: the schema-on-npm + daemon-route-on-jsrepo split. `workspace.ts` (schema) and `daemon-route.ts` (writer recipe) remain canonical blocks for every app.
**Removed**: `script.ts` as a per-app jsrepo recipe. The `openHoneycrispScript` / `openOpensidianScript` / `openZhongwenScript` examples in the body of this spec describe a defunct shape. Scripts now compose `connectDaemonActions` + read-only SQLite at the user's call site; there is nothing to copy.
**Author**: AI-assisted
**Branch**: feat/miscellaneous-spec-implementations

## Overview

Each app workspace publishes one thing on npm (its schema) and ships its peer-runtime recipes (script, daemon) as jsrepo blocks the consumer copies into their tree. The browser binding stays inside the SvelteKit app as private code. The `openXDocument` indirection is inlined into every consumer because the helper exists only to share four lines of primitive composition.

## Per-App File Map

The five apps do not share one layout. Phase work has to acknowledge each.

| App | Package name | Schema source | Runtime files dir | Notes |
| --- | --- | --- | --- | --- |
| Honeycrisp | `@epicenter/honeycrisp` | `src/routes/(signed-in)/honeycrisp/workspace.ts` | `src/routes/(signed-in)/honeycrisp/` | Schema and runtime co-located. |
| Fuji | `@epicenter/fuji` | `src/routes/(signed-in)/fuji/workspace.ts` | `src/routes/(signed-in)/fuji/` | `FUJI_WORKSPACE_ID = 'epicenter.fuji'` lives in `document.ts`; must move to `workspace.ts` before deletion. |
| Zhongwen | `@epicenter/zhongwen` | `src/routes/(signed-in)/zhongwen/workspace/index.ts` (directory) | `src/routes/(signed-in)/zhongwen/` | Has typed `zhongwenKv` schema; inlined runtime files must import it. |
| Opensidian | `opensidian` (no scope) | `src/lib/workspace/definition.ts` | `src/lib/opensidian/` | Schema and runtime in different directories. Cross-package consumers use bare `'opensidian/workspace'`. |
| Tab Manager | `@epicenter/tab-manager` | `src/lib/workspace/index.ts` (re-exports `definition.ts` and `actions.ts`) | `src/lib/tab-manager/` (extension.ts only) | No `document.ts`, no `script.ts`, no `daemon.ts`. Phase 1 and Phase 4 are no-ops. |

## Motivation

### Current State

After `20260513T180000-explicit-app-constructor-layers.md`, every app exposes a five-subpath npm contract:

```jsonc
// apps/honeycrisp/package.json
{
  "exports": {
    "./workspace": "./src/.../workspace.ts",
    "./document":  "./src/.../document.ts",
    "./browser":   "./src/.../browser.ts",
    "./daemon":    "./src/.../daemon.ts",
    "./script":    "./src/.../script.ts"
  }
}
```

Each runtime file imports the document layer:

```ts
// apps/honeycrisp/src/.../script.ts
import { openHoneycrispDocument } from './document.js';

export async function openHoneycrispScript({ projectDir, clientID }) {
  const auth = await createMachineAuthClient();
  const doc = openHoneycrispDocument({
    clientID,
    encryptionKeys: () => requireIdentity(auth).encryptionKeys,
  });
  const yjsLog = attachYjsLogReader(doc.ydoc, { ... });
  const sync = attachYjsSync(doc.ydoc, { ... });
  return { ydoc: doc.ydoc, tables: doc.tables, ..., yjsLog, sync, ... };
}
```

Trace of external consumers across the repo:

| Subpath | External imports outside the owning app |
| --- | --- |
| `./workspace` | playground configs, cross-app type references (real public surface) |
| `./document` | zero |
| `./browser` | zero (only `apps/<app>/src/lib/session.ts` imports it via the package boundary) |
| `./script` | zero (the script openers are defined and never invoked anywhere) |
| `./daemon` | zero (real `epicenter.config.ts` files inline the route construction; nothing imports `defineHoneycrispDaemon` etc.) |

### Problems

1. **Four subpaths exist for code with no external callers.** `./document`, `./browser`, `./script`, `./daemon` are published interfaces that nobody outside the owning app reaches. They look like contracts; they are recipes pretending to be contracts.

2. **The document helper forces three layers of indirection.** `script.ts` imports `openHoneycrispDocument`, which calls four primitives. The wrapper exists only because three sibling files (browser, script, daemon) shared the same four-line composition. The cost: a separate file per app, a separate subpath, a separate exported type, and the `Document` suffix question in every naming discussion.

3. **The wrong channel for recipes.** Playground configs like `playground/opensidian-e2e/epicenter.config.ts` already build the workspace inline with `attachEncryption + attachTables + attachSync` instead of importing `defineOpensidianDaemon`. Consumers do not want a black-box helper. They want a working starter to edit. npm semver is the wrong tool; a copy-and-edit registry is the right one.

4. **No place for "I want to fork this script."** A third-party Bun consumer who wants to run an Opensidian peer with different sync URLs, different auth, different log paths cannot do that with `openOpensidianScript` (the function hardcodes URL + auth + log path). They have to write it from scratch, the same way the playground configs already do.

### Desired State

```jsonc
// apps/honeycrisp/package.json (after)
{
  "exports": {
    ".": "./src/.../workspace.ts"
  }
}
```

The only published npm surface is the schema: tables, action types, branded IDs, awareness defs.

```ts
// apps/honeycrisp/src/lib/session/honeycrisp.ts (internal to the SvelteKit app)
export function openHoneycrispBrowser({ userId, peer, openWebSocket, encryptionKeys }) {
  // doc construction inlined here:
  const ydoc = new Y.Doc({ guid: 'epicenter.honeycrisp', gc: false });
  const encryption = attachEncryption(ydoc, { encryptionKeys });
  const tables = encryption.attachTables(honeycrispTables);
  const kv = encryption.attachKv({});
  // browser-specific composition follows:
  const idb = encryption.attachIndexedDb(ydoc, { userId });
  // ... awareness, sync, child docs, wipe ...
}
```

```ts
// apps/honeycrisp/blocks/script.ts (jsrepo block; consumer copies this into their tree)
export async function openHoneycrispScript({ projectDir, clientID } = {}) {
  const auth = await createMachineAuthClient();
  const ydoc = new Y.Doc({ guid: 'epicenter.honeycrisp', gc: false });
  // ... same four-line doc construction, inlined ...
}
```

```ts
// apps/honeycrisp/blocks/daemon-route.ts (jsrepo block)
export function defineHoneycrispDaemon({ route = 'honeycrisp' } = {}): DaemonRouteDefinition {
  return { route, async start({ projectDir }) { /* ... inlined ... */ } };
}
```

## Thesis (one sentence)

> Schema is contract on npm, browser is app code in the app, script and daemon are recipes on jsrepo, and nothing is shared between the three runtime files except the npm primitives they all import.

If that sentence reads true after the implementation, the break is done.

## Research Findings

### Distribution channel comparison

| Artifact class | Owner | Edit-friendly? | Versioning | Channel |
| --- | --- | --- | --- | --- |
| Primitive (yjs, attachEncryption, attachYjsSync) | Epicenter | No (forks break correctness) | semver | npm |
| Contract (honeycrispTables) | Epicenter | No (forks break sync compatibility) | semver | npm |
| Recipe (script entry, daemon route, materializer wiring) | Consumer | Yes (each consumer edits for their environment) | by content hash / commit | jsrepo |
| App code (browser session opener) | The app itself | n/a (not distributed) | n/a | stays inside the SvelteKit app |

**Key finding**: the current monorepo packs all four classes into one npm package. The honest split is three different homes.

### Prior art

| Project | What they distribute on npm | What they distribute as copy-paste |
| --- | --- | --- |
| shadcn-svelte | bits-ui primitives | every component you render |
| jsrepo | the CLI itself | every block in every registry |
| Better Auth | the core library + plugins | the integration glue (route handlers, server config, UI pages) |
| Yjs ecosystem | yjs, y-protocols, y-indexeddb | starters and demos (out-of-band) |
| Hono | the framework | example apps (out-of-band) |

The pattern is consistent: primitives publish, recipes copy. Better Auth packages this most explicitly with `create-auth-skill` generating code into the consumer's tree. shadcn institutionalized it for UI components. jsrepo generalized the mechanism.

**Implication**: Epicenter's runtime bindings are recipes by the same definition (consumer edits, no semver contract, dozens of right answers). Putting them on npm is the category error this spec corrects.

### What does NOT change

- `@epicenter/workspace`, `@epicenter/workspace/node`, `@epicenter/workspace/daemon`, `@epicenter/auth`, `@epicenter/auth/node`, `@epicenter/constants/apps`, `yjs` stay on npm with their current subpaths. These are primitives; the blocks import them.
- The schema content itself: `honeycrispTables`, `fujiTables`, branded IDs, awareness defs, action factories. They move from `./workspace` subpath to the root export but the source file is the same.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Where does the schema live? | 2 coherence | npm, one root export per app | Real cross-package consumers exist; the sync wire protocol depends on row shapes; needs semver. |
| Where does the browser binding live? | 1 evidence | Inside the SvelteKit app as private code, no npm export | Zero external imports of `./browser`; tight coupling to `createSession`, auth singleton, Svelte stores, `import.meta.hot`. |
| Where do script + daemon live? | 2 coherence | jsrepo blocks under `apps/<app>/blocks/` | Empirical: playground configs already inline the construction. They are recipes. |
| Should the document helper survive? | 2 coherence | Inline into each consumer; delete `document.ts` and the `./document` subpath | The helper hides four primitive calls; removing it deletes a file, a subpath, an exported type, and the `openX as openXDoc` aliasing pattern. The price is approximately four duplicated lines per runtime file. |
| jsrepo or npm or both for runtime bindings? | 2 coherence | jsrepo only | Hybrid distribution channels for the same artifact class is the greenfield-clean-breaks anti-pattern. Pick one. |
| jsrepo block file layout | 3 taste | `apps/<app>/blocks/<recipe>.ts` | Co-locates blocks with the schema they import; one glob in `jsrepo-build-config.json` finds them; build config lives at monorepo root. |
| Block naming | 2 coherence | Keep `openXScript`, `defineXDaemon` from the prior spec | Lifecycle-shaped names; `defineX` for inert definitions, `openX` for live resources. Already canonical after `20260513T180000`. |
| Browser opener naming after move | 3 taste | `openHoneycrispBrowser` stays (function and type name unchanged); only the file moves | Internal callers (`lib/session.ts`) already import `openHoneycrispBrowser`. Moving the file is enough. |
| What about Fuji's `openFujiSnapshot`? | 2 coherence | Becomes a separate jsrepo block | Different shape, different consumer story, real divergence from the `Script` recipe. Blocks are the right home for divergent variants. |
| Tab Manager | 1 evidence | No script or daemon blocks (none exist today) | Don't ship empty blocks speculatively. |
| Registry hosting | Deferred | Deferred | Decide before the jsrepo build phase. See Open Questions. |

## Architecture

### Distribution shape

```
              ┌─────────────────────────────────────────┐
              │  Epicenter monorepo                     │
              │                                         │
              │  packages/workspace/   npm: primitives  │
              │  packages/auth/        npm: primitives  │
              │  packages/constants/   npm: primitives  │
              │                                         │
              │  apps/honeycrisp/                       │
              │    src/.../workspace.ts ─── npm: schema (root export)
              │    src/lib/session/                     │
              │      honeycrisp.ts      ─── app code (not distributed)
              │    blocks/                              │
              │      script.ts          ─── jsrepo block
              │      daemon-route.ts    ─── jsrepo block
              │                                         │
              │  apps/fuji/ ... same shape ...          │
              │  apps/opensidian/ ... same shape ...    │
              │  apps/zhongwen/ ... same shape ...      │
              │  apps/tab-manager/                      │
              │    src/.../definition.ts ── npm: schema │
              │    src/lib/.../extension.ts ── app code │
              │    (no blocks: no script/daemon today)  │
              └─────────────────────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        npm registry    epicenter.so/r/   git source
        @epicenter/*    jsrepo manifest   (also reachable for archaeology)
```

### What a script block looks like after install

```
consumer-repo/
  package.json                       (lists @epicenter/workspace, @epicenter/honeycrisp, yjs, etc.)
  src/blocks/honeycrisp-script.ts    (copied from registry, consumer owns)
  epicenter.config.ts                (consumer's own wiring; imports the block)
```

```ts
// src/blocks/honeycrisp-script.ts  (consumer's tree, editable)
import { createMachineAuthClient, requireIdentity } from '@epicenter/auth/node';
import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import {
  attachEncryption,
  attachYjsSync,
  type ProjectDir,
  websocketUrl,
} from '@epicenter/workspace';
import {
  attachYjsLogReader,
  findEpicenterDir,
  hashClientId,
  yjsPath,
} from '@epicenter/workspace/node';
import { honeycrispTables } from '@epicenter/honeycrisp';
import * as Y from 'yjs';

export async function openHoneycrispScript({
  projectDir = findEpicenterDir(),
  clientID = hashClientId(Bun.main),
}: { projectDir?: ProjectDir; clientID?: number } = {}) {
  const auth = await createMachineAuthClient();
  const ydoc = new Y.Doc({ guid: 'epicenter.honeycrisp', gc: false });
  ydoc.clientID = clientID;
  const encryption = attachEncryption(ydoc, {
    encryptionKeys: () => requireIdentity(auth).encryptionKeys,
  });
  const tables = encryption.attachTables(honeycrispTables);
  const kv = encryption.attachKv({});
  const yjsLog = attachYjsLogReader(ydoc, {
    filePath: yjsPath(projectDir, ydoc.guid),
  });
  const sync = attachYjsSync(ydoc, {
    url: websocketUrl(`${EPICENTER_API_URL}/workspaces/${ydoc.guid}`),
    openWebSocket: auth.openWebSocket,
  });
  return {
    ydoc, tables, kv, encryption, yjsLog, sync,
    [Symbol.dispose]() { ydoc.destroy(); },
  };
}

export type HoneycrispScript = Awaited<ReturnType<typeof openHoneycrispScript>>;
```

The block depends on five npm packages and is otherwise standalone. The consumer edits the body freely (different URL, different auth, omit kv, add a materializer, etc.) without breaking sync, because sync compatibility is owned by the primitives + the schema, not by the recipe.

## Implementation Plan

Phases follow Build, Prove, Remove. Each phase runs across all apps before the next phase begins, EXCEPT Phase 1 which can land per-app for safer rollback. Tab Manager is a no-op for Phases 1 and 4 (no document, script, or daemon files exist).

`jsrepo` is already a root `devDependencies` entry (`^3.6.2`). No install step required.

Verification commands (used at the end of each phase):
- Typecheck: `bun run typecheck` (runs `turbo run typecheck`)
- Tests: `bun run test` (runs `turbo run test`)
- Per-app dev smoke: `bun run --cwd apps/<app> dev:local`, navigate to the signed-in route, observe the workspace opens and renders.

### Phase 1: Inline the document layer, app by app

For Fuji, Honeycrisp, Opensidian, Zhongwen (Tab Manager skipped):

- [x] **1.1** Pre-inline prep, app-specific:
  - **Fuji**: move `export const FUJI_WORKSPACE_ID = 'epicenter.fuji'` from `document.ts` to `workspace.ts`. (Daemon doesn't import it today, but the constant must survive.)
  - **Honeycrisp / Opensidian**: no prep; doc layer hardcodes the guid string.
  - **Zhongwen**: confirm `zhongwenKv` is exported from `workspace/index.ts` (it already is); inlined files will import it.
- [x] **1.2** In `browser.ts`, replace `const doc = openXDocument(...)` with the inlined body:
  ```ts
  const ydoc = new Y.Doc({ guid: '<app-guid>', gc: false });
  const encryption = attachEncryption(ydoc, { encryptionKeys });
  const tables = encryption.attachTables(<appTables>);
  const kv = encryption.attachKv(<kvSchema>);  // Zhongwen: zhongwenKv. Others: {}
  ```
  Then update all subsequent `doc.X` references (`doc.ydoc` → `ydoc`, `doc.tables` → `tables`, `doc.encryption` → `encryption`, `doc.kv` → `kv`, `doc.batch` → inline `(fn) => ydoc.transact(fn)` where used). Update the `[Symbol.dispose]` to `ydoc.destroy()`. Delete the `import { openXDocument } from './document.js'` line.
- [x] **1.3** Same inlining for `script.ts` (if present).
- [x] **1.4** Same inlining for `daemon.ts` (if present).
- [x] **1.5** Delete `apps/<app>/src/.../document.ts`.
- [x] **1.6** Remove `"./document": "..."` from `apps/<app>/package.json` `exports`.
- [x] **1.7** Grep the app's directory for `XDocument` (the type) and `openXDocument` (the function); confirm zero hits.

Fuji has TWO call sites in `script.ts` (`openFujiSnapshot` and `openFujiScript`): inline into both.

Verification after each app: `bun run --cwd apps/<app> typecheck` and `bun run --cwd apps/<app> dev:local`.

### Phase 2: Promote schema to the root npm export

For each app, in one commit:

- [x] **2.1** Edit `apps/<app>/package.json` exports map to replace `"./workspace": "<path>"` with `".": "<path>"`. Targets:
  - Honeycrisp: `./src/routes/(signed-in)/honeycrisp/workspace.ts`
  - Fuji: `./src/routes/(signed-in)/fuji/workspace.ts`
  - Zhongwen: `./src/routes/(signed-in)/zhongwen/workspace/index.ts`
  - Opensidian: `./src/lib/workspace/definition.ts`
  - Tab Manager: `./src/lib/workspace/index.ts`
- [x] **2.2** Update every cross-package consumer to import from the package root:
  - `playground/tab-manager-e2e/epicenter.config.ts`: `'@epicenter/tab-manager/workspace'` → `'@epicenter/tab-manager'`
  - `playground/opensidian-e2e/epicenter.config.ts`: `'opensidian/workspace'` → `'opensidian'`
  - `playground/opensidian-e2e/epicenter.config.test.ts`: same.
  - `packages/workspace/src/client/connect-daemon-actions.ts:16` (JSDoc): `'@epicenter/fuji/workspace'` → `'@epicenter/fuji'`.
- [x] **2.3** Grep the repo for `'@epicenter/(honeycrisp|fuji|zhongwen|tab-manager)/workspace'` and `'opensidian/workspace'`; expect zero hits.

2026-05-14 note: the current tree exports `./blocks/workspace.ts` as the package root for Honeycrisp, Fuji, Opensidian, and Zhongwen. Tab Manager still exports `./src/lib/workspace/index.ts`. This keeps the schema as the package-root npm contract and also makes the four app schemas available as jsrepo blocks.

Verification: `bun run typecheck` (root). `bun run test` (root).

### Phase 3: Delete the dead `./browser` subpath

The browser file already lives inside the app's `src/` tree; `apps/<app>/src/lib/session.ts` imports it via relative path, not via the package boundary. The `./browser` subpath has zero callers. Nothing moves.

For each app:

- [x] **3.1** Remove `"./browser": "..."` from `apps/<app>/package.json` exports.

Verification: `bun run typecheck`.

### Phase 4: Move script and daemon to `apps/<app>/blocks/`

For Fuji, Honeycrisp, Opensidian, Zhongwen (Tab Manager skipped):

- [x] **4.1** Create `apps/<app>/blocks/` directory.
- [x] **4.2** Move `apps/<app>/src/.../script.ts` to `apps/<app>/blocks/script.ts`.
- [x] **4.3** Move `apps/<app>/src/.../daemon.ts` to `apps/<app>/blocks/daemon-route.ts`.
- [x] **4.4** Inside the moved files, rewrite the schema import to use the package root (depends on Phase 2):
  - Was: `import { <appTables>, ... } from './workspace.js'` (or `'./workspace/index.js'` for Zhongwen, `'../workspace/definition.js'` for Opensidian).
  - Now: `import { <appTables>, ... } from '@epicenter/<app>'` (or `'opensidian'` for Opensidian).
- [x] **4.5** Fuji-specific: `daemon.ts` exports both `defineFujiDaemon` and `connectFujiDaemonActions`. Both move into `blocks/daemon-route.ts`. `blocks/script.ts` imports them via relative path `'./daemon-route.js'`.
- [x] **4.6** Update Fuji's `blocks/script.ts` import of `openFujiDocument` (which was deleted in Phase 1; the body is now inlined). The remaining schema import in `script.ts` is `EncryptionKeys` from `@epicenter/encryption` and `ProjectDir` from `@epicenter/workspace`: these stay.
- [x] **4.7** Remove `"./script": "..."` and `"./daemon": "..."` from `apps/<app>/package.json` exports.

Verification: `bun run typecheck`. The block files now compile against the package root, the same way a third-party consumer's copy will.

### Phase 5a: jsrepo build config (no hosting decision needed)

- [x] **5a.1** Add `jsrepo.config.ts` at the monorepo root. Block category: `blocks` glob `apps/*/blocks/*.ts`. Each app's blocks become a category named after the app (e.g. `epicenter/honeycrisp/script`).
- [x] **5a.2** Run `bun run jsrepo:build` locally; verify a manifest is produced with the expected block list.
- [x] **5a.3** Add `bun run jsrepo:build` to root `package.json` scripts so the manifest can be regenerated on demand.

Verification: manifest contains four blocks per app (script, daemon-route, plus Fuji's snapshot variant if split out), no unexpected entries.

### Phase 5b: registry hosting (gated on Open Question 1)

- [ ] **5b.1** Decide hosting (Open Question 1).
- [ ] **5b.2** Configure the registry origin in `jsrepo-build-config.json`.
- [ ] **5b.3** Wire build into CI (e.g. GitHub Actions workflow that runs `bunx jsrepo build` and uploads to the chosen origin).
- [ ] **5b.4** Add a short `docs/recipes/README.md` covering `bunx jsrepo add epicenter/<app>/<recipe>` for consumers.

### Phase 6: Prove and remove

- [ ] **6.1** `bun run typecheck` (root, all packages).
- [ ] **6.2** `bun run test` (root, all packages).
- [ ] **6.3** Dev-server smoke each SvelteKit app:
  ```
  bun run --cwd apps/honeycrisp dev:local
  bun run --cwd apps/fuji        dev:local
  bun run --cwd apps/opensidian  dev:local
  bun run --cwd apps/zhongwen    dev:local
  bun run --cwd apps/tab-manager dev:local
  ```
  For each: load the signed-in route, confirm the workspace opens and renders the expected initial UI.
- [ ] **6.4** Run the playground configs end-to-end:
  ```
  bun run playground/opensidian-e2e/epicenter.config.ts
  bun run playground/tab-manager-e2e/epicenter.config.ts
  ```
  Confirm both connect, sync, and exit cleanly on Ctrl+C.
- [x] **6.5** Final grep sweep, expect zero hits in source (excluding `specs/` and `docs/articles/`):
  ```
  rg 'openXDocument|XDocument\b' --type=ts        # X is each app name
  rg "'@epicenter/[^/]+/(workspace|document|browser|script|daemon)'" --type=ts --type=svelte
  rg "'opensidian/(workspace|document|browser|script|daemon)'" --type=ts
  rg 'src/.*/(document|script|daemon)\.ts'        # any straggler runtime file outside blocks/
  ```
- [x] **6.6** Confirm each app's `package.json` exports has exactly one entry: `"."`.

## Edge Cases

### Fuji's snapshot + script combo

1. Fuji has two recipes today: `openFujiSnapshot` (read-only encrypted tables + log reader) and `openFujiScript` (snapshot + daemon RPC client).
2. Both move to blocks: `apps/fuji/blocks/snapshot.ts` and `apps/fuji/blocks/script.ts`.
3. The `Script` block can import from the `Snapshot` block via a relative path within `apps/fuji/blocks/`. jsrepo's dep graph picks this up when a consumer installs `epicenter/fuji/script` (it transitively pulls `snapshot`).

### Tab Manager has no script or daemon block

1. Today: only `definition.ts` (schema) + `extension.ts` (browser binding) exist. No script. No daemon.
2. After: only the schema is on npm. The browser binding stays internal. The `blocks/` directory either does not exist or is empty. Do not create empty blocks.

### Cross-app type references in `packages/workspace`

1. `packages/workspace/src/client/connect-daemon-actions.ts` has a JSDoc reference `@epicenter/fuji/workspace`.
2. After Phase 2, that subpath is gone. JSDoc updates to `@epicenter/fuji`.
3. `packages/workspace/src/client/daemon-actions.ts` similarly.
4. Grep `'@epicenter/.*/workspace'` for all such references before deleting the subpath.

### Playground configs importing the old subpath

1. `playground/opensidian-e2e/epicenter.config.ts` imports `import { opensidianTables } from 'opensidian/workspace'`.
2. After Phase 2: `import { opensidianTables } from 'opensidian'`.

### Internal imports of `./document`

1. Phase 1 deletes `document.ts` while three files still import it.
2. Order matters: inline the body into each runtime file BEFORE deleting `document.ts`, in the same wave per app. Don't half-do an app and ship.

### Browser file location (no longer an edge case after Phase 3 collapse)

Phase 3 no longer moves the browser file. The file stays at `apps/<app>/src/.../browser.ts` and `apps/<app>/src/lib/session.ts` keeps its existing relative import. Only the package.json subpath export is removed. This sidesteps the `lib/session.ts` vs `lib/session/<app>.ts` collision question entirely.

## Open Questions

1. **Where is the jsrepo registry hosted?**
   - Options: (a) `epicenter.so/r/` (subpath of the marketing site), (b) a dedicated `registry.epicenter.so` subdomain, (c) `github.com/EpicenterHQ/blocks` with jsrepo reading the raw GitHub URLs.
   - **Recommendation**: (a) for v1. Lowest infrastructure: dump the manifest + raw files under `apps/landing/static/r/` and let Cloudflare serve them. Move to (b) when the registry justifies a subdomain. (c) avoids hosting entirely but ties registry URLs to the GitHub URL shape, which is harder to change later.

2. **Should the browser opener eventually fold into `lib/session.ts`?** (Out of scope for this spec: Phase 3 no longer moves the file.)
   - Options: (a) leave at `routes/(signed-in)/<app>/browser.ts` (current home, Phase 3 choice), (b) move into `lib/session.ts` as a follow-up, (c) move into `lib/session/<app>.ts` to preserve a split-out file.
   - **Recommendation**: defer (a) for this spec. If a future spec moves the file, prefer (b): the opener has exactly one caller and folding makes the session story sit in one file. Tracked as a separate concern from this spec.

3. **Does the document-construction code (the four inlined lines) deserve a primitive helper in `@epicenter/workspace`?**
   - Options: (a) leave as four inline lines in every block, (b) add `attachWorkspaceDoc(ydoc, { tables, encryptionKeys })` or similar to `@epicenter/workspace`.
   - **Recommendation**: (a) initially. The "primitive" would itself be a thin composition over four primitives the user already imports. Revisit if a sixth or seventh recipe arrives with the same four lines and starts to drift.

4. **Should `epicenter.config.ts` files inside the monorepo (playground, examples) migrate to `bunx jsrepo add` flows, or stay inline?**
   - Options: (a) migrate (eat your own dogfood), (b) stay inline (they're already the canonical examples).
   - **Recommendation**: (b) for the playground configs that already work as inline examples; they serve as the canonical "what does this block look like in use" demo. Migrate if and when a real third-party consumer reports the inline copy drifted from the registry.

5. **Does this spec also collapse `@epicenter/workspace`'s own subpaths (`/node`, `/daemon`, `/document/materializer/markdown`)?**
   - Options: (a) out of scope here, (b) collapse them too.
   - **Recommendation**: (a). Those subpaths are runtime-isolation boundaries (browser must not pull node), not recipe distribution. Different question, separate spec.

## Decisions Log

- **Keep the `Script` and `Daemon` and `Browser` suffixes on function names** even after the files move:
  Constraint: the prior spec just landed these names across five apps; renaming them again in the same week is churn.
  Revisit when: a future consumer reports the suffix is confusing now that the file path no longer needs to disambiguate (e.g. `openHoneycrispBrowser` lives in `apps/honeycrisp/src/lib/session.ts`, where the `Browser` part is redundant). Acceptable to revisit after the jsrepo registry has real external users.

- **Keep `defineXDaemon` separate from a hypothetical `defineXScript`**:
  Constraint: the daemon function genuinely returns an inert `DaemonRouteDefinition` while the script function performs side effects immediately. The verb asymmetry is honest.
  Revisit when: the daemon runtime API changes such that `start()` becomes synchronous or the route definition gains a third lifecycle moment that makes `define` ambiguous.

- **Keep `apps/<app>/blocks/` co-located with the app**:
  Constraint: blocks import the app's schema; co-location keeps the dep graph readable and lets one `jsrepo-build-config.json` glob find everything.
  Revisit when: blocks need to ship for an app whose schema lives elsewhere, or when there are more than ~10 apps and a flat `blocks/<app>/` top-level layout becomes simpler.

## Success Criteria

- [x] Each app's `package.json` lists exactly one export entry: `"."`.
- [x] No file named `document.ts` exists under `apps/*/src/`.
- [x] No file named `script.ts` or `daemon.ts` exists under `apps/*/src/` (Fuji, Honeycrisp, Opensidian, Zhongwen recipes live in `apps/*/blocks/`; Tab Manager has none).
- [x] `browser.ts` still exists at `apps/*/src/.../browser.ts` (or `extension.ts` for Tab Manager); only its package subpath export is gone.
- [x] `rg "'@epicenter/(honeycrisp|fuji|zhongwen|tab-manager)/(workspace|document|browser|script|daemon)'"` returns zero hits in source.
- [x] `rg "'opensidian/(workspace|document|browser|script|daemon)'"` returns zero hits in source.
- [x] `rg 'openXDocument|XDocument\b'` (X = each app) returns zero hits.
- [ ] `bun run typecheck` passes at the repo root.
- [ ] `bun run test` passes at the repo root.
- [ ] Every app's `bun run --cwd apps/<app> dev:local` starts and the signed-in route opens its workspace successfully.
- [ ] `bun run playground/opensidian-e2e/epicenter.config.ts` runs without errors until Ctrl+C.
- [ ] `bun run playground/tab-manager-e2e/epicenter.config.ts` runs without errors until Ctrl+C.
- [x] `jsrepo.config.ts` exists at the monorepo root and `bun run jsrepo:build` produces a manifest covering every block under `apps/*/blocks/`.

## References

- `specs/20260513T180000-explicit-app-constructor-layers.md`: the prior spec that landed the `Document/Browser/Script/Daemon` naming uniformity this spec is built on.
- `apps/honeycrisp/src/routes/(signed-in)/honeycrisp/document.ts`: the helper this spec removes.
- `apps/honeycrisp/src/routes/(signed-in)/honeycrisp/{browser,script,daemon}.ts`: the runtime files that move.
- `apps/honeycrisp/package.json`: the exports surface that collapses to one entry.
- `apps/fuji/src/routes/(signed-in)/fuji/script.ts`: contains both `openFujiSnapshot` and `openFujiScript`; both move and inline the document layer.
- `apps/tab-manager/src/lib/workspace/`: the only app whose schema layout differs; root export points at this directory's `index.ts`.
- `playground/opensidian-e2e/epicenter.config.ts`: canonical inline-recipe example that motivates the jsrepo model.
- `playground/tab-manager-e2e/epicenter.config.ts`: same.
- `packages/workspace/src/client/{daemon-actions,connect-daemon-actions}.ts`: JSDoc references to old subpaths to update.
- `jsrepo`: https://jsrepo.dev (CLI, build config, manifest format).

## Review (Phases 1-5a, 6 verification)

### Landed commits

| Phase | Commit | Summary |
| --- | --- | --- |
| 1 | `refactor(apps): inline document layer, drop ./document subpath` | Inlined `openXDocument` into every runtime caller; deleted each `document.ts`; dropped `./document` subpath. Fuji moved `FUJI_WORKSPACE_ID` to `workspace.ts`; Zhongwen kept its typed `zhongwenKv`. |
| 2 | `refactor(apps): promote schema to root npm export` | `./workspace` -> `.` for all 5 apps. Updated playground configs and the `@epicenter/workspace` JSDoc. Bundled Tab Manager's document inlining here for thesis consistency (spec said "no doc.ts"; turned out it had one). |
| 3 | `refactor(apps): drop ./browser subpath, browser stays app-private` | Removed `./browser` exports. Files unchanged: every consumer was already a relative or `$lib` alias import, not a package boundary import. |
| 4 | `refactor(apps): move script and daemon to apps/<app>/blocks/` | `apps/<app>/{src/...}/{script,daemon}.ts` -> `apps/<app>/blocks/{script,daemon-route}.ts`. Rewrote schema imports to the package root. Dropped `./script` and `./daemon` subpaths. Updated the `@epicenter/cli` README to show the recipe-as-block pattern. |
| 5a | `build(jsrepo): add registry config for app blocks` | `jsrepo.config.ts` at repo root, 8 items (`epicenter/<app>/{script,daemon-route}` x 4 apps), `repository()` output producing `registry.json` (gitignored). Cross-block deps (e.g. Fuji's script -> daemon-route) auto-detected. |

### Phase 6 verification outcome

- **6.1 typecheck (per-app, in scope)**: all 5 apps return `0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- **6.1 typecheck (root)**: fails on pre-existing errors in `@epicenter/ui` (DateTimeString brand mismatches, emoji-picker types) and `packages/workspace/src/document/peer.test.ts` (DocOpts shape). Confirmed unrelated to this spec by reproducing on a clean stash of the working tree before any phase landed.
- **6.2 test (root)**: `turbo run test` fails because four apps and one package have `test` scripts that point at directories with no test files. Pre-existing on the base branch; not introduced by this spec.
- **6.3 dev-server smoke**: not executed in this pass (each app needs an authenticated session against a running API). Per-app typecheck is the closest automated proxy. Worth a manual smoke before the next deploy.
- **6.4 playground configs**: not executed in this pass (need machine auth credentials). The import rewrites typecheck via TypeScript module resolution diagnostics, which confirmed the new package-root paths resolve to the schema files.
- **6.5 grep sweep**: zero hits for all four spec'd patterns:
  - `'@epicenter/(honeycrisp|fuji|zhongwen|tab-manager)/(workspace|document|browser|script|daemon)'` -> 0 hits.
  - `'opensidian/(workspace|document|browser|script|daemon)'` -> 0 hits.
  - `openXDocument|XDocument\b` (across all five apps) -> 0 hits.
  - `find apps -type f \( -name 'document.ts' -o -name 'script.ts' -o -name 'daemon.ts' \) -not -path '*/blocks/*'` -> 0 hits.
- **6.6 package.json exports**: every app has exactly one entry, `"."`:
  - `@epicenter/honeycrisp` -> `./blocks/workspace.ts`
  - `@epicenter/fuji` -> `./blocks/workspace.ts`
  - `@epicenter/zhongwen` -> `./blocks/workspace.ts`
  - `opensidian` -> `./blocks/workspace.ts`
  - `@epicenter/tab-manager` -> `./src/lib/workspace/index.ts`

### Status finalization

On 2026-05-14, the current tree already matched the implemented distribution shape. No source files were changed in this pass. This update marks the spec implemented and records the current package-root export paths.

### Spec discrepancies discovered during execution

- **Tab Manager had a `document.ts`** under `apps/tab-manager/src/lib/tab-manager/`. The spec asserted "no `document.ts`/`script.ts`/`daemon.ts`", so the spec's "Phase 1 is a no-op for Tab Manager" was wrong on the `document.ts` count. Inlined and deleted it during Phase 2 (where the package.json was being touched anyway). Tab Manager still has no `script` or `daemon`, so Phase 4 was a true no-op for it.
- **jsrepo config filename**: the spec said `jsrepo-build-config.json`. The actual jsrepo CLI looks for `jsrepo.config.(ts|js|mts|mjs)`. Used `jsrepo.config.ts`.

### Deferred (per spec)

- **Phase 5b (registry hosting)**: blocked on Open Question 1. Decide between `epicenter.so/r/`, a dedicated `registry.epicenter.so` subdomain, or `github.com/EpicenterHQ/blocks`. Until then `registry.json` is produced locally and gitignored.
- **Open Question 3 (helper for the four inlined lines)**: kept inline. No new primitive.
- **Open Question 4 (playground migration to jsrepo add)**: kept inline. Playground configs still serve as the canonical "what does this block look like in use" demo.
