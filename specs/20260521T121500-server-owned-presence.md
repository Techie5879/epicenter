# Server-Owned Presence: Stop Using Yjs Awareness For Liveness

**Date**: 2026-05-21
**Status**: Draft
**Author**: AI-assisted (with adversarial review)
**Branch**: TBD (proposed: `redesign/server-owned-presence`)
**Builds on**: commits `04f5d4c4` (clock 0 fix) and `d61edd8e` (wake broadcast removal)

## One sentence

The relay owns presence as plain server state read from `connections`; the y-protocols Awareness round-trip and its hibernation restore disappear because Awareness was the wrong primitive for "is this install connected right now."

## TL;DR

```
Today                                          After

client                                         client
  publishes liveness via Awareness                connects, that is the publish
  parses inbound AWARENESS frames                 parses inbound presence_* frames
  derives devices.list() from awareness states    derives devices.list() from presence set

server                                         server
  filterAwarenessUpdate validates liveness        URL-stamped installationId is the address
  applyAwarenessUpdate on every inbound           connections Map is the truth
  Awareness instance + setLocalState(null)        no Awareness instance at all
  hibernation restore loop + clock 0 seed         hibernation is a non-event
  webSocketClose force-clear via removeAwareness  webSocketClose broadcasts presence_removed
  encodeAwarenessFrame, encodeAwarenessUpdate     three text frame types, hand-written
  WsAttachment.clientID for force-clear           WsAttachment shrinks to installationId
```

Net: ~150 to 250 lines deleted, one wire surface added (~50 lines), zero new abstractions. Two unrelated complexity centers (presence + dispatch routing) collapse into one consumer pattern over the same `connections` Map.

## Problem

The project uses y-protocols Awareness to publish per-install liveness:

```ts
// packages/workspace/src/document/open-collaboration.ts:137
awareness.setLocalStateField('liveness', { installationId });
```

Three independent sources say this is the wrong primitive:

**1. Yjs upstream documents Awareness as not-this.**

DeepWiki on `yjs/yjs`:

> y-protocols/awareness is specifically designed for sharing transient
> user-specific states... cursor positions, selection ranges, and typing
> indicators... It is not designed to carry server-authoritative facts
> like "is this client connected," as such information is usually managed
> by the underlying network provider outside of the Awareness protocol
> itself.

> A Yjs Y.Doc can operate normally without an Awareness instance ever
> being created. The core Yjs synchronization protocol is independent of
> Awareness.

**2. The reference y-websocket server agrees.**

DeepWiki on `yjs/y-websocket`:

> The y-websocket server primarily relays Awareness updates between
> connected clients. The server itself does not own or manage an Awareness
> state for the document.

> The server does not persist client Awareness states across reconnections.
> Awareness is reconstructed from the live connections each time a client
> connects or reconnects.

We do the opposite: our DO is an Awareness peer, persists liveness across hibernation, and runs a clock-fabrication restore loop.

**3. Our own code already uses server-owned state for the sibling read.**

Dispatch routing reads `this.connections` directly:

```ts
// apps/api/src/room.ts:511
private pickRecipient(installationId: string): WebSocket | null {
  let newest: WebSocket | null = null;
  for (const [ws, connection] of this.connections) {
    if (
      connection.installationId === installationId &&
      ws.readyState === WebSocket.OPEN
    ) {
      newest = ws;
    }
  }
  return newest;
}
```

Dispatch already does not consult Awareness. Presence is the only thing taking the long way around.

### What this costs us today

Every gnarly thing in `room.ts` traces back to one root cause:

| Code                                                | Exists because                          |
| --------------------------------------------------- | --------------------------------------- |
| `clock: 0` seed (`room.ts:295`)                     | client owns the clock; server can't guess |
| Restored-liveness broadcast (deleted in `d61edd8e`) | tried to bridge ownership across reset  |
| `WsAttachment.clientID` + `maybeRecordClientID`     | learn clientID to force-clear on close  |
| `filterAwarenessUpdate` liveness validation         | client telling server URL-known facts   |
| `outdatedTimeout` reaper coordination               | gossip reaping when socket close is exact |
| 15s renewal dependency                              | gossip refresh window when an auth signal exists |
| Server's own `setLocalState(null)` placeholder      | server forced into a peer role         |
| Hibernation restore loop                            | server reconstructing what it already has from `ctx.getWebSockets()` |

