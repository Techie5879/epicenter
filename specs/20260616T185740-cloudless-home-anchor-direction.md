# Cloudless Home Anchor Direction

**Date**: 2026-06-16
**Status**: Draft
**Owner**: Braden
**Builds on**: `20260614T120000-app-folder-as-root-and-jsrepo-blocks.md`, `20260615T120000-trusted-relay-and-collaborative-fields.md`, `docs/encryption.md`

## One Sentence

Epicenter keeps one app mount per folder, keeps app-global workspace ids for each signed-in user's corpus, and adds a native Iroh sidecar below the daemon so those same Yjs rooms can sync to a user-owned home anchor instead of Epicenter Cloud.

## Current Direction

```txt
app folder
  epicenter.config.ts      singular Mount, e.g. export default fuji()
  .epicenter/             local machine state
  entries/                read-only projection

daemon for that folder
  owns the app Y.Doc
  owns Yjs log persistence
  owns SQLite and Markdown materializers
  owns actions

transport
  hosted mode: WebSocket to Epicenter Cloud
  cloudless mode: local Rust/Iroh sidecar to home anchor

home anchor
  always-on trusted peer
  stores many Yjs rooms
  stays app-semantics-blind
```

## Composable Roles

The clean model has three roles, not one "server" shape.

```txt
relay:
  sends packets between peers
  should be blind to application plaintext
  does not store durable workspace truth

anchor:
  stores durable Y.Doc replicas
  stays app-blind: no schemas, prompts, tools, or app actions
  can be Epicenter-hosted or self-hosted

worker:
  observes synced docs
  runs the model loop and app actions
  writes answers or computed effects back into the docs
  answers as one or more agents (an AgentId is the address; ADR-0025)
  can be Epicenter-hosted or self-hosted
```

The third role is the **worker** (the running process); the **agent** is the
durable address a conversation binds to, which a worker answers as. The two are
not interchangeable; see the "Agent and worker are not one word for one thing"
section of ADR-0024.

Cloudflare rooms currently bundle relay and anchor. The Iroh direction splits
them: Iroh gives the peer connection system and blind relay path; the chosen
anchor is the durable peer that stores the Y.Doc state. The worker is separate
from both. One physical machine may run anchor and worker processes, but the
roles stay separate so the anchor can remain boring and app-blind.

```txt
                            WORKER
                 hosted cloud      |      self-hosted device
ANCHOR      -----------------------+---------------------------
hosted      default hosted shape   | cloud holds docs,
            cloud holds docs       | device answers with local
            cloud can answer       | tools and local data

self-hosted user-owned docs,       | full self custody:
            hosted model           | user-owned docs,
            optional               | user-owned tools/model
```

The same workspace can be composed from any row and column. "Use my own anchor"
moves down the table. "Run the worker on my own device" moves right. Relay is a
third, independent axis not shown: it is blind either way, so you can self-host
the anchor and still use Epicenter's relay for reachability, and moving the
anchor or the worker never drags the relay with it. These choices must not be
fused in code or product language.

## Replica Rule

Many peers can hold replicas of the same Y.Doc. The anchor is not the only copy;
it is the copy we rely on to be durable and reachable.

```txt
phone/browser:
  in-memory Y.Doc
  optional IndexedDB cache
  not always online

desktop app:
  local Y.Doc replica
  optional local persistence
  not guaranteed always online

agent daemon:
  local Y.Doc replica
  observes matching docs
  writes answers

anchor:
  durable Y.Doc replica
  expected to stay online
```

This keeps the answer to "who stores the doc?" precise: everyone may cache or
replicate it, but the anchor is the product's availability promise.

The folder is the local mount/projection site. It is not automatically the remote corpus identity. For app-global products like Fuji, the workspace id can stay fixed per app and signed-in owner: `epicenter-fuji` means "this user's Fuji corpus." Two folders that both mount `fuji()` while signed in as the same owner are two local projections of the same corpus.

The mount name is a local label, not a routing namespace. Current CLI action addresses are bare action keys inside the one served mount, e.g. `epicenter run entries_update`. Cloudless sync must preserve that shape: one folder serves one mount, and transport routing happens below the daemon.

## Identity Rules

These identities must not be collapsed:

| Identity | Means | Same value implies | Collision risk |
| --- | --- | --- | --- |
| `ydoc.guid` / workspace id | Which data corpus or child doc | Sync the same data | Intentional when two replicas join the same room |
| Yjs `clientID` | Which CRDT worker produced operations | Same live writer | Dangerous if two live processes share it |
| `nodeId` | Which reachable runtime presence/dispatch targets | Same online node/process | Dangerous if two daemons share it |
| Iroh endpoint id | Which native peer to connect to | Same cryptographic network peer | Must be persisted per native peer |

