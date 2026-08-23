# Zero-Knowledge Relay and Collaborative Fields

**Date**: 2026-06-14
**Status**: Draft
**Owner**: Braden (workspace platform)
**Branch**: TBD
**Supersedes**: none (the cell-vs-row storage debate is absorbed and dissolved here, see Design Decisions)

## One Sentence

Every Yjs update is encrypted on the client before it touches disk or the network, the relay becomes a zero-knowledge **permanent append-only log** of opaque blobs (bounded by client-side flush coalescing and an optional non-destructive checkpoint cache, never by client-commanded deletion), and a row's collaborative fields (`field.richText()`, `field.text()`) are declared in the table schema instead of hand-wired per app.

## How to read this spec

```txt
Read first:
  One Sentence
  Motivation (Current State + Problems)
  Target Shape
  The trilemma
  Implementation Plan
  Success Criteria

Read if changing the architecture:
  Research Findings
  Design Decisions
  The field.* catalog
  Edge Cases

Skip:
  nothing is historical yet; this is a fresh design
```

This is a **clean break**. There is no migration plan and no compatibility path. Existing on-disk and on-relay data is disposable. Do not write dual-read code, versioned envelopes, or fallback branches to preserve old formats.

## Overview

Today body content (rich text) syncs to the cloud relay in plaintext while metadata is encrypted, the relay carries a full server-side Yjs merge brain, and each app hand-wires encryption, persistence, sync, and child-doc lifecycle in its own `.browser.ts`. This spec collapses all of that: one client-side encryption boundary for every update, a dumb relay, and a schema that declares collaborative fields so the workspace owns their entire lifecycle.

## Motivation

### Current State

Three encryption behaviors coexist, and which one a doc gets is an emergent property of how an app bolts primitives together:

| Path | Local IndexedDB | Relay (cloud) |
| --- | --- | --- |
| Root/metadata doc | encrypted | **encrypted** (value-level, in-doc ciphertext) |
| Body child-doc | **encrypted** (`attachEncryptedIndexedDb`) | **PLAINTEXT** |

Metadata encrypts at the value level inside `createEncryptedYkvLww` (`packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts:211`), so the relay receives ciphertext. Body docs are plain `Y.Doc`s holding a `Y.XmlFragment` (`packages/workspace/src/document/attach-rich-text.ts:31`); local disk is encrypted by `attachEncryptedIndexedDb` (`packages/workspace/src/document/attach-encrypted-indexed-db.ts:175`), but `openCollaboration` ships the raw `updateV2` bytes to the relay untouched (`packages/workspace/src/document/internal/sync-supervisor.ts:233`).

The relay is a smart Yjs merge brain: it holds a live `Y.Doc` (`packages/server/src/room/core.ts:175`), replays every update on cold start (`core.ts:199-201`), serves state-vector diffs, and compacts server-side via `Y.encodeStateAsUpdateV2` (`core.ts:738`).

Row deletion is four lines (`packages/workspace/src/document/table.ts:950`) calling `ykv.delete(id)` (`packages/workspace/src/document/y-keyvalue/y-keyvalue-lww.ts:727`). It removes the row from the root CRDT and nothing else.

This creates problems:

1. **Body content is plaintext on the relay.** The actual thing users write is encrypted on their own disk but readable by the server they are told not to trust. This directly contradicts the login-only / server-trusted-encryption product promise.
2. **The invariant has no owner.** "Is my data safe end to end" is smeared across ~40 lines of per-app `.browser.ts` wiring (`apps/fuji/src/lib/workspace/browser.ts:80`, `apps/honeycrisp/honeycrisp.browser.ts:58`), replicated per app, checked nowhere. Bodies leak because `openCollaboration` will sync anything handed to it.
3. **Deletion orphans bodies forever.** A hard delete leaves the body child-doc's IndexedDB store on disk and its Durable Object on the relay indefinitely. `packages/server/src/routes/rooms.ts` has no DELETE verb; no sweep exists.
4. **The materializer relies on a side effect.** A body edit reaches the vault projection only as a side effect of the `updatedAt` bump, an unnamed load-bearing invariant.

### Desired State

```ts
// A body is a declared FIELD of the row, not a free-floating GUID-joined sibling doc.
const fuji = defineWorkspace({
  id: 'epicenter-fuji',
  tables: {
    entries: defineTable({
      title:  field.string(),        // scalar: opaque cell in the row
      pinned: field.boolean(),       // scalar: opaque cell in the row
      body:   field.richText(),      // collaborative: own child doc, character merge
      code:   field.text(),          // collaborative: Y.Text (code.txt / plaintext)
    }),
  },
});

// Keyring required. Plaintext sync is unrepresentable.
const ws = await openWorkspace(fuji, { auth, transport: relay });

using body = ws.entries.open(id).body;   // lazy, character-merged, encrypted
body.observe(render);

ws.entries.delete(id);  // cascades: disposes the body doc, clears its IDB, drops the relay room
```

