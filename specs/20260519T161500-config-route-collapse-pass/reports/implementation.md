# Implementation Queue

Scope: safe findings from the three audit reports. Public export deletions are deferred unless explicitly approved, because `@epicenter/workspace` and `@epicenter/workspace/node` are published API surfaces.

## Queue

1. CLI project discovery split: make shared `projectOption` strict, keep the missing-config provisioning fallback only in `daemon up`.
2. Workspace route startup wording: update stale "configured workspace" test wording, rename the private helper, and change the `WorkspaceOpenFailed` message to name daemon routes.
3. Docs wording: replace stale folder-discovery wording in the workspace API skill, `apps/README.md`, and `packages/cli/README.md`.
4. Public export cleanup: defer deletion of `StartDaemonWorkspaceAppsOptions`, `StartDaemonWorkspaceAppsResult`, root config loader exports, and `ProjectConfigErrorType` pending explicit API approval.

## Checkpoint 1: CLI Project Discovery Split

Finding: shared `projectOption` carries the old `daemon up` provisioning fallback.

Inline check: `run`, `list`, `peers`, `down`, and `logs` all use `projectOption`; when discovery misses, the current option resolves any raw directory and lets downstream daemon lookup hash it as a project. Only `daemon up` should accept a non-project directory so it can create `epicenter.config.ts`.

Fix: make `projectOption` call `findProjectRoot(start)` directly, then give `daemon up` its own option that preserves the fallback.

What stays the same: `findProjectRoot` remains config-based, `daemon up` still provisions a missing default config, and `.epicenter/` remains project-local data.

Changed files:

- `packages/cli/src/util/common-options.ts`
- `packages/cli/src/util/common-options.test.ts`
- `packages/cli/src/commands/up.ts`

Validation:

- `bun test packages/workspace/src/client/find-project-root.test.ts`: passed.
- `bun test packages/cli/src/util/common-options.test.ts packages/cli/src/commands/up.test.ts`: failed in the default sandbox because Bun could not bind Unix sockets (`EPERM`). Re-run with escalation passed: 11 tests, 0 failures.
- `bun test packages/cli/src/util/common-options.test.ts`: passed after the final type-only test adjustment.
- `bun x tsc --noEmit -p packages/cli/tsconfig.json`: passed.
- `rg -n "resolveProjectDir|falls back to an absolute start path" packages/cli/src/util packages/cli/src/commands/up.ts`: no hits.

Remaining risk: yargs still prints help while the strict coercion failure is asserted in the unit test. That behavior predates this change and is only visible on parse failure.

## Checkpoint 2: Workspace Route Startup Wording

Finding: route startup internals still carry old workspace-app wording.

Inline check: `openOneWorkspaceApp` receives a `DaemonWorkspaceModule`, builds a context for that module's `route`, and calls `module.open(ctx)`. It does not know about workspace app folders.

Fix: rename the private helper and option type to daemon-route names, update stale test wording, and change `WorkspaceOpenFailed` text from `Workspace` to `Daemon route`.

What stays the same: exported `WorkspaceAppError` and `startDaemonWorkspaceApps` names stay in place; route validation, auth behavior, and runtime disposal behavior do not change.

Changed files:

- `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts`
- `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts`
- `packages/workspace/src/workspace-apps/errors.ts`

Validation:

- `bun test packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts`: passed.
- `bun test packages/cli/src/commands/up.test.ts`: failed in the default sandbox because Bun could not bind Unix sockets (`EPERM`). Re-run with escalation passed: 9 tests, 0 failures.
- `bun run typecheck` from `packages/workspace`: passed.
- `rg -n "configured workspace|openOneWorkspaceApp|OpenOneOptions|Workspace \"" packages/workspace/src/workspace-apps packages/cli/src`: no hits.

Remaining risk: the exported `WorkspaceAppError` variant name remains stale by design. Renaming it would cross the published package boundary.

## Checkpoint 3: Docs Wording

Finding: agent and CLI docs still describe folder discovery or over-authorize `workspaces/fuji/daemon.ts`.

Inline check: the current runtime reads `epicenter.config.ts` and starts the imported daemon modules in `routes`; `workspaces/<route>/daemon.ts` is only a conventional import location.

Fix: rewrite the stale docs to name the config route registry as the authority while preserving the conventional app file layout.

What stays the same: durable route names, daemon module shape, and the `workspaces/` example layout stay available as examples.

Changed files:

- `.agents/skills/workspace-api/references/actions-layout-and-attachments.md`
- `apps/README.md`
- `packages/cli/README.md`

Validation:

- `rg -n "folder-routed|workspaces/<route>/daemon\\.ts|discovers app daemons|workspaces -> apps" .agents/skills/workspace-api/references/actions-layout-and-attachments.md packages/cli/README.md apps/README.md apps/fuji/README.md`: no hits.
- `rg -n "folder-routed|workspaces/<route>/daemon\\.ts|discovers app daemons|workspaces -> apps" docs packages/cli/README.md apps/README.md apps/fuji/README.md .agents/skills`: one remaining hit in `docs/articles/workspace-apps-share-one-origin-on-purpose.md`, a historical article outside the audit findings and outside this safe implementation queue.
- `rg -n "workspaces/fuji/daemon\\.ts" packages/cli/README.md`: one hit remains, the example import path.

Remaining risk: historical docs articles still describe the old model. I left them alone because the audit findings targeted current docs, README files, and agent-facing skills.

## Checkpoint 4: Public Export Cleanup

Finding: several exported config and route-startup types have no in-repo consumers.

Inline check: the zero-consumer names are exported from `@epicenter/workspace` or `@epicenter/workspace/node`, which are published package surfaces. External SDK or CLI consumers could still import them.

Fix: defer deletion pending explicit API approval.

What stays the same: all public exported names remain available.

Changed files: none.

Validation:

- Not run for this deferred checkpoint.

Remaining risk: stale public names remain in the package API until a coordinated public API cleanup decides whether to remove, rename, or alias them.

## Overall Validation

- `bun run --filter @epicenter/cli typecheck`: failed because this repo's Bun script setup did not match that filter command (`No packages matched the filter`).
- `bun run typecheck`: failed in unrelated packages before completing the repo. Observed failures were in `apps/landing` (`@astrojs/svelte` resolution from UI Svelte files) and `apps/honeycrisp` (pre-existing Svelte/type errors in its app state and components).
- `bun x tsc --noEmit -p packages/cli/tsconfig.json`: passed.
- `bun run typecheck` from `packages/workspace`: passed.
- `rg -n "<em dash>|<en dash>" <touched files>`: no hits.

## Post Implementation Review

Files re-read:

```txt
.agents/skills/workspace-api/references/
`-- actions-layout-and-attachments.md
apps/
`-- README.md
packages/
|-- cli/
|   |-- README.md
|   `-- src/
|       |-- commands/
|       |   `-- up.ts
|       `-- util/
|           |-- common-options.test.ts
|           `-- common-options.ts
`-- workspace/
    `-- src/workspace-apps/
        |-- errors.ts
        |-- start-daemon-workspace-apps.test.ts
        `-- start-daemon-workspace-apps.ts
specs/20260519T161500-config-route-collapse-pass/reports/
`-- implementation.md
```

Review findings:

- Fixed one formatting issue in `packages/workspace/src/workspace-apps/errors.ts`.
- Left the `up.ts` startup cleanup shape as-is after validating it, because it preserves teardown behavior and shrinks repeated cleanup calls.
- Left public exported names in place because deleting them needs an explicit API decision.
