# Peer Presence Rename And Sync Split

**Date**: 2026-04-30
**Status**: Draft
**Author**: AI-assisted
**Related**: `specs/20260430T103959-split-attach-sync-into-transport-presence-rpc.md`, `specs/20260430T120000-cli-naming-decision.md`
**Reconciled Against**: `87bf8e751 refactor(fuji): simplify script surface`
**Also Reflects Working Tree**: historical daemon config route modules. Current project config default-exports `Mount[]`.

## Overview

This spec combines three related breaking changes that should land together: standard awareness becomes peer presence, `attachSync` splits presence and RPC into explicit sibling attachments, and public action exposure moves back to an explicit `actions` registry. `attachSync` keeps Y.Doc synchronization, `sync.attachPresence({ peer })` owns routable peer identity, and `sync.attachRpc(actions)` owns the registry that can be called over the wire.

One sentence:

```txt
A workspace exposes an explicit action registry, then peer presence maps stable peer ids to live Yjs clientIDs so RPC can call that registry across runtimes.
```

## Motivation

### Current State

`attachSync` currently owns sync, presence, and RPC in one return object:

```ts
const sync = attachSync(doc, {
  url,
  waitFor: idb,
  device: {
    id: getOrCreateDeviceId(localStorage),
    name: "Fuji",
    platform: "web",
  },
  actions,
});

const peers = sync.peers();
const found = sync.find("macbook-pro");
const remote = createRemoteClient({ presence, rpc }).actions<typeof tabManager>(
  "macbook-pro",
);
```

Current action discovery also walks entire workspace bundles in some places:

```ts
const entries = [...walkActions(workspace)];
const action = resolveActionPath(workspace, actionPath);
const tools = actionsToAiTools(workspace);
```

The standard awareness state is:

```ts
{
	device: {
		id: 'macbook-pro',
		name: 'Braden MacBook',
		platform: 'tauri',
	},
}
```

This creates five problems:

1. **The noun is too narrow**: `device` works for a laptop, but the runtime can also be a browser tab cluster, Chrome extension background worker, CLI daemon, Tauri app, or future worker process.
2. **The word collides with app domains**: Tab Manager has an app-level `Device` table. Whispering already uses `Device` for audio hardware. The sync layer means "live routable runtime", not every domain object called a device.
3. **The type lies**: `SyncAttachment` exposes `peers()`, `find()`, `observe()`, and `rpc()` even when the caller did not configure presence or RPC.
4. **The file boundary was muddy**: the old standard awareness file sounded generic, but it defined the standard Epicenter peer identity used by sync.
5. **Action exposure is implicit**: walking the whole workspace makes CLI paths, AI tool names, remote manifests, and inbound RPC depend on object layout. Moving actions under an `actions` key can silently change `tabs.close` into `actions.tabs.close`.

### Desired State

The app composes the three jobs explicitly:

```ts
const actions = {
	tabs: {
		close: defineMutation({ ... }),
		list: defineQuery({ ... }),
	},
} satisfies Actions;

const sync = attachSync(doc.ydoc, {
	url,
	waitFor: idb,
	getToken,
});

const presence = sync.attachPresence({
	peer: {
		id: getOrCreateInstallationId(localStorage),
		name: 'Fuji',
		runtime: 'web',
	},
});

const rpc = sync.attachRpc(actions);

const remote = createRemoteClient({ presence, rpc });
const macbook = remote.actions<typeof actions>('macbook-pro');
const manifest = await remote.describe('macbook-pro');
```

The current recommended awareness state keeps the peer convention small:

```ts
{
	peer: {
		id: 'macbook-pro',
		name: 'Braden MacBook',
		runtime: 'tauri',
	},
}
```

Namespacing this as `state.epicenter.peer` is still an open design choice, not a prerequisite for the next wave.

## Research Findings

### Yjs Awareness Model

Yjs awareness is ephemeral JSON state keyed by `clientID`. The `clientID` is a runtime address, not a durable identity. A fresh `Y.Doc` gets a new client id, and awareness states disappear when peers disconnect or time out.

That means awareness is the correct place for the live routing map:

```txt
stable identity       Yjs awareness       volatile address       RPC
---------------       -------------       ----------------       ---
peer.id          ->   state.peer      ->   clientID          ->   rpc(clientID, action)
```

Awareness is not the correct place for full capabilities, schemas, permissions, or durable registry data. Those belong in RPC or persistent CRDT data.

### Current Repo Surface

The current public surface is split across these concepts:

| Concept                      | Current name            | Problem                                                  |
| ---------------------------- | ----------------------- | -------------------------------------------------------- |
| Stable live runtime identity | `DeviceDescriptor`      | Too tied to physical device language                     |
| Awareness schema file        | `peer-presence-defs.ts` | Sounds generic, but it is Epicenter peer presence        |
| Local config                 | `device`                | Hides that passing it enables peer discovery             |
| Lookup                       | `sync.find(deviceId)`   | Too generic and tied to the old noun                     |
| Snapshot                     | `sync.peers()`          | Correct noun, but it lives on sync even without presence |
| Remote proxy                 | old direct helper       | Mechanism-oriented name and old target noun              |
| Discovery                    | old direct helper       | Same issue                                               |

### Related Spec

`specs/20260430T103959-split-attach-sync-into-transport-presence-rpc.md` already argues for splitting `attachSync` into sync, presence, and RPC attachments. This spec keeps that direction but changes the vocabulary before the split lands, so the extracted modules do not preserve the old device naming.

### Action Surface From `3009b6ca4`

Commit `3009b6ca4` made one important improvement: action discovery, AI tool conversion, RPC type inference, and remote manifests should share one traversal contract. That part should stay. The mistake was letting the workspace bundle itself become the public root for every action path.

The new rule is:

```txt
Implementation primitive:
  walkActions(source) may keep the same safe plain-object traversal internally.

Public exposure boundary:
  CLI, AI tools, RPC, and remote manifests use workspace.actions.
```

That keeps the useful flattening work while making path roots deliberate. Public action paths are always relative to the registry:

```txt
tabs.close
files.read
entries.create
```

They should not include the implementation grouping key:

```txt
actions.tabs.close
```

## Design Decisions

| Decision               | Choice                                                     | Rationale                                                                                                                                |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Standard concept name  | `peer`                                                     | The runtime is routable and online. It might not be a physical device.                                                                   |
| Stable id name         | `peer.id` in presence, `installationId` in storage helpers | Presence needs a short routing key. Storage should say where the id comes from.                                                          |
| Runtime platform name  | Open: current `platform`, target `runtime`                 | Current code still uses `platform`. Rename only if doing the peer type vocabulary pass.                                                  |
| Awareness namespace    | Open: current `state.peer`, target `state.epicenter.peer`  | Namespacing is cleaner long term, but current code already works with `state.peer`.                                                      |
| Awareness version      | Deferred                                                   | Only needed if the awareness state becomes namespaced or gains migration pressure.                                                       |
| `attachSync` name      | Keep                                                       | It synchronizes a Y.Doc. `attachTransport` would describe an implementation detail.                                                      |
| Presence ownership     | `sync.attachPresence({ peer })`                            | Presence is a sub-protocol riding on the sync connection. It should not be a top-level attachment with a hidden dependency.              |
| RPC ownership          | `sync.attachRpc(actions)`                                  | RPC registers message handlers and pending cleanup. The current positional form is implemented consistently.                             |
| Action exposure root   | `workspace.actions`                                        | The public callable surface should be a named registry, not inferred from bundle layout.                                                 |
| Action registry helper | Deferred                                                   | `Actions` and registry-relative call sites already carry the boundary. Add `defineActions(tree)` only if validation earns the extra API. |
| Bundle walking         | Internal or debug utility only                             | Useful traversal implementation, but not the public CLI, AI, or RPC contract.                                                            |
| CLI and AI paths       | Registry-relative paths                                    | Tool names and CLI paths should be stable across unrelated workspace bundle refactors.                                                   |
| Generic awareness      | Keep separate                                              | Custom cursors, selections, and typing state should still use `attachAwareness`. Standard peer presence is a specific convention.        |
| Compatibility aliases  | No aliases in the clean break                              | Aliases keep the old vocabulary alive and make docs worse.                                                                               |

## Current Implementation Checkpoint

This branch has already implemented a large part of the split. Do not execute the older phase list as if starting from scratch.

Current HEAD:

```txt
87bf8e751 refactor(fuji): simplify script surface
```

Implemented:

| Area                        | Current code                                                                                                | Notes                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit daemon action root | `DaemonRuntime.actions: Actions` in `packages/workspace/src/daemon/types.ts`                                | Daemon action paths are now relative to the hosted runtime's `actions` root.                                                                |
| Daemon runtime attachments  | `DaemonRuntime` requires `sync`, `presence`, and `rpc`                                                      | The daemon no longer treats peer and RPC methods as optional fields on sync.                                                                |
| Daemon config shape         | Historical: `defineConfig({ daemon: { routes } })` with route modules                                       | Current project config default-exports `Mount[]`; this checkpoint is no longer the active config shape.                                     |
| Split sync API              | `sync.attachPresence({ peer })` and `sync.attachRpc(actions)` exist                                         | The implementation uses positional `attachRpc(actions)`, not `attachRpc({ actions })`.                                                      |
| App daemon factories        | Fuji, Honeycrisp, Opensidian, Tab Manager, and Zhongwen daemon factories attach presence and RPC explicitly | Open the app daemon files before planning more migration work.                                                                              |
| AI action root              | App clients call `actionsToAiTools(workspace.actions)`                                                      | The whole-workspace discovery direction is already superseded.                                                                              |
| CLI daemon run path         | `packages/workspace/src/daemon/run-handler.ts` resolves against `workspace.actions`                         | The explicit action root is already the daemon execution boundary.                                                                          |
| Installation id helper      | `getOrCreateInstallationId` and async variant exist                                                         | `getOrCreateDeviceId` is no longer the active helper.                                                                                       |
| Peer presence attachment    | `packages/workspace/src/document/peer-presence.ts` exists                                                   | It now uses peer presence type names imported from `peer-presence-defs.ts`.                                                                 |
| Remote client               | `createRemoteClient({ presence, rpc })` exists                                                              | The bound client owns the local peer-calling capability. The proxy builder is now an implementation detail behind `remote.actions(peerId)`. |
| Script snapshot surfaces    | `apps/fuji/src/lib/fuji/script.ts` opens read-only snapshot tables plus daemon actions                      | Script helpers are not daemon runtimes. Do not require them to expose sync, presence, or RPC attachments.                                   |

Still not implemented:

| Area                      | Current code                                                                                   | Target in this spec                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Action registry helper    | No `defineActions` helper                                                                      | Decide whether to add it or keep plain `Actions` as enough.                  |
| RPC attach signature      | `sync.attachRpc(actions)`                                                                      | Decide whether object form `sync.attachRpc({ actions })` is worth the churn. |
| Presence schema namespace | Awareness state is `state.peer`                                                                | Decide whether `state.epicenter.peer` earns the extra migration.             |
| Presence type names       | `PeerRuntime`, `PeerIdentity`, `PeerIdentityInput`, `PeerPresenceState`, `ResolvedPeer`        | Vocabulary pass is complete.                                                 |
| Presence method names     | `presence.find()` and `presence.observe()`                                                     | Decide whether `resolve` or `subscribe` are worth the rename.                |
| File boundary             | `peer-presence-defs.ts` exists beside `peer-presence.ts`                                       | Definitions stay separate from attachment behavior.                          |
| Remote helper names       | Public API is `createRemoteClient` plus `remote.actions(peerId)` and `remote.describe(peerId)` | The intermediate helper names no longer need to be public.                   |

The next implementation wave should start from this checkpoint, not from the initial motivation examples.

## Architecture

### Current Shape

```txt
+------------------------------+
| attachSync(doc, config)      |
|                              |
| config.device                |
| config.awareness             |
| config.actions               |
|                              |
| returns:                     |
|   status                     |
|   peers()                    |
|   find(deviceId)             |
|   observe()                  |
|   rpc(clientId, action)      |
|   raw.awareness              |
|                              |
| CLI and AI may walk the      |
| whole workspace bundle       |
+------------------------------+
        |
        +--> Y.Doc sync supervisor
        +--> awareness with { device }
        +--> RPC dispatch and system.describe
```

### Target Shape

```txt
+------------------------------+
| attachSync(doc, config)      |
|                              |
| owns:                        |
|   WebSocket supervisor       |
|   Y.Doc sync protocol        |
|   lifecycle status           |
|   frame dispatch table       |
+------------------------------+
        |
        +-------------------------------+
        |                               |
        v                               v
+------------------------------+  +------------------------------+
| sync.attachPresence({ peer }) |  | sync.attachRpc(actions)      |
|                              |  |                              |
| owns:                        |  | owns:                        |
|   Yjs Awareness              |  |   pending RPC requests       |
|   peer state                 |  |   action dispatch            |
|   peers()                    |  |   system.describe            |
|   find(peerId)               |  |   rpc(clientID, action)      |
|   observe()                  |  |                              |
+------------------------------+  +------------------------------+
        |                               |
        +---------------+---------------+
                        |
                        v
              createRemoteClient({ presence, rpc }).actions(peerId)
```

### Action Exposure Boundary

```txt
+------------------------------+
| workspace bundle             |
|                              |
| ydoc                         |
| tables                       |
| idb                          |
| sync                         |
| presence                     |
| rpc                          |
| actions                      |
|   tabs.close                 |
|   files.read                 |
+------------------------------+
        |
        +--> CLI list/run: describeActions(workspace.actions)
        +--> AI tools: actionsToAiTools(workspace.actions)
        +--> RPC: sync.attachRpc(workspace.actions)
        +--> Types: InferSyncRpcMap<typeof workspace.actions>
```