## The trilemma

For any synced collaborative field you can have at most two of three:

```txt
        smart relay (server merges + compacts)
              /                    \
   character-level merge  ───  encrypted content
   (real-time collab text)      (relay can't read it)
```

- smart relay + character merge -> **plaintext content** (today, the bug)
- smart relay + encrypted content -> **no character merge** (whole-blob LWW; rejected, see below)
- character merge + encrypted content -> **dumb relay** (this spec)

Key correction that drives the whole design: **character-level merge happens on clients, not the server.** Two devices converge as long as something shuttles their updates. The server being smart is only an optimization (delta sync + server compaction), not a requirement for collaboration. So choosing the dumb-relay corner keeps collaboration fully intact and costs only server-side optimizations, which clients can replace.

## Research Findings

### Yjs merge is structural; values are opaque (grounded in yjs/yjs)

- CRDT merge (`Y.applyUpdate`, `Y.mergeUpdatesV2`) operates on item IDs, clocks, and client IDs. It never interprets stored values. A `Uint8Array` becomes a `ContentBinary` item treated as atomic, so a relay can merge and compact a doc full of encrypted blob values without decrypting. Yjs ships `Y.obfuscateUpdate` (replaces content, keeps merge metadata), proving this is intended.
- `Y.Text` / `Y.XmlFragment` require the inserted content to be real text/structure for character-level merge. You **cannot** store rich text as one opaque blob and keep character merge.

**Implication**: scalar fields can be opaque encrypted blobs even on a smart relay. Rich text cannot; encrypting it forces a dumb relay (clients hold the live CRDT, the wire/disk carries ciphertext deltas).

### Compaction primitives and the delete-set guarantee (grounded in yjs/yjs)

- `Y.encodeStateAsUpdateV2` preserves the **delete set** (`writeIdSet(encoder, doc.store.ds)`). An offline peer that missed a deletion gets the delete set in the snapshot and re-marks items deleted via `readAndApplyDeleteSet`. Deletions are state-based; dropping old updates and keeping only the snapshot does **not** resurrect deleted content.
- Updates and snapshots are commutative and idempotent ("apply in any order, multiple times"). Overlapping snapshots from two devices converge; double-apply is filtered via `ss.exclude(knownState)`.
- `Y.mergeUpdatesV2` merges blobs without a `Y.Doc` (but still must read them, so only a decrypting client can run it).

### Garbage collection hazard (grounded in yjs/yjs)

- With `gc:true`, deleted content becomes lightweight GC markers (id + length, no content). A peer offline **across** a deletion+GC whose old update references GC'd items can hit ambiguous integration. Yjs forbids `createDocFromSnapshot` on gc:true docs for this reason.
- That forbidden API is the **versioning** path, not our compaction path. Our path (`encodeStateAsUpdate` + `applyUpdate`) is the normal sync path, which y-indexeddb runs on gc:true docs in production. Routine offline windows are safe; only pathological long-offline-across-GC is at risk.

### Client-side compaction is proven; the relay never deletes on a client's word (grounded in yjs/y-indexeddb)

y-indexeddb stores each update as a record and, at `PREFERRED_TRIM_SIZE = 500`, calls `Y.encodeStateAsUpdate`, writes one consolidated record, deletes the old ones (`_dbsize` collapses to 1). This is the client's *local-disk* compaction and it already runs in `attachEncryptedIndexedDb`. We reuse the exact same snapshot computation for the relay, but as a **non-destructive checkpoint cache**: the client uploads `(snapshot, asOfSeq)`, the relay keeps the newest and serves `checkpoint + after(asOfSeq)` on cold start. The raw append log remains ground truth; the checkpoint is a safely-ignorable optimization. The relay never deletes raw blobs because a client told it to (it cannot decrypt to verify the claim); any reclamation is an operator-policy decision (see Architecture).

### Yjs GC is not relay compaction (grounded in yjs/yjs)

`gc:true` shrinks deleted *content inside one doc's struct store* (deleted items become id+length GC markers). It has **no effect on the count of update blobs** the relay stores. The two are orthogonal: relay storage is bounded by flush coalescing + checkpoints + optional operator reclaim, never by `gc`.

### Cost grounding: append-only on Cloudflare SQLite Durable Objects (grounded in Cloudflare docs)

Billing (live Jan 2026), one Durable Object per doc, one row per flushed blob:

| Lever | Rate | Free tier (account-wide, shared across all users) |
| --- | --- | --- |
| Rows written | $1.00 / million | first 50M / month |
| Rows read | $0.001 / million | first 25 billion / month |
| Stored data | $0.20 / GB-month | first 5 GB-month |
| Max storage per DO | 10 GB hard cap | per doc/room |

Facts that shape the design:

- **Cost is driven by edit-*event* count, not content size.** Each flushed update is one permanent row; a 1 KB note edited 100k times is 100k rows. The tail concentrates in streamed editing (transcription, AI completions written into a `field.*`), which produces updates 10-50x faster than human typing.
- **Writes and reads are effectively free at single-user scale and small at fleet scale.** Writes are design-neutral (you pay per live update regardless of compaction); reads stay under the vast free tier until very large scale.
- **Storage is the only term that compounds.** The free tier is per *account*, not per user, so it divides by user count. At ~5,000 users (blended ~30k updates/user/month) the fleet adds ~20 GB/month and storage runs roughly $300 (year 1) climbing past $1,400 (year 3) and rising every year under pure append-only. Trivial against revenue, but it never stops growing, and streamed editing accelerates it.
- **The per-doc 10 GB cap is ~40 years of human typing but can shrink to ~2 years on a hot streamed doc.**

Implication: append-only is free-ish for a launch window and never needs *client-commanded* deletion, but at fleet scale or with heavy streaming you eventually want operator-policy reclaim. Flush coalescing attacks the root cause (event count) before any compaction is needed.

### Comparable trust models

| System | Server reads content? | Merge model | Server can forge? | Notes |
| --- | --- | --- | --- | --- |
| Bitwarden | no | whole-item replace (no CRDT) | no | comparable for scalar fields |
| Signal (libsignal) | no | E2E message log | no | comparable for the append-log shape, not doc sync |
| Jazz | no | E2E CRDTs over a relay | no | directional comparable; verify compaction specifics before leaning on them |

**Key finding**: "E2E content + metadata-leaky + availability-trusting" is a recognized, defensible tier (Bitwarden lives there). We are not inventing a weaker model; we are reaching that tier for the first time.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Relay topology | 2 coherence | Dumb zero-knowledge append-only log | Encryption forces opaque updates the server cannot merge; collaboration is client-side anyway |
| Encryption layer | 1 evidence | Encrypt the Yjs update blob at the transport boundary | `attachEncryptedIndexedDb:175` already does this for disk; extend the same wrapper to the relay channel |
| Encryption scheme | 2 coherence | One scheme (XChaCha20-Poly1305 over the update blob) for all docs | Retire value-level `createEncryptedYkvLww`; relay-compaction was its only advantage and the relay no longer compacts |
| Flush granularity | 1 evidence | Client debounces + `mergeUpdatesV2` before encrypting/sending | Decouples relay row rate from keystroke/token rate at the source; the primary, zero-trust cost lever, esp. for streamed editing |
| Storage bounding | 2 coherence | Non-destructive checkpoint cache + optional operator-policy reclaim; never client-commanded deletion | Client uploads `(snapshot, asOfSeq)`; relay keeps newest as a safely-ignorable cache; only the operator deletes raw blobs, on its own retention timer, reusing the snapshot trust local disk already extends |
| GC mode | 3 taste | `gc:true` on client docs; offline hazard bounded by the always-retained raw log (and an operator retention window where reclaim is enabled) | Matches Yjs default and y-indexeddb; under append-only the raw log itself is the safety net |
| Collaborative fields | 2 coherence | Declared in schema (`field.richText()`, `field.text()`); workspace owns the child doc | Promotes ~40 lines of per-app wiring into the schema; makes delete-cascade structural |
| Body merge for rich text | 1 evidence | Character-level CRDT (kept) | User requirement: collaborative editing of a body/code field is load-bearing for Honeycrisp/Opensidian |
| AAD binding | 2 coherence | AAD = docGuid + key version per blob | Prevents cross-room splicing and replay |
| Auth vs encryption | 2 coherence | Two layers: relay authenticates access, keyring (never sent) gates readability | Makes the untrusted-relay promise honest |
| Privacy target | 3 taste | L2 (content + schema hidden); room-name hashing (L3) deferred | Room names still leak collection/rowId; closing it is a cheap rider, not load-bearing now |
| Rollback resistance | Deferred | Deferred (signed monotonic checkpoint / hash chain) | AEAD already blocks forgery; rollback/withholding is an availability-trust concern acceptable for a notes app initially |
| Cell-vs-whole-row storage | 2 coherence | Dissolved: it is now a pure client-side Yjs-type choice the relay never sees | With a dumb relay, merge granularity has no server consequence; declare per field in schema |

### What was considered and rejected