Eight pieces, one cause.

## Goals

1. **Delete the awareness-based liveness path.** No `setLocalStateField('liveness', ...)`. No `filterAwarenessUpdate`. No hibernation restore for liveness. No server-side Awareness instance.
2. **Replace it with a server-owned presence channel.** Three small text frame types. Server's `connections` Map is the source.
3. **Preserve `Collaboration.devices.{list,subscribe}` shape.** The public API stays. Only the source the reader pulls from changes.
4. **Make hibernation transparent for presence.** Any socket open or close wakes the DO and runs the corresponding handler before presence reads occur. The constructor's only presence job is to rebuild `connections` from `ctx.getWebSockets()`. Ping/pong auto-response (configured by `setWebSocketAutoResponse`) is the only event class that does NOT wake the DO; it runs at the runtime boundary and never touches presence state.

## Non-goals

These will be tempting to roll in. They are out of scope:

- **Cursor sync, selection state, typing indicators.** When these arrive, Awareness comes back, used for what it is designed for. Different concern, separate spec.
- **Server-issued installation IDs.** Client-generated installation IDs are routing labels, not auth principals. The existing comment in `app.ts:170` is right. Do not change.
- **Dispatch permission gates.** Today any peer in an authorized room can dispatch to any installationId. That is a separate access-control question, not a presence redesign.
- **Action capability advertisement.** Discovering "who can run `tabs_close`" is a feature, not a refactor. Defer.
- **Yjs schema validation on the server.** App-defined schemas; the server cannot validate without per-app knowledge. Out of scope.

## Design

### Wire surface

Three new text frame types ride the existing WebSocket alongside Yjs binary frames and dispatch text frames. JSON, same envelope style as dispatch.

```ts
type PresenceSnapshotFrame = {
  type: 'presence_snapshot';
  installs: string[]; // installationIds of all currently-connected peers, EXCLUDING the receiver
};

type PresenceAddedFrame = {
  type: 'presence_added';
  install: string; // installationId
};

type PresenceRemovedFrame = {
  type: 'presence_removed';
  install: string; // installationId
};
```

Server-to-client only. Clients never send presence frames; their connection is the publish.

Dedup rule: `presence_added` for an install that is already in the set is a no-op on the client. `presence_removed` for an install with multiple sockets (multi-tab) requires the server to broadcast only when the LAST socket for that install closes, not on every socket close.

### Server changes (`apps/api/src/room.ts`)

**Remove:**

```
- this.awareness: Awareness                                  // field
- new Awareness(this.doc) + setLocalState(null)              // constructor lines
- the restore loop's awareness state/meta seeding            // hibernation block
- maybeRecordClientID() helper                               // attachment write
- webSocketClose's removeAwarenessStates + force-clear broadcast
- WsAttachment.clientID field                                 // attachment shrinks
- this.room (RoomContext)                                    // becomes unnecessary
```

**Add:**

```
+ presenceBroadcast(frame: PresenceSnapshotFrame | PresenceAddedFrame | PresenceRemovedFrame, exclude?: WebSocket)
+ countInstallSockets(installationId): number                // dedup helper for multi-tab
+ snapshotInstalls(exclude?: WebSocket): string[]            // for presence_snapshot
```

**Change:**

In `upgrade()`, after accepting the WebSocket and stamping the attachment:

```ts
// Send snapshot to the new socket (excluding self).
server.send(JSON.stringify({
  type: 'presence_snapshot',
  installs: this.snapshotInstalls(server),
} satisfies PresenceSnapshotFrame));

// Broadcast presence_added to existing sockets if this is the FIRST socket for this install.
if (this.countInstallSockets(installationId) === 1) {
  this.presenceBroadcast(
    { type: 'presence_added', install: installationId },
    server,
  );
}
```

In `webSocketClose()`:

```ts
this.connections.delete(ws);

// Coalesce graceful tab handoffs: schedule the removed-broadcast, then cancel
// it if a new socket for the same install arrives within the grace window.
if (this.countInstallSockets(connection.installationId) === 0) {
  this.schedulePresenceRemoved(connection.installationId);
}
```

