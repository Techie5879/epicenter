# Uniform Per-Doc Providers (flat docs by guid)

**Date**: 2026-05-30
**Status**: Draft
**Owner**: Workspace platform
**Foundation for**: `specs/20260530T120000-daemon-manifest-and-mount-materializers.md`
(this is what makes the `{ name, workspace, materializers }` mount shape honest:
the daemon can persist + sync a whole workspace generically)

## One Sentence

A workspace is a flat set of independent Y.Docs (one root plus one content doc per
rich row), each addressed by its own guid; every runtime attaches the same two
providers (durable storage + cloud sync) to every doc uniformly, so persistence is
one mechanism keyed by guid instead of per-app, per-doc, per-runtime boilerplate.

## Pressure-test (2026-05-30): five corrections before Phase 1

A fresh-eyes pass against the actual primitives (`open-collaboration.ts`,
`attach-indexed-db.ts`, `attach-yjs-log.ts`, `disposable-cache.ts`,
`attach-project-infrastructure.ts`) confirmed the core (root and child are
symmetric; every provider self-disposes on `ydoc.destroy()`; the cache rebuilds on
reopen so `register` fires once per live instance). It also found five gaps the
illustrative snippets below gloss. **Phase 1 builds the corrected shapes in this
section, not the array-literal snippets later in the doc.**

**1. The hydration barrier is load-bearing, and the array-literal form drops it.**
`openCollaboration` takes `waitFor` and the sync supervisor blocks its connect loop
on it (`internal/sync-supervisor.ts:400`); today both root and child thread
`waitFor: idb.whenLoaded` so sync does not connect (and re-upload the whole doc)
before local state has replayed (`browser.ts:55,75`). `attachDoc` returning a bare
`[storage, sync]` literal cannot express "sync waits for storage" because the two are
siblings. `attachDoc` must be a block that threads the barrier AND hands it back
(see correction 2):

```ts
attachWorkspaceProviders(workspace, ({ ydoc, role }) => {
	const storage = attachLocalStorage(ydoc, { server, ownerId, keyring });
	const sync = openCollaboration(ydoc, {
		url: roomWsUrl({ baseURL, ownerId, guid: ydoc.guid, deviceId }),
		openWebSocket, onReconnectSignal,
		waitFor: storage.whenLoaded,                       // <- restored barrier
	});
	return { whenLoaded: storage.whenLoaded, providers: [storage, sync] };
});
```

So the callback is `attachDoc: (doc) => { whenLoaded?: Promise<unknown>; providers: Disposable[] }`,
not `=> Disposable[]`.

**2. Moving providers out of the cache removes the handle `markdown.ts` reads (the
real hole, not a typo).** The later claim "`markdown.ts` does not change" is false.
Today the body-aware push/pull does `await host.entryContentDocs.open(id).idb.whenLoaded`
(`markdown.ts:41,62`); `.idb` exists only because the browser cache wrapper spreads it
back (`{ ...contentDoc, idb, sync }`). Once `createDocCache` returns the bare iso doc
`{ ydoc, body, [Symbol.dispose] }` and providers attach out-of-band, `.idb` is gone and
the body read has nothing to await. The daemon body-aware `toMarkdown` snippet below
even invents `await doc.storage.whenLoaded`, assuming the same vanished handle.
Resolution: the registry carries the barrier, reachable by guid:

```ts
const { ydoc, body } = workspace.entryContentDocs.open(id);
await workspace.docs.get(ydoc.guid)?.whenLoaded;        // stamped by attachWorkspaceProviders
return { frontmatter: row, body: body.read() };
```

This is why `register` must notify `each` subscribers **synchronously**: opening a
child runs `build -> register -> (subscriber) attachDoc -> stamp whenLoaded`, all
inside `.open()`, so `get(guid).whenLoaded` is populated by the time `.open()` returns.

**3. The registry needs `get(guid)` and an unregister, not just `each` + `register`.**
`get(guid)` is correction 2's lookup. Unregister is required because the cache rebuilds
after gc (`disposable-cache.ts:244-248`): without removing the dead entry on
`ydoc.destroy()`, the registry accumulates destroyed docs and replays providers onto
them for any late `each` subscriber. `register` returns its unsubscribe; `createDocCache`
calls it from the built value's `[Symbol.dispose]`.