| Candidate | Why rejected |
| --- | --- |
| Approach P: body as opaque blob in a table cell | Loses character-level merge (whole-blob LWW); user requires collaborative body editing |
| Keep smart relay, value-encrypt bodies | Value-level encryption fits rich text terribly (leaks edit positions, structure, lengths) and cannot character-merge an opaque value |
| Two relay modes (smart for metadata, dumb for bodies) | "Two ways to do the same thing" carved into the foundation; once the dumb path exists, unifying on it deletes the server brain |
| Homomorphic / secure merge on server | Research-grade; infinite build cost for a win client checkpointing already provides |
| Server-side compaction retained | Server cannot compact ciphertext it cannot read; clients compact instead |
| Client-commanded destructive compaction ("delete raw updates <= N") | Hands an unverifiable client a delete trigger on data the relay cannot read; replaced by a non-destructive checkpoint cache + operator-policy reclaim |
| Migration / dual-read | Explicitly out of scope; clean break |

## The field.* catalog

```ts
// Scalar fields: stored as the row's value (opaque to the relay), structural/LWW merge
field.string<TBrand?>(s?)     // text
field.number(s?)              // real
field.integer(s?)             // integer
field.boolean()              // 0/1
field.select([...])          // enumerated text
field.json<S>(schema)        // JSON-encoded value

// Collaborative fields: own lazy child doc, character-level CRDT merge, encrypted deltas
field.richText()             // Y.XmlFragment (Tiptap/ProseMirror rich body)
field.text()                 // Y.Text (plaintext / code.txt)
```

A collaborative field declares: the field is backed by a child doc whose guid derives from `(workspaceId, collection, rowId, fieldName)`; the workspace owns its creation, encryption, sync, disposal, and delete-cascade.

## Architecture

### Encryption boundary (one place, every update)

```txt
client edit
  -> Y.Doc updateV2 (plaintext CRDT delta, in client memory)
    -> encrypt(blob, keyring, aad = docGuid + keyVersion)     <-- the single boundary
      -> attachEncryptedIndexedDb (local)   AND   relay channel (network)
relay: stores opaque blob, assigns monotonic seq, fans out to peers. Never decrypts.
peer:  receives blob -> decrypt -> applyUpdateV2 -> Yjs merges (char-level for rich text)
```

The relay never imports Yjs for room storage. It is: append-blob, serve-blobs-after-seq-N, accept-checkpoint, GC-before-checkpoint, DELETE-room.

### Storage bounding: a zero-trust escalation ladder

The raw append log is permanent ground truth. Bound its growth with the cheapest rung that suffices; everything except the last rung has no trust surface.

```txt
Rung 0  flush coalescing (client, free, no trust)
  client buffers updates ~500ms, Y.mergeUpdatesV2 -> one blob -> encrypt -> send
  turns a 2,000-token stream into a few dozen rows instead of 2,000

Rung 1  non-destructive checkpoint cache (client, ~free, no trust)
  snapshot = Y.encodeStateAsUpdateV2(localDoc)   // delete set included
  upload (encrypt(snapshot), asOfSeq)
  relay keeps the NEWEST checkpoint; deletes nothing
  new device: download checkpoint + after(asOfSeq) -> decrypt -> apply
  if a checkpoint is wrong, relay falls back to full replay (raw log still there)

Rung 2  operator-policy reclaim (operator, the ONLY deletion, off by default)
  operator's own timer deletes raw blobs <= newest-checkpoint.asOfSeq
    older than a retention window
  not client-commanded; trust == the same encodeStateAsUpdateV2 already
    trusted for local-disk compaction; retention window is the backstop
  enable per-deployable only when storage bills enough to care
```

The relay's surface stays: append-blob, serve-after-seq, accept-checkpoint, DELETE-room, and (operator-only) reclaim-before-checkpoint. It never decrypts and never deletes on a client's instruction.

### Lifecycle ownership

```txt
row (schema declares its collaborative fields)
  owns -> body child doc creation (lazy, via createDisposableCache)
  owns -> encryption on every channel (keyring)
  owns -> sync (dumb relay)
  owns -> disposal (refcount + grace)
  owns -> delete cascade: clearLocal() + relay DELETE room
```

### Transport and liveness (two channels, two backends)

Liveness and storage cost are different channels with different latency budgets; do not force one stream to serve both.

```txt
ephemeral broadcast         durable append
latency budget <100ms       latency budget "before a crash matters"
every raw update            debounced ~1s, mergeUpdatesV2 -> one blob
relay fans out, NO store    relay appends one row (the cold-start substrate)
```

