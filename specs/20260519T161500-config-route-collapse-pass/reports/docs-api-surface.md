# Docs And API Surface Audit

Scope audited:

- `packages/workspace/src/index.ts`
- `packages/workspace/src/node.ts`
- `packages/workspace/src/config/**`
- `docs/scripting.md`
- `packages/cli/README.md`
- app READMEs touched by the last two commits: none
- relevant agent skills: `.agents/skills/workspace-api/**`, `.agents/skills/workspace-app-layout/**`

Last two commits checked:

```txt
cbdeb93 refactor(workspace): remove workspace apps barrel
373a4e0 refactor(workspace): collapse route discovery helper
```

## Findings

### Finding 1: folder-routed daemon docs still present in agent skill

Citation: `.agents/skills/workspace-api/references/actions-layout-and-attachments.md:276`

The skill still tells agents to use a "folder-routed `workspaces/<route>/daemon.ts`" for long-running daemons. That conflicts with the current model where `epicenter.config.ts` is the project marker and route registry, while the daemon module path is just an import chosen by the project config.

Caller count:

- `rg -n "folder-routed|workspaces/<route>/daemon\\.ts" .agents/skills docs packages/cli/README.md apps/README.md apps/fuji/README.md`: 1 stale skill hit, plus 1 stale `apps/README.md` hit covered in Finding 2
- This exact skill line is agent-facing documentation, not a source symbol.

Proposed collapse:

- Replace the folder-routed sentence with config-routed wording: use `epicenter.config.ts` to register daemon modules, and treat `workspaces/<route>/daemon.ts` as only one conventional file layout.
- Do not change the durable route string or daemon module contract.

Targeted validation:

```bash
rg -n "folder-routed|workspaces/<route>/daemon\\.ts" .agents/skills docs packages/cli/README.md apps/README.md apps/fuji/README.md
```

### Finding 2: `apps/README.md` still describes symlink discovery

Citation: `apps/README.md:15`

The repo-level app README says `epicenter daemon up -C <repoRoot>` discovers app daemons through `workspaces -> apps`, matching the old folder discovery model. This was outside the "app READMEs touched by the last two commits" set, because no app README was touched by `HEAD~2..HEAD`, but the grep found it and it is directly stale.

Caller count:

- `rg -n "discovers app daemons|workspaces/<route>/daemon\\.ts" apps/README.md`: 1 stale hit
- Not a source symbol.

Proposed collapse:

- Rewrite the line so the repo root `epicenter.config.ts` owns registration.
- Keep the layout guidance that each app can expose a `daemon.ts`; remove the claim that discovery depends on `workspaces -> apps`.

Targeted validation:

```bash
rg -n "discovers app daemons|workspaces/<route>/daemon\\.ts|workspaces -> apps" apps/README.md
```

### Finding 3: CLI README over-authorizes `workspaces/fuji/daemon.ts`

Citations:

- `packages/cli/README.md:73`
- `packages/cli/README.md:80`
- `packages/cli/README.md:94`

The README correctly says `epicenter.config.ts` is the route registry at `packages/cli/README.md:59`, but then repeatedly describes `workspaces/fuji/daemon.ts` as if that path carries authority. After the migration, the import path is illustrative; only `routes: [fuji]` plus the module's `route` field matters.

Caller count:

- `rg -n "workspaces/fuji/daemon\\.ts" packages/cli/README.md`: 3 hits
- Not a source symbol.

Proposed collapse:

- Keep one example import path.
- Change surrounding prose to say "the imported module" or "the Fuji daemon module" instead of repeating `workspaces/fuji/daemon.ts` as the actor.

Targeted validation:

```bash
rg -n "workspaces/fuji/daemon\\.ts" packages/cli/README.md
```

### Finding 4: config exports are split across root and node barrels with different audiences

Citations:

- `packages/workspace/src/index.ts:109`
- `packages/workspace/src/index.ts:111`
- `packages/workspace/src/index.ts:112`
- `packages/workspace/src/index.ts:113`
- `packages/workspace/src/index.ts:114`
- `packages/workspace/src/index.ts:117`
- `packages/workspace/src/index.ts:118`
- `packages/workspace/src/index.ts:119`
- `packages/workspace/src/node.ts:15`
- `packages/workspace/src/node.ts:16`
- `packages/workspace/src/node.ts:18`
- `packages/workspace/src/node.ts:19`

The root barrel exports both user-facing config authoring helpers and node-only loading helpers. `findProjectRoot` and `loadProjectConfig` are also exported from `@epicenter/workspace/node`, which is the path used by CLI and script docs. Browser consumers should not need project-root walking or dynamic Bun config loading from the root barrel.

Caller count:

- `findProjectRoot`: 5 non-test production or docs callers outside its implementation: `docs/scripting.md:10`, `docs/scripting.md:15`, `docs/scripting.md:52`, `packages/cli/src/commands/up.ts:28`, plus `packages/cli/src/util/common-options.ts:10` outside this audit's main docs scope.
- `loadProjectConfig`: 1 non-test production caller outside implementation: `packages/cli/src/commands/up.ts:29`.
- `DEFAULT_PROJECT_CONFIG_SOURCE`: 1 non-test production caller outside implementation and barrels: `packages/cli/src/commands/up.ts:27`.
- `PROJECT_CONFIG_FILENAME`: 1 non-test source caller outside implementation and barrels: `packages/workspace/src/client/find-project-root.ts:3`.
- `ProjectConfigError`: 0 non-test callers outside implementation and barrels.
- `ProjectConfigErrorType`: 0 non-test callers outside `packages/workspace/src/index.ts`.

Proposed collapse:

- Keep `defineConfig`, `EpicenterConfig`, and probably `PROJECT_CONFIG_FILENAME` in the root barrel, because `epicenter.config.ts` imports from `@epicenter/workspace` and `findProjectRoot` uses the filename constant.
- Move or remove root-barrel exports for `findProjectRoot`, `loadProjectConfig`, `DEFAULT_PROJECT_CONFIG_SOURCE`, `ProjectConfigError`, and `ProjectConfigErrorType` unless there is an intentional external SDK contract. These are node/runtime concerns and already fit `@epicenter/workspace/node`.
- If `DEFAULT_PROJECT_CONFIG_SOURCE` remains public, prefer `@epicenter/workspace/node` only; its only production caller is CLI provisioning at `packages/cli/src/commands/up.ts:269`.

Targeted validation:

```bash
rg -n "findProjectRoot|loadProjectConfig|DEFAULT_PROJECT_CONFIG_SOURCE|ProjectConfigError|ProjectConfigErrorType" packages apps docs .agents examples --glob '!*.test.ts'
bun run typecheck
bun test packages/workspace/src/config/load-project-config.test.ts packages/workspace/src/config/define-config.test.ts packages/cli/src/commands/up.test.ts
```

### Finding 5: `StartDaemonWorkspaceApps*` types have no external callers

Citations:

- `packages/workspace/src/node.ts:96`
- `packages/workspace/src/node.ts:97`
- `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:38`
- `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:44`
- `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts:55`

`startDaemonWorkspaceApps` has one production caller in `packages/cli/src/commands/up.ts:33` and `packages/cli/src/commands/up.ts:150`. Its public option and result types have no callers outside their defining module and node barrel. They are derived from the function signature and do not currently buy a public consumer anything.

Caller count:

- `startDaemonWorkspaceApps`: 1 production caller outside implementation and tests: `packages/cli/src/commands/up.ts`.
- `StartDaemonWorkspaceAppsOptions`: 0 callers outside `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts` and `packages/workspace/src/node.ts`.
- `StartDaemonWorkspaceAppsResult`: 0 callers outside `packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts` and `packages/workspace/src/node.ts`.

Proposed collapse:

- Stop exporting `StartDaemonWorkspaceAppsOptions` and `StartDaemonWorkspaceAppsResult` from `@epicenter/workspace/node`, or derive them locally with `Parameters<typeof startDaemonWorkspaceApps>[0]` and awaited result inference if an internal caller appears.
- Keep `startDaemonWorkspaceApps` public only if CLI remains an external package consumer of `@epicenter/workspace/node`.

Targeted validation:

```bash
rg -n "StartDaemonWorkspaceAppsOptions|StartDaemonWorkspaceAppsResult|startDaemonWorkspaceApps" packages apps docs .agents examples --glob '!*.test.ts'
bun run typecheck
bun test packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts packages/cli/src/commands/up.test.ts
```

### Finding 6: `ProjectConfigError` is public but not consumed as a public type

Citations:

- `packages/workspace/src/config/load-project-config.ts:24`
- `packages/workspace/src/config/load-project-config.ts:34`
- `packages/workspace/src/index.ts:118`
- `packages/workspace/src/index.ts:119`
- `packages/workspace/src/node.ts:19`

`loadProjectConfig` returns a structured `ProjectConfigError`, but no non-test caller imports or narrows the exported error factory or the root alias. The CLI immediately converts the error to `new Error(error.message)` at `packages/cli/src/commands/up.ts:141` and `packages/cli/src/commands/up.ts:142`.

Caller count:

- `ProjectConfigError`: 0 non-test callers outside `load-project-config.ts` and barrels.
- `ProjectConfigErrorType`: 0 non-test callers outside the root barrel.

Proposed collapse:

- Remove `ProjectConfigErrorType` from the root barrel first; it is an alias with no callers.
- Consider keeping `ProjectConfigError` internal to `load-project-config.ts` unless external consumers need structured config error matching. This crosses a published package boundary, so pause before deletion.

Targeted validation:

```bash
rg -n "ProjectConfigError|ProjectConfigErrorType" packages apps docs .agents examples --glob '!*.test.ts'
bun run typecheck
bun test packages/workspace/src/config/load-project-config.test.ts packages/cli/src/commands/up.test.ts
```

## Non-findings

### `.epicenter` as data directory is current

Citations:

- `docs/scripting.md:37`
- `packages/cli/README.md:96`
- `apps/fuji/README.md:97`
- `.agents/skills/workspace-app-layout/SKILL.md:212`

These references describe `.epicenter/` as project-local data, not as a discovery marker. They should stay.

### `workspace-app-layout` skill has the corrected marker wording

Citations:

- `.agents/skills/workspace-app-layout/SKILL.md:201`
- `.agents/skills/workspace-app-layout/SKILL.md:212`
- `.agents/skills/workspace-app-layout/SKILL.md:213`

This skill still uses `./workspaces/fuji/daemon.ts` in an example import, but it explicitly says `epicenter.config.ts` is the project marker and route registry. That is acceptable unless the project wants to stop recommending the `workspaces/` folder convention entirely.

## Validation Commands For A Follow-Up Patch

```bash
rg -n "folder-routed|workspaces/<route>/daemon\\.ts|discovers app daemons|workspaces -> apps" docs packages/cli/README.md apps/README.md apps/fuji/README.md .agents/skills
rg -n "findProjectRoot|loadProjectConfig|DEFAULT_PROJECT_CONFIG_SOURCE|PROJECT_CONFIG_FILENAME|ProjectConfigError|ProjectConfigErrorType|StartDaemonWorkspaceAppsOptions|StartDaemonWorkspaceAppsResult|startDaemonWorkspaceApps" packages apps docs .agents examples --glob '!*.test.ts'
bun run typecheck
bun test packages/workspace/src/config/define-config.test.ts packages/workspace/src/config/load-project-config.test.ts packages/workspace/src/workspace-apps/start-daemon-workspace-apps.test.ts packages/cli/src/commands/up.test.ts
```