### Addressing Flow

```txt
1. App boots
   storage -> getOrCreateInstallationId() -> peer.id

2. Presence attaches
   sync.attachPresence({ peer }) -> awareness local state

3. Another runtime calls a peer
   createRemoteClient({ presence, rpc }).actions(peerId)
     -> presence.find(peerId)
     -> ResolvedPeer { clientId, state }
     -> rpc.rpc(clientId, action, input)

4. PeerIdentity leaves
   awareness removes clientId
     -> pending peer calls return PeerLeft
```

## Proposed API

### Action Registry

```ts
const actions = {
	tabs: {
		close: defineMutation({ ... }),
		list: defineQuery({ ... }),
	},
} satisfies Actions;

type TabManagerActions = typeof actions;
type TabManagerRpc = InferSyncRpcMap<typeof actions>;
```

`defineActions` is optional. Add it only if the helper validates action path keys or improves inference in a way plain `Actions` cannot.

The action utilities should target the registry:

```ts
describeActions(workspace.actions);
walkActions(workspace.actions);
resolveActionPath(workspace.actions, "tabs.close");
actionsToAiTools(workspace.actions);
```

### Peer Presence Types

```ts
export const PeerRuntime = type(
  '"web" | "tauri" | "chrome-extension" | "node"',
);
export type PeerRuntime = typeof PeerRuntime.infer;

export const PeerIdentity = type({
  id: "string",
  name: "string",
  platform: PeerRuntime,
});
export type PeerIdentity = typeof PeerIdentity.infer;

export type PeerIdentityInput<TId extends string = string> = {
  id: TId;
  name: string;
  platform: PeerRuntime;
};

export const PeerPresenceState = type({
  peer: PeerIdentity,
});
export type PeerPresenceState = typeof PeerPresenceState.infer;

export type ResolvedPeer = {
  clientId: number;
  state: PeerPresenceState;
};
```

### Sync Attachment

```ts
const sync = attachSync(ydoc, {
  url,
  waitFor,
  getToken,
});

const presence = sync.attachPresence({
  peer,
});

const rpc = sync.attachRpc(actions);
```

### Presence Attachment

```ts
type PresenceAttachment = {
  peers(): Map<number, PeerPresenceState>;
  find(peerId: string): ResolvedPeer | undefined;
  observe(callback: () => void): () => void;
  raw: { awareness: YAwareness };
};
```

### RPC Attachment

```ts
type RpcAttachment = {
  rpc<
    TMap extends RpcActionMap = DefaultRpcMap,
    TAction extends string & keyof TMap = string & keyof TMap,
  >(
    target: number,
    action: TAction,
    input?: TMap[TAction]["input"],
    options?: RemoteCallOptions,
  ): Promise<Result<TMap[TAction]["output"], RpcError>>;
};
```

### Remote PeerIdentity Helpers

```ts
const remote = createRemoteClient({ presence, rpc });
const macbook = remote.actions<TabManagerActions>(peerId);
const result = await macbook.tabs.close({ tabIds: [1] });

const manifest = await remote.describe(peerId);
```

Normal app bundles can hide the pair:

```ts
return {
  ...doc,
  sync,
  presence,
  rpc,
  remote,
};
```

## Rename Map

