# CLI/daemon collapse waves

Status: waves 1-2 implemented; wave 3 deferred with triggers.

Source: greenfield clean-break consult on the CLI/daemon shape, plus a
latency experiment for daemonless one-shot `run`.

## Product sentence

The lease owner runs actions; the user enters through `epicenter run`; the
daemon's one job is staying online as a live peer (presence, inbound
dispatch, materializer projections).

## Experiment record

Throwaway benchmark (`bench-oneshot.ts` at the repo root, untracked) drove
the full one-shot path against a temp Epicenter root mounting the real fuji app
with stub signed-in auth and no relay: bun spawn, library import,
`openEpicenterRoot`, invoke `entries_get_all_valid`, dispose.

| Scenario                          | openEpicenterRoot | total wall  |
| --------------------------------- | ----------------- | ----------- |
| Empty root                        | 41-53 ms          | 0.17-0.25 s |
| 300 entries (2.8 MB Yjs log)      | 65-69 ms          | ~0.21 s     |

Latency gate for daemonless `run` was "under ~1 s"; it passes by roughly 5x.
`attachYjsLog` hydration is synchronous, dispose is clean, and the sync
supervisor exits gracefully offline.

The experiment also surfaced a correctness bug, recorded under wave 2: a
short-lived process drops markdown materializer work entirely. Seeding 300
entries left 300 rows in the SQLite materializer and zero `.md` files, with
zero body reads attempted across three subsequent opens.

## Wave 1: sure collapses (implemented)

- Deleted the `REMOVED_DAEMON_COMMANDS` tombstone in `packages/cli/src/cli.ts`;
  yargs `.strict()` already rejects unknown commands.
- Replaced the recursive tree renderer in `epicenter list` with mount-grouped
  flat output; action paths are exactly `mount.action_key`, so the tree was
  always two levels deep.
- Moved Epicenter-root scaffolding out of `daemon up` into a new `epicenter init`.
  `daemon up` no longer writes `epicenter.config.ts` or litters `.epicenter`
  into non-Epicenter-root directories; on a missing config it fails with a hint
  pointing at `init`. Per-dir provisioning collapsed entirely: the attach
  primitives create their own data dirs on demand (verified by the benchmark,
  which never provisioned and still got `sqlite/` and `yjs/`), and
  `.epicenter/log` had no consumer (daemon logs live in the user log dir).
  `daemon up` now only ensures `.epicenter/.gitignore` containing `*`, a
  universal rule instead of a maintained directory list.
- Made the socket ping the single liveness authority in `daemon ps`; the pid
  in metadata exists only so `daemon down` can signal the process.
- Merged `/invoke` and `/dispatch` into one `/run` route, merged
  `InvokeError` + `PeerDispatchError` into one `RunError` union, and
  collapsed the CLI's dual error rendering. The peer fields are grouped into
  one optional `peer: { to, waitMs? }` object, so "waitMs without a peer
  target" is structurally unrepresentable instead of a runtime guard. The
  daemon owns the peer wait default (`DEFAULT_PEER_WAIT_MS`); the CLI sends
  `waitMs` only when the user passes `--wait`. `waitMs` stays a duration, not
  an absolute deadline: same-clock single hop over a Unix socket, and the CLI
  flag is a duration, so a deadline would only add conversions.

Wire compatibility was explicitly refused: no `/invoke` or `/dispatch`
aliases remain. CLI and daemon ship together from this repo; there is no
published contract that earns an alias.

## Wave 2: materializer drain on teardown (implemented)

The bug: `attachMarkdownExport` started its initial flush as a
fire-and-forget promise (`whenFlushed`, `export.ts`) and aborted it at the
first dispose check; row renders triggered by observers were also unawaited.
The SQLite materializer had the same shape: dispose cancelled the debounced
flush (dropping `pendingSync`) and the initial DDL + full-load aborted on a
dispose-immediately. Nothing in the mount dispose chain drained any of it,
so `epicenter daemon down` shortly after a mutation could drop projection
writes mid-flight.

The fix, in three layers:

- Both materializers now drain on dispose and expose a `whenDisposed`
  barrier (per the attach-primitive invariant): the markdown export awaits
  the initial flush plus in-flight observer render batches; the SQLite core
  flushes the pending row set through its db queue before closing. Each
  drain is bounded by a per-materializer `disposeTimeoutMs` (default 10 s)
  so a hung HTTP body read or statement cannot wedge shutdown.
- A `waitFor` gate that never opened owes nothing: disposing before the
  gate resolves abandons the flush instead of sitting out the timeout, and
  the flush bails if the gate opens after dispose. Draining after
  `ydoc.destroy()` is safe because YKV reads come from in-memory maps that
  survive doc destruction.
- `attachProjectInfrastructure` takes a `materializers` list and its
  `[Symbol.asyncDispose]` awaits their `whenDisposed` barriers alongside
  collaboration and log teardown; the fuji, honeycrisp, and tab-manager
  mounts register their sqlite + markdown attachments there, and the
  daemon's teardown stack already awaits each runtime's async dispose.

## Wave 3: daemonless `run` (deferred)

Candidate:
  `epicenter run`/`list` work without a running daemon: if the root
  socket answers, route through it; otherwise open the root in-process
  offline, run, dispose. The daemon remains for live-peer duties; `--peer`
  honestly requires it.

Refusal (for now):
  Latency is a green light (see experiment record), but the design is
  blocked on three decisions, not performance:

  1. Materializer policy for one-shots. Fuji's markdown export re-reads
     every entry body over HTTP on each attach (in-memory `fileState`), so a
     one-shot that properly drains pays O(entries) network round trips per
     CLI invocation. Likely answer: projections are the daemon's job and
     one-shot runs skip materializers, but that must be decided, not
     defaulted.
  2. Relay flush policy on exit. The WebSocket connects in the background; a
     one-shot mutation gets only a race window to sync. Needs an explicit
     flush-with-timeout-else-sync-later contract.
  3. Lease contention. Socket dead but daemon mid-startup means both sides
     contend for the SQLite lease; the loser needs a defined retry/error.

User loss while deferred:
  `run`/`list`/`peers` keep requiring `epicenter daemon up` first.

Trigger to revisit:
  Deciding to ship daemonless `run` as product direction, or recurring user
  friction reports about the `daemon up` prerequisite. Wave 2 must land
  first.
