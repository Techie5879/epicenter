# Project Folders And Control Plane Vision

**Date**: 2026-05-27
**Status**: Draft
**Owner**: Braden

## One Sentence

Epicenter should treat a project folder as the default local boundary, with one daemon process per project, one usual route per project, and an optional control plane app that orchestrates those projects without absorbing their data.

## How To Read This

Read first:

```txt
One Sentence
Current State
Target Shape
Naming Model
Control Plane
Open Questions
```

This is a working vision, not an implementation spec. It records the current system, the direction that feels simpler, and the questions still worth keeping open.

## Current State

The repo already has three related layers:

```txt
app package
  apps/fuji
  apps/honeycrisp
  apps/opensidian

project folder
  examples/fuji
  playground/opensidian-e2e
  user-created folders later

daemon host
  packages/cli
  packages/workspace/src/daemon
```

Fuji is the clearest current package example:

```txt
apps/fuji/
|- src/lib/workspace.ts    createFujiWorkspace()
|- src/lib/browser.ts      openFujiBrowser()
|- daemon.ts               openFujiDaemon()
`- package.json            package exports
```

The canonical project example is `examples/fuji/epicenter.config.ts`:

```txt
examples/fuji/
|- epicenter.config.ts
|- entries/
|  |- hello-fuji.md
|  `- welcome.md
`- .epicenter/
   |- yjs/
   |- sqlite.db
   `- log/
```

That project default-exports a `Mount[]`. The Fuji mount carries the route name itself.

```txt
examples/fuji
  default export: [fuji({ markdownDir: '.', sqliteFile: '.epicenter/sqlite.db' })]
  mount name: fuji
```

Multi-mount projects add more entries to the array:

```ts
export default [fuji(), opensidian()];
```

That is useful, but it should not be the first mental model.

## Target Shape

The blessed default should be:

```txt
one folder = one local project
one project = one daemon process
one project = usually one route
one route = one app workspace mount
```

Default project:

```txt
~/Fooie/
|- epicenter.config.ts
|- content-or-data-files/
`- .epicenter/
   |- yjs/
   |  `- epicenter.fooie.db
   |- sqlite/
   |  `- epicenter.fooie.db
   |- md/
   |  `- epicenter.fooie/
   `- log/
```

Runtime flow:

```txt
desktop app or browser app
  edits Y.Doc
        |
        v
Epicenter sync room
        |
        v
project daemon
        |
        +-- Yjs update log
        +-- SQLite materializer
        +-- markdown or file materializer
        `-- route actions for scripts and CLI
```

The escape hatch remains:

```txt
one folder = one local project
one project = one daemon process
one project = many routes
```

Use that when the routes truly share one local working set. Do not make it the default concept.

## What `workspaces/` Means

`workspaces/` is a project-local source layout convention. It is not a registry, not a discovery mechanism, and not required.

Small project:

```txt
~/Fooie/
`- epicenter.config.ts
```

The config imports the package mount factory directly:

```ts
import { fooie } from "@epicenter/fooie/project";

export default [fooie()];
```

Customized project:

```txt
~/Fooie/
|- epicenter.config.ts
`- workspaces/
   `- fooie/
      `- daemon.ts
```

Use `workspaces/fooie/daemon.ts` when this project needs custom materializer paths, custom actions, custom markdown shape, import behavior, or other local composition. It is not the workspace itself. It is the project's local daemon recipe.

## Naming Model

The current names mostly have a useful split:

```txt
create* = construct a plain local object
open*   = attach runtime resources
attach* = attach one side-effectful primitive to an existing object
```

Workspace package layer:

```txt
createWorkspace()
  returns { ydoc, tables, kv, actions, dispose }
  no browser, no daemon, no socket, no materializer
```

App package layer:

```txt
createFujiWorkspace()
  wraps createWorkspace({
    id: FUJI_ID,
    tables: fujiTables,
    kv,
    keyring,
  })

createFujiActions()
  builds action registry over the workspace bundle

entryContentDocGuid()
  names child docs deterministically
```

Runtime layer:

```txt
openFujiBrowser()
  createFujiWorkspace()
  attachLocalStorage()
  openCollaboration()
  createDisposableCache(child docs)

openFujiDaemon()
  createFujiWorkspace()
  attachBunSqliteMaterializer()
  attachMarkdownMaterializer()
  attachDaemonInfrastructure()
```

The standard should be:

| Prefix             | Meaning                                                   | Examples                                                    |
| ------------------ | --------------------------------------------------------- | ----------------------------------------------------------- |
| `create*Workspace` | Build the app's isomorphic Y.Doc bundle                   | `createFujiWorkspace`, `createHoneycrispWorkspace`          |
| `create*Actions`   | Build app actions over a workspace bundle                 | `createFujiActions`                                         |
| `open*Browser`     | Create the workspace and attach browser runtime resources | `openFujiBrowser`                                           |
| `open*Daemon`      | Create the workspace and attach daemon runtime resources  | `openFujiDaemon`                                            |
| `open*Script`      | Create a one-shot Bun or Node script runtime              | Proposed                                                    |
| `attach*`          | Attach one primitive to an existing doc or workspace      | `attachBunSqliteMaterializer`, `attachDaemonInfrastructure` |