The dispatch text-frame handler stays. `handleTextFrame` already routes only `dispatch_response`; presence is server-to-client so the handler does not need to grow.

**Tab-handoff coalescing.** A graceful tab handoff (T1 closes, T2 connects within a few hundred ms) would otherwise emit `presence_removed(X)` followed by `presence_added(X)` to all peers, even though install X was continuously present from the user's perspective. To suppress the flap, `webSocketClose` schedules the `presence_removed` broadcast on a 300 ms timer instead of firing inline. If `upgrade()` increments `countInstallSockets(installationId)` to 1 during the grace window, it cancels the pending removed-broadcast and emits no `presence_added` (the install never left from peers' point of view).

```ts
private pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();
private static readonly PRESENCE_REMOVE_GRACE_MS = 300;

private schedulePresenceRemoved(installationId: string): void {
  const existing = this.pendingRemovals.get(installationId);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    this.pendingRemovals.delete(installationId);
    if (this.countInstallSockets(installationId) > 0) return;
    this.presenceBroadcast({ type: 'presence_removed', install: installationId });
  }, Room.PRESENCE_REMOVE_GRACE_MS);
  this.pendingRemovals.set(installationId, handle);
}

private cancelPendingRemoval(installationId: string): boolean {
  const handle = this.pendingRemovals.get(installationId);
  if (!handle) return false;
  clearTimeout(handle);
  this.pendingRemovals.delete(installationId);
  return true;
}
```

In `upgrade()`, the first-socket broadcast becomes:

```ts
if (this.countInstallSockets(installationId) === 1) {
  // If a removed-broadcast was pending from a just-closed sibling socket,
  // cancel it and emit nothing: peers never saw the install leave.
  if (!this.cancelPendingRemoval(installationId)) {
    this.presenceBroadcast(
      { type: 'presence_added', install: installationId },
      server,
    );
  }
}
```

Real disconnects (last socket gone, no replacement within 300 ms) still emit `presence_removed` exactly once. The grace window is the only tunable; 300 ms is a starting point, justified in Risks below.

### Server changes (`apps/api/src/sync-handlers.ts`)

**Remove:**

```
- filterAwarenessUpdate (entire function)
- encodeAwarenessFrame, encodeAwarenessFrameForClients (entire functions)
- MESSAGE_TYPE.AWARENESS case in applyMessage
- learnedClientIDs on MessageEffect
- imports of applyAwarenessUpdate, encodeAwarenessUpdate, Awareness
```

`RoomContext` shrinks from `{ doc, awareness }` to `{ doc }`, or disappears if `doc` is the only field.

`applyMessage` now only handles SYNC and AUTH cases. If AUTH stays a no-op warn, consider deleting it; AUTH is unused on this wire.

### Client changes (`packages/workspace/src/document/`)

**Replace `open-collaboration.ts`:**

```
- import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
- const awareness = new Awareness(ydoc);
- awareness.setLocalStateField('liveness', { installationId });
- awareness.on('update', awarenessUpdateHandler);
- decodeAndApplyAwarenessFrame helper
- encodeAwarenessFrame helper
- onBinaryFrame: AWARENESS branch
- onConnected: awareness publish
- devices.list() reads from awareness states

+ const presence = createPresenceTracker(installationId);
+ onTextFrame: parse presence_snapshot / presence_added / presence_removed, mutate presence set
+ devices.list() reads from presence set
+ devices.subscribe(fn) subscribes to presence set changes
```

**New file `packages/workspace/src/document/presence.ts`:**

```ts
export type Presence = {
  list(): LiveDevice[];
  subscribe(fn: (devices: LiveDevice[]) => void): () => void;
  /** Returns true if the frame was a recognized presence frame. */
  handleFrame(rawText: string): boolean;
  /** Reset to empty (called on reconnect before snapshot arrives). */
  reset(): void;
};

export function createPresenceTracker(selfInstallationId: string): Presence {
  const installs = new Set<string>();
  const listeners = new Set<(devices: LiveDevice[]) => void>();
  // ...
}
```

On reconnect: the client clears the presence set, then the server's `presence_snapshot` rebuilds it. This mirrors how y-websocket reconstructs awareness on reconnect (per DeepWiki: "Awareness is reconstructed from the live connections each time a client connects or reconnects").