A live peer renders character-by-character from the broadcast channel; an offline peer catches up from the durable log. Coalescing (Rung 0) touches only the durable channel, so it never costs liveness. The window is loss-free: every update is already on the writer's local disk (`attachEncryptedIndexedDb`) and in any peer that received the broadcast, so the relay log is a shared rendezvous allowed to lag, not the only copy. Live cursors/selections ride Yjs **awareness** (ephemeral, never logged); persisting them would row-bomb the log with mouse moves.

Transport by doc state, not one-size-fits-all (both surfaces already exist: WS in `room/core.ts`, HTTP in `http-room-sync.ts`):

- **WebSocket (hibernatable)** for the *actively-edited* doc's live fan-out. `ctx.acceptWebSocket` + `setWebSocketAutoResponse` keep idle sockets open with no compute billing.
- **HTTP fetch** for cold-start bootstrap (`GET checkpoint` + `GET after-seq`, cacheable) and background flush of docs not being live-edited.

Scaling consequence: you hold roughly **one WebSocket per actively-edited doc (usually one per user)**, not one per doc. Concurrent sockets track active editors, not user count or doc count.

### Wire protocol (relay surface)

The relay is one Durable Object per room (per doc). Single-threaded, so `seq` is a total order with no distributed-counter problem. Per-room storage is two tables:

```sql
updates    (seq INTEGER PRIMARY KEY AUTOINCREMENT, blob BLOB)  -- append-only, opaque
checkpoint (blob BLOB, as_of_seq INTEGER)                      -- one row, newest as_of_seq wins
```

Four content verbs (plus the unchanged WS live-fan-out and the unchanged dispatch/presence text channel):

| Verb | Input | Effect | Output |
| --- | --- | --- | --- |
| **append** | encrypted blob | assign next `seq`, insert, fan out to live WS peers | `seq` |
| **read-after-seq** | cursor `N` (absent = cold start) | rows where `seq > N`; on cold start return `checkpoint` + rows where `seq > checkpoint.as_of_seq` | blobs (+ checkpoint) |
| **accept-checkpoint** | encrypted snapshot, `asOfSeq` | upsert `checkpoint` if `asOfSeq` newer; **delete nothing** | 204 |
| **DELETE-room** | (room id) | drop `updates` + `checkpoint` for the cascade | 204 |

The relay never decrypts a blob, never runs Yjs, and never deletes a raw update except via the optional operator-policy reclaim timer (Rung 2). The transport for `append` (WS broadcast-only frame vs HTTP POST) is the deferred two-channel mapping; the *operation* above is transport-independent.

### Cursor semantics

The client persists `lastSeq` per doc in the encrypted-IDB CUSTOM store. On connect/bootstrap it calls read-after-seq with `lastSeq`, applies each blob with `applyUpdateV2` (idempotent), and advances `lastSeq` to the max `seq` received. Delivery is **at-least-once + idempotent apply**, never exactly-once: a crash between applying a blob and persisting the cursor merely re-fetches it next time, and Yjs dedups on `(client, clock)`. No transaction spans apply + cursor-write. Cold start (`lastSeq` absent) applies the checkpoint first, then the tail.

### Yjs doc granularity and non-goals

A Yjs doc is the unit of **concurrent co-editing**, never the unit of **readership** or **storage**. Its fan-out set is "who has this entity open right now," which stays small by construction.

- **Split by entity, never one megadoc.** One root metadata doc plus one independent child doc per collaborative field (guid from `(workspaceId, collection, rowId, fieldName)`). These are **separate top-level docs, not Yjs subdocuments**: subdocs propagate updates *through* the parent, which would defeat independent per-field encryption, lazy loading, and per-room sync (grounded in yjs/yjs). Derived-guid independent docs give each field its own lifecycle, encryption, and room.
- **Non-goal: a single doc fanned out to many simultaneous editors (a "megaroom").** Thousands of live editors on one doc is a different system (segmented/sharded docs) and is out of scope. Collaboration here is small-fan-out (your devices; a few co-authors of one page).
- **Readership is a database read, not CRDT sync.** Browsing/searching a corpus is served from a SQLite projection (client-side for personal; server-side for a self-hosted instance), never by joining a Yjs room. The per-DO 1,000 req/s and 10 GB caps bind only under the excluded megaroom load; flush coalescing keeps a hot doc far under both, and a `SQLITE_FULL` DO still serves reads and deletes so reclaim always recovers it.

### Deployable fork: trust model decides where truth lives

The personal hosted relay (`apps/api`) and the self-hosted instance relay (`apps/self-host`) have different trust models, so they have different sources of truth. This is not "two relay modes for one deployable" (rejected above); it is two deployables with genuinely different threat models sharing `packages/server` primitives.

