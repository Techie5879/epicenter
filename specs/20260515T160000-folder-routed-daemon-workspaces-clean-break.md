# Folder Routed Workspace Apps Clean Break

**Date**: 2026-05-15
**Status**: Superseded by `20260516T130000-hosted-apps-with-optional-daemon-extensions.md`
**Author**: Braden + AI-assisted

## Supersession Note

This spec captured the source-installed app package path: copy one full app
folder into `workspaces/<route>/`, build its SPA locally, and let the daemon
serve the generated files.

The product direction has changed. The default app distribution path is now
hosted UI over local core. Source-installed apps stay useful for app authors,
private/internal apps, and local development, but they are no longer the
primary user path. See
`specs/20260516T130000-hosted-apps-with-optional-daemon-extensions.md`.

Treat the implementation plan below as historical context, not a backlog. Do
not implement the local-build or daemon-served SPA tasks as the default product
path.

## One Sentence

Every directory under `<projectDir>/workspaces/` is one installable local workspace app package: the folder name is the route, `daemon.ts` opens the daemon runtime, `workspace.ts` defines the shared data and action contract, and an optional static SPA is built from the same folder and served by the daemon.

## Why this design

The previous version of this spec made the folder the daemon route, but still treated the SPA as something adjacent. That stops one step too early. If a user installs Fuji, they should get the Fuji data contract, daemon runtime, and UI as one editable local app package.

```
Current pressure:

  apps/<app>/src/                 first-party SPA source
  apps/<app>/blocks/workspace.ts  shared schema and actions
  apps/<app>/blocks/daemon-route.ts
  epicenter.config.ts             route registry
  jsrepo.config.ts                copies only fragments

Clean shape:

  workspaces/<route>/             one local app package
    package.json                  deps and build scripts
    daemon.ts                     daemon runtime entrypoint
    workspace.ts                  shared schema and actions
    src/                          SPA source
    static/                       SPA assets
    build/                        generated static SPA
```

This keeps the good part of folder routing: the folder name owns the route. It also removes the split where a user copies daemon files but still has to understand where the matching SPA lives.

## Product Sentence

Install a workspace app by copying one folder into `workspaces/`. The daemon runs its `daemon.ts`, serves its built SPA if present, and routes CLI actions through the folder name.

## Research Notes

Comparable plugin systems mostly converge on one installable folder that contains metadata, source, assets, and one or more host entrypoints.

| System | Shape | Useful lesson |
| --- | --- | --- |
| VS Code extensions | One package with `package.json`, `src/extension.ts`, and a `main` entry | Package metadata and host entrypoint live together. |
| Raycast extensions | One package with `package.json`, `src/`, assets, and command entry files | Source, package metadata, and commands are colocated. |
| Chrome extensions | One root `manifest.json` declares background code, pages, permissions, and resources | The installable unit is the folder, not scattered files. |
| Figma plugins | One manifest declares `main` and optional `ui` files | Runtime code and UI code are separate entrypoints inside one plugin. |
| Obsidian plugins | One plugin folder with manifest metadata and compiled plugin files | The local plugin folder is the unit users can inspect and edit. |

Implication for Epicenter: use one workspace app folder. Do not keep `blocks/` as the install unit once the SPA is part of the user-owned app.

Reference docs:

- https://code.visualstudio.com/api/get-started/extension-anatomy
- https://developers.raycast.com/information/file-structure
- https://developer.chrome.com/docs/extensions/get-started
- https://developers.figma.com/docs/plugins/manifest/
- https://docs.obsidian.md/Reference/Manifest

## Supersedes And Updates

| File | Recommendation | Reason |
| --- | --- | --- |
| `specs/20260514T170000-single-daemon-multi-workspace.md` | Mark **Superseded by** this spec once Phase 1 + 2 land | Single-process goal still stands. Config-as-registry shape is replaced. |
| `specs/20260501T114356-daemon-startup-boundary-and-route-definition-cleanup.md` | Mark **Partially Superseded** | Startup ownership and async disposal stand. `DaemonRouteDefinition[]` public config shape becomes historical. |
| `specs/20260501T160000-daemon-route-map-config.md` | Leave `Superseded`; append this spec to `Superseded By` chain | Already historical. |
| `specs/20260501T120000-daemon-peer-runtime-contract.md` | **Update examples** only | Peer, RPC, and dispatch contract unchanged. Config examples become folder examples. |
| `specs/20260512T222257-cli-daemon-command-clean-break.md` | **Update examples** only | `epicenter run route.action_key` shape stays. Route source changes. |
| `specs/20260515T120000-daemon-run-ownership-map.md` | **Update ownership map** | `/run` ownership unchanged. Route discovery moves from `loadDaemonConfig` to workspace app discovery. |
| `specs/20260515T140000-daemon-run-clean-break.md` | **Update examples** only | Error and dispatch cleanup unaffected. |
| `apps/README.md` | **Rewrite** the `blocks/` section | `blocks/` goes away as the public install unit. First-party apps become copyable workspace app packages. |
| `packages/cli/README.md` | **Rewrite** config, app install, and route naming sections | Replace `epicenter.config.ts` route examples with `workspaces/<route>/daemon.ts`, plus the app build flow. |
| `docs/scripting.md` | **Update discovery language** | `findEpicenterDir` discovers `.epicenter/` OR `workspaces/`. CLI, script, and local automation `/run` semantics stay unchanged. |
| `jsrepo.config.ts` | **Rewrite registry items** | Each first-party app contributes one `workspaces/<app>` block that copies the full workspace app package. |