### `dispatch.ts` changes

`getOnlineInstallationIds` is no longer awareness-backed. Either:
- A. Delete it; `devices.list()` reads from presence directly.
- B. Keep the name and signature; reroute to read from a presence set passed in.

Prefer A. The function was a thin adapter over awareness states. Delete it and have `devices.list()` read from `presence.list()` directly.

### Run-handler `PeerNotFound` pre-check window

The daemon's local-liveness pre-check at `packages/workspace/src/daemon/run-handler.ts:100-116` reads `runtime.collaboration.devices.list()` to split `PeerNotFound` from `RemoteCallFailed`:

```ts
const online = runtime.collaboration.devices
  .list()
  .some((d) => d.installationId === peerTarget);
if (!online) {
  return RunError.PeerNotFound({ peerTarget, waitMs, syncStatus: ... });
}
```

Under the current awareness path, the read is hot immediately after `setLocalStateField` because the local clientID's state is synchronously present in `awareness.getStates()`. Under server-owned presence, `devices.list()` returns `[]` until `presence_snapshot` arrives, which is one RTT after upgrade. The window is small but real: a CLI `epicenter run <peer> <action>` fired within ~50 ms of daemon start would currently see the peer; after the redesign it would briefly report `PeerNotFound`.

Choose one of:

- **A. Gate the pre-check on snapshot arrival.** `createPresenceTracker` carries a `hasSnapshot: boolean` flag (false at construction, true after first `presence_snapshot` is applied). The pre-check is suppressed (returns "assume online, let HTTP dispatch produce the real result") until `hasSnapshot` is true.
- **B. Accept the contract change.** Document in `run-handler.ts:100` that `PeerNotFound` can be returned during a short post-connect window even if the peer is in fact online. CLI users see `PeerNotFound` instead of `RemoteCallFailed` on a tiny percentage of fast first-calls.

Prefer A. It preserves the exit-code split. The flag is cheap (one boolean per presence tracker) and the suppression is short-lived (one RTT after upgrade, gone for the rest of the session).

### App-level changes

```
apps/fuji/src/lib/browser.ts             no change (uses Collaboration.devices)
apps/honeycrisp/...                      no change
apps/opensidian/...                      no change
apps/tab-manager/...                     no change
packages/cli/...                         no change (CLI's "liveness" is pid liveness, unrelated)
```

The public API of `Collaboration.devices` stays. Only the implementation switches.

## What we are paying

```
+ apps/api/src/room.ts                   ~ +60 lines net (-160 awareness, +100 presence)
+ apps/api/src/sync-handlers.ts          ~ -120 lines (filterAwarenessUpdate gone)
+ packages/workspace/.../open-collab.ts  ~ -50 lines
+ packages/workspace/.../presence.ts     ~ +80 lines (new)
+ packages/workspace/.../dispatch.ts     ~ -30 lines (getOnlineInstallationIds gone)
+ tests                                  ~ -100 lines (filterAwarenessUpdate, awareness-wake)
                                         ~ +50 lines (presence frame contract)

Approx net: -270 lines, +210 lines = -60 lines of source.
                                     -50 lines of test.
```

The line count is not the prize. The deletion of one entire wrong-shape abstraction is.

## Sequence diagrams

### Cold start, two clients

```
A connects                       relay              B connects later

upgrade ----------------------->  accept WS_A
                                   send to A: {type:'snapshot', installs:[]}

                                  upgrade <----- B
                                  accept WS_B
                                  send to B: {type:'snapshot', installs:['A']}
                                  broadcast to existing (only A):
                                    {type:'presence_added', install:'B'}
A's devices.list() -> ['B']      

B's devices.list() -> ['A']
```

### Multi-tab same install

```
Fuji tab 1 (install X) connects -> snapshot:[], broadcast presence_added(X) to others
Fuji tab 2 (install X) connects -> snapshot:[..., X excluded], NO broadcast (cIS(X) = 2, cancel any pending removal)
Fuji tab 1 closes               -> NO broadcast (cIS(X) = 1, tab 2 alive)
Fuji tab 2 closes               -> schedule presence_removed(X); fires 300 ms later
```

### Graceful tab handoff