The fixed workspace id is not the bug. The bug would be deriving daemon writer identity from a path or hardcoding daemon presence identity.

Old risky shape:

```ts
ydoc.clientID = hashYDocClientId(ctx.epicenterRoot);
nodeId: asNodeId(`${ctx.mount}-daemon`)
```

Two machines can share the same absolute path and mount name. They should still sync the same workspace, but they must not share the same Yjs `clientID` or daemon `nodeId`.

Current repo shape:

```txt
.epicenter/node.json
  epicenter.node.id: generated nodeId

attachMountInfrastructure(...)
  ydoc.clientID = hashYDocClientId(ctx.nodeId)
```

The node file is local machine state. It is ignored, not synced, and created once per app folder per machine. Because `nodeId` is random and persisted per root, two folders of the same app can intentionally sync the same corpus without sharing the same live worker identity.

## Transport Placement

Iroh belongs below the daemon, not inside app factories.

```txt
Fuji mount
  -> attachMountInfrastructure(...)
  -> sync transport adapter
       hosted: WebSocket
       cloudless: sidecar
  -> Yjs sync frames
```

The sidecar should carry existing `@epicenter/sync` frames, wrapped only with routing metadata:

```json
{ "type": "sync", "roomId": "epicenter-fuji", "frameBase64": "..." }
```

The sidecar must not learn Fuji tables, actions, materializers, child-doc layouts, or app schemas. It routes room bytes and reports connection status.

## Scope: App-Blind Custody Only