| | Personal hosted (this spec) | Self-hosted instance (separate spec) |
| --- | --- | --- |
| Server may read content | No (ZK) | Yes (members' own server) |
| Source of truth | Encrypted append log (opaque blobs) | Plaintext SQLite (queryable, FTS) |
| Query / search | Client-side SQLite materializer | Server-side SQLite |
| Yjs doc role | The doc *is* the truth, synced encrypted | Ephemeral live co-edit layer over a SQLite row |
| Yjs lifetime | Long-lived per device | Hydrated on open, materialized + destroyed on quiesce |
| Encryption | Mandatory update-blob | Optional (server trusted) |

**Phase 4.2's "delete the server merge brain" is scoped to the personal relay.** A self-hosted instance relay may legitimately keep a smart but **ephemeral** Y.Doc: hydrate a page's doc from its SQLite row, fan out to the few live editors, materialize back to SQLite on quiesce, destroy the doc (snapshot-hydrate-then-destroy is supported; clientID rotation is harmless because presence keys on `deviceId`). Non-editing readers never join the room; they read the SQLite row over HTTP. The self-hosted SQLite-as-truth design is its own spec; this spec only fixes the boundary so Phase 4.2 does not delete a brain that deployable wants.

## Call sites: before and after

### Fuji entry body

**Before** (`apps/fuji/src/lib/workspace/browser.ts:80`, abbreviated):

```ts
const ydoc = new Y.Doc({ guid: entryContentDocGuid(id), gc: true });
const { idb: bodyIdb } = wire(ydoc, { actions: {} });   // attachLocalStorage + openCollaboration
const body = attachRichText(ydoc);
// + onLocalUpdate hook bumping updatedAt
// + manual disposal in cache build closure
```

**After**:

```ts
// declared once in the schema:
entries: defineTable({ /* ... */, body: field.richText() })

// consumed:
using body = ws.entries.open(id).body;   // workspace owns guid, encryption, sync, disposal, cascade
```

**Semantic shift to flag**: the body update path now reaches the relay as ciphertext, not plaintext. The `onLocalUpdate -> updatedAt` bump is no longer the body-changed signal; the materializer observes the field directly. App `.browser.ts` no longer constructs body docs.

### Honeycrisp note body

**Before** (`apps/honeycrisp/honeycrisp.ts:136`, `honeycrisp.browser.ts:58`): identical pattern, plus `openCollaboration` with no keyring (the leak).

**After**: a `body: field.richText()` field; `openWorkspace` requires a keyring, so a keyring-less sync path is unrepresentable.

## Implementation Plan

Clean break uses Build, then Remove. No "prove old path still works" wave because there is no old path to preserve.

### Phase 1: Dumb relay (the architectural collapse)

**Single-channel at launch.** Phase 1 ships one stream: the client sends every update over the WebSocket; the relay appends it (assigns `seq`, stores the blob) **and** fans it out to live peers. The ephemeral-broadcast vs durable-append split (Transport and liveness) is explicitly out of this slice; it is a later prototype, not a Phase 1 task. Build the whole branch through Phase 4 before release, since the plaintext-body bug is only closed once Phase 2 lands (encryption requires the dumb relay, so it cannot precede Phase 1).

- [ ] **1.1** Replace the room core's live `Y.Doc` binary-sync storage (`packages/server/src/room/core.ts`) with an append-only encrypted-blob log keyed by monotonic seq. **Keep the dispatch-correlation and presence text-frame channel unchanged** (it is content-blind; do not delete it).
- [ ] **1.2** Replace state-vector sync with offset-cursor sync ("send blobs after seq N") in `packages/sync/src/protocol.ts` and `rooms.ts`. The client persists a per-doc relay seq cursor (new bookkeeping, alongside the encrypted update store).
- [ ] **1.3** Add a DELETE room verb to `packages/server/src/routes/rooms.ts`.
- [ ] **1.4** Remove `yjs` from `packages/server` room storage; confirm the relay never imports it for rooms.

### Phase 2: Client encryption boundary

- [ ] **2.1** Extract the update-blob encryption from `attachEncryptedIndexedDb` into a shared boundary usable by both disk and relay channels.
- [ ] **2.2** Make `openCollaboration` require a keyring and encrypt every outbound update / decrypt every inbound update (AAD = docGuid + key version).
- [ ] **2.3** Retire `createEncryptedYkvLww` value-level encryption; all docs use update-blob encryption.
- [ ] **2.4** Add flush coalescing: debounce outbound updates (~500ms) and `Y.mergeUpdatesV2` the buffer into one blob before encrypting/sending. Decouples relay row rate from edit-event rate; the primary cost lever.

### Phase 3: Schema-owned collaborative fields

- [ ] **3.1** Add `field.richText()` and `field.text()` to the field catalog; declare child-doc backing.
- [ ] **3.2** Wire `table.open(id).<field>` to lazily open the backing child doc via `createDisposableCache` and return the live `Y.XmlFragment` / `Y.Text`.
- [ ] **3.3** Make `table.delete(id)` cascade: dispose the child doc, `clearLocal()` its IDB, call the relay DELETE for each collaborative field.
- [ ] **3.4** Point the materializer at the collaborative field's observer directly; remove the `updatedAt`-bump-as-signal coupling.

### Phase 4: Remove

- [ ] **4.1** Delete per-app body-doc wiring from `apps/fuji`, `apps/honeycrisp`, `apps/opensidian` `.browser.ts`.
- [ ] **4.2** Delete the per-room live `Y.Doc`, STEP1/STEP2 state-vector sync, and server-side compaction. Do **not** delete dispatch correlation or presence.
- [ ] **4.3** Typecheck, run workspace + server tests, smoke each app.

### Phase 5: Storage bounding (deferred until cold-start latency or fleet storage bills enough to matter)

- [ ] **5.1** Non-destructive checkpoint: client uploads `(encrypt(encodeStateAsUpdateV2(doc)), asOfSeq)`; relay keeps the newest and serves `checkpoint + after(asOfSeq)` on cold start. Deletes nothing.
- [ ] **5.2** (Optional, per-deployable, off by default) Operator-policy reclaim: an operator timer deletes raw blobs <= newest-checkpoint.asOfSeq older than a retention window. Never client-triggered. Personal: enable when fleet storage bills enough. Self-hosted instance: leave off (or feed only owner checkpoints); rate-limit row-bombing instead.

## Edge Cases

### Concurrent checkpoints from two devices

1. Device A uploads a checkpoint with asOfSeq 1300; device B uploads one with asOfSeq 1349.
2. The relay keeps the newest by asOfSeq (1349) as its cache and discards the older checkpoint. Nothing else is deleted.
3. Outcome: convergent, no data loss. Because checkpoints are non-destructive, a wrong one is at worst ignored in favor of full replay.

### Device offline across a deletion + GC

1. Device offline for months; content it concurrently edited was deleted and GC'd elsewhere.
2. Its old update references GC'd items.
3. Under append-only (reclaim off), the raw log is fully retained, so it reconciles against real deltas (zero risk). Where reclaim is enabled, the same holds if offline < retention window; longer than that it gets the checkpoint and is effectively a fresh sync. The always-retained raw log is the default safety net.

### Malicious or compromised relay

1. AEAD blocks tampering and forgery (decryption fails); reorder is harmless (CRDT).
2. The relay can still withhold updates or serve a stale checkpoint (rollback).
3. Outcome: confidentiality and forgery-resistance hold; availability/freshness are trusted unless a hash chain is added. See Open Questions.

### New device cold start with 10k rows

1. Root/metadata doc snapshot may be several MB of opaque cells.
2. Downloaded once; bodies remain lazy per doc.
3. Outcome: acceptable one-time cost; the lazy split is preserved.

## Open Questions

1. **Self-hosted instance reclaim / abuse policy.**
   - Context: a malicious member could row-bomb one doc toward the 10 GB per-DO cap, or upload a bad checkpoint.
   - **Recommendation**: keep operator reclaim off for the self-hosted instance (or feed it only owner checkpoints); bound growth with flush coalescing + rate limits. Do not add server-side content validation to the personal relay. Leave open.

2. **Flush debounce window vs liveness.**
   - Context: coalescing trades a few hundred ms of remote-echo latency for a large drop in row count.
   - **Recommendation**: ~500ms default, tunable per field kind (tighter if a live-cursor surface ever needs it; awareness/cursors ride a separate ephemeral channel and are not row-logged regardless). Revisit if collaborative typing feels laggy. Leave open.

3. **Rollback resistance.**
   - Context: AEAD blocks forgery; a malicious relay can still serve a stale checkpoint or withhold tail blobs.
   - **Recommendation**: defer. Add a signed monotonic checkpoint counter (clients refuse regressions) only if the threat model rises above "notes app." Leave open.

(Retention-window length, checkpoint-trigger ownership, and `gc:true`-vs-`false` are no longer open: clients never command deletion, so the always-retained raw log is the safety net, and the only retention question is the optional operator reclaim's window, owned per deployable.)

## Adjacent Work

- Room-name hashing (L3 privacy): not required now; brings the relay from "can't read content/schema" to "can't enumerate rows." A cheap rider on Phase 1 if desired.
- Hash-chain / signed checkpoints (rollback resistance): deferred per Open Question 2.

## Decisions Log

- Keep `gc:true` on client docs: matches Yjs default, y-indexeddb, and existing code; smaller docs.
  Revisit when: a real long-offline-across-GC corruption is observed in practice.
- Relay never deletes on a client's word: append-only is permanent ground truth; bounding escalates flush coalescing -> non-destructive checkpoint -> operator-policy reclaim, cheapest rung first.
  Revisit when: the per-DO 10 GB cap or fleet storage cost forces operator reclaim on by default.
- Keep the root-doc / body-doc lazy split: it owns the instant-list-render-with-10k-rows invariant.
  Revisit when: bodies become small enough to inline without a cold-start cost (unlikely).

## User story

> As a Honeycrisp user with a laptop and a phone, when I type into a note's body on my laptop, the words appear on my phone within ~1s, the relay operator can never read what I wrote, and when I delete the note it leaves nothing behind: no IndexedDB store on either device, no live room on the relay.

This one story exercises every load-bearing claim: liveness, character-level merge, encryption, and delete-cascade.

## Test matrix

Most tests are client-side with a fake relay: `createSyncSupervisor` already accepts an injected `openWebSocket`, so two in-memory docs drive a fake relay with no network.

| # | Test | Asserts |
| --- | --- | --- |
| 1 | Plaintext-never | every stored relay blob fails `applyUpdateV2`/decode without the keyring; `openCollaboration` throws without a keyring |
| 2 | Convergence | two docs + fake relay, concurrent edits to one `field.richText()` converge character-for-character |
| 3 | Cold-start | fresh client bootstraps from `checkpoint + after(asOfSeq)` and deep-equals the writer |
| 4 | Delete-cascade | `table.delete(id)` clears the IDB store, calls DELETE-room, leaves no live room/socket |
| 5 | One-cipher | `createEncryptedYkvLww` deleted; all docs use the update-blob path |
| 6 | Coalescing (Rung 0, when built) | 2,000 streamed updates produce a relay row count far below 2,000 |
| 7 | Relay-has-no-yjs | `packages/server` room storage does not import `yjs` (import-graph assertion) |
| 8 | Cursor idempotency | replaying overlapping `read-after-seq` ranges leaves doc state and `lastSeq` unchanged |

One real integration test against a deployed Durable Object covers the four wire verbs (append, read-after-seq, accept-checkpoint, DELETE-room) and hibernation wake/replay, which the in-memory fake cannot. The manual end-to-end is the user story itself: type on one device, watch it land on another within ~1s, inspect the relay rows to confirm they are opaque, delete, confirm both stores and the room are gone.

## Success Criteria

- [ ] No doc reaches the relay in plaintext; `openCollaboration` cannot sync without a keyring.
- [ ] The relay does not import `yjs` for room storage and never decrypts a blob.
- [ ] Two devices editing the same `field.richText()` body converge character-by-character through the relay.
- [ ] Flush coalescing keeps relay row count well below edit-event count under streamed editing.
- [ ] A non-destructive checkpoint lets a new device cold-start from checkpoint + tail without the relay deleting any raw blob.
- [ ] `table.delete(id)` leaves no orphaned IndexedDB store and no live relay room for the row's collaborative fields.
- [ ] One encryption scheme in the codebase; `createEncryptedYkvLww` value-level path deleted.
- [ ] Per-app body-doc wiring removed from `apps/*/.browser.ts`.
- [ ] Typecheck passes; workspace + server tests pass; each app smoke-tested.

## References

- `packages/workspace/src/document/internal/sync-supervisor.ts:233` - where raw updates currently reach the relay unencrypted
- `packages/workspace/src/document/attach-encrypted-indexed-db.ts:175` - the update-blob encryption to lift into a shared boundary
- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts:211` - value-level encryption to retire
- `packages/workspace/src/document/attach-rich-text.ts:31` - current body `Y.XmlFragment` construction
- `packages/server/src/room/core.ts:175,199-201,738` - the server Yjs brain to delete
- `packages/server/src/room/backends/cloudflare/durable-object.ts` - room Durable Object shell
- `packages/server/src/routes/rooms.ts:135,186` - room routes; needs offset-cursor sync + DELETE verb
- `packages/sync/src/protocol.ts:78,107` - sync framing to swap to offset cursor
- `packages/workspace/src/document/table.ts:950` - row delete; needs cascade
- `packages/workspace/src/document/y-keyvalue/y-keyvalue-lww.ts:727` - underlying delete
- `packages/workspace/src/cache/disposable-cache.ts` - lazy child-doc lifecycle to reuse
- `apps/fuji/src/lib/workspace/browser.ts:80`, `apps/honeycrisp/honeycrisp.browser.ts:58` - per-app wiring to remove
- yjs/yjs, yjs/y-indexeddb (DeepWiki) - merge-is-structural, delete-set preservation, compaction model