**4. Dispose composition is under-specified.** Providers self-dispose on
`ydoc.destroy()`, but their teardown (`collaboration.whenDisposed`, `yjsLog.whenDisposed`)
is async; `attachProjectInfrastructure` already destroys then `await Promise.all([...whenDisposed])`.
`attachWorkspaceProviders`' `[Symbol.asyncDispose]` must (a) call `workspace[Symbol.dispose]()`
(destroys the root ydoc AND disposes the child cache, cascading destroy to every open
child), then (b) await every collected `whenDisposed`. For (a) to reach children, the
iso factory's own `[Symbol.dispose]` must dispose its child cache (confirm this is wired
in `createFuji`).

**5. Child docs get random clientIDs (minor).** The daemon pins only the root's
deterministic `clientID` (`define-mount.ts:38`); children built by the cache use Yjs's
random per-construction id, so each daemon restart adds a fresh writer id per child to
that child's state vector. Harmless for CRDT correctness, mild state-vector growth. If
it matters, derive child clientIDs from `projectDir + guid` inside `attachDoc`. Out of
scope for Phase 1.

## Overview

Each app already splits data across a root doc (tables, metadata) and per-row child
docs (rich-text bodies), all independent top-level Y.Docs sharing a deterministic
guid scheme. Today each app's `browser.ts` hand-wires `attachStorage + openCollaboration`
for the root inline and wraps the child-doc cache to do the same per child. This spec
replaces that repeated wiring with one primitive: the workspace exposes its docs, and
the runtime attaches its providers to every doc through a single call.

---

## Motivation

### Current State

The iso factory builds **bare** child docs (no persistence, no sync):

```ts
// apps/fuji/src/lib/workspace/index.ts:129-149  (createFuji)
const entryContentDocs = createDisposableCache((entryId: EntryId) => {
	const childYdoc = new Y.Doc({ guid: entryContentDocGuid(entryId), gc: true });
	const body = attachRichText(childYdoc);
	onLocalUpdate(childYdoc, () => { /* bump entry.updatedAt */ });
	return { ydoc: childYdoc, body, [Symbol.dispose]() { childYdoc.destroy(); } };
});
```

The browser runtime then attaches the same two providers, once for the root inline and
again by wrapping the child cache:

```ts
// apps/fuji/src/lib/workspace/browser.ts  (openFujiBrowser)  -- abbreviated
const idb = attachLocalStorage(workspace.ydoc, { ... });                          // root storage
const collaboration = openCollaboration(workspace.ydoc, { guid: workspace.ydoc.guid, ... }); // root sync

const entryContentDocs = createDisposableCache((entryId) => {                     // wrap the iso cache
	const contentDoc = workspace.entryContentDocs.open(entryId);
	const childIdb = attachLocalStorage(contentDoc.ydoc, { ... });                // child storage
	const childSync = openCollaboration(contentDoc.ydoc, { guid: contentDoc.ydoc.guid, ... }); // child sync
	return { ...contentDoc, idb: childIdb, sync: childSync, [Symbol.dispose]() { contentDoc[Symbol.dispose](); } };
});
```

This creates problems:

1. **Per-app, per-doc, per-runtime boilerplate.** Every app's `browser.ts` repeats
   "attach storage + sync, keyed by guid" for root and children. The daemon would
   repeat it a third time per app. The wrapping cache exists only to thread providers.
2. **The daemon does not persist child docs at all.** Only the `opensidian-e2e`
   playground wires it ad hoc. So daemon markdown is metadata-only (no bodies), and
   the clean `{ workspace, materializers }` mount shape cannot be true while
   persistence is per-app glue.
3. **Two ways to say "child docs."** The iso cache makes bare docs; the runtime cache
   re-wraps them. A reader must hold both in their head.

### The symmetry the code already proves

Root and child get the **identical treatment**, addressed by `ydoc.guid`:

```txt
            storage                         sync (room keyed by guid)        local registry
root        attachStorage(workspace.ydoc)   openCollaboration({guid})        workspace (+ materializers on daemon)
child       attachStorage(childYdoc)        openCollaboration({guid})        none (pure content)
```

