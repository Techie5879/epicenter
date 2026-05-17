# Folder-Routed Daemon Extensions

**Date**: 2026-05-16
**Status**: Active
**Author**: Braden + AI-assisted
**Supersedes**: `20260516T130000-hosted-apps-with-optional-daemon-extensions.md`

## One Sentence

Every directory under `<projectDir>/workspaces/` is one daemon extension; its `daemon.ts` default export is opened on `epicenter daemon up`, and the daemon is a local extension host with no UI concerns.

## Vision

```txt
hosted UI (browser)           local core daemon              optional extensions
─────────────────             ──────────────────             ───────────────────
SvelteKit app on the web      one process per project        workspaces/<route>/
talks to local daemon over    owns auth, sync, encryption    daemon.ts is opened
IPC                           hosts extension routes         on `epicenter up`
```

The daemon **does not serve SPAs**, does not run a static file server, does not own anything UI-shaped. Hosted apps live on a CDN, an app server, or `localhost:5173`. The bridge between hosted UI and local daemon is a separate spec.

The daemon **does own local privileged work**: identity, encryption, Yjs persistence, sync, and any app-specific materializers/jobs that need a node runtime. Apps that need this contribute one folder under `workspaces/<route>/`.

## Path Convention

```txt
monorepo:
  apps/fuji/daemon.ts                canonical source, colocated with app
  apps/fuji/workspace.ts             shared workspace contract
  apps/fuji/src/                     SPA source (hosted externally)
  <repoRoot>/workspaces -> apps      one symlink, daemon discovery sees folders here

consumer (after jsrepo install):
  <projectDir>/workspaces/fuji/      one folder per installed extension
    daemon.ts                        required entrypoint
    workspace.ts                     shared schema/opener
    ...                              optional source, build, etc.
  <projectDir>/.epicenter/           runtime state (yjs/, sqlite/, md/)
```

The folder name is the route. Renaming the folder renames the route. Nothing else owns route identity.

## Daemon Extension Contract

```ts
// workspaces/fuji/daemon.ts
import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';

export default defineDaemonWorkspace({
  async open({ auth, projectDir, route, clientId, replicaId }) {
    // construct the long-lived workspace runtime
    // return a DaemonRuntime
  },
});
```

Context fields (final shape):

```txt
auth        machine auth client, host-owned, shared across extensions
projectDir  absolute resolved project root for path derivation
route       folder-derived route name for replicaIds, error messages, logger
clientId    deterministic Y.Doc clientID derived from projectDir
replicaId   route-derived collaboration replicaId, `${route}-daemon`
```

Refused fields and rationale:

```txt
workspaceDir   derivable from projectDir + route; no current caller
logger         daemons create their own; DI deferred until log sinks are real
```

The host calls `open(ctx)` exactly once per extension on `epicenter daemon up`. Failures dispose successfully opened siblings.

## What the Daemon Does

```txt
yes:
  discover workspaces/*/daemon.ts
  skip folders without daemon.ts
  validate folder names and reject collisions
  import each daemon.ts and call open(ctx) in parallel
  bind a unix socket
  serve /run, /list, /peers, /ping, /shutdown over IPC
  dispose every runtime on SIGINT/SIGTERM

no:
  serve /apps/<route>/ static files
  run app builds
  read epicenter.config.ts
  install dependencies
  hot reload new folders
```

## Refused Surfaces

These were considered and dropped:

```txt
epicenter.config.ts default-export    legacy; playground scripts may still
                                      run as standalone Bun processes,
                                      but the CLI does not consume it

daemon static SPA serving             /apps/<route>/ removed; hosted UI
                                      is served by whatever serves hosted UI

epicenter app build                   `cd workspaces/<route> && bun run build`
                                      is the same command in fewer characters

EPICENTER_APP_BASE                    only useful if the daemon served SPAs;
                                      it does not

workspaceDir in ctx                   redundant with projectDir + route

logger in ctx                         aspirational DI; daemons make their own
```

## Future Asymmetric Win

The current daemon contract is `open(ctx) → DaemonRuntime`. Fuji and Honeycrisp's `open()` is ~50 lines each, of which ~35 lines are identical boilerplate:

```ts
// every daemon does this
yjsLog at yjsPath(projectDir, guid)
collaboration with replicaId: `${route}-daemon`
sqlite db at sqlitePath, dispose on ydoc destroy
markdown materializer at markdownPath
Symbol.asyncDispose composition
```

