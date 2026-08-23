# Epicenter: project as a first-class concept

**Status**: Worth committing

> Historical note: this spec predates the current single-mount config shape.
> Current project loading is: `epicenter.config.ts` default-exports one `Mount`
> from an app package factory such as `fuji()` (`export default fuji()`). The
> mount `name` owns the CLI prefix, and `workspaces/` is only a source-layout
> convention.

**Path policy (2026-05-22)**: Aligned with `specs/20260522T203209-top-level-epicenter-path-cleanup.md`. The `~/.epicenter/` references in this spec argue for _deleting_ that directory; user-global state lives under `env-paths('epicenter')` and daemon runtime files use the OS runtime dir. No new top-level `~/.epicenter/` writes are introduced.

Supersedes `specs/20260519T113632-epicenter-project-root-single-marker.md`. That
spec was a local fix (one marker, walk-up, `daemon up` auto-creates). This
spec is a wider clean break: the project marker becomes a config file, the
config file owns route registration, `~/` is not a project, and user-global
state lives in XDG-standard locations resolved by `env-paths`. Four collapses,
one coherent model.

## One-sentence model

A project is a directory containing `epicenter.config.ts`; that file lists the
project's routes and settings; the directory's `.epicenter/` holds data; the
user's machine is not a project.

## Why a new spec, not a patch on the old one

The previous spec correctly diagnosed that three callers disagreed on what a
project was (`workspaces/` vs `.epicenter/` vs trust-`-C`). Its fix was to pick
one of those two markers and walk for it. Two problems surfaced during review:

1. **Same-basename collision.** `<project>/.epicenter/` and `~/.epicenter/` are
   different concepts (project data vs user runtime state). Every variable in
   code named `epicenterDir` had to mean one or the other but the name does
   not say which. That is a naming bug the old spec inherited rather than
   solved.

2. **Directory-as-marker is rare in modern tooling.** The dev-tools survey
   (wrangler, wxt, drizzle-kit, shadcn-svelte, jsrepo, tauri) showed 5 of 6
   use a config file as the marker. Tauri uses a directory but its real
   marker is `tauri.conf.json` inside it. Sticking with directory-as-marker
   meant fighting precedent for no gain.

The previous spec also explicitly named `<project>/.epicenter/config.ts` as
"future". Once you accept that the project has a config file in its future,
making the config file itself the marker collapses two responsibilities into
one and deletes the same-basename problem on day one.

## The new model

```
<project>/epicenter.config.ts            marker + config + route registry
<project>/.epicenter/                    project data
  sqlite/  yjs/  md/  log/               materialized workspace state
  .gitignore                             auto-managed
<project>/workspaces/<route>/daemon.ts   route code (convention, not required)

User-global, resolved via env-paths:
  ~/.config/epicenter/                   auth, default project, known projects (Linux)
  ~/Library/Application Support/epicenter (macOS equivalent)
  %APPDATA%\epicenter\Config             (Windows)
  ~/.local/share/epicenter/              cross-project index, if needed
  ~/.cache/epicenter/                    regen-safe
  ~/.local/state/epicenter/log/          logs (mac: ~/Library/Logs/epicenter)

Runtime (OS rendezvous, hash-keyed):
  $XDG_RUNTIME_DIR/epicenter/<hash>.sock     Linux
  $TMPDIR/epicenter/<hash>.sock              macOS
  \\.\pipe\epicenter-<hash>                  Windows (named pipe)
```

The user-facing mental model has exactly three concepts and three obvious
names:

```
epicenter.config.ts      "is this a project, and what does it do?"
.epicenter/              "the project's data"
user paths (env-paths)   "stuff that belongs to me, not to a project"
```

`~/` is not a project. Nothing at `~/` declares route registration or holds
sqlite/yjs/markdown. If a user wants `~/` to be a project they can put an
`epicenter.config.ts` there, exactly the same as any other directory. There is
no special "default project" magic.

## Decisions and why

### Decision 1: file marker (`epicenter.config.ts`), not directory marker

Five of six modern dev tools use a file marker (wrangler.toml, wxt.config.ts,
drizzle.config.ts, components.json, jsrepo.json). Cargo and npm have used this
pattern for over a decade. The pattern won.

The directory-as-marker design has one real selling point: zero ceremony to
mark a project (just `mkdir`). But that ceremony savings forces three costs:

```
A. marker doubles as data dir       -> deleting half the dir half-unprojects it
B. marker name same as user home    -> code ambiguity in every variable
C. marker has no content            -> nowhere to declare per-project settings
```