```
Fuji tab 1 (install X) only socket           -> peers see X
Fuji tab 1 closes (cIS(X) = 0)               -> schedule presence_removed(X), 300 ms timer armed
Fuji tab 2 (install X) connects within grace -> cIS(X) = 1, cancel pending removal, NO presence_added
                                                peers see continuous X
Fuji tab 2 closes (cIS(X) = 0)               -> schedule presence_removed, no replacement, fires
                                                peers see X go offline
```

The "broadcast on first socket up, scheduled-broadcast on last socket down, cancel on intra-grace-window replacement" rule is what handles multi-tab cleanly without exposing tabs as separate presences and without flapping on graceful handoffs.

### Hibernation

```
state                            connections Map        in-flight transitions
clients A, B connected           {WS_A:A, WS_B:B}       none

DO hibernates                    (memory cleared)       only close-of-existing-sockets
                                                        or a new upgrade can wake the DO;
                                                        ping/pong is auto-handled
                                                        without wake

DO wakes (cause varies)          rebuilt from           handler runs after constructor:
                                 ctx.getWebSockets()    - new upgrade:  presence_added
                                                        - message:      forwarded
                                                        - close:        presence_removed
                                                                        (after grace timer)
```

The hibernation block in `room.ts` shrinks to: build `connections` from `ctx.getWebSockets()`. No clock seed, no broadcast, no force-clear. The presence read is implicitly current because the connection map IS the presence source, and any state transition wakes the DO before any peer can observe it.

**Subtlety: queued event ordering on wake.** When the DO wakes due to a close event, Cloudflare runs the constructor first, then the queued `webSocketClose` handler. If multiple events queued during a brief hibernation period (e.g., a close and an upgrade both arrived), the constructor sees `ctx.getWebSockets()` reflecting the state right then, but the relative order of subsequent queued `webSocketMessage` vs `webSocketClose` callbacks is inferred from workerd source, not Cloudflare public docs. Presence correctness does not depend on this order (each handler emits its own delta, idempotent at the install-level via `cancelPendingRemoval`), but any test that asserts a specific ordering should cite this caveat.

## Migration

Pre-launch, local-first, no external users. Clean break, single bundled PR, two commits.

**Commit 1: add the presence path end-to-end.**

```
+ packages/workspace/src/document/presence.ts                 new file
~ apps/api/src/room.ts                                        emit presence_* in upgrade() and webSocketClose()
                                                              add pendingRemovals + cancelPendingRemoval
                                                              keep Awareness instance and filter (still emitting)
~ packages/workspace/src/document/open-collaboration.ts       parse presence_* in onTextFrame
                                                              wire devices.list() / devices.subscribe() to presence tracker
                                                              keep awareness setLocalStateField for now (unused)
~ packages/workspace/src/daemon/run-handler.ts                gate the local-liveness pre-check on presence.hasSnapshot
+ apps/api/src/presence.test.ts                               snapshot, added, removed, grace window, multi-tab cases
+ packages/workspace/src/document/presence.test.ts            tracker unit tests
```

After commit 1: presence is the source of truth for `devices.list()`. Awareness still emits but nothing reads it. The system is fully functional.

**Commit 2: delete the awareness liveness path.**

```
~ apps/api/src/room.ts                                        delete Awareness instance + setLocalState(null)
                                                              delete WsAttachment.clientID + maybeRecordClientID
                                                              delete hibernation awareness restore block
                                                              delete webSocketClose force-clear branch
                                                              drop RoomContext (inline Y.Doc)
~ apps/api/src/sync-handlers.ts                               delete filterAwarenessUpdate, encodeAwarenessFrame,
                                                              encodeAwarenessFrameForClients,
                                                              MESSAGE_TYPE.AWARENESS case in applyMessage,
                                                              learnedClientIDs on MessageEffect
~ packages/workspace/src/document/open-collaboration.ts       delete new Awareness, setLocalStateField('liveness'),
                                                              awareness.on('update'), encode/decode helpers,
                                                              onBinaryFrame AWARENESS branch, onConnected publish
~ packages/workspace/src/document/dispatch.ts                 delete getOnlineInstallationIds
- apps/api/src/awareness-wake.test.ts                         delete file
~ apps/api/src/sync-handlers.test.ts                          delete filterAwarenessUpdate describe block
~ packages/workspace/src/document/dispatch.test.ts            delete getOnlineInstallationIds describe block
~ JSDoc rewrites                                              per Definition of done
```