Older specs are not marked superseded until the new discovery path, static app serving, and config removal land.

## Project Shape

### Before

```
Project/
  epicenter.config.ts
    imports app helpers
    lists daemon routes

  .epicenter/
    yjs/<workspaceId>.db
    sqlite/<workspaceId>.db
    md/<workspaceId>/

  no workspaces/ directory
```

First-party app source and copied daemon files live in different places:

```
apps/fuji/
  src/                         SPA source
  blocks/
    workspace.ts               schema and actions
    daemon-route.ts            daemon recipe
```

### After

```
Project/
  workspaces/
    fuji/
      package.json             deps, scripts, optional package exports
      daemon.ts                required daemon runtime entrypoint
      workspace.ts             shared schema, IDs, action factory
      src/                     optional SPA source
      static/                  optional SPA assets
      svelte.config.js         optional SPA build config
      vite.config.ts           optional SPA build config
      build/                   generated static SPA, ignored by source control

    opensidian/
      package.json
      daemon.ts
      workspace.ts
      src/
      static/
      build/

  .epicenter/
    yjs/<workspaceId>.db
    sqlite/<workspaceId>.db
    md/<workspaceId>/
```

The route is the folder name, for example `fuji` or `opensidian`. The `<workspaceId>` keying on-disk materializers is the Y.Doc guid declared by `workspace.ts`. These strings stay deliberately separate.

```
folder name:
  "fuji"
  CLI route and HTTP app route

workspace id:
  "epicenter.fuji"
  persistence and sync identity

package name:
  package manager metadata only
  never the daemon route
```

Renaming `workspaces/fuji` to `workspaces/blog` renames the local route. Changing `FUJI_WORKSPACE_ID` changes persisted storage and sync compatibility.

## Entrypoint Decision

`daemon.ts` stays as the daemon entrypoint. `package.json` stays as package metadata.

```
daemon.ts owns:
  open(ctx)
  daemon-only imports
  materializers
  daemon actions
  cleanup

package.json owns:
  dependencies
  scripts
  package manager metadata
  optional package exports

workspace.ts owns:
  Y.Doc guid
  table and kv schemas
  branded IDs
  action factory
  exported action types

src/ owns:
  browser UI
  route-local components
  browser workspace opening
```

Why not `package.json` as the daemon entrypoint?

```
Option:
  package.json has "epicenter": { "daemon": "./src/daemon.ts" }

Cost:
  another manifest shape
  another path that can drift
  daemon must parse package metadata before it can find runtime code
  package metadata starts owning a runtime invariant

Decision:
  refuse for now
```

The fixed root file is easier to teach:

```
The daemon imports workspaces/<route>/daemon.ts.
The folder name is the route.
That is the whole discovery contract.
```

If a future real app needs a non-root daemon entrypoint, add it later as a deliberate manifest feature. Do not pay for that flexibility before there is a caller.

## Workspace App Contract

```
workspaces/<route>/
  package.json          optional for headless workspaces, expected for SPA apps
  daemon.ts             required
  workspace.ts          conventional and strongly recommended
  src/                  optional SPA source
  static/               optional SPA assets
  build/                generated static SPA output, served if index.html exists
  README.md             optional
  tests/                optional
```

The daemon imports only `daemon.ts` during runtime startup. The daemon does not import `src/`, does not run build tools, and does not inspect app components.

`workspace.ts` is shared source. It must stay browser-safe because the SPA can import it. It owns the app's data contract and the shared workspace attachment, not browser storage and not daemon services.

