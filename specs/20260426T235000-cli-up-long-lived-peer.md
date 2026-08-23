# `epicenter up`: long-lived discoverable peer with local IPC

**Status**: ready to execute
**Date**: 2026-04-26
**Related**: `specs/20260426T230000-drop-manifest-from-awareness.md` (introspection is now an on-demand RPC, which assumes a live peer to call into; this spec gives "live peer" a first-class verb).

> **Path note (2026-05-22):** The socket and log examples using `~/.epicenter/run/` and `~/.epicenter/log/` are superseded. Current daemon sockets and metadata use `runtimeDir()` (`$XDG_RUNTIME_DIR/epicenter` when available, otherwise `os.tmpdir()/epicenter`), and logs use the platform log directory.

## Why this exists

Cross-peer commands (`list --peer`, `run --peer`, anything that uses `describePeer`) only work while *both* peers are processes holding a WS connection to the relay. Awareness has a ~30s TTL; the relay is content-blind by design. So "discover and call peer-a from peer-b" today requires a coordinated two-terminal dance:

```bash
# Terminal 1: keep peer-a "online" by misusing peers as a hand-rolled keep-alive:
epicenter peers --dir peer-a --wait 60000

# Terminal 2: race the 60s window:
epicenter list --dir peer-b --peer notes-repro-peer-a --wait 5000
```

Two problems:

1. **`peers --wait 60000` is doing two unrelated jobs.** It's an inspector *and* a hand-rolled keep-alive. The 60s number is arbitrary and the feature is undiscoverable.
2. **Every transient peer pays full handshake cost.** Cold-start a peer-b process → TLS + WS upgrade + auth + Yjs sync handshake + awareness settle. Hundreds of ms even on a hot machine. Ad-hoc scripting (`for f in *.json; do epicenter run notes.add "$(cat $f)"; done`) becomes painful.

`epicenter up` solves both: an explicit verb for "bring this workspace online as a long-lived peer," plus a local Unix-socket IPC channel that lets sibling CLI invocations share that warm peer instead of standing up their own.

## Invariants (lock these down before anything ships)

These are the things to encode now, before someone "just adds a small flag" later. Every one of them is load-bearing for keeping `up` from drifting into a process-management framework.

1. **Socket path is purely derived from `realpath(--dir)`.** No env-var override (`EPICENTER_SOCKET_PATH`), no config field, no flag. One input → one path. The auto-detect property of sibling commands depends on this.
2. **One daemon per `--dir`, hard-error on collision.** Second `up` exits 1 with `"already running, pid=X"`. Not a warning, not "the second one wins."
3. **IPC protocol is internal.** Wire format is undocumented for external consumers. The CLI is the only client. If a third tool needs in, it imports a future `@epicenter/cli-client` package; we never get pinned by an unknown consumer asserting wire-stability.
4. **No daemon-side config hot-reload.** `up` is bound to the config it loaded at startup. Edit the config → restart. No `--watch`, no SIGHUP-reloads-config, no FS watcher.
5. **No daemonization flags** (`--background`, `--detach`, `--pidfile`). The verb stays `up`, the process stays foreground. Backgrounding is the user's job (`&`, `nohup`, `tmux`, `systemd --user`). Otherwise we own a process-management story we don't want.
6. **`peers --wait` capped at 30 000 ms** with a one-line hint when the user passes a value above 5 000: `"Tip: for long-lived presence, see \`epicenter up\`."`. Past 30 s, you're using `peers` as a daemon. That's now a typed-out instruction to do the right thing.
7. **The daemon serves every workspace its config exports.** `epicenter up` is "this config is online," not "this entry is online." There is no `--workspace` flag on `up`. Sibling commands pass `--workspace` straight through to IPC; the daemon resolves the name via the same `resolveEntry` the cold path uses, so an unknown workspace returns the same error in either path. Resource isolation between workspaces is expressed by splitting them into separate config dirs (one daemon per dir, by design; see "Why per-`--dir`" below).

## Naming

`up` over `host` (less semantic, more lifecycle-clear) and over `serve` (no public HTTP listener; `serve` carries the wrong mental model). Picking `up` invites the natural docker-compose-style sibling verbs:

```
epicenter up        bring the peer online (foreground)
epicenter down      stop a running peer (default: current --dir)
epicenter ps        list running peers (this user, this machine)
epicenter logs      tail the rotating log for a running peer
```

Five top-level verbs total, each one word, each pulling its weight. Reads better than nesting (`up status`, `up stop`) and matches an idiom developers already know.

## What `up` does and doesn't do

```
up                                     peers / list / run (today)
────────────────────────────           ──────────────────────────
process lifetime: until SIGINT         process lifetime: until response
WS connection:    held open            WS connection:    open + close per call
awareness:        published until exit awareness:        published briefly, then gone
listens on:       ~/.epicenter/run/<h>.sock listens on: nothing
side effects:     none beyond presence side effects:    none beyond presence
```

**Not** a public server in the HTTP sense. No port and no public listener. The daemon does use HTTP-shaped routes internally over its Unix socket, but the only "inbound" channels are:
- the relay's RPC (every peer already has this; `up` just stays alive long enough to receive)
- a local Unix socket scoped to this `--dir`, only callable from the same machine and the same Unix user

## Decision

```
┌─────────────────────────────┐         relay (api.epicenter.so)
│  epicenter up --dir foo     │←─── WS ────┐
│  (long-lived process)       │            │
│                             │            ▼
│  ┌──────────────────────┐   │      ┌──────────────┐
│  │ workspace (warm)     │   │      │ peer-b CLI   │
│  │  - sync attachment   │   │      │ (transient)  │
│  │  - awareness present │   │      └──────────────┘
│  │  - actions live      │   │            ▲
│  └──────────────────────┘   │            │ relay RPC
│            ▲                │            │ (inter-process)
│            │ IPC            │            │
│            ▼                │
│  ~/.epicenter/run/<h>.sock  │
└──────────────────────────────┘
            ▲
            │ Unix socket (newline-JSON)
            │
   ┌────────┴────────┐
   │ epicenter run   │  same-host CLI invocations targeting the same --dir
   │ (auto-detects)  │  reuse this daemon's warm workspace; no new WS, no
   └─────────────────┘  awareness settle.
```

### Surface

```bash
# Foreground: Ctrl-C to stop. Streams structured logs to stderr.
# Default-on: prints awareness changes ("peer-b joined" / "peer-b left").
# Pass --quiet to suppress those and emit only errors.
epicenter up   --dir <path> [--quiet]

# Stop a running peer. Defaults to current --dir; --all stops every running peer.
epicenter down [--dir <path> | --all]

# List running peers (this user, this machine).
epicenter ps

# Tail the rotating log file. --follow streams new lines.
epicenter logs [--dir <path>] [--follow]
```

### Discovery from sibling commands

`peers`, `list`, `run` gain an implicit auto-detect:

```
epicenter run --dir peer-b ...
   │
   ├─ derive abs path of --dir
   ├─ hash → ~/.epicenter/run/<h>.sock
   ├─ socket exists AND ping succeeds?
   │       yes → IPC: forward the call, stream result
   │       no  → fall back to today's behavior (transient peer, do call, exit)
   └─
```

No flag. No ceremony. If you `up` it, every other call becomes fast and reliable. If you don't, nothing changes.

## Socket location: per-`--dir`, runtime directory, hashed name

```
<runtimeDir>/run/<sha256(absolute --dir)[:16]>.sock        # IPC socket
<runtimeDir>/run/<sha256(absolute --dir)[:16]>.meta.json   # daemon metadata
~/.epicenter/log/<sha256(absolute --dir)[:16]>.log          # rotating log (always under home)
```

Where `runtimeDir` is resolved per-platform:

```ts
function runtimeDir() {
  // Linux with a session manager (systemd, etc.): tmpfs, auto-cleaned on reboot.
  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, 'epicenter');
  }
  // macOS / Windows / Linux without XDG: discoverable, paired with auth/, log/.
  // Orphan cleanup on `up` startup handles cross-reboot stale sockets.
  return path.join(epicenterPaths.home(), 'run');
}
```

macOS doesn't have a canonical XDG_RUNTIME_DIR equivalent. `$TMPDIR` is "temporary files" semantically, not "runtime state," and its long path eats into our 104-char socket budget. macOS therefore uses `~/.epicenter/run/` like Windows; orphan cleanup at `up` startup substitutes for Linux's reboot tmpfs cleanup.