The actually app-specific parts are: which workspace opener, which actions factory, which tables get sqlite/markdown materialization. A declarative successor contract could compress to:

```ts
export default defineDaemonExtension({
  openWorkspace: openFujiWorkspace,
  createActions: createFujiActions,
  materialize: {
    sqlite: (tables) => [tables.entries],
    markdown: (tables) => [{ table: tables.entries, filename: slugFilename('title') }],
  },
});
```

Not now. The current `open(ctx)` contract is the minimum surface that works; the declarative shape is a follow-up once a third or fourth daemon shows the same boilerplate.

## Deferred Migrations

Nothing remains deferred for the old config path.

Landed in this cleanup:

```txt
apps/opensidian/daemon.ts                  folder-routed daemon extension
apps/opensidian/workspace.ts               package-root shared opener
apps/zhongwen/daemon.ts                    folder-routed daemon extension
apps/zhongwen/workspace.ts                 package-root shared opener
playground/tab-manager-e2e/workspaces/     boots through folder discovery
playground/opensidian-e2e/workspaces/      boots through folder discovery
packages/cli/test/fixtures/inline-actions/ fixture moved under workspaces/demo
packages/cli/src/load-config.ts            deleted
@epicenter/workspace/daemon                no config registry exports
```

`epicenter daemon up` does not read `epicenter.config.ts`. Folders under
`workspaces/` without a `daemon.ts` are ignored, which lets this monorepo use a
single `workspaces -> apps` symlink even though not every app has a daemon
extension.

## Implementation Notes for This Round

### Daemon side

- `packages/workspace/src/daemon/define-daemon-workspace.ts`: drop `workspaceDir` and `logger` from `DaemonWorkspaceContext`; add host-owned `clientId` and `replicaId`.
- `packages/workspace/src/workspace-apps/`: restore `start-daemon-workspace-apps.ts` and the `WorkspaceOpenFailed` / `WorkspaceDaemonInvalidExport` errors, but drop `staticApps` and `appBuildDir` from the result shape and from `WorkspaceAppEntry`.
- `packages/workspace/src/daemon/static-app.ts` + test: deleted. The `buildDaemonApp` signature returns to `(runtimes, triggerShutdown)`.
- `packages/workspace/src/daemon/index.ts` and `node.ts`: drop static-app exports.

### CLI side

- `packages/cli/src/commands/up.ts`: load only from `workspaces/`. No `epicenter.config.ts` fallback. Folders without `daemon.ts` are ignored so monorepo `workspaces -> apps` works without forcing every app to expose a daemon.
- `packages/cli/src/commands/app.ts` + `app-build.ts` + test: deleted. CLI no longer registers `app` subcommand.
- `packages/cli/src/cli.ts`: drop `appCommand` registration.

### App side

- `apps/fuji/daemon.ts`: inline `createDaemonWorkspaceOwner`, use trimmed context.
- `apps/honeycrisp/daemon.ts`: inline `createDaemonWorkspaceOwner`, use trimmed context.
- `apps/fuji/svelte.config.js` and `apps/honeycrisp/svelte.config.js`: drop `EPICENTER_APP_BASE` config.

## Validation

```bash
bun test packages/workspace/src/daemon
bun test packages/workspace/src/workspace-apps
bun test apps/fuji
bun test apps/honeycrisp
bun test packages/cli  # up.test.ts cases on the config path will need rework
                       # or pre-existing-blocked marking; auth-session failures
                       # are environmental, not introduced here.
```

## Completion Checklist

- [x] Daemon discovers `workspaces/*/daemon.ts` and opens each on `up`
- [x] `DaemonWorkspaceContext = { auth, projectDir, route, clientId, replicaId }`
- [x] Fuji and Honeycrisp daemon.ts use the trimmed contract with inlined owner adapter
- [x] Daemon serves no `/apps/<route>/` static files
- [x] No `epicenter app build` command
- [x] No `EPICENTER_APP_BASE` in app svelte configs
- [x] `up.ts` no longer reads `epicenter.config.ts`
- [x] Legacy `defineConfig` / `DaemonRouteDefinition` exports are deleted from `@epicenter/workspace/daemon`
- [x] Deferred migrations are documented in this spec