```ts
// workspaces/fuji/workspace.ts
import { attachRichText, DateTimeString, docGuid } from '@epicenter/workspace';
import * as Y from 'yjs';

export const FUJI_WORKSPACE_ID = 'epicenter.fuji';
export const fujiTables = { entries: entriesTable };

export function openFujiWorkspace(
  owner: Pick<LocalOwner, 'attachEncryption'>,
  options: { clientId?: number } = {},
) {
  const ydoc = createFujiYdoc();
  if (options.clientId !== undefined) {
    ydoc.clientID = options.clientId;
  }
  return attachFujiWorkspace(ydoc, owner);
}

export function entryContentDocGuid({
  workspaceId,
  entryId,
}: {
  workspaceId: string;
  entryId: EntryId;
}) {
  return docGuid({
    workspaceId,
    collection: 'entries',
    rowId: entryId,
    field: 'content',
  });
}

export function createFujiDaemonActions(workspace: FujiWorkspace) {
  return defineActions({
    entries_import_from_disk: defineMutation({
      // daemon-owned local automation
    }),
  });
}

export type FujiWorkspace = ReturnType<typeof openFujiWorkspace>;
export type FujiDaemonActions = ReturnType<typeof createFujiDaemonActions>;

function createFujiYdoc() {
  return new Y.Doc({ guid: FUJI_WORKSPACE_ID, gc: false });
}

function attachFujiWorkspace(
  ydoc: Y.Doc,
  owner: Pick<LocalOwner, 'attachEncryption'>,
) {
  const encryption = owner.attachEncryption(ydoc);
  const tables = encryption.attachTables(fujiTables);
  const kv = encryption.attachKv({});

  return {
    ydoc,
    encryption,
    tables,
    kv,
    batch: (fn: () => void) => ydoc.transact(fn),
    touchEntry(entryId: EntryId) {
      tables.entries.update(entryId, {
        updatedAt: DateTimeString.now(),
      });
    },
    openEntryContentDoc(entryId: EntryId) {
      const contentYdoc = new Y.Doc({
        guid: entryContentDocGuid({ workspaceId: ydoc.guid, entryId }),
        gc: false,
      });
      return {
        ydoc: contentYdoc,
        body: attachRichText(contentYdoc),
      };
    },
  };
}
```

`daemon.ts` wires that shared workspace attachment into long-lived daemon resources.

```ts
// workspaces/fuji/daemon.ts
import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import {
  defineDaemonWorkspace,
  openCollaboration,
  roomWsUrl,
} from '@epicenter/workspace';
import {
  attachMarkdownMaterializer,
  slugFilename,
} from '@epicenter/workspace/document/materializer/markdown';
import { attachSqliteMaterializer } from '@epicenter/workspace/document/materializer/sqlite';
import {
  attachYjsLog,
  hashClientId,
  markdownPath,
  openWriterSqlite,
  sqlitePath,
  yjsPath,
} from '@epicenter/workspace/node';
import {
  createFujiDaemonActions,
  openFujiWorkspace,
} from './workspace.js';

export default defineDaemonWorkspace({
  async open({ auth, projectDir, route, logger }) {
    if (auth.state.status === 'signed-out') {
      throw new Error(`[${route}] auth signed-out at start`);
    }

    const owner = createDaemonWorkspaceOwner({ auth, route });
    const workspace = openFujiWorkspace(owner, {
      clientId: hashClientId(projectDir),
    });
    const actions = createFujiDaemonActions(workspace);

    const yjsLog = attachYjsLog(workspace.ydoc, {
      filePath: yjsPath(projectDir, workspace.ydoc.guid),
    });

    const collaboration = openCollaboration(workspace.ydoc, {
      url: roomWsUrl(EPICENTER_API_URL, workspace.ydoc.guid),
      openWebSocket: auth.openWebSocket,
      replicaId: `${route}-daemon`,
      actions,
    });

    const sqliteDb = openWriterSqlite({
      filePath: sqlitePath(projectDir, workspace.ydoc.guid),
      log: logger.child('sqlite'),
    });
    workspace.ydoc.once('destroy', () => sqliteDb.close());

    attachSqliteMaterializer(workspace.ydoc, { db: sqliteDb }).table(
      workspace.tables.entries,
    );
    attachMarkdownMaterializer(workspace.ydoc, {
      dir: markdownPath(projectDir, workspace.ydoc.guid),
    }).table(workspace.tables.entries, {
      filename: slugFilename('title'),
    });

    return {
      collaboration,
      yjsLog,
      async [Symbol.asyncDispose]() {
        workspace.ydoc.destroy();
        await Promise.all([collaboration.whenDisposed, yjsLog.whenDisposed]);
      },
    };
  },
});
```

SPA source should import the local contract through a route-agnostic local alias, not through a hard-coded package name.

```ts
// workspaces/fuji/src/routes/fuji/browser.ts
import {
  openFujiWorkspace,
} from '$workspace';
```

The browser composes browser-only attachments around the same core.

```ts
// workspaces/fuji/src/routes/fuji/browser.ts
export function openFujiBrowser({ owner, replicaId, openWebSocket }) {
  const workspace = openFujiWorkspace(owner);

  const idb = owner.attachIndexedDb(workspace.ydoc);
  owner.attachBroadcastChannel(workspace.ydoc);

  const collaboration = openCollaboration(workspace.ydoc, {
    waitFor: idb.whenLoaded,
    openWebSocket,
    replicaId,
    actions: {},
  });

  return {
    ...workspace,
    idb,
    collaboration,
    async wipe() {
      workspace.ydoc.destroy();
      await Promise.all([idb.whenDisposed, collaboration.whenDisposed]);
      await owner.wipeLocalYjsData([workspace.ydoc.guid]);
    },
    [Symbol.dispose]() {
      workspace.ydoc.destroy();
    },
  };
}
```

The core rule:

```txt
openFujiWorkspace:
  canonical Y.Doc, browser-safe data model, and domain helpers

openFujiBrowser:
  browser storage, BroadcastChannel, browser sync, browser wipe

daemon.ts:
  daemon doc configuration, Yjs log, SQLite, Markdown, jobs, CLI/script actions
```

The template config owns that alias:

```js
// workspaces/fuji/svelte.config.js
const config = {
  kit: {
    adapter: staticAdapter({
      fallback: 'index.html',
    }),
    alias: {
      $workspace: './workspace.ts',
    },
  },
};
```

## Static SPA Contract

The daemon serves built workspace apps, not source apps.

```
workspaces/fuji/build/index.html exists:
  serve /apps/fuji/

workspaces/fuji/build/index.html missing:
  daemon runtime still opens
  /apps/fuji/ returns a normal not found response
```

The SPA must not need runtime route injection to boot. Browser-safe workspace identity comes from `workspace.ts`; static asset and navigation paths should be relative to the served document or configured by the app's build tool.

Workspace app templates must build as relocatable static apps. Asset paths should work under `/apps/<route>/`, not only at `/`. The base path is a static serving concern, not a daemon-provided browser API.

### Browser Apps Do Not Use `/run` By Default

Browser apps should use local browser-safe workspace state as their default write path. The daemon still serves the built bundle at `/apps/<route>/`, but the SPA mutates local Yjs/workspace data directly.

```txt
GET /apps/fuji/
  -> serve built SPA
  -> SPA opens browser-safe workspace state
  -> SPA mutates local Yjs/workspace data directly
  -> daemon handles sync, materializers, persistence, and background work
```

`/run` remains part of the daemon for CLI commands, scripts, and local automation. It is not part of the browser SPA contract in v1. Browser-called daemon actions are deferred until a concrete app needs privileged effects.

The same-origin `/apps/<route>/` serving shape still matters. It gives the SPA a stable local origin and a route-derived base path without turning daemon actions into the browser's default mutation API.

### Trust And Capability Boundaries

Workspace apps are trusted local source packages, not sandboxed plugins. Installing source is a trust decision: the user is choosing to run editable local code in their project.

The manifest, when one exists, is for consent and audit. It should explain what the app expects, but it does not create a sandbox.

The Tauri bridge is the native capability boundary. The daemon is the local workspace runtime: sync, materializers, persistence, background jobs, and long-lived services live there.

Native desktop capabilities are not installed by copying TypeScript source. A source-installed SPA cannot add new Rust, Tauri, or native host capabilities to an already-built desktop binary. Whispering-style capabilities such as CPAL recording, tray, global shortcuts, updater, process/shell, and OS permissions must already exist in the host binary and be explicitly granted to that window or app.

## Development And Production Modes

There are two loops:

```
development:
  run the daemon for auth, sync, materializers, persistence, and services
  run the workspace app's Vite dev server for source UI iteration
  the dev server serves the same source app

production or installed local use:
  build the workspace app into workspaces/<route>/build/
  run the daemon
  the daemon serves /apps/<route>/ from the built files
```

The daemon should not become a Vite supervisor. It owns long-lived workspace runtimes and static serving. The app package owns source serving, HMR, TypeScript diagnostics, and browser UI build tooling.

Recommended first implementation:

```bash
# terminal 1
epicenter daemon up

# terminal 2
cd workspaces/fuji
bun run dev
```

Dev and production should differ only in who serves the static files. The browser app should not fetch a daemon-provided boot document before it can start.

Testing should cover both loops:

```
unit:
  workspace.ts action factories and schema helpers
  daemon.ts open failure and disposal behavior
  static app serving from build/

integration:
  start daemon with a fixture workspaces/fuji/
  call epicenter run fuji.action_key
  request /apps/fuji/

browser dev smoke:
  start daemon
  start bun run dev in workspaces/fuji
  verify the Vite-served UI opens browser-safe workspace state

browser production smoke:
  bun run build in workspaces/fuji
  start daemon
  verify /apps/fuji/ loads and opens browser-safe workspace state
```

This makes development possible without teaching the daemon about source apps, and makes production boring: production is static files plus the already-running local workspace runtime.

## Architecture

### Discovery flow

```
projectDir
  |
  v
discoverWorkspaceApps(projectDir)
  scans <projectDir>/workspaces/*
  skips dotfile folders
  validates folder names
  rejects case-insensitive route collisions
  |
  v
WorkspaceAppEntry[]
  route
  workspaceDir
  daemonEntryPath
  appBuildDir
```

Discovery is not daemon-only anymore. Both daemon startup and app build commands use it. The returned entry is internal execution metadata: it gives callers the paths they need after the route has already been derived from the folder name.

```
route:
  folder-derived route name
  public routing identity

workspaceDir:
  app package root
  cwd for build commands and base for relative paths

daemonEntryPath:
  resolved workspaces/<route>/daemon.ts path
  the daemon startup import target

appBuildDir:
  resolved workspaces/<route>/build path
  served only when index.html exists
```

`package.json` is deliberately not part of the base discovery entry. Build commands may read `<workspaceDir>/package.json` when they need scripts or package manager metadata, but package metadata does not define the route, daemon entrypoint, or static app serving path.

### Daemon startup flow

