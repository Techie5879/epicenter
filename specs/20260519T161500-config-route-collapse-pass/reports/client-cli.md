# Client And CLI Audit

Scope audited:

- `packages/workspace/src/client/**`
- `packages/workspace/src/node.ts`
- `packages/workspace/src/daemon/paths.ts`
- `packages/cli/src/**`

Commands run:

```bash
sed -n '1,220p' AGENTS.md
sed -n '1,260p' specs/20260519T161500-config-route-collapse-pass/02-client-cli-audit.prompt.md
sed -n '1,260p' /Users/braden/Code/epicenter/.agents/skills/collapse-pass/SKILL.md
git show --stat HEAD~1..HEAD
sed -n '1,240p' /Users/braden/Code/epicenter/.agents/skills/collapse-pass/references/report-format.md
sed -n '1,220p' /Users/braden/Code/epicenter/.agents/skills/collapse-pass/references/never-touch.md
sed -n '1,220p' /Users/braden/Code/epicenter/.agents/skills/writing-voice/SKILL.md
rg -n "findEpicenterDir|findProjectRoot|\\.epicenter|workspaces/|MissingConfig|project socket|socket|epicenter up|project root|config" packages/workspace/src/client packages/workspace/src/node.ts packages/workspace/src/daemon/paths.ts packages/cli/src
rg -n "findEpicenterDir|findProjectRoot|\\.epicenter|workspaces/|MissingConfig|project socket|old|epicenter up|project root" specs/20260519T161500-config-route-collapse-pass packages/cli/README.md docs/scripting.md
ls -la specs/20260519T161500-config-route-collapse-pass/reports
git status --short
nl -ba packages/workspace/src/client/find-project-root.ts
nl -ba packages/workspace/src/client/connect-daemon-actions.ts
nl -ba packages/workspace/src/daemon/paths.ts
nl -ba packages/cli/src/commands/up.ts
rg -n "findProjectRoot\\b" packages/workspace/src packages/cli/src --glob '!**/*.test.ts'
rg -n "resolveProjectForUp\\b|provisionProject\\b|DEFAULT_PROJECT_CONFIG_SOURCE\\b|socketPathFor\\b|metadataPathFor\\b|leasePathFor\\b|runtimeDir\\b|dirHash\\b|logPathFor\\b" packages/workspace/src packages/cli/src --glob '!**/*.test.ts'
nl -ba packages/cli/src/util/common-options.ts
nl -ba packages/workspace/src/node.ts
rg -n "epicenter up|daemon up|project socket|daemon socket|workspaces/|workspaces<|\\.epicenter|MissingConfig|findEpicenterDir|findProjectRoot|project root" packages/cli/src packages/workspace/src/client packages/workspace/src/node.ts packages/workspace/src/daemon/paths.ts
rg -n "ProjectConfigError|MissingConfig|NoConfig|Config" packages/workspace/src/config packages/workspace/src/workspace-apps packages/cli/src
rg -n "command:|describe:|description:" packages/cli/src/commands packages/cli/src/cli.ts packages/cli/src/util
nl -ba packages/workspace/src/daemon/client.ts | sed -n '1,240p'
nl -ba packages/cli/src/commands/run.ts
nl -ba packages/cli/src/commands/list.ts
nl -ba packages/cli/src/commands/peers.ts
nl -ba packages/cli/src/commands/down.ts
nl -ba packages/cli/src/commands/logs.ts
nl -ba packages/cli/src/commands/ps.ts
nl -ba packages/cli/src/commands/daemon.ts
sed -n '1,180p' specs/20260519T161500-config-route-collapse-pass/README.md
rg -n "projectOption\\b|resolveProjectDir\\b" packages/cli/src --glob '!**/*.test.ts'
rg -n "resolveProjectForUp\\b|provisionProject\\b|safeDisposeStartedRoutes\\b|printPeersSnapshot\\b|subscribePeers\\b|subscribeSyncStatus\\b" packages/cli/src --glob '!**/*.test.ts'
```

Last commit context:

```txt
373a4e0 refactor(workspace): collapse route discovery helper
11 files changed, 79 insertions(+), 141 deletions(-)
Removed packages/workspace/src/workspace-apps/discover.ts and discover.test.ts.
Updated packages/cli/src/commands/up.ts and packages/cli/README.md for config-routed daemon startup.
```

## Finding 1: Shared project option still carries `daemon up` provisioning fallback

The shared `projectOption` tries `findProjectRoot(start)` and falls back to `resolve(start)` when no `epicenter.config.ts` exists (`packages/cli/src/util/common-options.ts:13`, `packages/cli/src/util/common-options.ts:15`, `packages/cli/src/util/common-options.ts:17`). That fallback is right for `daemon up`, because `runUp` provisions a missing `epicenter.config.ts` (`packages/cli/src/commands/up.ts:94`, `packages/cli/src/commands/up.ts:95`, `packages/cli/src/commands/up.ts:266`, `packages/cli/src/commands/up.ts:269`). It is stale for commands that require an existing project and daemon.

Caller count:

```txt
projectOption non-test CLI callers: 6
  packages/cli/src/commands/run.ts:58
  packages/cli/src/commands/list.ts:37
  packages/cli/src/commands/down.ts:73
  packages/cli/src/commands/peers.ts:29
  packages/cli/src/commands/up.ts:201
  packages/cli/src/commands/logs.ts:127

resolveProjectDir callers: 1
  packages/cli/src/util/common-options.ts:27

resolveProjectForUp callers: 1
  packages/cli/src/commands/up.ts:94
```

