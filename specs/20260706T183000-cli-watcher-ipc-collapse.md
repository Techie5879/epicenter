# CLI watcher IPC collapse

**Date**: 2026-07-06
**Status**: In Progress
**Owner**: Braden
**ADR**: `docs/adr/0112-the-cli-watcher-is-not-a-callable-action-server.md`

## One Sentence

Keep Epicenter's headless watcher, but delete the external daemon IPC plane so a running `epicenter` process syncs and materializes a folder without becoming a callable action server.

## How to read this spec

Read first:

- One Sentence
- Current target shape
- Remaining review focus
- Success criteria

Read historical sections when changing deeper architecture:

- Design decisions
- Implementation plan

Historical only:

- Earlier clean-break analysis named the broader radical-options pass; this spec is the narrower execution slice.

## Historical shape before the collapse

The CLI used to have two products tangled together:

```txt
Headless watcher:
  epicenter daemon up
    -> load epicenter.config.ts
    -> claim .epicenter machine state
    -> open mount
    -> sync
    -> materialize SQLite / Markdown
    -> write logs and metadata
    -> stop on signal

Callable action server:
  epicenter run/list/peers
    -> daemon client
    -> Unix socket
    -> Hono app
    -> /run /list /peers
    -> action registry exposed by the mount runtime
```

The first product was useful. The second product was the collapse target.

## Current target shape

The shipped CLI exposes the headless watcher directly: `epicenter up`, `down`, `status`, and `logs`. `up` opens one app mount headlessly for one folder, keeps sync and materializers alive, writes logs and metadata, and shuts down cleanly. It does not bind a socket and nothing can call it.

```txt
CLI after Waves 1-3:
  up        keep, no socket
  down      keep, metadata + pid signal
  status    keep, metadata + pid liveness
  logs      keep, log file tail/read
  auth      keep
  init      keep
  blobs     keep
  matter    keep

  run       deleted
  list      deleted
  peers     deleted
```

Workspace actions stay. Apps, local tools, tests, and future app-specific commands can call actions in-process. This spec deleted only the generic off-process daemon action bus.

## Motivation

The removed daemon IPC plane preserved an old story: the daemon as a callable peer. ADR-0009 said `run`, `list`, and `peers` required a daemon because the daemon represented an online callable device. That stopped matching the code before this collapse. The mesh peer, `run --peer`, relay action dispatch, and the daemon action handler are all gone.

That shape created problems:

1. The watcher has to carry an action registry because the socket can serve it, even though the sync/materialization product does not need external calls.
2. `connectDaemonActions` and the daemon client create a public-looking script surface with no production caller.
3. The CLI teaches users `run`, `list`, and `peers` while the live product need is headless sync and materialization.
4. Hono, socket routing, request schemas, JSON parsing, manifest output, and error mapping exist only to support the callable-server product.

The desired state is smaller: a headless watcher plus explicit future verbs when a real workflow earns them.

## Design decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Keep headless operation | 2 coherence | Keep `daemon up/down/ps/logs` in Wave 1 | The watcher owns real lifecycle value: lease, sync, materializers, logs, metadata. |
| Delete external IPC | 2 coherence | Remove socket, Hono app, daemon client, `/run`, `/list`, `/peers` | The product sentence does not include “call a running process.” ADR-0112 records the durable decision. |
| Keep workspace actions | 2 coherence | Do not delete `defineActions`, `invokeAction`, local tool catalogs, or app action registries | Actions are still the in-process write/tool boundary. Only the off-process bus is removed. |
| Do not rename daemon yet | 3 taste | Leave `epicenter daemon up` in Wave 1 | Avoid hiding the functional collapse under vocabulary churn. Rename after the socket deletion is green. |
| Do not add `sync` yet | Deferred | Add one-shot sync after watcher shape is smaller | `sync` needs a convergence contract; it should not block deleting unused IPC. |

## Architecture

Removed path:

```txt
epicenter run/list/peers
  -> daemon client
    -> Unix socket transport
      -> Hono app
        -> mount.runtime.actions / mount.runtime.collaboration.peers
```

Current path:

```txt
epicenter up
  -> claim lease
  -> openEpicenterRoot
    -> load epicenter.config.ts
    -> open mount
      -> sync
      -> materializers
  -> write metadata
  -> monitor collaboration status on stderr
  -> stop on SIGINT/SIGTERM

No command talks back to this process.
```

## Implementation plan

### Wave 1: delete external daemon IPC

Goal: the watcher still runs, but no socket exists and no CLI command can call it.