The metadata file is `<h>.meta.json` (paired visibly with `<h>.sock`):

```jsonc
{
  "pid": 51234,
  "dir": "/Users/braden/.../examples/notes-cross-peer/peer-a",
  "startedAt": "2026-04-26T23:50:01.224Z",
  "cliVersion": "0.1.0",
  "configMtime": 1745700301000   // for stale-config detection in `epicenter ps`
}
```

The daemon serves every workspace its config exports (Invariant 7), so the loaded set isn't recorded here. Read the config file to know what's loaded. The sidecar stays static-facts-only; live state (per-workspace sync status, peer counts) is observable via the daemon's foreground stderr and the existing `peers` IPC verb. A JSON-shaped `status` introspection verb is deferred until a tooling consumer asks for it.

### Why hashed / global rather than `<dir>/.epicenter/run.sock`

1. **macOS Unix-socket path limit is 104 chars.** Conductor workspace paths alone (`/Users/braden/conductor/workspaces/epicenter/copenhagen-v1/examples/notes-cross-peer/peer-a/.epicenter/run.sock`) blow past it. Project-relative sockets are a footgun waiting on a long monorepo path.
2. **No project-tree pollution.** No new `.gitignore` entry per workspace.
3. **Hash is stable.** `epicenter run --dir peer-a` from `/tmp` and from inside the dir resolve to the same socket. `realpath(--dir)` is the input.
4. **Truncated SHA-256 (16 hex = 64 bits)** keeps paths short while keeping collisions cryptographically improbable: with N concurrent daemons the collision probability is ~N²/2^65. At N=1000 that's ~10⁻¹⁴.

Trade-off accepted: a stale `~/.epicenter/run/<h>.sock` orphan can survive a hard kill. `up` startup checks the metadata JSON's `pid` against `kill -0` and unlinks if dead. If the metadata is missing but the socket exists, treat it as orphan and unlink.

### Why per-`--dir` rather than one global daemon

Each workspace dir has its own `epicenter.config.ts`, its own auth (potentially different server URL), its own action surface, its own sync session. One global multiplexer would have to handle all of those plus version-skew during dev. Per-`--dir` daemons isolate cleanly:

- Editing one workspace's config doesn't restart unrelated daemons.
- Two parallel agents in two conductor branches don't fight over a shared daemon.
- `epicenter down --dir foo` is precise; you can never accidentally take down somebody else's workspace.

The cost is N processes for N active workspaces. That's fine, since the practical N is "the workspaces you're actively working in" (typically 1-3).

## IPC wire protocol

HTTP over the Unix socket. The daemon is a `Bun.serve({ unix, routes })` instance; the CLI client is `fetch(url, { unix })`. One route per command, JSON body in and out, no framing layer of our own.

```http
# request: POST /<cmd>; body is JSON-encoded args (or empty for void cmds)
POST /list      { "path": "notes", "mode": { "kind": "local" }, "waitMs": 5000 }
POST /run       { "actionPath": "notes.add", "input": { "body": "x" }, "waitMs": 0 }
POST /peers     { "workspace": "demo" }
POST /ping
POST /shutdown
```

```jsonc
// 200 response body: Result<T, SerializedError>
{ "data": { /* T */ }, "error": null }                                 // success
{ "data": null, "error": { "name": "PeerOffline", "message": "..." } } // domain failure (still 200)

// non-200 (handler crashed, route unknown): error body is SerializedError
// HTTP 500 -> { "name": "HandlerCrashed", "message": "..." }
// HTTP 404 -> "not found" (unknown route)
```

Domain errors and successes share status 200 because callers narrow on `result.error.name` (`RunError`, `RpcError.PeerOffline`, etc.); HTTP status is reserved for transport-level failures, which the client maps to `IpcClientError.NoDaemon` / `Timeout` / `HandlerCrashed`.

CLI commands (`list`, `run`, `peers`) translate their argv into the body of a `POST /<cmd>` and parse the `Result<T, E>` from the response. This is the same envelope the transient (in-process) path returns. The daemon's route handlers dispatch into the same code paths that transient mode uses; the only difference is whose `SyncAttachment` is at the top of the call stack.