Inline check:

```txt
run/list/peers:
  projectOption.coerce
    -> findProjectRoot(start)
    -> catch
    -> resolve(start)
    -> getDaemon(argv.C)
    -> socketPathFor(resolved non-project dir)
    -> DaemonError.Required("no daemon running for ...; start one with `epicenter daemon up` first")

down/logs:
  projectOption.coerce
    -> same fallback
    -> readMetadata/logPathFor on a hash of the non-project dir
```

The visible result is that `run`, `list`, `peers`, `down`, and `logs` silently treat any directory as a project address. After `epicenter.config.ts` became the project marker, those commands should either resolve an existing config-backed project or fail at the project lookup boundary. Only `daemon up` needs the "no config yet, use this directory and create one" path.

Proposed collapse:

Split the option behavior so the fallback lives only in `daemon up`.

```txt
packages/cli/src/util/common-options.ts
  projectOption:
    coerce -> findProjectRoot(start)

packages/cli/src/commands/up.ts
  upProjectOption or handler-local resolution:
    coerce/resolve -> findProjectRoot(start) catch resolve(start)
```

Then remove one of the duplicated fallbacks:

- If `upProjectOption` does the fallback, `resolveProjectForUp` can collapse into direct `realpathSync(options.projectDir)`.
- If `runUp` keeps the fallback for direct unit-test calls, `upCommand` should not reuse the strict shared option.

What stays the same:

- `findProjectRoot` remains config-based (`packages/workspace/src/client/find-project-root.ts:9`, `packages/workspace/src/client/find-project-root.ts:16`).
- `daemon up` still creates `epicenter.config.ts` when starting from a non-project directory (`packages/cli/src/commands/up.ts:267`, `packages/cli/src/commands/up.ts:269`).
- Project data still lives under `<projectDir>/.epicenter` (`packages/cli/src/commands/up.ts:274`, `packages/workspace/src/daemon/paths.ts:9`).
- Runtime sockets and metadata remain OS-runtime keyed by project directory hash (`packages/workspace/src/daemon/paths.ts:33`, `packages/workspace/src/daemon/paths.ts:57`, `packages/workspace/src/daemon/paths.ts:69`).

Targeted validation commands:

```bash
bun test packages/cli/src/commands/up.test.ts
bun test packages/workspace/src/client/find-project-root.test.ts
bun run --filter @epicenter/cli typecheck
```

Suggested follow-up test coverage:

```txt
packages/cli/src/commands/run.test.ts or a focused common-options test:
  Given cwd under a directory without epicenter.config.ts,
  `run/list/peers/logs/down` should fail project discovery instead of hashing the raw cwd.

packages/cli/src/commands/up.test.ts:
  Keep the existing "writes the default config and starts with no routes when config is missing" coverage.
```

## No-Finding Checks

`findEpicenterDir`: no hits in the assigned scope.

`MissingConfig`: no hits in the assigned scope. The current config error is `ProjectConfigNotFound` in `packages/workspace/src/config/load-project-config.ts:25`, outside the assigned client/CLI surface except through `loadProjectConfig` usage in `packages/cli/src/commands/up.ts:141`.

`.epicenter` as project marker: no production hits in the assigned scope. Remaining `.epicenter` hits describe project-local data (`packages/cli/src/commands/up.ts:274`, `packages/workspace/src/daemon/paths.ts:9`, `packages/workspace/src/client/epicenter-paths.ts:5`) or machine-local auth/home state (`packages/cli/src/commands/auth.ts:8`, `packages/workspace/src/client/epicenter-paths.ts:13`). The test at `packages/workspace/src/client/find-project-root.test.ts:38` explicitly verifies `.epicenter` is not a marker.

`workspaces/` as project marker: no production hits in the assigned scope. The remaining scoped hit is test fixture import text in `packages/cli/src/commands/up.test.ts:113`, not marker logic.

Old `epicenter up` wording: no hits in the assigned scope. Current CLI and errors use `epicenter daemon up` (`packages/workspace/src/client/find-project-root.ts:17`, `packages/workspace/src/daemon/client.ts:49`, `packages/cli/src/commands/up.ts:2`, `packages/cli/src/commands/down.ts:71`, `packages/cli/src/commands/ps.ts:58`).

Project socket wording: no stale `.epicenter/daemon.sock` style path found. Socket helpers are runtime-directory based (`packages/workspace/src/daemon/paths.ts:27`, `packages/workspace/src/daemon/paths.ts:57`).

## Considered But Not Collapsed

- `findProjectRoot`: kept. It has three non-test direct callers in the audited CLI/client path (`packages/workspace/src/client/connect-daemon-actions.ts:53`, `packages/cli/src/commands/up.ts:260`, `packages/cli/src/util/common-options.ts:15`) plus public exports (`packages/workspace/src/node.ts:15`, `packages/workspace/src/index.ts:109`). It is now the config marker lookup and remains a useful API.
- `connectDaemonActions`: kept. Its docs are already route-config based and point to `epicenter.config.ts` (`packages/workspace/src/client/connect-daemon-actions.ts:38`, `packages/workspace/src/client/connect-daemon-actions.ts:44`).
- `socketPathFor` and daemon path helpers: kept. They have multiple non-test callers across daemon client, metadata, lease, runtime cleanup, and CLI commands. The comments now distinguish runtime files from project-local `.epicenter` data (`packages/workspace/src/daemon/paths.ts:4`, `packages/workspace/src/daemon/paths.ts:9`).