The two-commit split gives a genuine atomic revert boundary: revert commit 2 to keep presence with awareness still emitting (works, just heavier), revert both to fully back out. Within each commit, the diff is independently reviewable. No transitional half-state where the system is broken at any commit boundary.

A previous draft of this spec proposed a five-commit sequence with a parallel-emit middle step. That step did not earn its keep on a pre-launch codebase: bisectability matters across merged PRs, not within an unmerged branch. The two-commit plan is strictly cleaner.

## Test plan

**Delete:**
- `apps/api/src/awareness-wake.test.ts` entirely.
- `filterAwarenessUpdate` tests in `apps/api/src/sync-handlers.test.ts` (the whole `describe` block).
- `getOnlineInstallationIds` tests in `packages/workspace/src/document/dispatch.test.ts`.

**Add:**
- `apps/api/src/presence.test.ts`:
  - Snapshot is sent to the new socket on upgrade.
  - `presence_added` broadcast on FIRST socket for an install.
  - No `presence_added` broadcast on subsequent sockets for the same install.
  - `presence_removed` broadcast on LAST socket close, after grace window elapses.
  - No `presence_removed` broadcast on intermediate socket close.
  - Graceful handoff inside grace window: T1 closes, T2 connects within 300 ms, peers see no transition; no `presence_removed`, no `presence_added`.
  - Real disconnect: T1 closes, no replacement, after 300 ms peers see `presence_removed`.
  - Cancel-then-replace: T1 closes, T2 connects at 200 ms, T2 closes at 500 ms, peers see no `presence_removed` for the T1 close and one `presence_removed` 300 ms after T2 close.
  - Hibernation+wake: surviving sockets see no presence transitions; new upgrade post-wake sees correct snapshot.
  - Close-during-hibernation: a close arriving while DO is hibernated wakes the DO; after the constructor and `webSocketClose` run, the `presence_removed` grace timer is armed (300 ms from handler execution, not from the TCP-layer close time).

- `packages/workspace/src/document/presence.test.ts`:
  - `handleFrame` parses snapshot, added, removed correctly.
  - `list()` excludes self.
  - `subscribe()` fires on add/remove/snapshot.
  - `reset()` clears the set.

**Reuse:**
- The existing dispatch tests (`dispatch.ts:RecipientOffline` etc.) stay; they exercise routing, not presence representation.

**Additional must-add coverage (wave-4 audit findings):**

- **Dispatch regression after source switch.** Integration test: dispatch to a present install succeeds, dispatch to an absent install returns `RecipientOffline`. Verifies `pickRecipient` over `connections` still routes correctly after `getOnlineInstallationIds` is gone.
- **Broadcast resilience.** Inject a wedged socket (one whose `ws.send` throws) into `this.connections`, broadcast a `presence_added`, verify all other peers receive the frame. `presenceBroadcast` must wrap `ws.send` in try/catch per the same pattern as `Room.broadcast`.
- **`run-handler.ts` hasSnapshot gate.** Two tests:
  - pre-snapshot: `runHandler` invoked before `presence_snapshot` arrives bypasses the local pre-check and lets HTTP dispatch produce the real error.
  - post-snapshot: an absent peer correctly yields `PeerNotFound`.
- **Hibernation attachment retrieval.** Hibernate with three sockets across two installs, wake, verify `pickRecipient` and `snapshotInstalls` produce correct results from the shrunken `WsAttachment` (installationId-only, no clientID field).
- **Close-code policy.** Decide: do auth-rejection close codes (4401) bypass the 300 ms grace window because there is no legitimate handoff for an auth-failed socket? Recommended: yes. Test that 4401 closes emit `presence_removed` immediately; 1006/1009/1011/4400 respect the grace window. Document the decision next to `PRESENCE_REMOVE_GRACE_MS`.

## Risks and mitigations