| Current                             | Recommended target                          | Notes                                                                                            |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `standard-awareness-defs.ts`        | `peer-presence-defs.ts`                     | File says what convention it owns.                                                               |
| `Platform`                          | `PeerRuntime`                               | Avoid broad platform naming.                                                                     |
| `PeerDevice`                        | `PeerIdentity`                              | This is identity for a live peer.                                                                |
| `DeviceDescriptor`                  | `PeerIdentityInput`                         | Generic input type for branded ids.                                                              |
| `PeerAwarenessState`                | `PeerPresenceState`                         | Presence is the concept, awareness is the Yjs mechanism.                                         |
| `FoundPeer`                         | `ResolvedPeer`                              | Resolution maps peer id to client id.                                                            |
| `standardAwarenessDefs`             | `peerPresenceDefs`                          | Keep private unless a real public custom composition appears.                                    |
| `config.device`                     | `sync.attachPresence({ peer })`             | Presence becomes explicit.                                                                       |
| `state.device`                      | `state.peer`                                | Current branch shape. Consider `state.epicenter.peer` only if namespacing earns the migration.   |
| `sync.peers()`                      | `presence.peers()`                          | No more no-op method on sync.                                                                    |
| `sync.find(deviceId)`               | `presence.find(peerId)`                     | Keep current verb unless the vocabulary pass chooses `resolve`.                                  |
| `sync.observe()`                    | `presence.observe()`                        | Keep current verb unless the vocabulary pass chooses `subscribe`.                                |
| local `{ presence, rpc }` bag       | `createRemoteClient({ presence, rpc })`     | The local peer-calling capability should be bound once.                                          |
| old remote action helper            | `remote.actions(peerId)`                    | The helper is private implementation detail. Public callers bind once with `createRemoteClient`. |
| old remote describe helper          | `remote.describe(peerId)`                   | Same bound-client shape as action proxies.                                                       |
| `getOrCreateDeviceId`               | `getOrCreateInstallationId`                 | Storage helper names the durable source.                                                         |
| `deviceId` call-site names          | `peerId` or `installationId`                | Use `peerId` for routing, `installationId` for storage.                                          |
| `walkActions(workspace)`            | `walkActions(workspace.actions)`            | Public path root becomes explicit.                                                               |
| `describeActions(workspace)`        | `describeActions(workspace.actions)`        | CLI and manifests use registry-relative paths.                                                   |
| `actionsToAiTools(workspace)`       | `actionsToAiTools(workspace.actions)`       | AI tool names should not include implementation grouping.                                        |
| `InferSyncRpcMap<typeof workspace>` | `InferSyncRpcMap<typeof workspace.actions>` | The type contract matches the runtime root.                                                      |

## Files Likely Touched