## Process lifecycle

| event | behavior |
| --- | --- |
| start | resolve abs `--dir` → hash → check existing socket. If existing daemon answers `ping`, exit 1 with `"already running, pid=X"`. If stale, unlink and continue. Validate config (`loadConfig` throw → exit 1 with the error, no partial state). Construct **every** workspace the config exports, await each `whenConnected` concurrently with a hardcoded 10 000 ms ceiling. One bad workspace fails the whole daemon; split configs for isolation. The ceiling is a stopgap until the workspace package surfaces typed connection failures (see `20260427T120000-workspace-sync-failed-phase.md`); on timeout, an expired auth token surfaces as `"connect failed: <name>: 401 Unauthorized. Try \`epicenter auth login\`"`. Write metadata JSON, listen on socket. Print one-line `"online (workspaces=[a, b, c])"` followed by an initial peers snapshot per workspace so the operator sees current state, not just future deltas. |
| awareness change | (default) print `"peer-b joined (deviceId=...)"` / `"peer-b left"` to stderr. Suppress with `--quiet`. |
| sync state change | print `"connecting (retry N)"` / `"connected"` / `"offline"` transitions. These are operationally critical (you want to know the moment the WS drops); not suppressed by `--quiet`. |
| SIGINT / SIGTERM | stop accepting new IPC, flush in-flight responses (best-effort, 2 s budget), `[Symbol.asyncDispose]` the workspace, unlink socket + metadata, exit 0. |
| `epicenter down --dir foo` | sends `{cmd:"shutdown"}` over IPC. Falls back to SIGTERM if IPC unresponsive within 1 s. |
| `epicenter down --all` | enumerate `<runtimeDir>/run/*.meta.json`, `shutdown` each in parallel. Prints a one-line summary (`"stopped 3 daemons"`); no confirmation prompt. Daemons are kill-friendly by design. |
| crash (uncaught) | metadata + socket may be orphaned. Next `up` start cleans them up. Worst case: one extra `"cleaned orphan socket"` log line. |
| config file change | **default: ignore** (Invariant 4). `epicenter ps` surfaces a `configChanged: true` flag computed from `configMtime` so the operator knows when to restart. |

### Why no auto-reload on config change

The temptation is to watch `epicenter.config.ts` and restart the workspace in-process when it changes. Don't:

- Workspaces own a CRDT doc, table extensions, attached encryption, sync state. Hot-swapping mid-flight is the category of operation that's never *quite* right and silently corrupts state when it isn't.
- The user's mental model after `epicenter up` should be "this is the state I committed to." If they edit the config, they should consciously restart.
- The hybrid auto-detect already makes restart cheap: `^C`, edit, `epicenter up --dir foo` again. Sibling commands re-bind to the new daemon on next call.

A future spec can add `epicenter reload` as an opt-in surface that does a clean teardown + reattach inside the same process, but it's not a v1 concern.

## Logging

`createLogger` from `wellcrafted/logger`. Sinks:

- **stderr**: human-friendly, default to `info`. `--log-level debug` for development. Awareness-change lines (`peer-b joined` / `peer-b left`) emit at `info`; `--quiet` raises the floor to `warn`.
- **`~/.epicenter/log/<h>.log`**: structured JSON Lines, rotating at 10MB / keeping 3 generations. Always on. `epicenter logs --follow` tails it.

Log every accepted IPC connection (cmd + caller pid via `SO_PEERCRED`), every awareness change to peers (joined/left), every reconnect, and every uncaught error inside dispatch. *Do not* log RPC inputs by default; they may contain user content. `--log-level trace` opts in.

## Security model