```
Risk                                          Mitigation
Multi-tab dedup logic is one-line subtle      Cover with explicit test (first up, last down,
                                              grace-window cancellation).
Tab handoff flap visible to peers without     300 ms grace window on presence_removed; upgrade
  coalescing                                  within the window cancels the pending broadcast
                                              and emits no presence_added either. See below
                                              for the grace-window justification.
Snapshot send on upgrade missed if WS opens   The upgrade() codepath is the only entry; if upgrade
  but client races to send before snapshot    is processed before the WS's first send, snapshot
                                              arrives first. Verified by Cloudflare's WS API contract.
Future cursor sync needs awareness back       Awareness comes back as cursor sync; clean separation.
                                              Spec is explicit this is not a permanent ban on Awareness.
Network-layer flakes cause dropped removed    Same risk as today's awareness path. Mitigated by
  frame, client shows ghost device            client-side periodic resync (out of scope; see open Q).
We delete filterAwarenessUpdate but a future  filterAwarenessUpdate logic is liveness-specific. If
  awareness use needs server-side filtering   cursor sync arrives and needs server-side checks, that
                                              is its own filter. Different content, different rule.
Close-during-hibernation ordering vs wake     Documented (workerd source): close wakes the DO via
                                              handleSocketTermination, so webSocketClose runs
                                              promptly. Relative order of queued
                                              webSocketMessage vs webSocketClose on a
                                              multi-event wake is inferred from workerd source,
                                              not Cloudflare public docs. Presence correctness
                                              does not depend on this order.
Frame reordering on the wire                  Each peer has exactly one WebSocket. TCP guarantees
                                              in-order delivery on a single connection. The server
                                              emits presence frames after the grace window resolves,
                                              so the linearization happens in DO memory before send.
                                              No wire-level sequence number is required.
```

**Grace-window justification.** 300 ms covers the realistic graceful-tab-handoff scenarios (SPA navigation closing T1 then opening T2, page reload, extension popup closing as a new window opens) without delaying real-disconnect notification more than a quarter second. A shorter window risks flaps for legitimate handoffs that take ~150 ms; a longer window delays the presence_removed signal that downstream consumers (UI "device offline" toast, run-handler PeerNotFound) depend on. The window is a `Room` static constant so it can be tuned without redeploying clients.

## Open questions

These should not block the spec going green. They are answerable during implementation or follow-up.

1. **Reconcile on long idle?** If a client suspects its presence set is stale (e.g., woke from laptop sleep), should it be able to request a fresh snapshot via a `presence_query` text frame? Today, awareness regossips every 15s; presence has no equivalent self-heal. Probably not needed because the server's snapshot-on-connect already handles the only natural staleness case (reconnect).
2. **`RoomContext` retention.** After Awareness is removed from the server, `RoomContext` shrinks to `{ doc }`. Is it worth keeping as a named type, or inline as `Y.Doc`?
3. **AUTH message case retention.** With AWARENESS gone, only SYNC and AUTH remain in `applyMessage`. AUTH is a no-op warn today. Delete the entire `case AUTH` block? Probably yes.
4. **Awareness as a wire concept.** Should `MESSAGE_TYPE.AWARENESS` stay reserved in `@epicenter/sync` for future cursor work, or be deleted? Keep reserved; restoring it is cheap, but accidentally re-allocating its value would be a wire break.
5. **Test for "two installs over the same connection?"** Impossible by construction (one URL stamp per upgrade). Add an explicit invariant check?
6. **Snapshot scale trip-wire.** Current unsolicited-push design ships a full list on every upgrade. At ~26 chars per installation ID, a 500-install room is ~14 KB per snapshot; a 1000-install room is ~28 KB; well under Cloudflare's 1 MiB message cap but room churn turns it quadratic (N upgrades x N broadcast). If `connections.size` ever exceeds ~1000, switch to a `presence_query` request-response pull on connect and broadcast only `presence_added` / `presence_removed`. No need to implement now; the threshold is the trip-wire.

## Out of scope: the centralization audit

The prompt asked whether other things could be moved to server authority. I checked. Honest answer: nothing else low-hanging.