This gives a simple rule:

```txt
create = object construction
open = runtime lifecycle
attach = one side-effectful layer
```

## Composition Stack

Current Fuji stack:

```txt
createWorkspace()
        ^
        |
createFujiWorkspace()
        ^
        |
openFujiBrowser()                 openFujiDaemon()
  attachLocalStorage()              attachBunSqliteMaterializer()
  openCollaboration()               attachMarkdownMaterializer()
  child content docs                attachDaemonInfrastructure()
```

Daemon infrastructure hides the common daemon substrate:

```txt
attachDaemonInfrastructure(ydoc, ctx)
        |
        +-- attachYjsLog(.epicenter/yjs/<guid>.db)
        +-- openCollaboration(roomWsUrl(ownerId, guid, deviceId))
        `-- dispose in the right order
```

That helper should stay low-level. App daemons still choose materializers and actions explicitly.

## Control Plane

The Epicenter control plane should be an orchestrator over project folders, not a replacement for project folders.

```txt
Epicenter control plane app
  remembers projects
        |
        +-- ~/Fooie
        +-- ~/Blog
        `-- ~/Research
```

For each project, it can:

```txt
read epicenter.config.ts
start daemon up
stop daemon
show routes
show peers
list actions
run actions
open SQLite mirror
open markdown projection
run one-off scripts
show logs
```

The control plane owns a registry:

```ts
type ProjectReference = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
};
```

The project owns the data:

```txt
~/Fooie/.epicenter/
~/Blog/.epicenter/
~/Research/.epicenter/
```

Do not collapse those into one global control plane data directory. That would make project ownership harder to see and harder to delete.

## Scripts

Scripts should be project-scoped.

```txt
bun run scripts/list.ts -C ~/Fooie
epicenter run fooie.search '{"query":"hello"}' -C ~/Fooie
```

Long-term, app packages should expose script runtimes next to daemon runtimes:

```txt
apps/fooie/
|- src/lib/workspace.ts
|- src/lib/browser.ts
|- daemon.ts
`- script.ts
```

The rule:

```txt
daemon.ts = long-lived writer and materializer runtime
script.ts = short-lived project reader or action runner
```

Scripts should not import daemon entrypoints directly. If a script and daemon need shared setup, extract the shared setup behind a smaller factory.

## Decisions So Far

| Decision                | Class       | Working choice                                                           | Rationale                                                                       |
| ----------------------- | ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Default project shape   | 2 coherence | One project folder, usually one route                                    | Local data has an obvious owner. Cleanup and debugging are easier.              |
| Multi-route support     | 2 coherence | Keep as escape hatch                                                     | Some real projects may need multiple app workspaces in one daemon process.      |
| `workspaces/` folder    | 3 taste     | Convention only                                                          | It organizes project-local daemon code, but config remains the source of truth. |
| Control plane ownership | 2 coherence | Control plane stores project references, not project data                | Project folders stay portable and inspectable.                                  |
| Naming                  | 2 coherence | `create` for construction, `open` for lifecycle, `attach` for primitives | This matches most current app code and clarifies where side effects enter.      |

## Open Questions

1. Should package daemons export a `Mount` factory directly, or export only `openFooieDaemon(ctx)` and let project configs wrap it?

   Current leaning: export the mount factory. Project configs should decide whether to pass options or add local customization.

2. Should single-mount projects ever derive the mount name from the folder basename?

   Current behavior does not do this. The mount factory carries the name. Folder-derived names are still a possible convenience, but they would make the address implicit.

3. Should `.epicenter/sqlite/<workspaceId>.db` stay the default, or should canonical single-workspace projects prefer `.epicenter/sqlite.db`?

   Current helpers use `<workspaceId>.db`. `examples/fuji` intentionally inlines `.epicenter/sqlite.db` to make the root project simpler.

4. Should markdown projections live under `.epicenter/md/<workspaceId>/` by default, or at a visible project path such as `entries/`?

   For cache-like projections, `.epicenter/md` is cleaner. For human-authored source files, visible project folders are better.

5. Should `open*Script` be a standard app package export?

   Current leaning: yes. It gives Bun scripts a first-class runtime without importing the daemon entrypoint.

6. Should the control plane run project daemons itself, or shell out to `epicenter daemon up -C <project>`?

   Current leaning: start with CLI/process orchestration. Move to direct library calls only if process control becomes too limiting.

## Suggested Next Spec

Write a follow-up implementation spec for a single app, probably Fooie or Fuji:

```txt
Goal:
  Make one project folder, one route, one script runtime feel first-class.

Scope:
  package daemon export
  package script export
  project config example
  docs for route name, workspace id, and local data paths
  one handoff test
```

That spec should decide whether the next concrete move is a new `examples/fooie`, a cleanup of `examples/fuji`, or a package export standard applied to Fuji and Honeycrisp first.