And the cloud is **already flat by guid**: every doc, root or child, is the room
`subject:<userId>:rooms:<guid>`. Storing docs locally as `docs/<guid>.db` simply makes
local storage match the model the cloud already uses. (Yjs subdocuments are
deliberately not used here; the workspace owns separate top-level docs, per the `yjs`
skill: "Prefer separate top-level docs over Yjs subdocuments unless Epicenter owns the
whole provider lifecycle." This spec is Epicenter owning that lifecycle.)

### Desired State

The runtime states its two providers once; they apply to every doc:

```ts
// any runtime (browser shown)
const workspace = createFuji({ keyring });
attachWorkspaceProviders(workspace, ({ ydoc, role }) => [
	attachLocalStorage(ydoc, { server, ownerId, keyring }),
	openCollaboration(ydoc, {
		url: roomWsUrl({ baseURL, ownerId, guid: ydoc.guid, deviceId }),
		openWebSocket, onReconnectSignal,
	}),
]);
```

---

## Design

Three pieces. The registry is the only genuinely new concept; the rest is sugar and
deletion.

### 1. A doc registry on the workspace bundle

`createWorkspace` gains a `docs` registry and pre-registers the root doc. The bundle
exposes it. The registry fires for the root immediately and for each child as it opens.
(Corrected shape per the pressure-test above: `register` returns an unsubscribe and
notifies subscribers synchronously, the registry also exposes `get(guid)`, and each
`WorkspaceDoc` carries an optional `whenLoaded` the runtime stamps so body-readers can
await a child's local replay. The minimal `each`/`register` type below is illustrative.)

```ts
export type DocRole = 'root' | 'content';
export type WorkspaceDoc = { ydoc: Y.Doc; role: DocRole };

export type DocRegistry = {
	/** Call `cb` for every live doc now (root + open children) and for each future open. Returns unsubscribe. */
	each(cb: (doc: WorkspaceDoc) => void): () => void;
	/** Internal: register a doc. Called by createWorkspace (root) and createDocCache (children). */
	register(doc: WorkspaceDoc): void;
};

// createWorkspace returns { ydoc, tables, kv, docs, [Symbol.dispose] }
// with docs pre-seeded: docs.register({ ydoc, role: 'root' })
```

The registry is the separate-top-level-docs analogue of Yjs's `subdocs` event: one
place a provider learns about every doc in the workspace.

### 2. `createDocCache`: a doc cache that auto-registers

Child docs are created in `createDisposableCache`. `createDocCache` is the same
refcounted cache that also registers each built doc with the workspace registry, so
the app author never writes a `register` call.

```ts
const entryContentDocs = createDocCache(workspace, (entryId: EntryId) => {
	const ydoc = new Y.Doc({ guid: entryContentDocGuid(entryId), gc: true });
	return { ydoc, body: attachRichText(ydoc), [Symbol.dispose]() { ydoc.destroy(); } };
});
// each built doc -> workspace.docs.register({ ydoc, role: 'content' })
```

### 3. `attachWorkspaceProviders`: the runtime's one call

```ts
/**
 * Attach the runtime's per-doc resources to every doc in the workspace (root now,
 * children as they open). `attachDoc` returns the disposables for one doc; the
 * helper tracks them and composes a single teardown. Each doc's providers also
 * self-dispose on `ydoc.destroy()`, so child gc tears them down naturally.
 */
export function attachWorkspaceProviders(
	workspace: { docs: DocRegistry },
	attachDoc: (doc: WorkspaceDoc) => Disposable[],
): { [Symbol.asyncDispose](): Promise<void> };
```

Lazy by design: providers attach on doc open (root at startup; a child the first time
it is opened, e.g. during a materialize pass) and tear down when the doc disposes
(refcount 0 + gc, or workspace teardown). This matches the browser's existing
lazy-per-entry behavior; it does not hold every child doc open forever.

---

## Architecture

```txt
createWorkspace ----> docs registry (root pre-registered)
createDocCache  ----> registers each child doc as it is built (role: 'content')
                          |
                          v
attachWorkspaceProviders(workspace, attachDoc)
   docs.each(({ ydoc, role }) => attachDoc({ ydoc, role }))   <- root now + children on open
   keeps disposables; one async dispose tears all down
   |
   +-- browser:  [ attachLocalStorage(ydoc), openCollaboration(ydoc, {guid}) ]
   +-- daemon:   [ attachYjsLog(ydoc, {docs/<guid>.db}), openCollaboration(ydoc, {guid}) ]
```

On-disk, flat by guid (the chosen layout):

```txt
.epicenter/mounts/fuji/
  docs/
    epicenter-fuji.db        root doc (guid == workspace id)
    a3f8...e1.db             entry body (guid == entryContentDocGuid(entryId))
    b7c2...90.db             entry body
  sqlite.db                  projection (manifest spec)
```

No root-vs-child path distinction; both are `docs/<guid>.db`. The action set is the
only place root differs (it serves actions; children are pure content), expressed by
`role` at the provider call, not by a different storage path.

---

## Ownership

| Concern | Owner |
| --- | --- |
| What docs a workspace has | the workspace (root in `createWorkspace`; children via `createDocCache`) |
| Doc identity (guid) | the app's deterministic guid scheme (`entryContentDocGuid`, the workspace id) |
| Per-doc storage + sync | the runtime, via `attachWorkspaceProviders` (browser = localStorage; daemon = yjs-log; both = `openCollaboration`) |
| On-disk layout (`docs/<guid>.db`) | the daemon storage provider |
| Which doc serves actions | the `role` discriminator (`root` only) |
| Teardown order | the helper's composed dispose + each provider's `ydoc.destroy()` hook |

---

## Call sites: before and after

### Fuji browser factory

**Before** (`browser.ts`, ~90 lines): root storage + sync inline, plus a wrapping
`createDisposableCache` that re-opens each iso child and attaches storage + sync.

**After** (~12 lines):

```ts
export function openFujiBrowser({ signedIn, deviceId }) {
	const workspace = createFuji({ keyring: signedIn.keyring });
	const teardown = attachWorkspaceProviders(workspace, ({ ydoc, role }) => [
		attachLocalStorage(ydoc, { server: signedIn.server, ownerId: signedIn.ownerId, keyring: signedIn.keyring }),
		openCollaboration(ydoc, {
			url: roomWsUrl({ baseURL: signedIn.baseURL, ownerId: signedIn.ownerId, guid: ydoc.guid, deviceId }),
			openWebSocket: signedIn.openWebSocket, onReconnectSignal: signedIn.onReconnectSignal,
		}),
	]);
	return defineWorkspace({ ...workspace, [Symbol.asyncDispose]: teardown[Symbol.asyncDispose] });
}
```

The wrapping cache is gone. `markdown.ts` (the Tauri body-aware push/pull) keeps using
`workspace.entryContentDocs.open(id)`, but it DOES change in one line: its
`await contentDoc.idb.whenLoaded` becomes `await workspace.docs.get(ydoc.guid)?.whenLoaded`,
because `.idb` is no longer spread onto the cache value (pressure-test correction 2).

### Daemon (in the mount runner, generic across all mounts)

```ts
const workspace = mount.workspace({ keyring });
attachWorkspaceProviders(workspace, ({ ydoc, role }) => [
	attachYjsLog(ydoc, { filePath: join(mountDocsDir, `${ydoc.guid}.db`) }),
	openCollaboration(ydoc, {
		url: roomWsUrl({ baseURL, ownerId, guid: ydoc.guid, deviceId }),
		openWebSocket, onReconnectSignal,
	}),
]);
```

The daemon writes this **once**, not per app. Child docs persist + sync for free. This
is what lets the mount be just `{ name, workspace, materializers }`.

### Daemon markdown with bodies (now possible)

Because the daemon now persists + syncs child docs, a body-aware `toMarkdown` can open
the child and read its rich text (the pattern the attach-primitive skill documents):

```ts
markdown({ dir: '.', perTable: { entries: {
	filename: slugFilename('title'),
	toMarkdown: async (row) => {
		using doc = workspace.entryContentDocs.open(row.id);
		await doc.storage.whenLoaded;                 // local replay; cloud pull if you also await sync
		return { frontmatter: row, body: doc.body.read() };
	},
} } })
```

This dissolves the "daemon markdown is metadata-only" limitation noted in the manifest
spec. (Whether to await only local load or also cloud sync is a per-deployment choice.)

---

## Implementation Plan

### Phase 1: Primitives

- [ ] **1.1** Add the `DocRegistry` + `WorkspaceDoc` types; seed the root in
  `createWorkspace`; expose `workspace.docs`.
- [ ] **1.2** Add `createDocCache(workspace, build)` over `createDisposableCache` that
  registers each built doc as `role: 'content'`.
- [ ] **1.3** Add `attachWorkspaceProviders(workspace, attachDoc)` with composed teardown.

### Phase 2: Adopt in the runtimes

- [ ] **2.1** Convert each app iso factory's child cache to `createDocCache`
  (fuji `entryContentDocs`, honeycrisp `noteBodyDocs`, opensidian `fileContentDocs`).
- [ ] **2.2** Rewrite each `*.browser.ts` to one `attachWorkspaceProviders` call; delete
  the wrapping child cache.
- [ ] **2.3** Wire the daemon mount runner to `attachWorkspaceProviders` generically
  (replaces the per-mount `attachProjectInfrastructure` root-only wiring).

### Phase 3: Prove, then remove

- [ ] **3.1** Typecheck + smoke each app (browser editor still syncs a child; daemon
  persists `docs/<guid>.db` for root + an opened child).
- [ ] **3.2** Delete the per-app child-doc wrapping caches and any ad hoc child
  persistence (e.g. `opensidian-e2e`'s manual `attachYjsLog(contentYdoc, ...)`).

---

## What to delete

```txt
DELETE
  per-app child-doc wrapping caches in *.browser.ts (root + child hand-wiring)
  opensidian-e2e ad hoc child attachYjsLog(contentYdoc, yjsPath(projectDir, guid))
  the root-only attachProjectInfrastructure split (folded into attachWorkspaceProviders)

KEEP
  createDisposableCache (createDocCache builds on it; non-doc caches still use it directly)
  attachLocalStorage / attachYjsLog / openCollaboration (the providers attachDoc composes)
  the deterministic guid scheme (entryContentDocGuid, the workspace id)
```

---

## Risks

### Broad blast radius

This touches every app's `browser.ts` (and the iso child caches), not just the daemon.
That is the point (the win is deleting the per-app wiring everywhere), but it is a
bigger change than the manifest. Land it as its own wave; the manifest + mount-shape
spec can ship first with the daemon wiring children per-app as an interim.

### Lazy sync semantics

Providers attach on open, dispose on gc. A child not currently open is not actively
syncing. For the browser this matches today (you sync the entry you are editing). For
the daemon it means children sync during materialize passes, not continuously. If a
mount needs every child continuously synced (e.g. a live mirror), that is an eager
mode (`attachWorkspaceProviders(workspace, attachDoc, { eager: true })` opening every
known child), deferred until a real need. See Open Questions.

### The registry is a new core primitive

`createWorkspace` grows a `docs` registry. Keep it minimal (`each` + internal
`register`); resist adding query/filter surface. If it grows beyond "iterate docs now
and future," that is scope creep.

---

## Open Questions

1. **Lazy vs eager child providers on the daemon.** Lazy (attach on open) is the
   default and matches the browser. Eager (persist + sync every known child always)
   would need enumerating children from the root table via the deterministic guid.
   - **Recommendation**: lazy now; add an `eager` option only when a mount needs a
     continuous full mirror.

2. **Does the registry live on `createWorkspace` or a separate attachable?** Putting it
   on `createWorkspace` makes it always present (root pre-registered). A separate
   `attachDocRegistry(workspace)` keeps `createWorkspace` smaller but adds a step.
   - **Recommendation**: on `createWorkspace`; the root doc is always a doc, so the
     registry is never absent.

3. **Naming.** `attachWorkspaceProviders` vs `attachEachDoc` vs `bindWorkspaceDocs`;
   `createDocCache` vs `createDocumentCache`. Bikeshed; settle in implementation.

4. **`role` vs richer doc metadata.** Today `role: 'root' | 'content'` is enough (it
   only gates the action set). If a future doc kind needs different handling, widen the
   discriminator then, not now.

---

## Success Criteria

- [ ] One `attachWorkspaceProviders` call replaces per-doc wiring in every `*.browser.ts`.
- [ ] The daemon persists `docs/<guid>.db` for the root and every opened child, with no
  per-app daemon doc code.
- [ ] Daemon markdown can include bodies via a body-aware `toMarkdown`.
- [ ] The mount shape `{ name, workspace, materializers }` holds with no per-app
  persistence glue.

---

## References

- `apps/fuji/src/lib/workspace/index.ts` - iso `createFuji`, the bare `entryContentDocs` cache
- `apps/fuji/src/lib/workspace/browser.ts` - the per-doc wiring this collapses
- `apps/fuji/src/lib/workspace/markdown.ts` - Tauri body-aware push/pull (unchanged; shows the body read)
- `packages/workspace/src/cache/disposable-cache.ts` - `createDocCache` builds on this
- `packages/workspace/src/daemon/attach-project-infrastructure.ts` - the root-only wiring folded in
- `specs/20260530T120000-daemon-manifest-and-mount-materializers.md` - the mount shape this enables