```
projectDir
  |
  v
discoverWorkspaceApps(projectDir)
  |
  v
create shared auth client
  |
  v
for each app in parallel:
  import daemon.ts
  validate default export has open()
  await module.open({ projectDir, workspaceDir, route, auth, logger })
  |
  v
startDaemonServer({
  lease,
  routes,
  staticApps
})
```

`/list`, `/peers`, `/run`, presence, RPC, dispatch, and CLI rendering keep their current behavior after startup.

### Runtime flow

```
CLI, script, and local automation only:

epicenter run fuji.entries_update '{"id":"..."}'
  |
  v
POST /run { actionPath: 'fuji.entries_update', input }
  |
  v
parseDaemonActionPath
  routeName = 'fuji'
  localPath = 'entries_update'
  |
  v
find runtime for route 'fuji'
  |
  v
invoke actions.entries_update(input)
```

### SPA serving flow

```
GET /apps/fuji/
  |
  v
serve workspaces/fuji/build/index.html
  |
  v
SPA opens browser-safe workspace state
  |
  v
SPA mutates local Yjs/workspace data directly
  |
  v
daemon handles sync, materializers, persistence, background jobs, and services
```

## Ownership Table

```
folder name         owns  route
workspaces/         owns  project app discovery
package.json        owns  dependencies and build scripts
daemon.ts           owns  daemon open(ctx) runtime
workspace.ts        owns  Y.Doc guid, schemas, open<App>Workspace, action factory
src/                owns  SPA source
build/              owns  generated static SPA files
daemon process      owns  auth, socket, startup, shutdown, static serving
.epicenter/ files   keyed by projectDir and ydoc.guid
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Install unit | 2 coherence | One folder under `workspaces/<route>/` | The user installs, edits, builds, and runs one local app package. |
| Route ownership | 2 coherence | Folder name under `workspaces/` | One source of truth. Deletes config aliases. |
| Package manifest | 2 coherence | `package.json` owns deps and scripts only | Package metadata should not own the daemon route or runtime entrypoint. |
| Daemon entrypoint | 2 coherence | Root `daemon.ts` | The daemon has one predictable module to import. No manifest path lookup required. |
| Shared contract | 2 coherence | Root `workspace.ts` | Daemon, SPA, scripts, and tests can share schemas and action types without importing Node-only runtime wiring. |
| Shared workspace opener | 2 coherence | `open<App>Workspace(owner)` in `workspace.ts` | The app's canonical Y.Doc, browser-safe encrypted tables, kv, and domain helpers are composed once, then browser and daemon layers add their own runtime attachments. Private create/attach helpers can sit below the exported opener. |
| SPA source | 3 taste | Root `src/` beside `daemon.ts` and `workspace.ts` | Matches common TypeScript app layout and avoids a nested package inside the workspace package. |
| Build output | 3 taste | `build/` | Matches SvelteKit adapter-static defaults in first-party apps. Future non-Svelte support can add an explicit build-dir contract if needed. |
| Discovery metadata | 2 coherence | `{ route, workspaceDir, daemonEntryPath, appBuildDir }` | One scan resolves the execution paths daemon startup, static serving, and app build commands need. Package metadata stays outside the route contract. |
| Browser boot endpoint | 2 coherence | Refuse for v1 | Browser apps do not need a daemon-provided endpoint to boot. `workspace.ts` owns browser-safe workspace identity, and relative/static build paths handle the serving base. Add one later only for a concrete browser API need. |
| Static app route | 2 coherence | `/apps/<route>/` | Keeps app UI routes away from daemon API routes. |
| Browser writes | 2 coherence | Browser-safe workspace state first | Browser apps mutate local Yjs/workspace data directly. Browser-called daemon actions wait until a concrete app needs privileged effects. |
| `/run` ownership | 2 coherence | CLI, scripts, and local automation | Preserve the daemon and CLI `/run` behavior without making it the default browser SPA write path. |
| Capability boundary | 2 coherence | Host binary owns native capabilities | Source-installed SPAs cannot add Rust, Tauri, or native capabilities. The host must already ship and grant them. |
| Build execution | 2 coherence | Explicit command, not `daemon up` | Startup should open and serve already-built local apps. It should not install dependencies or run package scripts implicitly. |
| Custom route aliases | 2 coherence | Refuse | `mv workspaces/fuji workspaces/daily` is the alias. |
| Hyphenated folders | 2 coherence | Allowed | Existing route validation accepts `[A-Za-z0-9][A-Za-z0-9_-]*`. |
| Nested workspace folders | Deferred | Single level: `workspaces/*` | Avoid recursive discovery until a real user needs it. |
| Dotfile folders | 3 taste | Skip silently | Lets users keep `.archive/` or editor folders under `workspaces/`. |
| Case-insensitive collisions | 2 coherence | Reject before startup | APFS and NTFS can conflate `Fuji` and `fuji`. Discovery should produce a structured error. |
| jsrepo packaging | 2 coherence | One block per first-party app package | Copies the whole app package instead of two daemon fragments. |
| First-party app roots | 2 coherence | `apps/<app>/` becomes the canonical template source | The same folder powers monorepo development and consumer installation. No duplicated `workspace-template/`. |

## What Collapses

```
Before
  epicenter.config.ts
    daemon.routes = [...]

  apps/fuji/
    src/
    blocks/
      workspace.ts
      daemon-route.ts

  jsrepo copies:
    epicenter/fuji/workspace
    epicenter/fuji/daemon-route

After
  workspaces/fuji/
    package.json
    daemon.ts
    workspace.ts
    src/
    static/
    build/

  jsrepo copies:
    workspaces/fuji
```

Code families expected to disappear:

```
packages/cli/src/load-config.ts
  loadDaemonConfig
  startDaemonRoutes
  DaemonConfigError variants tied to config exports
  route definition duck typing

packages/workspace/src/daemon/types.ts
  EpicenterConfig
  DaemonRouteDefinition
  defineConfig

apps/<app>/blocks/
  split install fragments
  define<App>Daemon({ route }) factories
```

## Implementation Plan

### Phase 1: Land workspace app discovery and daemon entrypoints

- [ ] **1.1** Add `DaemonWorkspaceModule`, `DaemonWorkspaceContext`, and `defineDaemonWorkspace` to `packages/workspace/src/daemon/define-daemon-workspace.ts`; export from `daemon/index.ts`.
- [ ] **1.2** Add `discoverWorkspaceApps(projectDir)` under `packages/workspace/src/workspace-apps/`. It scans `<projectDir>/workspaces/*`, skips dotfile folders, validates route names, rejects case-insensitive collisions, requires `daemon.ts`, and returns `{ route, workspaceDir, daemonEntryPath, appBuildDir }[]`.
- [ ] **1.3** Add `startDaemonWorkspaceApps({ projectDir, auth, logger })`. It imports each `daemon.ts`, validates the default export has `open`, runs opens in parallel, disposes opened runtimes if any app fails, and hands `{ route, runtime }[]` plus `{ route, appBuildDir }[]` to `startDaemonServer`.
- [ ] **1.4** Add structured errors with `defineErrors`: `WorkspaceFolderInvalid`, `WorkspaceFolderCollision`, `WorkspaceDaemonMissing`, `WorkspaceDaemonInvalidExport`, `WorkspaceOpenFailed`.
- [ ] **1.5** Keep `buildDaemonApp`, `/run`, `/list`, `/peers`, dispatch, and runtime action invocation behavior unchanged.

### Phase 2: Serve built workspace SPAs

- [ ] **2.1** Extend the daemon server to serve `/apps/<route>/` from `<workspaceDir>/build/` when `build/index.html` exists.
- [ ] **2.2** Add static serving tests: index route, nested SPA fallback, missing build directory, and static asset.
- [ ] **2.3** Add a smoke fixture where a built app under `workspaces/fuji/build/` loads under `/apps/fuji/`.
- [ ] **2.4** Add an explicit CLI command, likely `epicenter app build [route]`, that runs `bun run build` with cwd set to the workspace app folder. It should never run during `daemon up`.
- [ ] **2.5** Defer browser `/run` wiring. Do not add generated browser action clients, default `connectDaemonActions` setup, a browser daemon action endpoint, or a daemon-provided browser boot endpoint in v1.

### Phase 3: Convert first-party apps into workspace app packages

- [x] **3.1** Create the minimal Fuji reproduction first. Move `apps/fuji/blocks/workspace.ts` to `apps/fuji/workspace.ts` and add `openFujiWorkspace(owner)` as the public opener.
- [x] **3.2** Keep `createFujiYdoc` and `attachFujiWorkspace` as private helpers below the exported opener unless a concrete caller needs the lower-level escape hatch.
- [x] **3.3** Refactor `openFujiBrowser` to call `openFujiWorkspace`, then add only browser attachments: IndexedDB, BroadcastChannel, browser collaboration, and wipe. **Deviation:** browser collaboration still gets `actions: createFujiActions(tables)` because Fuji's UI components call `fuji.collaboration.actions.entries_*` for local writes. These are local action handlers, not daemon RPC. Browser code does not import `connectDaemonActions` and does not use `runPath`. Migrating components to call `tables.entries.*` directly is deferred to a follow-up wave so Wave 1 stays scoped to the opener boundary.
- [x] **3.4** Move `apps/fuji/blocks/daemon-route.ts` to `apps/fuji/daemon.ts`. **Deviation:** kept the existing `DaemonRouteDefinition` shape (`{ route, start({ auth, projectDir }) }`) instead of switching to `defineDaemonWorkspace({ open })` because Phase 1.1 (which adds `defineDaemonWorkspace`) has not landed yet. The composition is right: `daemon.ts` builds a tiny owner adapter, calls `openFujiWorkspace(owner, { clientId: hashClientId(projectDir) })`, then attaches Yjs log, collaboration, SQLite, and Markdown around `workspace.ydoc`.
- [ ] **3.5** Update Fuji SPA imports to use a local `$workspace` alias instead of importing from `@epicenter/fuji` when source lives inside the app package.
- [x] **3.6** Update `apps/fuji/package.json` so the package root export points to `./workspace.ts`, scripts remain Bun/Vite based, and no route metadata is added.
- [x] **3.7** Add `apps/fuji/architecture.test.ts` to lock the boundary: `workspace.ts` exports `openFujiWorkspace`, does not export `createFujiYdoc` or `attachFujiWorkspace`, browser code calls `openFujiWorkspace`, browser code does not construct the root Fuji Y.Doc directly, browser code does not call `connectDaemonActions`, and daemon code passes `{ clientId: hashClientId(projectDir) }`.
- [x] **3.8** Add behavior tests for `openFujiWorkspace`: it creates a Y.Doc with `FUJI_WORKSPACE_ID`, applies an optional `clientId`, attaches Fuji tables/kv, and exposes browser-safe domain helpers.
- [ ] **3.9** Add a Fuji smoke path that proves the same root workspace opener works in both places: browser can create/update an entry through local workspace state, and CLI can still call a daemon `/run` action.
- [ ] **3.10** Repeat for `honeycrisp`, `opensidian`, and `zhongwen` after Fuji proves the pattern. `tab-manager` stays separate because it has no daemon workspace today.
- [ ] **3.11** Update first-party static builds to be relocatable under `/apps/<route>/`. Add a build-and-serve smoke test for at least Fuji.

### Fuji Architecture Lock

Fuji gets one source-shape test because this boundary is architectural, not just behavioral. The test can read source files directly.

```ts
// apps/fuji/architecture.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const workspaceSource = readFileSync('workspace.ts', 'utf8');
const browserSource = readFileSync(
  'src/routes/(signed-in)/fuji/browser.ts',
  'utf8',
);
const daemonSource = readFileSync('daemon.ts', 'utf8');

describe('Fuji workspace architecture', () => {
  test('workspace.ts owns the shared opener', () => {
    expect(workspaceSource).toContain('export function openFujiWorkspace');
    expect(workspaceSource).not.toContain('export function createFujiYdoc');
    expect(workspaceSource).not.toContain('export function attachFujiWorkspace');
  });

  test('browser composes browser runtime around the shared opener', () => {
    expect(browserSource).toContain('openFujiWorkspace');
    expect(browserSource).not.toContain(
      'new Y.Doc({ guid: FUJI_WORKSPACE_ID',
    );
    expect(browserSource).not.toContain('connectDaemonActions');
    expect(browserSource).not.toContain('runPath');
  });

  test('daemon composes daemon runtime around the shared opener', () => {
    expect(daemonSource).toContain('openFujiWorkspace');
    expect(daemonSource).toContain('clientId: hashClientId(projectDir)');
    expect(daemonSource).toContain('attachYjsLog');
    expect(daemonSource).toContain('attachSqliteMaterializer');
    expect(daemonSource).toContain('attachMarkdownMaterializer');
  });
});
```

The source-shape test is deliberately narrow. It protects the v1 boundary without pretending to validate all runtime behavior.

### Phase 4: Rewrite jsrepo packaging

> **Known broken until this phase lands.** Wave 1 deleted `apps/fuji/blocks/`
> as part of moving the install unit to the app root. `jsrepo.config.ts` still
> declares `epicenter/fuji/workspace` and `epicenter/fuji/daemon-route` at the
> old paths, so `bun x jsrepo build` fails with "File not found" for the Fuji
> entries. This is intentional: Fuji is the template, the per-fragment registry
> shape is being replaced, and patching the old paths would lock in a layout
> that 4.1 deletes a few PRs later. Honeycrisp, Opensidian, and Zhongwen
> entries still build because their `blocks/` folders have not been moved yet.

- [ ] **4.1** Replace `BLOCKS = { app: ['workspace', 'daemon-route'] }` with one registry item per app: `workspaces/fuji`, `workspaces/honeycrisp`, `workspaces/opensidian`, `workspaces/zhongwen`.
- [ ] **4.2** Copy a curated whole-app allowlist: `package.json`, `daemon.ts`, `workspace.ts`, `src/**`, `static/**`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, and app-local config files needed to build.
- [ ] **4.3** Exclude generated and monorepo-only material: `node_modules`, `build`, `.svelte-kit`, test artifacts, and local caches.
- [ ] **4.4** Verify `bun x jsrepo build --dry-run` materializes `workspaces/fuji/` as one folder with SPA source and daemon entrypoint.

### Phase 5: Remove config-as-registry

- [ ] **5.1** Delete `packages/cli/src/load-config.ts` (`loadDaemonConfig`, `startDaemonRoutes`, `DaemonConfigError`, duck typers).
- [ ] **5.2** Delete `EpicenterConfig`, `DaemonRouteDefinition`, and `defineConfig` from daemon types and exports.
- [ ] **5.3** Update `packages/workspace/src/client/find-epicenter-dir.ts`: marker is now `.epicenter/` OR `workspaces/`.
- [ ] **5.4** Coordinate `CONFIG_FILENAME` removal across `findEpicenterDir`, `connectDaemonActions` JSDoc, and `paths.ts` metadata. Rename `configMtime` to `discoveredAt` if that metadata still exists.
- [ ] **5.5** Rewrite `packages/cli/README.md`, `apps/README.md`, and `docs/scripting.md`.
- [ ] **5.6** Add documentation that workspace apps are trusted local source packages, manifests are consent and audit records, the daemon is the local workspace runtime, and native desktop capabilities must already exist in the host binary.
- [ ] **5.7** Mark the specs listed above as superseded after the new path is working.

## Validation

```bash
# Type and unit tests pass without config loading.
bun test packages/workspace/src/workspace-apps
bun test packages/workspace/src/daemon
bun test packages/cli

# First-party apps still build as local packages.
bun --cwd apps/fuji run build
bun --cwd apps/honeycrisp run build
bun --cwd apps/opensidian run build
bun --cwd apps/zhongwen run build

# Minimal Fuji reproduction proves the composition shape.
bun --cwd apps/fuji test
bun --cwd apps/fuji run build
epicenter daemon up
epicenter run fuji.entries_import_from_disk '{}'

# Fuji architecture boundary stays locked.
rg "export function openFujiWorkspace" apps/fuji/workspace.ts
rg "openFujiWorkspace" 'apps/fuji/src/routes/(signed-in)/fuji/browser.ts'
rg "clientId: hashClientId\\(projectDir\\)" apps/fuji/daemon.ts
! rg "export function (createFujiYdoc|attachFujiWorkspace)" apps/fuji/workspace.ts
! rg "new Y\\.Doc\\(\\{ guid: FUJI_WORKSPACE_ID|connectDaemonActions|runPath" 'apps/fuji/src/routes/(signed-in)/fuji/browser.ts'

# No live daemon route config examples outside historical specs.
rg "defineConfig\\(\\{\\s*daemon|daemon:\\s*\\{\\s*routes" apps packages docs README.md

# No epicenter.config.ts references in live docs.
rg "epicenter\\.config\\.ts" apps packages docs README.md

# No old block install surface remains.
rg "daemon-route|workspace-template|apps/.*/blocks" apps packages docs README.md jsrepo.config.ts

