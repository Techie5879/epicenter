# Workspace Apps Audit

Scope: `packages/workspace/src/workspace-apps/**` after the move from folder discovery to `epicenter.config.ts` route registration.

Commit context: `git show --stat HEAD~1..HEAD` shows `373a4e0 refactor(workspace): collapse route discovery helper`, which removed `packages/workspace/src/workspace-apps/discover.ts` and its tests, updated CLI `up`, and kept `start-daemon-workspace-apps.ts` as the route startup path.

## Grep Results

No hits inside `packages/workspace/src/workspace-apps/**`:

```txt
daemonEntryPath
DAEMON_ENTRY_FILENAME
WorkspaceFolder
WorkspaceDaemonInvalidExport
folder-routed
discoverWorkspaceApps
folder discovery
folder-discovery
```

Remaining local wording hits:

```txt
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts:5
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts:57
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:72
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:110
packages/workspace/src/workspace-apps/errors.ts:16
packages/workspace/src/workspace-apps/errors.ts:36
```

## Findings

### Finding 1: test wording still says "configured workspace"

Citation:

```txt
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts:5
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts:57
```

Caller count: documentation string only, 0 runtime callers.

One-sentence test: `startDaemonWorkspaceApps` opens configured daemon route modules and returns started routes.

Inline check: The test data is a `DaemonWorkspaceModule[]` passed as `routes`; there is no folder scan, workspace directory enumeration, or daemon entry path lookup in the happy path.

Proposed collapse: Change both test strings from "configured workspace" to "configured route" or "configured daemon route". This is a mechanical wording cleanup with no behavior change.

Targeted validation:

```bash
bun test packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts
```

### Finding 2: `openOneWorkspaceApp` carries the old install-unit name

Citation:

```txt
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:72
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:104
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:110
```

Caller count: 1 internal non-test caller, at `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:72`.

One-sentence test: The helper builds a daemon context for one config route and calls that route module's `open(ctx)`.

Inline check: The helper does not know about workspace app folders. It receives a `DaemonWorkspaceModule`, uses `module.route`, and returns `StartedDaemonRoute`.

Proposed collapse: Rename `OpenOneOptions` to `OpenOneRouteOptions` and `openOneWorkspaceApp` to `openOneDaemonRoute`, or inline the helper if the caller reads better with the context construction in the `routes.map` body. The rename is safer because the helper owns the try/catch boundary for `WorkspaceOpenFailed`.

Targeted validation:

```bash
bun test packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts
bun run typecheck
```

### Finding 3: public error names still say `WorkspaceApp`

Citation:

```txt
packages/workspace/src/workspace-apps/errors.ts:16
packages/workspace/src/workspace-apps/errors.ts:42
packages/workspace/src/node.ts:94
packages/cli/src/commands/up.ts:35
packages/cli/src/commands/up.ts:93
```

Caller count: 1 non-test public barrel export, 1 CLI type consumer, and internal construction sites in `start-daemon-workspace-apps.ts`.

One-sentence test: These errors describe route validation, signed-out machine auth, and failures thrown by configured daemon route `open(ctx)` calls.

Inline check: The error object is not about discovering or validating a workspace app folder. `WorkspaceRouteRejected` already names routes; `WorkspaceAuthSignedOut` names daemon extensions; `WorkspaceOpenFailed` is the only variant whose message still says `Workspace "${route}" failed to open`.

Proposed collapse: Keep the exported `WorkspaceAppError` name until the public API cleanup is coordinated, but change the user-facing `WorkspaceOpenFailed` message to `Daemon route "${route}" failed to open: ...`. A later public API pass can decide whether to alias or rename `WorkspaceAppError` to a route-startup name.

Targeted validation:

```bash
bun test packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts packages/cli/src/commands/up.test.ts
bun run typecheck
```

### Finding 4: exported startup types have no in-repo consumers

Citation:

```txt
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:38
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:44
packages/workspace/src/node.ts:96
packages/workspace/src/node.ts:97
```

Caller count: 0 non-test consumers outside the defining function annotations and `node.ts` re-export.

One-sentence test: `StartDaemonWorkspaceAppsOptions` and `StartDaemonWorkspaceAppsResult` describe the options and result of one exported route startup function.

Inline check: The CLI calls `startDaemonWorkspaceApps` directly and lets inference carry the result at the call site; no repo code imports these type names.

Proposed collapse: Remove the public re-export from `packages/workspace/src/node.ts` if the package does not intend these as SDK surface. If they are kept for external consumers, leave them as explicit exports and document them as route startup types rather than workspace app discovery types.

Targeted validation:

```bash
rg "StartDaemonWorkspaceAppsOptions|StartDaemonWorkspaceAppsResult" packages apps
bun run typecheck
```

## Deferred Public-Shape Work

The folder name and exported function still use `workspace-apps` and `startDaemonWorkspaceApps`. That name now means "configured daemon route startup", not "folder-discovered workspace apps":

```txt
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:4
packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:55
packages/workspace/src/node.ts:98
packages/cli/src/commands/up.ts:150
```

Caller count: 1 non-test runtime caller, 1 public barrel export, 6 direct test calls.

Do not rename this in a drive-by cleanup. It crosses the `@epicenter/workspace/node` public surface and the CLI startup path. The clean collapse is probably a coordinated rename to a route-startup module with compatibility exports, or a deliberate decision that "workspace app" remains the product term even though folder discovery is gone.

## Rejected Smells

- `WorkspaceRouteRejected`: not stale; the variant names the current config route validation boundary.
- `WorkspaceAuthSignedOut`: not stale enough to rename alone; it is part of the exported `WorkspaceAppError` union.
- `startDaemonWorkspaceApps`: stale wording, but public-surface impact makes it a deferred API decision rather than a local collapse.
- `packages/workspace/src/workspace-apps/errors.ts`: keep as a separate file for now; the error union is exported through `node.ts` and shared by the startup function and CLI typing.