- [x] Remove CLI commands `run`, `list`, and `peers` from `packages/cli/src/commands/` and from `packages/cli/src/cli.ts`.
- [x] Delete CLI utilities used only by `run`/`list` if no callers remain, especially JSON input parsing and action-output helpers.
- [x] Remove `startDaemonServer` from `packages/cli/src/commands/up.ts`; `runUp` should open the mount and write metadata without binding a socket.
- [x] Delete workspace daemon IPC modules: `app.ts`, `server.ts`, `unix-socket.ts`, `client.ts`, `action-handler.ts`, `action-errors.ts`, and `list-mount` tests/helpers if no non-test caller remains.
- [x] Delete client proxy modules: `packages/workspace/src/client/connect-daemon-actions.ts` and `daemon-actions.ts`, plus tests.
- [x] Remove now-dead node exports: `connectDaemonActions`, `DaemonActions`, `RunError`, `DaemonListSnapshot`, `PeerSnapshot`, `RunRequest`, `DaemonClient`, `DaemonError`, `daemonClient`, `getDaemon`, `pingDaemon`, `socketPathFor`, `startDaemonServer`, and `DaemonServer` unless a real non-test caller remains.
- [x] Remove package dependencies that become unused, likely `hono`, `@hono/standard-validator`, and `arktype` from `@epicenter/workspace`; remove CLI-only dependencies made unused by deleting `list`/`run`.
- [x] Update tests so lifecycle coverage proves `daemon up` opens and tears down the mount without socket assertions.
- [x] Re-grep deleted names and sweep stale JSDoc, README claims, and docs that teach external IPC.

Green checkpoint:

```txt
bun test packages/cli packages/workspace
bun run --cwd packages/cli typecheck
bun run --cwd packages/workspace typecheck
```

If repo scripts do not support package arguments for `bun test`, run targeted test files first, then the package-local test scripts.

### Wave 2: trim runtime shape

Goal: once no socket serves actions, `DaemonRuntime` should not require `actions` just to satisfy an old transport.

- [x] Remove `actions` from `DaemonRuntime` if all remaining callers can use a runtime without it. (Zero non-test callers; `compose` is side-effect only and `MountComposition` is deleted.)
- [x] Keep workspace actions in connected workspace bundles.
- [x] Decide whether materializer maintenance operations should remain action-shaped or become direct materializer methods. (Direct methods: `rebuild(table?)` and `search(table, query, options?)`; the action shape existed only for wire introspection.)

### Wave 3: lifecycle surface rename

Goal: make the CLI say what the product is.

- [x] Promote `daemon up` to `up`.
- [x] Promote `daemon down` to `down`.
- [x] Rename `daemon ps` to `status`.
- [x] Promote `daemon logs` to `logs`.
- [x] Decide whether to keep temporary aliases. (No aliases: no package script, workflow, or external contract invokes the `daemon` namespace; the only callers were this repo's tests and docs, updated in the same change.)

### Wave 4: one-shot sync

Refused for now. `epicenter sync` is not needed without a concrete workflow, and its convergence contract would be easy to over-promise. Keep `epicenter up` as the lifecycle surface until a real user needs one-shot sync and can name what "done" means.

## PR strategy history

Wave 1 was reviewable on its own because the headless watcher remained while the callable action server disappeared. Wave 3 then renamed the lifecycle surface to top-level commands with no compatibility aliases.

The durable PR summary was:

```txt
Before:
  run/list/peers -> daemon client -> Unix socket -> Hono app -> action registry

After:
  up opens the mount, syncs, materializes, writes logs and metadata, and cannot be called.

Workspace actions remain in-process for apps and local tools. Future write workflows should earn explicit app verbs instead of reviving a generic daemon action bus.
```

## Remaining review focus

Waves 1-3 are shipped. Wave 4 is refused for now: do not add `epicenter sync` without a concrete workflow and a crisp definition of "done."

## Edge cases

### Inactive mount

`epicenter up` may still return an inactive mount when a session-required app is signed out. It should report the reason, release the lease, and exit without metadata for a running watcher.

### Mount with collaboration

`epicenter up` should still print initial peers and sync status from the in-process collaboration object. Deleting `epicenter peers` removes only the on-demand query path.

### External package consumers

`@epicenter/workspace` is published. Removing `connectDaemonActions` and daemon client exports is a clean break. Pause if we decide published compatibility matters for the current release; otherwise ADR-0112 is the decision record.

## Refused follow-up

Do not add `epicenter sync` as speculative symmetry with `up`. A one-shot command only earns itself when a real workflow needs it and can define convergence across root-doc sync, child-doc sync, and materializer flush/drain.

## Success criteria

- [x] `epicenter up` starts a mount, syncs, materializes, writes metadata, logs status, and tears down.
- [x] No Unix socket is bound by the watcher.
- [x] `epicenter run`, `epicenter list`, and `epicenter peers` are gone from the CLI.
- [x] No exported daemon client or `connectDaemonActions` surface remains without a non-test caller.
- [x] Workspace actions still work in-process.
- [x] Package tests and typechecks pass for `packages/cli` and `packages/workspace`.
- [x] ADR-0112 is accepted, and ADR-0009 is no longer the active decision after merge.

## References

- `docs/adr/0112-the-cli-watcher-is-not-a-callable-action-server.md` - durable decision for the clean break.
- `docs/adr/0009-the-cli-dispatches-through-a-mandatory-daemon.md` - superseded callable-peer rationale.
- `packages/cli/src/commands/up.ts` - watcher startup owner.
- `packages/cli/src/cli.ts` - CLI command registration.
- `packages/workspace/src/config/open-epicenter-root.ts` - config-to-mounted-runtime startup path.
- `packages/workspace/src/daemon/types.ts` - watcher runtime shape after IPC deletion.