A file marker dissolves all three. The marker is a file you can read; the data
dir has no responsibility beyond holding data; the user-home path is named
differently; and the file already does meaningful work on day one (lists
routes).

The selling point of directory-marker (zero ceremony) is preserved by having
`epicenter daemon up` write a minimal config file on first run. Users get the
same "no manual init" experience.

### Decision 2: routes registered in the config file, not discovered

Today, `discover.ts` scans `<project>/workspaces/*/daemon.ts` and imports
whatever it finds. That is filesystem-as-registry. The model the codebase is
already pointing at (per the `greenfield-clean-breaks` skill's own example) is
config-as-registry:

```ts
// epicenter.config.ts
import { defineConfig } from "@epicenter/workspace";
import fuji from "./workspaces/fuji/daemon";
import opensidian from "./workspaces/opensidian/daemon";

export default defineConfig({
  routes: [fuji, opensidian],
});
```

This change does the following:

```
- deletes the filesystem scanner (discover.ts core loop)
- deletes implicit route ordering questions
- deletes "what if the folder name has a space in it" validation
- adds explicit go-to-def for every route
- enables routes to live anywhere (npm package, monorepo sibling, inline)
- preserves workspaces/<route>/daemon.ts as a *convention* for organization
```

`workspaces/<route>/daemon.ts` becomes optional. Trivial projects ship one
inline route in the config file with no `workspaces/` directory at all. Real
projects organize by convention. Plugin distribution is just `import`.

This is what wrangler, vite, drizzle, tauri all do.

### Decision 3: `defineConfig({...})` builds on existing `defineDaemonWorkspace`

The repo already has `defineDaemonWorkspace({ open(ctx) })`
(`packages/workspace/src/daemon/define-daemon-workspace.ts:71`). Every daemon
extension already default-exports one. The clean-break skill already documents
the destination shape:

```ts
export default defineConfig({
  daemon: {
    routes: [defineFujiDaemon()],
  },
});
```

We are not inventing a pattern. We are completing one the codebase has been
pointing at.

`defineConfig` is a typed identity function (the value-level work is trivial;
the type binding is what gives users IntelliSense for `routes`, `peers`,
`workspaces`, future fields). Same shape as `defineDaemonWorkspace`.

### Decision 4: sockets are an OS rendezvous mechanism, not "user runtime files"

Today the spec describes `~/.epicenter/run/<hash>.sock` as "user runtime
home". That framing is wrong twice over:

```
- It is not really user-scoped; it is per-project (keyed by dirHash).
- It is not user-managed; it lives where the OS wants Unix sockets to live.
```

The new model names this honestly: sockets are an OS rendezvous mechanism.
Their location is chosen by platform constraints, not by an Epicenter design
choice:

```
Linux: $XDG_RUNTIME_DIR/epicenter/<hash>.sock
       (tmpfs, OS-cleaned on logout/reboot; the spec's intended home)

macOS: $TMPDIR/epicenter/<hash>.sock
       (no XDG_RUNTIME_DIR exists; $TMPDIR is short, per-user, OS-cleaned)

Windows: \\.\pipe\epicenter-<hash>
       (Unix sockets are not the right primitive; named pipes are)
```

The 104-byte `sun_path` limit on macOS (108 on Linux) bites any design that
puts sockets under deep paths. `$TMPDIR/epicenter/<hash>.sock` stays around
50 to 60 bytes on macOS; safe.

This decision deletes the concept of "user runtime home" entirely. There is no
directory anywhere whose job is "hold sockets and leases." Sockets go where
the OS wants them; leases follow.

### Decision 5: user-global state uses XDG paths via `env-paths`

`env-paths` (sindresorhus, 57M weekly downloads) returns
`{ data, config, cache, log, temp }` per platform, mapped to XDG on Linux,
`~/Library/...` on macOS, `%APPDATA%`/`%LOCALAPPDATA%` on Windows. Adopting
it means:

```
auth tokens, default-project pointer, known-projects list
  -> userConfig (~/.config/epicenter on Linux)

cross-project search index, if/when we build it
  -> userData (~/.local/share/epicenter on Linux)

regen-safe blobs (model downloads, etc.)
  -> userCache (~/.cache/epicenter on Linux)

logs
  -> userLog (~/.local/state/epicenter/log on Linux, ~/Library/Logs/epicenter on macOS)
```

`~/.epicenter/` as a single mixed-purpose directory disappears. Each piece of
user-global state gets the correct platform path; macOS users get
`~/Library/Application Support/epicenter` not a hidden dotdir cluttering home;
Linux users stop having to file XDG-compliance bugs.

`env-paths` is 4KB, has no runtime dependencies, and matches the platformdirs
convention from Python. The alternative (rolling our own 30 lines of
`homedir()` + `process.platform` branching) is worse on three axes: more code
to maintain, more risk of getting Windows wrong, more reinvention.

### Decision 6: `~/` is not a project

A user with no project should not have epicenter commands "just work" against
some default. Running `epicenter run x` from `~/` should fail loudly with "no
project found, run `epicenter daemon up` to create one here, or `cd` into a
project."

This refuses the "default project" idea we considered. The reasoning:

```
- A default project means ~/.epicenter/ holds durable data the user did not
  consciously create. Backup, encryption, and sync stories get harder.
- "rm -rf ~/.epicenter" used to be a safe reset (process state only). Under
  a default-project model it means deleting the user's notes.
- The mental model "epicenter operates on projects you created" is clearer
  than "epicenter has a default project at ~/ and also any project you cd
  into."
```

Refusing a default project lets us refuse the "user runtime home" directory
too (Decision 4). The two refusals are linked: once `~/.epicenter/` does not
exist, there is no temptation to put runtime files there.

### Decision 7: `daemon up` auto-creates the marker on first run

The previous spec already had this. Keeping it: `epicenter daemon up` is the
one command that provisions a project, and it provisions everything:

```
1. Walk up from -C looking for epicenter.config.ts.
2. If none found, write a minimal default at -C/epicenter.config.ts.
3. mkdir -p <project>/.epicenter/{sqlite,yjs,md,log} with mode 0o700.
4. Write <project>/.epicenter/.gitignore (covers sqlite/, yjs/, md/, log/).
5. Resolve runtime dir (XDG_RUNTIME_DIR or $TMPDIR), bind socket, claim lease.
```

No separate `epicenter init`. No "you forgot to run init" failures. One verb,
one outcome.

The minimal default written in step 2 is:

```ts
import { defineConfig } from "@epicenter/workspace";

export default defineConfig({});
```

Three lines. The empty config validates; routes can be added later by
importing them.

### Decision 8: no compatibility shim with the old layout

This is a clean break. The patch removes the `workspaces/` walk-up branch and
the `~/.epicenter/` references in one PR. No alias, no fallback parser, no
"if the old marker is present, use it." Existing projects migrate by running
`epicenter migrate` (separately specced) or by manually creating the config
file. The reasoning matches the `greenfield-clean-breaks` skill:

```
Compatibility is a feature. If nobody explicitly asked for that feature,
do not smuggle it into the implementation.
```

There are no production users of the dual-marker behavior. The cost of a
shim is permanent code complexity for a one-time-use migration path.

## Canonical terminology

Code and docs must use these names. The previous spec's ambiguous
`epicenterDir` is gone.

| Concept                                      | Name in code             | Name in docs                 |
| -------------------------------------------- | ------------------------ | ---------------------------- |
| Project root (nearest ancestor with config)  | `projectDir: ProjectDir` | "project root"               |
| Project config file                          | `projectConfigPath`      | "project config"             |
| Project data directory                       | `projectDataDir`         | "project data directory"     |
| Workspace route registry (folder convention) | `workspaceRoutesDir`     | "workspace routes directory" |
| User config dir (env-paths config)           | `userConfigDir`          | "user config"                |
| User data dir                                | `userDataDir`            | "user data"                  |
| User cache dir                               | `userCacheDir`           | "user cache"                 |
| User log dir                                 | `userLogDir`             | "user logs"                  |
| OS runtime dir (sockets, leases)             | `runtimeDir`             | "runtime directory"          |

Banned in code: `epicenterDir`, `epicenterHome`, "the epicenter dir."

## Code shapes

### Before

```ts
// packages/workspace/src/client/find-epicenter-dir.ts
export function findEpicenterDir(start: string = process.cwd()): ProjectDir {
  let current = resolve(start);
  while (true) {
    const hasWorkspaces = existsSync(join(current, WORKSPACES_DIRNAME));
    const hasDir = existsSync(join(current, ".epicenter"));
    if (hasWorkspaces || hasDir) return current as ProjectDir;
    // ...
  }
}
```

```ts
// packages/workspace/src/daemon/client.ts::getDaemon
const workspacesPath = join(projectDir, WORKSPACES_DIRNAME);
if (!existsSync(workspacesPath)) {
  return DaemonError.MissingConfig({ projectDir });
}
```

```ts
// packages/workspace/src/workspace-apps/discover.ts
// scans <project>/workspaces/* and imports each daemon.ts
```

### After

```ts
// packages/workspace/src/client/find-project-root.ts
const CONFIG_FILENAME = "epicenter.config.ts";

export function findProjectRoot(start: string = process.cwd()): ProjectDir {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, CONFIG_FILENAME)))
      return current as ProjectDir;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `findProjectRoot: no ${CONFIG_FILENAME} found walking up from ${start}. ` +
          `Run \`epicenter daemon up\` to create one.`,
      );
    }
    current = parent;
  }
}
```

```ts
// packages/workspace/src/config/define-config.ts (new)
import type { DaemonWorkspaceModule } from "../daemon/define-daemon-workspace.js";

