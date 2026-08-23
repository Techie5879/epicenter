# Trusted Relay and Collaborative Child Docs (single path)

**Date**: 2026-06-15
**Status**: Draft
**Owner**: Braden (workspace platform)
**Branch**: TBD
**Supersedes**: `20260614T160000-zero-knowledge-relay-and-collaborative-fields.md` (the ZK append-log design is withdrawn; see Decision)

## How to read this spec

```txt
Read first:
  One Sentence
  Decision: trusted, not zero-knowledge
  Target shape: three layers
  Implementation Plan

Read if changing the architecture:
  Research Findings
  Design Decisions
  Open Questions

Historical / supporting:
  What collapses / What stays
```

## One Sentence

There is exactly one trusted relay that runs Yjs, merges, and reads content; a collaborative body is a child Y.Doc addressed by a stable guid, opened through one bound `session.childDocs` runtime (lifecycle), shaped by an `attach*(ydoc)` layout (shape + writer policy), and declared on a row only for identity + delete-cascade; the server-trust encryption layer (keyring, value-level and update-blob encryption) is deleted, and at-rest protection moves to infrastructure.

## Decision: trusted, not zero-knowledge

"Even logged in, we cannot read your data" was evaluated as a **nice-to-have, not a primary differentiator** for Epicenter. It is not a landing-page reason to choose the product, and the roadmap does not commit to "the server never computes over content forever." Therefore:

- The hosted relay **may read content**. The server is a normal trusted peer.
- The ZK append-log design (`20260614`) is withdrawn. Its dumb-relay rewrite (Wave 1) is reverted.
- Encryption-at-rest for **server trust** (server-blindness) is removed. Encryption-at-rest for **disk theft** moves to infrastructure (see Encryption matrix), not the CRDT wrapper.

Reversibility note: trusted -> opt-in ZK later is additive (a per-corpus encrypted mode). ZK -> server intelligence later is a promise regression. Choosing trusted keeps the door to server-side content features (AI, materialization, search) open, which is the point.

## Research Findings

### Finding 1: `@epicenter/field` is a closed cell palette; `field.richText()` is a category error

`@epicenter/field` is a closed meta-schema (`packages/field/src/field.ts`). Every kind (a) has an at-rest truth that is a plain JSON Schema, (b) maps to exactly one SQLite storage class (`TEXT`/`INTEGER`/`REAL`), and (c) is mutually exclusive with the others so `recognize()` is unambiguous. The full namespace (`packages/field/src/builders.ts:226`) is:

```txt
string url number integer boolean date instant datetime select multiSelect tags json
```

A collaborative body is a separate Y.Doc. It has no JSON-Schema-cell truth and no SQLite storage class. Adding `field.richText()` (returning a live `Y.XmlFragment`) would either be rejected by `recognize()` and degrade to raw, or force a fake storage class. **Conclusion: child docs are a different axis from cells. Declaration belongs at the table/document level, not inside the `field.*` cell palette.**

### Finding 2: the layout-over-doc pattern already exists (the IoC is composition, not invention)

The three layers the design needs are already built; they are just not wired together:

| Concern | Owner | Status |
| --- | --- | --- |
| **Lifecycle** (refcount, grace, dedup, dispose) | `createDisposableCache` (`packages/workspace/src/cache/disposable-cache.ts`) | exists |
| **Shape** (Y.Doc layout) | `attachPlainText(ydoc)` (`attach-plain-text.ts`), `chat-doc.ts` free-functions over a `Y.Doc` | exists (text, conversation) |
| **Identity** (the guid) | `zhongwenConversationDocGuid` (`apps/zhongwen/zhongwen.ts:109`) | exists, hand-wired per app |

`createDisposableCache(build, { gcTime })` already separates lifecycle (the cache) from shape (the `build` closure): shape is injected, lifecycle is owned. `attachPlainText` is already a layout (`attach*(ydoc) -> handle`). `chat-doc.ts` is the conversation layout, already functions over a doc. The work is naming and composition.