| File                                                      | Change                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/workspace/src/shared/actions.ts`                | Reframe `Actions` as the public registry shape; keep canonical traversal but target registry roots in public docs. Add `defineActions` only if the helper earns its keep. |
| `packages/workspace/src/ai/tool-bridge.ts`                | Change examples and call sites back to action registries. Keep one traversal path.                                                                                        |
| `packages/workspace/src/rpc/types.ts`                     | Update examples and tests to infer RPC maps from `typeof actions`.                                                                                                        |
| `packages/workspace/src/document/attach-sync.ts`          | Remove presence and RPC ownership from base return. Add `attachPresence`, `attachRpc`, and internal frame registration surface.                                           |
| `packages/workspace/src/document/peer-presence.ts`        | Standard peer presence implementation and resolver helpers. Should own the names currently split with `peer-presence-defs.ts`.                                            |
| `packages/workspace/src/document/attach-presence.ts`      | New presence attachment implementation. Owns awareness send and receive through sync.                                                                                     |
| `packages/workspace/src/document/attach-rpc.ts`           | RPC attachment implementation. Owns pending requests, request handling, response handling, and `system.describe`.                                                         |
| `packages/workspace/src/rpc/remote-actions.ts`            | Keep `createRemoteClient({ presence, rpc })` public. Keep proxy construction private unless another package proves it needs the lower-level hook.                         |
| `packages/workspace/src/shared/device-id.ts`              | Rename storage helpers to installation id helpers.                                                                                                                        |
| `packages/workspace/src/index.ts`                         | Update public exports. Remove old device-based names.                                                                                                                     |
| `packages/workspace/src/document/attach-sync.test.ts`     | Keep supervisor and sync protocol tests. Move presence and RPC tests out.                                                                                                 |
| `packages/workspace/src/document/attach-presence.test.ts` | Tests for peer awareness state and peer lookup.                                                                                                                           |
| `packages/workspace/src/document/attach-rpc.test.ts`      | New tests for RPC frame handling and system describe.                                                                                                                     |
| `packages/workspace/src/rpc/peer.test.ts`                 | Update mocks from one sync object to `{ presence, rpc }`.                                                                                                                 |
| `packages/workspace/src/ai/tool-bridge.test.ts`           | Assert tool names are registry-relative.                                                                                                                                  |
| `packages/cli/src/daemon/run-handler.ts`                  | Resolve actions from `workspace.actions`, not the whole workspace.                                                                                                        |
| `packages/cli/src/daemon/app.ts`                          | Describe `workspace.actions` for `/list`; read `entry.workspace.presence.peers()` for `/peers`.                                                                           |
| `apps/fuji/src/lib/fuji/client.ts`                        | Rename id helper and `device` construction.                                                                                                                               |
| `apps/fuji/src/lib/fuji/browser.ts`                       | Attach sync, presence, and RPC separately.                                                                                                                                |
| `apps/honeycrisp/src/lib/honeycrisp/client.ts`            | Same pattern.                                                                                                                                                             |
| `apps/honeycrisp/src/lib/honeycrisp/browser.ts`           | Same pattern.                                                                                                                                                             |
| `apps/opensidian/src/lib/opensidian/client.ts`            | Same pattern.                                                                                                                                                             |
| `apps/opensidian/src/lib/opensidian/browser.ts`           | Same pattern, including explicit `actions` RPC attachment.                                                                                                                |
| `apps/tab-manager/src/lib/tab-manager/client.ts`          | Rename generated descriptor to peer identity. Keep app table ids branded.                                                                                                 |
| `apps/tab-manager/src/lib/tab-manager/extension.ts`       | Attach sync, presence, and RPC separately.                                                                                                                                |
| `packages/cli/src/load-config.ts`                         | Update public workspace entry shape and type aliases.                                                                                                                     |
| `packages/cli/src/util/peer-wait.ts`                      | Find peers via presence, not sync.                                                                                                                                        |
| `packages/workspace/SYNC_ARCHITECTURE.md`                 | Rewrite diagrams around sync, presence, and RPC.                                                                                                                          |

## Remaining Implementation Plan

This plan starts from `e3703ca74`. It only covers work that has not already landed.

### Phase 1: Choose The Remaining Public Names

- [x] **1.1** Decide whether the old lower-level remote helper stays public.
  - Current code has a bound client shape: `createRemoteClient({ presence, rpc }).actions(peerId)`.
  - Decision: keep only `createRemoteClient` public. `remote.actions(peerId)` and `remote.describe(peerId)` are the user-facing methods.
- [x] **1.2** Decide whether the old remote describe helper stays public.
  - Decision: no separate public helper. `remote.describe(peerId)` keeps discovery on the same bound client.
- [ ] **1.3** Decide whether `sync.attachRpc(actions)` should become `sync.attachRpc({ actions })`.
  - Recommendation: keep positional `attachRpc(actions)` for now. It reads like encryption sub-attachments and current call sites already use it consistently.
- [ ] **1.4** Decide whether `defineActions(tree)` is still needed.
  - Recommendation: defer unless the helper adds validation that tests prove is useful. The `Actions` type and `walkActions` validation already carry most of the value.

### Phase 2: Finish Peer Presence Vocabulary

- [x] **2.1** Rename `packages/workspace/src/document/standard-awareness-defs.ts` to `peer-presence-defs.ts`.
- [x] **2.2** Rename exported types from old mechanism names to current concept names:
  - `Platform` -> `PeerRuntime`
  - `Peer` -> `PeerIdentity`
  - `PeerDescriptor` -> `PeerIdentityInput`
  - `PeerAwarenessState` -> `PeerPresenceState`
  - `FoundPeer` -> `ResolvedPeer`
- [x] **2.3** Rename `standardAwarenessDefs` to `peerPresenceDefs`; keep it internal to the document package.
- [ ] **2.4** Keep app-level `Device` and audio `deviceId` names untouched. This pass is only about sync peer presence.
- [ ] **2.5** Update barrel exports and tests after the rename.

### Phase 3: Decide The Awareness Wire Shape

- [ ] **3.1** Decide whether to keep current `state.peer` or migrate to `state.epicenter.peer`.
  - Current code publishes `state.peer`.
  - Target spec says `state.epicenter.peer`.
  - Recommendation: keep `state.peer` unless there is a real mixed-awareness collision. The namespaced shape is cleaner long term, but it adds migration work without fixing a current bug.
- [ ] **3.2** If namespacing is chosen, update `createPeerPresence`, tests, and any direct awareness fixtures together.
- [ ] **3.3** If namespacing is deferred, update this spec's target examples and success criteria to say `state.peer`.

### Phase 4: Finish Presence Method Naming Or Document Current Names

- [ ] **4.1** Decide whether to rename `presence.find(peerId)` to `presence.resolve(peerId)`.
  - Recommendation: rename only if doing the type vocabulary pass in Phase 2. `resolve` is more precise, but `find` is already implemented and readable.
- [ ] **4.2** Decide whether to rename `presence.observe(callback)` to `presence.subscribe(callback)`.
  - Recommendation: keep `observe` if consistency with existing awareness APIs matters more than perfect naming.
- [ ] **4.3** Update `createRemoteClient`, daemon run handler, CLI peer wait logic, and tests if method names change.

### Phase 5: Documentation And Teaching Pass

- [ ] **5.1** Update this spec after Phases 1 through 4 so it says what the branch actually chose.
- [ ] **5.2** Update `specs/20260430T150000-explicit-daemon-host-config.md` if public helper names or presence names change.
- [ ] **5.3** Update `specs/20260430-whole-workspace-action-discovery.md` only if the explicit daemon action root changes again.
- [ ] **5.4** Add a short "How to Read This Stack" section to the final spec:
  - `actions` is the callable surface.
  - `sync` moves Y.Doc updates.
  - `presence` maps peer ids to client ids.
  - `rpc` sends action calls to client ids.
  - daemon routes add a route prefix before action paths.
- [ ] **5.5** Keep examples educational: show the same `entries.create` action through local action, daemon action, peer RPC, and AI tool naming.

### Phase 6: Verification

- [ ] **6.1** Run focused workspace tests for actions, sync, peer presence, RPC, and daemon run handling.
- [ ] **6.2** Run app integration tests touched by the naming changes.
- [ ] **6.3** Run CLI tests if daemon route or peer output changed.
- [ ] **6.4** Run typecheck.
- [ ] **6.5** Search for stale names:

```bash
rg "DeviceDescriptor|PeerDevice|PeerPresenceState|ResolvedPeer|peerPresenceDefs|getOrCreateDeviceId|sync\\.find|sync\\.peers|sync\\.observe|sync\\.rpc|actionsToAiTools\\([^)]*workspace|describeActions\\(workspace|walkActions\\(workspace|resolveActionPath\\(workspace" packages apps specs
```

## Edge Cases

### Same Installation In Multiple Tabs

Multiple tabs may share one stored installation id. Before cross-tab leader election, this can publish multiple peers with the same `peer.id`.

Expected behavior for this rename:

1. `presence.find(peerId)` sorts client ids ascending.
2. It returns the first matching peer.
3. Remote calls remain valid because same-installation runtimes are intended to be interchangeable.

Future leader election can reduce duplicate presence, but this rename does not need to solve it.

### RPC Without Presence

RPC can target a raw Yjs client id and does not require presence. `createRemoteClient()` requires both presence and RPC because it resolves a stable peer id to a client id before dispatching through the bound RPC attachment.

Expected behavior:

```ts
await rpc.rpc(clientId, "tabs.close", input);
createRemoteClient({ presence, rpc }).actions(peerId);
```

### Presence Without RPC

A read-only viewer may want to show online peers without invoking actions.

Expected behavior:

```ts
const presence = sync.attachPresence({ peer });
presence.peers();
```

No RPC attachment is required.

### Custom Awareness Fields

Apps may still use generic `attachAwareness` for cursors, selections, and typing indicators. Standard peer presence should not absorb those fields.

Expected behavior:

```ts
const editorAwareness = attachAwareness(
  ydoc,
  {
    cursor: Cursor,
    selection: Selection,
  },
  initial,
);
```

Standard peer presence remains separate:

```ts
const presence = sync.attachPresence({ peer });
```

### Malformed PeerIdentity State

A peer can publish malformed awareness state. Presence must validate before returning peer states.

Expected behavior:

1. Malformed `peer` state is dropped from `presence.peers()`.
2. `presence.find(peerId)` ignores malformed states.
3. A warning can be logged through the configured logger.

### Old And New Peers In The Same Room

During a clean breaking migration, mixed old and new clients may temporarily share a room if deployed inconsistently.

Recommendation:

1. Treat old `{ device }` states as invisible to the new presence attachment.
2. Do not add compatibility reads unless rollout demands it.
3. If compatibility is required, add it as a temporary explicit migration branch with a deletion task.

### Registry Root Versus Bundle Layout

Workspace bundles can still contain infrastructure fields like `ydoc`, `tables`, `idb`, `sync`, `presence`, and `rpc`. Those fields must not affect public action paths.

Expected behavior:

```ts
describeActions(workspace.actions);
actionsToAiTools(workspace.actions);
resolveActionPath(workspace.actions, "tabs.close");
```

Do not expose:

```ts
actions.tabs.close;
```

unless the registry itself intentionally contains an `actions` namespace.

### Workspace Without Actions

Some workspace entries may expose sync and presence but no callable actions.

Expected behavior:

1. `/list` returns an empty manifest.
2. Local `/run` reports an unknown action with no crash.
3. `sync.attachRpc(actions)` is only called when the workspace wants inbound RPC actions.
4. PeerIdentity listing still works when presence exists.

### Script Snapshot Surfaces

Script helpers can combine local read-only snapshots with daemon actions. They are consumers of daemon actions, not hosted daemon runtimes.

Expected behavior:

1. Snapshot helpers can read local Yjs state without attaching sync, presence, or RPC.
2. Script action clients can call daemon actions through the daemon client surface.
3. `DaemonRuntime` requirements apply only to hosted daemon routes, not script helper return values.

## Open Questions

1. **Should the awareness namespace stay `peer` or become `epicenter`?**
   - Options: `epicenter`, `$epicenter`, `peer`.
   - Recommendation: keep `peer` for this wave. `epicenter` is cleaner if this state grows, but current peer presence does one small job.

2. **Should `app` be required in `PeerIdentity`?**
   - Options: required `app`, optional `app`, no `app`.
   - Recommendation: optional. The routing identity does not require the app name, but CLI listings may benefit from it.

3. **Should the storage helper return `InstallationId` or `PeerId`?**
   - Options: `InstallationId`, `PeerId`, branded generic only.
   - Recommendation: use `getOrCreateInstallationId` for storage and pass it as `peer.id`. The same value can be branded by apps.

4. **Should CLI flags change from `--peer <id>` to anything else?**
   - Options: keep `--peer`, use `--peer-id`, keep old `--device`.
   - Recommendation: keep `--peer <id>`. It already matches the target concept.

5. **Should `PresenceAttachment.observe` pass change details?**
   - Options: `callback()`, `callback(changes)`, async event stream.
   - Recommendation: keep `callback()` for the first pass unless current callers need change details. The snapshot API is simpler and enough for UI refresh.

## Success Criteria

- [ ] `attachSync` no longer exposes peer or RPC methods directly.
- [ ] Standard peer presence publishes the chosen peer state shape, currently `state.peer`, not `state.device`.
- [ ] Public workspace exports use `PeerIdentity`, `PeerIdentityInput`, `PeerPresenceState`, `ResolvedPeer`, and `PeerRuntime`.
- [ ] Public action exposure uses explicit `workspace.actions` registries.
- [ ] `defineActions` is either intentionally deferred or exists because it adds proven validation or inference value.
- [ ] CLI list/run and AI tools use registry-relative paths.
- [ ] Apps pass `peer` into `sync.attachPresence({ peer })`.
- [ ] Apps pass explicit `actions` into `sync.attachRpc(actions)` when they expose RPC.
- [ ] Remote calls use `createRemoteClient({ presence, rpc }).actions(peerId)` at app boundaries. The lower-level proxy builder is private.
- [ ] CLI peer listing and peer targeting use peer vocabulary.
- [ ] No public docs recommend full-bundle action walking for CLI, AI, or RPC exposure.
- [ ] No old public names remain unless explicitly documented as temporary compatibility.
- [ ] Tests cover sync-only, presence-only, RPC-only, and presence plus RPC compositions.
- [ ] `bun test packages/workspace/src/document` passes.
- [ ] `bun test packages/workspace/src/rpc` passes.
- [ ] `bun test packages/cli` passes.
- [ ] Monorepo typecheck passes.

## References

- `packages/workspace/src/document/attach-sync.ts`: current sync base with `attachPresence` and `attachRpc`.
- `packages/workspace/src/document/peer-presence-defs.ts`: current peer presence definitions to rename or fold into `peer-presence.ts`.
- `packages/workspace/src/document/attach-awareness.ts`: generic typed awareness wrapper to reuse.
- `packages/workspace/src/shared/actions.ts`: action registry and canonical traversal implementation.
- `packages/workspace/src/ai/tool-bridge.ts`: AI tool conversion should take explicit registries.
- `packages/workspace/src/rpc/types.ts`: RPC type maps should infer from explicit registries.
- `packages/workspace/src/rpc/remote-actions.ts`: current remote action helper on the split `{ presence, rpc }` transport.
- `packages/workspace/src/shared/device-id.ts`: current persistent id helper to rename.
- `packages/workspace/src/document/attach-sync.test.ts`: current presence and RPC tests to split.
- `packages/workspace/src/document/system-describe.test.ts`: current `system.describe` and no-manifest-in-awareness tests.
- `packages/workspace/src/rpc/remote-actions.test.ts`: current remote helper tests.
- `apps/fuji/src/lib/fuji/browser.ts`: app migration pattern.
- `apps/honeycrisp/src/lib/honeycrisp/browser.ts`: app migration pattern.
- `apps/opensidian/src/lib/opensidian/browser.ts`: app migration pattern with explicit actions.
- `apps/tab-manager/src/lib/tab-manager/extension.ts`: app migration pattern with branded app-level device ids.
- `packages/cli/src/daemon/app.ts`: CLI peer listing consumer.
- `packages/cli/src/util/peer-wait.ts`: CLI peer resolution consumer.
- `specs/20260430T103959-split-attach-sync-into-transport-presence-rpc.md`: previous split proposal that this spec refines.
- `specs/20260430T170000-readonly-table-primitives-and-script-surfaces.md`: adjacent script and read-only table work that should not be conflated with daemon runtime requirements.

## Review

Not implemented yet. This spec is ready for review before execution.