The home anchor here routes opaque room bytes and never learns app schemas, layouts, actions, or product semantics. The always-on device *also* runs per-app **workers** (observe synced docs, run inference, execute the app's actions as agent tools), but those are a separate, app-aware role: daemons that sit beside the anchor, never inside the Iroh sidecar. "Anchor" in this spec always means the app-blind role. The worker/agent layer is specified in `docs/adr/0024-an-always-on-worker-runs-app-semantics-beside-the-app-blind-anchor.md`, `docs/adr/0025-agent-conversations-are-durable-child-docs-driven-by-an-observing-worker.md`, and `specs/20260616T225034-always-on-workers-over-synced-docs.md`.

## Multiplexing Rule

Do not multiplex apps in `epicenter.config.ts`.

```txt
No:
  export default [fuji(), zhongwen()]

Yes:
  fuji/epicenter.config.ts      export default fuji()
  zhongwen/epicenter.config.ts  export default zhongwen()
```

Multiplexing belongs at the transport layer:

```txt
one local Rust sidecar
  room epicenter-fuji
  room epicenter-fuji.entries.content.<id>
  room epicenter-zhongwen
  room epicenter-zhongwen.conversations.messages.<id>
```

This preserves folder/process fault isolation while avoiding one Iroh endpoint per room.

## Topology

The default cloudless topology is still a star around the home anchor.

```txt
MacBook daemon -> local sidecar -> Iroh -> Mac Studio anchor
phone app      -> native sidecar -> Iroh -> Mac Studio anchor
desktop daemon -> local sidecar -> Iroh -> Mac Studio anchor
```

Peerwise Iroh or gossip can be an optimization later. It should not be the base model, because it does not answer the durability question: where does the update go when every other device is asleep?

The star is a topology, not an authority model. The anchor is a normal peer with
an availability job. Other peers may connect directly when Iroh can make that
link, but the product still needs a durable place for async work.

```txt
co-online mesh:
  phone <---- sync while both are awake ----> laptop agent

hosted anchor:
  phone <----> Epicenter anchor <----> laptop agent

self-hosted anchor:
  phone <----> home anchor <----> laptop agent
```

For chat, the topology does not decide who answers. The conversation row does:

```txt
conversation.agent = laptop-books-agent

laptop-books-agent:
  if row.agent === selfAgentId:
    answer
  else:
    ignore
```

The optional wake nudge (the doorbell, ADR-0025) follows the same rule: it
targets the bound agent's runtime, never the anchor. The anchor stores and
forwards; it is never the endpoint you ping to make an answer happen. Wiring the
doorbell to the anchor would re-fuse the durable-storage role with the
who-answers question the row already owns.

## What The Spike Proved

Throwaway spike: `/Users/braden/Code/epicenter-anchor-experiment`.

- Iroh 1.0 can reach a home Mac Studio anchor from a MacBook on phone hotspot.
- The anchor can persist a `yrs` doc and keep a stable endpoint identity across restart.
- JS/Yjs update bytes are compatible with Rust/yrs for the tested document shape.
- A live JS/Yjs runtime can use a Rust sidecar to sync through Iroh while JS keeps app semantics.

What it did not prove:

- Real `@epicenter/sync` frame transport.
- Room multiplexing.
- Pairing, revocation, auth, packaging, supervision.
- Browser/WASM Iroh inside Epicenter. Upstream Iroh supports browser peers over
  WebSocket relays and keeps relays blind to application plaintext, but this repo
  has not yet proven a browser Y.Doc syncing through Iroh to an anchor.
- Production daemon-to-sidecar integration against the repo's current `nodeId` model.

## Recommended Next Slice

1. Keep the singular-mount collapse honest: remove or rename any stale multi-mount wording that contradicts one folder, one mount, bare action keys.
2. Make the sidecar carry real `@epicenter/sync` binary frames for one room.
3. Add sidecar room multiplexing.
4. Define pairing: how a daemon learns and trusts the home anchor's Iroh endpoint id.
5. Treat the app-blind anchor/sidecar and the app-aware worker (daemon) as separate roles with separate packaging. The sidecar multiplexes opaque rooms; the worker mounts an app workspace, observes its docs, and runs the app's actions as agent tools. Do not fold the worker into the sidecar. See ADR-0024.
6. Only then add product packaging and browser/native wrapper decisions.

## Grill Prompt

```md
We are reviewing Epicenter's cloudless home-anchor and agent direction. The goal
is to make the model canonical enough that a future agent can implement slices
without re-litigating the topology.

Current thesis:
- One app folder has one `epicenter.config.ts`.
- That config default-exports one `Mount`, not `Mount[]`.
- The folder is a local mount/projection site.
- The workspace id / `ydoc.guid` is the remote corpus identity. Same id means same synced data.
- Yjs `clientID` and daemon `nodeId` are local worker identities and must be unique per live daemon/node.
- Iroh belongs below the daemon as an alternate byte transport, not inside app factories.
- Relay, anchor, and worker are separate runtime roles:
  - relay moves packets and should be blind to application plaintext
  - anchor stores durable Y.Doc replicas and stays app-blind
  - worker observes docs, runs models/tools/actions, and writes results
- An `AgentId` is the durable address a conversation binds to; a worker answers
  as one or more agents. Agent (identity) and worker (process) are distinct.
- Cloudflare rooms currently bundle relay and anchor. Iroh lets us split them.
- A shared Rust sidecar can multiplex many Yjs rooms to one chosen anchor.
- The home anchor is the always-on trusted peer for cloudless custody, but it is not the agent by definition.
- Many peers can cache/replicate the Y.Doc; the anchor is the replica we rely on to be durable and reachable.
- A conversation is bound to exactly one `AgentId`; many peers may sync it, but only the bound agent answers.
- Epicenter Cloud can be the default hosted anchor and/or managed agent; users must be able to designate their own anchor independently from which agent answers.

Please review whether this direction is coherent against the repo. Focus on:

1. Whether fixed app workspace ids are correct for app-global corpora like Fuji.
2. Whether the current daemon identity model is sufficient: `.epicenter/node.json` stores `nodeId`, and Yjs `clientID` is derived from `ctx.nodeId`.
3. Whether daemon node identity belongs under the app root's `.epicenter/` directory or platform user data.
4. Whether bare action keys remain correct now that config is singular.
5. Whether any product semantics accidentally move into Rust/Iroh.
6. Whether multiplexing belongs only in the sidecar/anchor, not config.
7. Whether star topology around the anchor should remain the default over peerwise gossip.
8. Whether the product language keeps relay, anchor, and agent separate.
9. Whether hosted vs self-hosted composition is independent per layer:
   - hosted anchor + hosted agent
   - hosted anchor + self-hosted agent
   - self-hosted anchor + hosted agent
   - self-hosted anchor + self-hosted agent
10. Whether the browser/Iroh claim is proven enough for a product decision:
    upstream Iroh supports browser peers over WebSocket relays, but Epicenter
    still needs its own browser Y.Doc to Iroh anchor spike.
11. The smallest implementation slice that proves this without overbuilding.

One-sentence test:
Can the design be explained as "relays move bytes, anchors keep docs alive,
workers think and write, and conversations bind to one agent" without exceptions?

Relevant files:
- specs/20260616T185740-cloudless-home-anchor-direction.md
- specs/20260614T120000-app-folder-as-root-and-jsrepo-blocks.md
- specs/20260615T120000-trusted-relay-and-collaborative-fields.md
- docs/adr/0024-an-always-on-worker-runs-app-semantics-beside-the-app-blind-anchor.md
- docs/adr/0025-agent-conversations-are-durable-child-docs-driven-by-an-observing-worker.md
- docs/encryption.md
- packages/workspace/src/daemon/attach-mount-infrastructure.ts
- packages/workspace/src/config/daemon-node-id.ts
- packages/workspace/src/shared/client-id.ts
- packages/workspace/src/document/node-id.ts
- packages/workspace/src/document/internal/sync-supervisor.ts
- packages/workspace/src/config/load-epicenter-config.ts
```