# Workspace app entrypoints exist.
find apps -maxdepth 2 -name daemon.ts -print
find apps -maxdepth 2 -name workspace.ts -print

# jsrepo registry materializes whole app folders.
bun x jsrepo build --dry-run
```

## Open Questions

1. **Should the build output stay fixed to `build/`?**

   Recommendation: yes for the first implementation. SvelteKit adapter-static already uses `build/` in first-party apps. A future `package.json` field can support other build directories after a real non-Svelte workspace app needs it.

2. **Should Epicenter add `epicenter app install` or `epicenter app prepare`?**

   Recommendation: defer. Start with `epicenter app build [route]` and docs that tell users to run `bun install` in the workspace app folder or through their project root workspace setup. Installing dependencies is networked and should stay explicit.

3. **Should `package.json` ever own the daemon path?**

   Recommendation: not now. Root `daemon.ts` is the simple contract. Add a manifest field only if there is a concrete app that cannot put its daemon entrypoint at the root.

4. **Should apps support multiple installs of the same first-party app under different routes?**

   Recommendation: not as a default promise. Copying Fuji twice without changing `FUJI_WORKSPACE_ID` would point both routes at the same sync and persistence identity. Multiple instances require an explicit workspace id story first.

5. **Should `findEpicenterDir` prefer `workspaces/` over `.epicenter/`?**

   Recommendation: no. It should return the first ancestor with either marker. `.epicenter/` is runtime state; `workspaces/` is the developer-visible project marker.

6. **Should the daemon hot reload new workspace app folders?**

   Recommendation: defer. Restart the daemon after adding or removing app folders.

## Completion Checklist

- [ ] Daemon hosts workspaces from folders with no `epicenter.config.ts` present.
- [ ] Folder name is the only daemon route source.
- [ ] Root `daemon.ts` is the only required daemon runtime entrypoint.
- [ ] Root `workspace.ts` is browser-safe and shared by daemon, SPA, scripts, and tests.
- [ ] Root `workspace.ts` exposes `open<App>Workspace(owner)` as the shared composition core.
- [ ] Browser and daemon open the same app workspace through the shared opener.
- [ ] Fuji has architecture tests that lock the shared opener boundary.
- [ ] Fuji has behavior tests for canonical Y.Doc creation, optional `clientId`, and browser-safe workspace helpers.
- [ ] Built SPAs are served under `/apps/<route>/`.
- [ ] Browser apps mutate browser-safe workspace state directly.
- [ ] Browser-called daemon actions are deferred.
- [ ] CLI/script `/run` behavior remains unchanged.
- [ ] `/list`, `/run`, `/peers`, dispatch, presence behavior unchanged after startup.
- [ ] Trusted source and native capability boundaries are documented.
- [ ] `defineConfig`, `DaemonRouteDefinition`, and `loadDaemonConfig` are deleted.
- [ ] `apps/<app>/blocks/` no longer exists as a public install surface.
- [ ] jsrepo copies each first-party workspace app as one folder.
- [ ] CLI README, apps README, and scripting docs teach `workspaces/<route>/daemon.ts` and the app build flow.
- [ ] Specs listed in the supersession table are marked Superseded once Phase 5 lands.