**Caveat from `chat-doc.ts:46`:** a layout encodes *writer policy*, not just shape ("Single writer per map: the creating client for user messages, the server generation actor for assistant messages"). A generic "child doc of any shape" abstraction must not erase this, or it invites two-writer corruption. A layout owns shape AND who-may-write-what; that is why `text` / `richText` / `conversation` are not interchangeable knobs.

### Finding 3: trusted unlocks stored-id child docs (1:N, relocatable, nested)

A blind relay cannot follow a child id stored in a parent doc (it can't read the parent), which is why Zhongwen is forced into a deterministic *derived* guid and a structural 1:1 relationship. A trusted relay can read the parent, so a field may store an arbitrary set of child-doc ids: 1:N, relocatable, and nestable (a child doc's own field stores grandchild ids). The trust decision does not just delete the keyring; it *enables* the more composable identity model.

### Finding 4: the encryption wrapper does not provide transit or CRDT logic

Audit of `createEncryptedYkvLww` (`packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts`): it encrypts cell *values* at the CRDT boundary (`set` encrypts into the Y.Array, `get`/observer decrypts). It does NOT provide transport encryption (that is TLS on the WebSocket, a separate layer) and does NOT provide conflict resolution (that is the inner `YKeyValueLww`, which stays). Deleting the wrapper loses only: at-rest value encryption (server-blindness), the keyring, and the "unreadable cell" failure class. The bare `YKeyValueLww` is already a drop-in (`workspace.ts:193-196`).

### Finding 5: the home anchor path works as topology, not encryption

Throwaway spike: `/Users/braden/Code/epicenter-anchor-experiment` (local only, not monorepo product code).

What passed on 2026-06-15:

- A MacBook on phone hotspot synced a `yrs` document to a Mac Studio home anchor over Iroh 1.0.
- The Studio anchor persisted the CRDT state across restart and kept a stable peer identity via `anchor.key`.
- A JS/Yjs client produced update bytes that Rust/yrs accepted and carried to the anchor.
- A live JS/Yjs runtime used a Rust sidecar over stdio JSON lines; Rust owned Iroh, JS kept app/Yjs semantics, and the anchor persisted both live JS edits after restart.

**Key finding**: self-custody does not require restoring value-level CRDT encryption. It requires changing who operates the always-on trusted peer. The home anchor can be that peer.

**Implication**: "cloudless" should be treated as a deployment topology, not a separate data model. The same Yjs document model and child-doc runtime can sync to Epicenter Cloud, a self-hosted Worker, or a home anchor. The product fork is transport, pairing, and custody UX, not table/schema semantics.

### Encryption matrix (what each layer protects, after this change)