```
Concern                       Current ownership       Should change?
Yjs durable doc state         Server persists,        No. CRDT is correct here (multi-writer).
                              clients hold CRDT
Dispatch routing              Server (connections)    Already correct.
Auth                          Server (Worker)         Already correct.
Room name resolution          Server (app.ts)         Already correct.
Snapshot bootstrap            Server (RPC)            Already correct.
Liveness / presence           Client gossip (wrong)   YES, this spec.
Install identity              Client-generated        No. Routing label, not auth principal.
Capability advertisement      Not present             Not now. Feature, not refactor.
Permission gates on dispatch  None                    Not now, but blocks GA. Any second role
                                                      (viewer, editor) requires server-side
                                                      dispatch authorization. Track as a follow-up
                                                      before external users.
Yjs schema validation         App-defined             No. Server cannot validate without per-app schema.
```

The presence redesign is the only correction available right now. Adding the others would be scope creep; they are either correct already, hypothetical features, or actively incompatible with the workspace model.

The right move is to ship this redesign clean and leave the audit appendix in the spec as the record of what was considered and rejected.

## Definition of done

- `awareness` no longer imported in `packages/workspace/src/document/open-collaboration.ts`.
- `Awareness` no longer instantiated in `apps/api/src/room.ts`.
- `filterAwarenessUpdate` deleted from `apps/api/src/sync-handlers.ts`.
- All tests in the "Add" section above pass.
- `Collaboration.devices.list()` and `Collaboration.devices.subscribe()` behave identically from the consumer's perspective in Fuji root doc, Fuji entry body docs, Honeycrisp, Opensidian, Tab Manager.
- `run-handler.ts:100-116` is updated per the chosen option (A: gate on `hasSnapshot`, or B: documented contract change).
- JSDoc rewrites land in the same PR:
  - `packages/sync/src/protocol.ts:30-42` `MESSAGE_TYPE.AWARENESS` doc no longer claims relay-side liveness validation; the slot is documented as reserved for future cursor/typing/selection use. Add an explicit note: "presence rides text frames; awareness rides binary frames; they share a socket and never collide in the wire decoder."
  - `packages/workspace/src/index.ts:8` removes "per-peer liveness via y-protocols awareness" language.
  - `packages/workspace/src/document/open-collaboration.ts:4-22, 88` rewritten to reflect "presence channel, server-owned" instead of "liveness lives in awareness."
  - `packages/workspace/src/document/installation-id.ts:13` and `keys.ts:12` updated to state that `installationId` is bound to a socket by URL stamp at upgrade, period. No round-trip claim validation.
- One bundled PR with the commit sequence in the Migration section.
- A short note in `docs/adr/` or equivalent recording the decision (presence is server-owned; awareness is reserved for future ephemeral CRDT state).

## Appendix A: Migration ordering, why two commits not five

An earlier draft of this spec proposed five micro-commits with a parallel-emit middle step. That draft was wrong for a pre-launch codebase. The reasoning, kept here as a record of consideration:

The two cited benefits of parallel-emit were reviewability and bisectability. Both fall apart under scrutiny:

- **Reviewability.** Two reviewable commits (add presence, delete awareness) deliver the same review affordance as five. The deletion commit is a near-pure removal whose correctness depends on the presence path working, which the presence tests in commit 1 establish.
- **Bisectability.** `git bisect` granularity matters across merged PRs, not within an unmerged branch. Five commits that must revert together is the worst-of-both: noisy history and no granular rollback.

The five-commit version also violated its own "shippable at every commit" claim: deleting `open-collaboration.ts` awareness publish while server still ran `filterAwarenessUpdate` was a transient half-state (functionally fine, but the validation code was filtering frames nobody sent).

The two-commit plan keeps a genuine atomic revert boundary (revert commit 2 if presence regresses, both if the whole redesign needs to back out), reads cleanly in `git log -p`, and matches the `standalone-commits` skill convention: each commit is a coherent unit, the PR is the revert atom.

## Appendix B: What happens to awareness as a concept

After this spec lands, `y-protocols/awareness` is no longer a dependency in production paths. It is reserved for:

1. **Future cursor sync.** Add an `attachCursors` primitive in the workspace package that creates an Awareness instance for cursor state only. No liveness travel.
2. **Future typing indicators.** Same pattern, different field.
3. **Future selection broadcasting.** Same pattern, different field.

The presence wire surface stays separate. Adding cursor sync later does not touch the presence channel. Awareness goes back to what Yjs upstream documents it for: ephemeral peer-to-peer state that benefits from CRDT clocks because it has concurrent writers per peer.