The Unix socket is created with mode `0600` and lives under `<runtimeDir>/run/` (which is created `0700` if it doesn't exist). Only the same Unix user on the same machine can talk to the daemon. There is no auth on the IPC channel beyond filesystem permissions, same as `gpg-agent`, `ssh-agent`, the Docker socket on a single-user dev machine.

On Linux multi-user systems with a session manager, `XDG_RUNTIME_DIR` is per-user (`/run/user/<uid>/`) and already isolates correctly. On macOS/Windows the home-dir fallback is per-user by construction.

## What this is not (out of scope for v1)

- **HTTP transport.** No `--listen 0.0.0.0:7000`. If we want network-callable peers later, that's a separate spec; today's only inbound channel is the relay.
- **System-init integration.** No `launchd` plist, no `systemd` unit. Foreground process; users compose with `nohup`, `tmux`, `pm2`, `systemd --user`, or a dev-loop tool of their choice.
- **Daemon-per-machine.** Per-`--dir`, full stop. Multiplexing belongs to a different product.
- **Auto-spawn on first call.** Sibling commands *use* a daemon if present, but never start one. Auto-spawn is the magic that bites users with stale schemas; opt-in via `epicenter up` keeps the mental model honest.
- **`--require-up` / `--no-up` flags.** Useful only when scripts care to assert daemon presence/absence (e.g. CI: "fail loudly if you fall through to a transient peer instead of using the warm one I started"). Add when a real consumer asks; speculative for v1.
- **`--idle-timeout`.** Auto-die after N ms of no IPC traffic, gpg-agent style. Useful for `epicenter up --idle-timeout 60s &; ...do work...; daemon exits on its own`. Explicit `^C` is fine for v1.
- **`epicenter ps --json` / `status` IPC verb.** Defer until a tooling consumer (Conductor panel, shell prompt) asks. The current `peers` verb plus the daemon's foreground stderr cover the human-debug case; a JSON-shaped daemon-state introspection earns its keep only once something parses it.

## Migration path

Once `up` ships, `peers --wait <large>` stops being the recommended way to keep a peer online. Update:

- `examples/notes-cross-peer/README.md`: Terminal 1 becomes `bun x epicenter up --dir peer-a` (no `--wait`); Terminal 2 commands stay literally identical (auto-detected).
- `packages/cli/src/commands/peers.ts`: enforce Invariant 6: cap `--wait` at 30 000 ms, print the `epicenter up` hint when the user passes anything above 5 000.

No breaking changes. The current two-terminal dance keeps working.

## Acceptance criteria

- `epicenter up --dir peer-a` starts, prints `"online (workspaces=[notes])"` followed by the initial peers snapshot per loaded workspace, holds connection, prints `"notes: peer-b joined"` when peer-b connects, exits cleanly on Ctrl-C, leaves no orphan socket/metadata.
- With `up` running for peer-a, `epicenter run --dir peer-b --peer notes-repro-peer-a notes.add '...'` succeeds in <100 ms wall time (vs >2 s for transient mode), and `up` logs the inbound RPC.
- `epicenter ps` lists every running daemon with dir, pid, uptime, `configChanged` flag. (No workspace column: the daemon serves every workspace its config exports; read the config file to know what's loaded.)
- `epicenter logs --dir peer-a --follow` tails the rotating log file.
- Killing the daemon with `kill -9` and restarting `up` produces one `"cleaned orphan socket"` log line and starts cleanly.
- Two `up` invocations against the same `--dir`: the second exits 1 with `"daemon already running (pid=X)"`.
- `epicenter down --dir peer-a` shuts down gracefully; `epicenter down --all` shuts down every running daemon for this user without prompting.
- **Stale-auth fast-fail**: with an expired token, `epicenter up --dir peer-a` exits within ~10 s (hardcoded ceiling) with `"connect failed: 401 Unauthorized. Try \`epicenter auth login\`"`, never an indefinite hang. The clock is a stopgap; the proper fix is in the workspace package's sync layer (see `20260427T120000-workspace-sync-failed-phase.md`), after which the ceiling is deleted.
- **Multi-workspace daemon (Invariant 7)**: `epicenter up --dir foo` running with a config that exports `alpha` and `beta`, then `epicenter list --dir foo --workspace beta` routes through the daemon to `beta` (not an error about a "wrong" workspace). `epicenter peers --dir foo` returns peers grouped by workspace across both. An unknown workspace name returns the same `resolveEntry` error the cold path emits.
- **Invariant 6 enforced**: `epicenter peers --dir foo --wait 60000` errors with `"--wait capped at 30000 ms; use \`epicenter up\` for long-lived presence"`. `--wait 10000` succeeds but prints the hint to stderr.