| Layer | Provider | Status after change |
| --- | --- | --- |
| In transit | TLS (wss:// / HTTPS) | Unchanged, always on |
| CRDT merge / LWW | inner `YKeyValueLww` | Unchanged |
| At rest, server | infra (Cloudflare DO/R2 platform encryption or KMS) | Encrypted at rest, server-readable in memory |
| At rest, client (IndexedDB) | OS full-disk encryption (FileVault/BitLocker) | App-level encryption dropped (see Open Questions) |
| Server-blindness (ZK) | (removed) | Deleted on purpose |

## Target shape: three layers

```txt
declare (identity + cascade)        open (lifecycle)            shape (+ writer policy)
─────────────────────────────       ──────────────────         ────────────────────────
row field OR derived convention  ->  session.childDocs(guid) ->  attach*(ydoc) layout
  derives/stores the guid             createDisposableCache       attachPlainText  (text)
  delete() drops the id ref           refcount + grace + GC       attachRichText   (richText, TODO)
  NOT a member of field.*             config pre-bound            attachChatTranscript (conversation)
```

- **Lifecycle** is one runtime: `session.childDocs(build)` over `createDisposableCache`, with server/ownerId/url/openWebSocket/deviceId pre-bound. Same guid -> one shared Y.Doc; N opens require N disposes; grace window survives route/pane swaps.
- **Shape** is an `attach*(ydoc)` layout that owns the CRDT layout and its writer discipline. `attachPlainText` exists; `attachChatTranscript`/`chat-doc.ts` exists; `attachRichText` (Y.XmlFragment) is the one to add for prose bodies.
- **Identity** is either a *derived* guid (row + literal field name; stores nothing; 1:1; invisible to SQL) or a *stored id* cell (`field.string()`/`field.json()` holding the child id; 1:N; relocatable; queryable in SQL). This is the one genuine fork (Open Question 2).

This is **not** the deleted `defineDocument` contract: no handle brand, no `DocumentFactory`, no `ActionIndex`. It is a cache, a set of `attach*` layouts, and a thin row-declaration for cascade.

## The row-declaration (replaces `field.richText()` as a field member)

The common single-body case (Fuji, Honeycrisp, Opensidian, Skills) still wants the body declared on the row so the workspace owns guid derivation, lazy open via `session.childDocs`, disposal, and **structural delete-cascade** (a bare id-keyed factory cannot give the cascade). But the declaration is a child-doc axis, distinct from the `field.*` cell palette:

```ts
// Resolved (Open Question 1): a `.childDocs({ name: layout })` builder method,
// chained after the columns (and after `.migrate()` for a multi-version table).
entries: defineTable({ title: field.string() })   // cells: materialize to SQLite
  .childDocs({
    body: attachRichText,                          // child docs: separate axis, derived guid
    code: attachPlainText,                         // orphaned on row delete, reclaimed by the sweep
  })

using body = ws.entries.open(id).body;       // lazily opens via session.childDocs, returns the layout handle
```

`.childDocs({ name: layout })` derives each child guid from `(workspaceId, collection, rowId, name)` (derived mode); because the guid is a pure function of the row, deleting the row orphans the child with no bookkeeping and the offline sweep reclaims it. Zhongwen's conversation is the *same* mechanism with a custom layout (`attachChatTranscript`); whether it stays a hand-wired call or becomes a `.childDocs({ messages: attachChatTranscript })` declaration is Open Question 3.

### Refused

- `field.richText()` / `field.text()` / `field.childDoc()` as members of `@epicenter/field`. Category error (Finding 1). Layouts are `attach*(ydoc)`; the cell palette stays closed.
- Restoring `defineDocument` as a contract. Custom shapes use the runtime + a layout; they own their reference.

## Child-doc deletion & garbage collection (the cautious path)

Deletion in a distributed CRDT is the hard part (idempotency, the delete-vs-re-add race, real-time cascade). Greenfield decision: **do not solve it in the hot path.** Trust lets us move deletion off the critical path entirely.

- `delete(rowId)` does ONE thing: drop the child-id reference from the parent. It never touches the child doc. The list re-renders without the row immediately, so the user sees it gone at once.
- The child doc becomes an **orphan**: an unreferenced Y.Doc, invisible to the app (nothing can open it), costing only storage.
- **Reclamation is offline mark-and-sweep, run by the trusted server** (the win trust unlocks: a blind relay cannot read parents to know what is referenced; a trusted one can). The sweep reads every parent, computes the set of referenced child guids, and deletes the child DOs not in that set. On a consistent server snapshot there are no races and idempotency is trivial. It is the SAME sweep that clears old encrypted data: one offline GC for both.

| Layer | Reclaimed by | When |
| --- | --- | --- |
| In-memory handle | `createDisposableCache` refcount | already: disposed when no surface holds it (grace window) |
| Server doc (DO) | trusted-server mark-and-sweep | manual script now; scheduled later |
| Client doc (IDB) | accepted dead storage; optional load-time prune | low priority |

This keeps the "two paths delete the child" smell away: the parent table owns the reference; the sweep owns child-doc deletion; they never overlap.

### Accepted downsides (named, per greenfield)

1. **Byte-level deletion is eventually-consistent.** An orphan persists until the next sweep. Acceptable: privacy is explicitly not the moat (see Decision) and the UI shows the row gone immediately.
2. **Client IDB accumulates orphans** until a prune. Negligible; storage cost is low.

### Trigger to upgrade to real-time GC

A compliance/product promise requiring immediate hard delete, material storage growth, or a need to reflect a remote peer's delete in real time. The upgrade is the observer-driven single-owner cascade: `delete()` still only drops the reference, and one observer in `session.childDocs` reacts to the reference dropping by disposing the handle, clearing IDB, and calling idempotent `DELETE-room`. Documented here so it is a known next step, not a redesign.

## What collapses (the deletions this decision authorizes)

| Deleted | Reason |
| --- | --- |
| Update-blob encryption boundary + AAD binding | Server reads plaintext; nothing to encrypt for the relay |
| `createEncryptedYkvLww` value-level encryption | Only existed so the relay couldn't read cells; bare `YKeyValueLww` is a drop-in |
| The keyring: `derive-workspace-keyring`, keyring-mandatory `openWorkspace`, `attach-encrypted-indexed-db` | No server-trust key needed; also deletes the key-recovery problem |
| Wave 1 dumb append-log: offset-cursor sync, checkpoint cache, `append`/`readAfter` room contract | Server runs Yjs again; normal state-vector sync returns |
| Client-mediated AI relocation, peer-continuation machinery | `doc-generation.ts` server peer stays; build nothing new |
| Custody fork: Mailbox vs Actor, two-sources-of-truth, deployable trust-mode table | One trusted relay; deployables differ only in who operates them |

The custody fork and the keyring are the two largest subtractions. The keyring deletion ripples into auth (identity + tokens only), local storage (plain, not encrypted), and onboarding (no recovery-code flow). At-rest protection is not lost; it moves to infra (Encryption matrix).

## What stays

- **Smart Yjs relay** (the pre-Wave-1 behavior): live per-room `Y.Doc`, state-vector sync (STEP1/STEP2), server-side compaction. Revert restores this.
- **Server-side AI** as a Yjs peer: `doc-generation.ts` hydrates a replica, streams tokens into the doc, syncs back. Unchanged.
- **Root metadata doc + lazy body child docs split**: still owns the instant-list-render-with-10k-rows invariant. Bodies remain separate top-level docs (independent guids), lazy-loaded.
- **Dispatch correlation + presence channel**: content-blind, untouched.
- **The `field.*` cell palette**: unchanged and closed; cells continue to materialize to SQLite.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Trusted vs zero-knowledge | 3 taste | Trusted | ZK is a nice-to-have, not a differentiator; trusted keeps server-content features open and is additively reversible to ZK |
| `field.richText()` as a field member | 1 evidence | Rejected | `field` is a closed SQLite-cell palette (`builders.ts:226`); a Y.Doc is not a cell |
| Layout mechanism | 2 coherence | `attach*(ydoc)` | `attachPlainText`/`chat-doc.ts` already are this; one mechanism for simple and custom bodies |
| Lifecycle runtime | 2 coherence | `session.childDocs` over `createDisposableCache` | Cache already separates lifecycle from injected shape; binds the session connection |
| Layout owns writer policy | 1 evidence | Yes | `chat-doc.ts:46` single-writer invariant must survive the abstraction |
| At-rest encryption location | 3 taste | Infra (platform/KMS), not the wrapper | Server-held key makes the wrapper pure cost; infra at-rest is simpler and has no keyring |
| Identity: derived vs stored id | Resolved | Derived-only for now | Derived 1:1 makes the trusted sweep safe (row exists iff child referenced); stored-id 1:N deferred until a real case forces it |
| Child-doc deletion | 3 taste | `delete()` drops the reference; offline server mark-and-sweep reclaims | Real-time CRDT cascade is the hard problem; trust lets the server GC offline (no races). Accept transient orphans (privacy not the moat) |
| Native self-custody transport | 1 evidence | JS/Yjs app plus Rust/Iroh sidecar | Spike proved live JS update flow through a Rust sidecar to a home anchor with restart persistence; keep app semantics in TypeScript and native reachability in Rust |

## Branch action

1. Preserve the stray working tree first: the 9 modified `packages/server/**` files are an uncommitted append-log experiment (matches the dangling `a841628ef`), on no branch. Commit them to `feat/zk-append-log-relay-wip` before anything, so the experiment is not lost.
2. Clean this branch: `git restore packages/server/...` so `chore/skill-library-composition-audit` is skills-only again.
3. Build forward from `main` (the smart relay already is `main`; there is nothing to "revert" as a commit). `DELETE-room` lands in Phase 5 alongside the mark-and-sweep that consumes it, not as a standalone Phase 1 patch.

## Implementation Plan

### Phase 0: Preserve + clean (do first)
- [ ] **0.1** Commit the 9 working-tree server files to `feat/zk-append-log-relay-wip`.
- [ ] **0.2** `git restore packages/server/...` on the skills branch.
- [ ] **0.3** Branch `feat/trusted-relay-collab-docs` off `main`.

### Phase 1: Confirm smart relay
- [x] **1.1** Confirm client and server speak the same Yjs sync frames on `main` (no half-state). VERIFIED 2026-06-15: the room contract on `main` is `sync` / `getDoc` / `handleUpgrade` (state-vector smart relay, `packages/server/src/room/contracts.ts`); the withdrawn append-log rewrite is not on `main`. No code needed.
- [ ] **1.2** Smoke each app against the relay.
- Note: `DELETE-room` moved to Phase 5. Its only consumer is the mark-and-sweep, so adding it here would ship a verb with no caller through Phases 2 to 4. Its value is as the sweep's deletion primitive, not a storage-cost win (orphan storage is negligible).

### Phase 2: Delete the encryption layer
- [ ] **2.0** Migration (one-off, manual): a server-side admin script clears every existing room DO (`DELETE FROM updates` / `storage.deleteAll()`). Existing encrypted data is intentionally discarded (accepted). **Correctness caveat**: must run before the plaintext code reads those rooms, or the plaintext reader ingests old ciphertext as Yjs updates (corruption). Client local stores wipe by bumping the IndexedDB DB name (old encrypted DBs orphaned; optional one-time delete). This is the same sweep that later reclaims orphaned child docs (see Child-doc deletion).
- [ ] **2.1** Remove update-blob encryption from the relay channel.
- [ ] **2.2** Delete `createEncryptedYkvLww`; cells sync plaintext via bare `YKeyValueLww`.
- [ ] **2.3** Collapse the now-dead contract: with the wrapper gone, `unreadable` has zero producers (`YKeyValueLww.read()` only returns `present`/`absent`). Reduce `ObservableKvStore` from the `KvRead`/`KvStoredRead` tri-state to `get()`/`has()`; `has` re-aligns with `get() !== undefined`; `size` just counts entries.
- [ ] **2.4** Remove the mandatory keyring from `openWorkspace`; `attachLocalStorage` uses plain IndexedDB; delete `attach-encrypted-indexed-db`, `derive-workspace-keyring`; `attachStore` collapses to `new YKeyValueLww(yarray)` (drop the `workspaceKeyring` param thread).
- [ ] **2.5** Enable infra at-rest encryption (confirm Cloudflare DO/R2 default at-rest, or KMS-wrap the storage key). Client local-at-rest: OS disk encryption (Open Question 4).

### Phase 3: Bound child-doc runtime
- [ ] **3.1** Add `session.childDocs(build)` over `createDisposableCache`, config pre-bound (`attachLocalStorage`, `attachCollaboration`, `onLocalUpdate`).
- [ ] **3.2** Add `attachRichText(ydoc)` (Y.XmlFragment layout) alongside `attachPlainText` and `attachChatTranscript`.
- [ ] **3.3** Port Zhongwen (the proven case) onto `session.childDocs` + `attachChatTranscript`. Prove the composition before generalizing.

### Phase 4: Row-declared child docs (Build, Prove, Remove)
- [ ] **4.1** Add the table-level `childDoc(layout)` declaration (surface per Open Question 1): resolve guid, lazy-open via `session.childDocs`. `delete()` drops the child-id reference only (no cascade; GC reclaims, see Child-doc deletion).
- [ ] **4.2** Port Fuji/Honeycrisp/Opensidian/Skills bodies onto `childDoc(attachRichText)` / `childDoc(attachPlainText)`.
- [ ] **4.3** Materializer observes the layout's signal directly; remove the `updatedAt`-bump-as-signal coupling.
- [ ] **4.4** Verify delete UX: `delete()` drops the reference, the row disappears immediately, the in-memory handle disposes via the cache; the orphaned doc is left for the sweep (Phase 5), not the delete path.

### Phase 5: Garbage collection (offline, not hot-path)
- [ ] **5.1** `DELETE-room` verb on the smart-relay contract, idempotent (deleting an absent room is a no-op).
- [ ] **5.2** Server mark-and-sweep: read parents, compute referenced child guids, delete unreferenced child DOs. Runnable as the same admin script that clears old encrypted data (2.0).
- [ ] **5.3** (Optional) client load-time prune of local IDB docs with no parent reference.

### Phase 6: Cloudless anchor track (separate from child-doc delivery)
- [ ] **6.1** Promote the Iroh sidecar spike into a real transport prototype that speaks `@epicenter/sync` frames, not the spike's demo text doc.
- [ ] **6.2** Multiplex rooms over one sidecar process: `{ roomId, update }` in, `{ roomId, update }` out, with connection-status events.
- [ ] **6.3** Define pairing: how a device learns and trusts the home anchor's Iroh peer id, how revocation works, and where the stable device identity lives.
- [ ] **6.4** Define custody UX: Epicenter Cloud anchor, self-hosted Worker, or home anchor are choices of trusted peer, not different document formats.
- [ ] **6.5** Defer browser-direct networking. Browsers remain relay-bound leaves unless they run inside a native shell or speak to a local sidecar.

## Edge Cases

### Child doc whose row is deleted while open by two surfaces
1. Two editors open the same body (one shared Y.Doc via the cache).
2. Row deleted in one surface -> only the child-id reference is dropped; the doc is NOT touched.
3. Expected: both surfaces re-render without the row; their handles dispose via the cache when navigated away. The orphaned doc lingers until the sweep. No real-time cascade, so no cross-surface race.

### Stored-id child whose id is dangling
1. A row stores a child id whose doc was never created or already deleted.
2. `session.childDocs(guid)` opens an empty doc.
3. Expected: empty layout (not a crash); a separate reconciliation may prune dangling ids. See Open Questions.

### Materialization of child docs
1. Cells materialize to SQLite; child docs do not (Zhongwen transcript is a Y.Doc, only the list materializes).
2. A generic `childDoc` abstraction is also deciding "child docs are outside the SQL mirror."
3. Expected: explicit. Optionally a derived summary cell (e.g. last-message preview) is written back as a normal cell.

## Open Questions

1. **`childDoc(layout)` declaration surface. RESOLVED (2026-06-15).**
   - Resolution: a `.childDocs({ name: layout })` builder method on `TableDefinition`, chained after `.migrate()`. Coupled to the table (the workspace supplies the collection key structurally, so no collection string is hand-typed), derived-only, never versioned. A flat `name -> layout` map of the current shape.
   - Why not a positional arg (option a): `defineTable`'s positional slots are already the version tuple (`defineTable(v1, v2)` means v1 + v2 columns), so a second positional arg is indistinguishable from declaring a v2 column set. The illustrative `defineTable({cells}, {childDocs})` shown earlier in this spec is therefore unbuildable as written.
   - Why outside the version tuple: `.migrate(fn)` operates on the row value (cells that materialize to SQLite) and structurally cannot rewrite a separate child Y.Doc. So a version bump never migrates child docs: add a child in a later version and old rows open it empty, remove one and the orphan is swept. Incompatible layout changes are migrate-on-read inside the layout, not a row migration.
   - Refused: option (a) positional; option (b) as a separate `childDocs:` block was folded into the builder method. The stored-id 1:N mode and any top-level child-doc abstraction are also refused for now (see Question 2).

2. **Identity: derived guid vs stored id. RESOLVED (2026-06-15): derived-only for now.**
   - Ship derived-1:1 only: the guid is `docGuid({ workspaceId, collection, rowId, name })`, storing nothing. Derived is what makes the trusted offline sweep safe: the invariant "row exists if and only if its child is referenced" holds by construction, so `delete(id)` (drop the row) orphans the child with zero reference bookkeeping, and the sweep recomputes the referenced set and deletes the rest.
   - Stored-id 1:N is deferred: there is no real or near-term consumer (the Opensidian-nesting case is hypothetical). It slots in additively when a real 1:N case forces it, via the top-level abstraction that derived-1:1 does not need.

3. **Does Zhongwen's conversation become a declaration or stay manual?**
   - Options: (a) `childDoc(attachChatTranscript)` declaration like the others, (b) keep the hand-wired `zhongwenConversationDocGuid` + manual open.
   - **Recommendation**: once `childDoc(layout)` exists and writer policy is preserved, fold Zhongwen in so it stops being a special case. Defer until Phase 3 proves the runtime.

4. **Client local-at-rest encryption.**
   - Keep an optional device-local encrypted-IDB slice (native only) or rely on OS disk encryption everywhere?
   - **Recommendation**: drop; rely on OS disk encryption. A browser cannot hold a key safely (it would live in the same storage). Revisit for native (Tauri) if a segment needs it; additive, not load-bearing.

5. **Server-side materialization + SQLite-as-truth** (future deepening).
   - Server observes docs and writes SQLite, dissolving the client materializer; bodies hydrated on open, materialized + destroyed on quiesce.
   - **Recommendation**: defer. Real collapse, new architecture; do not bundle with this pass.

## Adjacent Work

- Stored-id reconciliation (prune dangling child ids): folded into the server mark-and-sweep (Phase 5.2); the same pass that reclaims orphans also drops references to docs that never existed.
- Derived summary cells (last-message preview materialized back to SQL): opportunistic; only if a list view needs it.
- Cloudless home anchor: validated enough to keep as a product track, but not required for the trusted-relay / child-doc implementation. Keep it separate until the sidecar speaks the real `@epicenter/sync` protocol.

## Decisions Log

- `.childDocs()` declaration surface (Open Question 1): coupled, derived-only builder method chained after `.migrate()`, table-scoped, never versioned. Positional arg rejected (collides with the version tuple); stored-id and any top-level abstraction deferred until a real 1:N case.
  Revisit when: a real 1:N, nested, or relocatable child-doc case appears.
- DELETE-room: deferred from Phase 1 to Phase 5. It is the sweep's deletion primitive, not a standalone storage-cost win, so it ships with its only consumer.
- Home-anchor sidecar: keep as the native self-custody transport direction. The spike proved reachability, JS/Yjs to Rust/yrs update compatibility, live sidecar update flow, and restart persistence. Revisit the bridge mechanism after room multiplexing; stdio is a test bridge, not a final product commitment.

## Success Criteria

- [ ] One relay; client and server speak the same Yjs sync frames; no half-state.
- [ ] No keyring in `openWorkspace`; `createEncryptedYkvLww`, `attach-encrypted-indexed-db`, `derive-workspace-keyring` deleted; storage is plain.
- [ ] At-rest encryption confirmed at the infra layer (platform or KMS).
- [ ] Server-side AI (`doc-generation.ts`) works unchanged against the restored relay.
- [ ] One `session.childDocs` runtime; per-app cache closures gone.
- [ ] Bodies are `childDoc(attachRichText)` / `childDoc(attachPlainText)`; delete cascades with no orphaned IDB store or live room.
- [ ] Home-anchor work stays protocol-compatible: no app schema, table materializer, or child-doc semantics move into Rust.
- [ ] `field.*` palette unchanged; no `field.richText()` member; no `defineDocument` contract.
- [ ] Zhongwen transcript runs on the shared runtime (declared or manual) and cascades on conversation delete.

## References

- `packages/field/src/field.ts`, `builders.ts` - closed cell palette (Finding 1)
- `packages/workspace/src/cache/disposable-cache.ts` - lifecycle primitive
- `packages/workspace/src/document/attach-plain-text.ts` - existing text layout
- `packages/workspace/src/ai/chat-doc.ts` - conversation layout + writer policy
- `apps/zhongwen/zhongwen.ts` - the proven child-doc pattern (derived guid)
- `packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts` - the wrapper to delete (Finding 4)
- `packages/workspace/src/document/workspace.ts:186-197` - `attachStore` (plaintext branch already exists)
</content>
</invoke>