export type EpicenterConfig = {
  routes?: DaemonWorkspaceModule[];
  // Future, none load-bearing today:
  // peers?: PeerConfig[];
  // workspaces?: Record<string, WorkspaceConfig>;
  // schemaVersion?: number;
};

export function defineConfig(config: EpicenterConfig): EpicenterConfig {
  return config;
}
```

```ts
// packages/workspace/src/daemon/client.ts::getDaemon
import { findProjectRoot } from "../client/find-project-root.js";

// MissingConfig variant deleted. Either the project resolves (config exists
// and was loaded into routes), or findProjectRoot threw upstream.
```

```ts
// packages/cli/src/commands/up.ts::runUp
async function runUp(opts: UpOptions) {
  const projectDir = resolveProjectDir(opts); // walks up, OR auto-creates if -C is fresh
  await provisionProject(projectDir); // writes config, .epicenter/, .gitignore
  const config = await loadProjectConfig(projectDir);
  const routes = config.routes ?? [];
  // ...claim lease, bind socket, open routes...
}
```

```ts
// packages/workspace/src/paths/user-paths.ts (new)
import envPaths from "env-paths";

const paths = envPaths("epicenter", { suffix: "" });
export const userConfigDir = paths.config;
export const userDataDir = paths.data;
export const userCacheDir = paths.cache;
export const userLogDir = paths.log;
```

```ts
// packages/workspace/src/daemon/paths.ts
import { join } from "node:path";
import { tmpdir } from "node:os";

export function runtimeDir(): string {
  if (process.env.XDG_RUNTIME_DIR) {
    return join(process.env.XDG_RUNTIME_DIR, "epicenter");
  }
  // macOS, Windows (Unix-socket emulation paths), Linux without XDG
  return join(tmpdir(), "epicenter");
}

export function socketPathFor(dir: string): string {
  const socketPath = join(runtimeDir(), `${dirHash(dir)}.sock`);
  if (socketPath.length > 95) {
    throw new Error(
      `socketPathFor: resolved path is ${socketPath.length} bytes, ` +
        `exceeds safe Unix socket limit (95). projectDir=${dir}`,
    );
  }
  return socketPath;
}
```

## What `workspaces/` becomes

`workspaces/` stops being a magic registry. It is a _convention_ for where
humans put route code in a real project. Three legal shapes:

```
trivial inline
<project>/epicenter.config.ts
  -> imports nothing from a sibling dir, defines a route inline

conventional layout (today's apps)
<project>/epicenter.config.ts
<project>/workspaces/fuji/daemon.ts
<project>/workspaces/notes/daemon.ts

from-package
<project>/epicenter.config.ts
  -> imports { fuji } from '@org/fuji-daemon'
```

`discover.ts` is deleted. Folder name validation (`route-validation.ts`) stays
because routes still need valid names, but the name now comes from
`defineDaemonWorkspace({ route: 'fuji', ... })` or a derived field on the
module, not from scraping the folder name.

## Daemon identity edge cases

`dirHash(realpathSync(projectDir))` keys sockets, leases, and logs.

| Case                                   | Behavior                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project moves                          | New realpath → new hash → daemon thinks it is a new project. Old `<old-hash>.sock` and lease are orphaned; cleaned at next `daemon up` startup.              |
| Symlinks                               | `realpathSync` collapses them. One daemon per real path.                                                                                                     |
| Two checkouts (`app/` and `app-copy/`) | Different real paths → different hashes → independent daemons.                                                                                               |
| Two users on one machine               | `env-paths` and `tmpdir` are per-user. No collision.                                                                                                         |
| `epicenter.config.ts` deleted mid-run  | Daemon keeps serving on its socket; next `findProjectRoot` from a subdir fails. User should `epicenter daemon down` first. Documented behavior, not a crash. |
| Stale `<hash>.sock` after reboot       | macOS: cleaned at next `daemon up` (orphan sweep in `runtime-files.ts`). Linux: tmpfs is cleared by the OS.                                                  |
| Symlink at runtime path                | `runtimeDir()` does not resolve symlinks; we trust XDG_RUNTIME_DIR / $TMPDIR.                                                                                |

## Patch plan

Three commits, one PR. Order matters: tests in commit 1 lock down the new
behavior before code in commit 2 deletes the old shape.

### Commit 1: introduce `defineConfig` and the new path resolvers

Additive only. Does not remove old behavior.

- `packages/workspace/src/config/define-config.ts` (new): `defineConfig`, `EpicenterConfig` type.
- `packages/workspace/src/config/load-project-config.ts` (new): import the project's `epicenter.config.ts` and return the validated config.
- `packages/workspace/src/config/define-config.test.ts` (new): type tests, identity behavior.
- `packages/workspace/src/paths/user-paths.ts` (new): re-export `env-paths` results under named symbols.
- `packages/workspace/src/client/find-project-root.ts` (new): walk up for `epicenter.config.ts`.
- `packages/workspace/src/client/find-project-root.test.ts` (new): walk-up, throw at fs root, descend into subdir behavior.
- Add `env-paths` to `packages/workspace/package.json`.
- Export `defineConfig`, `userConfigDir`, `userDataDir`, `userCacheDir`, `userLogDir`, `findProjectRoot` from `packages/workspace/src/index.ts`.

### Commit 2: cut over

The breaking change. Old paths gone, no aliases.

- `packages/workspace/src/client/find-epicenter-dir.ts`: delete file. All references swap to `findProjectRoot`.
- `packages/workspace/src/client/connect-daemon-actions.ts`: import `findProjectRoot`. Update JSDoc lines 38, 43, 45, 57 to reference `epicenter.config.ts`.
- `packages/workspace/src/daemon/client.ts`: delete `DaemonError.MissingConfig` variant entirely. `getDaemon` becomes "resolve project, get socket path, ping; if down, return `Required`." Drop the `workspacesPath` check.
- `packages/workspace/src/daemon/paths.ts`: `epicenterHome()` deleted. `runtimeDir()` uses `XDG_RUNTIME_DIR` or `tmpdir()`. Logs move from `~/.epicenter/log/` to `userLogDir` (env-paths). Add the 95-byte socket-path guard.
- `packages/workspace/src/workspace-apps/discover.ts`: delete the filesystem-scan core. Keep `WorkspaceAppEntry`, `validateDaemonRouteNames`, `WORKSPACES_DIRNAME` if still useful for the convention; remove the auto-scan.
- `packages/cli/src/commands/up.ts::runUp`: read routes from `loadProjectConfig(projectDir)`, not `discoverWorkspaceApps`. On a fresh `-C`, write the minimal config file (~3 lines) and the `.epicenter/.gitignore`.
- `packages/cli/src/util/common-options.ts`: `-C` description becomes "Project root (or any directory under it; discovery walks up to the nearest `epicenter.config.ts`)."
- `packages/workspace/src/daemon/define-daemon-workspace.ts`: no change to the type or function; this is the building block the new config consumes.
- Touched tests: `find-project-root.test.ts` replaces `find-epicenter-dir.test.ts`; `up.test.ts` asserts the config file is written; `discover.test.ts` either deletes (if the scanner is gone) or shrinks to validating the convention helper.

### Commit 3: docs and skill text

- `packages/cli/README.md`: rewrite project-discovery section; remove the stale "`.epicenter/daemon.sock` lives in the project" claim; describe `epicenter.config.ts` + `.epicenter/` + user paths via env-paths.
- `apps/fuji/README.md`: update marker references; drop the in-project socket line.
- `docs/scripting.md` line 46: single-marker walk-up to `epicenter.config.ts`.
- `.agents/skills/workspace-app-layout/SKILL.md`: replace dual-marker text; add `defineConfig` example.
- `.agents/skills/greenfield-clean-breaks/SKILL.md`: keep the `defineConfig` example; add a pointer to this spec as the worked example.

## Verification

```
bun test packages/workspace/src/client/find-project-root.test.ts
bun test packages/workspace/src/config/define-config.test.ts
bun test packages/workspace/src/paths/user-paths.test.ts
bun test packages/workspace/src/daemon/paths.test.ts
bun test packages/workspace/src/daemon/client.test.ts
bun test packages/cli/src/commands/up.test.ts
bun test packages/cli/test/e2e-up-cross-peer.test.ts
bun run --cwd packages/workspace typecheck
bun run --cwd packages/cli typecheck
```

Manual smoke (one terminal):

```
cd /tmp && mkdir new-project && cd new-project
epicenter daemon up                              # writes epicenter.config.ts + .epicenter/
ls -la                                            # epicenter.config.ts (file), .epicenter/ (dir)
cat epicenter.config.ts                          # 3-line minimal defineConfig({})
cat .epicenter/.gitignore                        # sqlite/, yjs/, md/, log/
epicenter daemon down
```

## What is refused

This spec refuses several behaviors. The refusal is the point; each one
deletes a code family.

```
- workspaces/ as a project marker
  deletes: dual-marker walk-up, MissingConfig error variant, every
           "or .epicenter/" prose branch in docs

- filesystem scan as the route registry
  deletes: discover.ts core loop, case-collision validation against
           folder names, "what if the folder name has a space" branch

- the directory marker named .epicenter/
  deletes: same-basename ambiguity, every `epicenterDir` variable

- ~/.epicenter/ as a single user-global directory
  deletes: epicenterHome() helper, mixed-purpose user dotdir,
           macOS-citizenship complaints about hidden dotdir in home

- a "default project" at ~/
  deletes: the question "what happens when I run epicenter from ~",
           backup-and-encryption story for non-explicit projects

- compatibility aliases for the old layout
  deletes: every "if old marker found, fall back" branch, the
           permanent maintenance of a migration parser

- a separate `epicenter init` command
  deletes: a parallel verb, the "you forgot to run init" failure mode
```

## Migration impact

Existing projects must do one thing: create `epicenter.config.ts`. Two paths
to do it:

```
manual:    write a 3-line file (the default `epicenter daemon up` writes)
automatic: a future `epicenter migrate` command (separate spec)
```

For development monorepo (`apps/fuji`, `apps/honeycrisp`, `apps/opensidian`),
each app's existing `daemon.ts` already default-exports
`defineDaemonWorkspace(...)`. A project that wants to use one is one config
file away:

```ts
// my-project/epicenter.config.ts
import { defineConfig } from "@epicenter/workspace";
import fuji from "../../apps/fuji/daemon";
export default defineConfig({ routes: [fuji] });
```

No daemon code changes. No `defineDaemonWorkspace` signature changes.

## Open questions

1. **Does `defineConfig` validate at construction or at load?** Construction-time
   validation gives type errors at config-author time; load-time validation gives
   richer runtime messages. Lean: type-only at construction, arktype validation
   at load (matches the daemon-app pattern at the socket boundary).

2. **Where does `defineConfig` live?** Proposed: `@epicenter/workspace`
   (`packages/workspace/src/config/define-config.ts`). Alternative: a
   thinner `@epicenter/config` package. The first is simpler; the second is
   cleaner if config evolves into something heavier. Default to the first.

3. **Does the config file support `.js`, `.mjs`, `.json` fallbacks?** Lean: no.
   One filename: `epicenter.config.ts`. Wrangler accepts three formats and
   regrets it. One format keeps the loader trivial and the docs short.

4. **What happens if `loadProjectConfig` throws (syntax error in the user's
   config)?** Surface with a clear error pointing at the file. Do not fall
   back. The user broke their config; tell them.

5. **Does `epicenter daemon up` refuse to overwrite an existing
   `epicenter.config.ts`?** Yes. If the file exists, leave it alone; just
   provision `.epicenter/` if missing. If the file does not exist, write the
   minimal default.

6. **`env-paths` "suffix" option.** `env-paths` defaults to appending `-nodejs`
   to the app name on Linux. We pass `{ suffix: '' }` to get plain
   `~/.config/epicenter`. Confirmed in the spec; flagged here so future
   readers do not relitigate it.

7. **Should this spec also rename `defineDaemonWorkspace` to `defineRoute` or
   similar?** Lean: no, not in this PR. The current name is accurate and
   widely cited. Renaming is reversible later; scope creep here is not.

8. **ADR.** This decision is hard to reverse, surprising without context, and
   the result of a real trade-off. Write a short ADR after merge capturing why
   `epicenter.config.ts` is the marker, why `~/` is not a project, why sockets
   are an OS detail, and which alternatives were rejected (default project,
   directory marker, three-distinct-name renames).
