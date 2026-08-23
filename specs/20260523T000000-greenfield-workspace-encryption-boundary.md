# Greenfield workspace encryption boundary: primitives + per-app openers

Status: partially superseded (see note below)
Owner: braden
Date: 2026-05-22

> **Superseded**: the `openEncryptedDoc({ id, keyring, clientId? })` bundle
> proposed in §3.1 was reverted on 2026-05-23. It owned Y.Doc construction
> and exposed `ws.ydoc`, which every caller immediately unbundled to thread
> into `attachLocalStorage`, `openCollaboration`, and the daemon
> materializers. The shipped shape restores `attachEncryption(ydoc, { keyring })`:
> the caller constructs the Y.Doc, the factory binds the per-workspace
> keyring across `attachTable`/`attachKv`. Everything else in this spec
> still applies: `LocalOwner` removal, `attachLocalStorage` and
> `wipeLocalStorage` as free primitives, flat `SignedIn` value,
> `DaemonWorkspaceContext.keyring`, per-app openers with inline composition.

## 1. Goal

Collapse the current `LocalOwner` + `attachEncryption` callback + `openFujiWorkspace(attachEncryption)` triangulation into two honest tiers: small free-function primitives in `@epicenter/workspace`, and one per-app opener per environment (`openFujiBrowser`, `openFujiDaemon`) that inlines composition.

The single design that drove this: the `attachEncryption: (ydoc) => EncryptionAttachment` callback parameter on workspace openers exists only to "bake in" the keyring closure. The bake-in is fake symmetry between browser and daemon; both sides reduce to "pass keyring in." Once that callback is replaced with a plain `keyring` field, `LocalOwner.attachEncryption` is a 1-line delegate with no consumers, `createDaemonAttachEncryption` is a 9-line wrapper with no consumers, and the per-app openers can construct their own Y.Doc and tables inline.

This is greenfield. No back-compat shims. No "renamed but kept the old export." Old surfaces get deleted.

## 2. The five real intents

Every call site reduces to one or more of these:

1. **Define the workspace's structure** (id, tables, kv, actions). Pure data + one function. Lives in `apps/<app>/src/lib/schema.ts` (or equivalent). Four plain exports. No umbrella.
2. **Mount an encrypted Y.Doc** with tables and KV from a schema. `openEncryptedDoc({ id, keyring, clientId? })`.
3. **Attach encrypted local storage** (IDB + scoped BroadcastChannel) to any Y.Doc. `attachLocalStorage(ydoc, identity)`.
4. **Sync a Y.Doc with the cloud** using auth. `openCollaboration(ydoc, opts)` (unchanged).
5. **Wipe local storage for a subject** on sign-out / user request. `wipeLocalStorage({ subject })`.

`LocalOwner` conflated 2, 3, and 5 behind a stateful facade. The five free functions are honest about dependencies.

## 3. Tier 1: primitives in `@epicenter/workspace`

### 3.1 `openEncryptedDoc`

Replaces `attachEncryption(ydoc, { keyring })`. Constructs the Y.Doc itself so `guid` and `clientId` are right by construction, then attaches the encryption coordinator.

```ts
type OpenEncryptedDocOptions = {
  /** Y.Doc guid, used as HKDF domain-separation label for the workspace key. */
  id: string;
  /**
   * Lazy reader for the current subject keyring. Called synchronously at every
   * attachTable / attachKv site. Throw if no keyring is available (signed-out):
   * a throw here means the caller outlived its signed-in scope.
   */
  keyring: () => SubjectKeyring;
  /** Pin Y.Doc clientID. Daemons set this; browsers leave undefined. */
  clientId?: number;
};

type EncryptedDoc = {
  ydoc: Y.Doc;
  attachTable<T>(
    name: string,
    def: TableDefinition<T>,
  ): Table<InferTableRow<T>>;
  attachReadonlyTable<T>(
    name: string,
    def: TableDefinition<T>,
  ): ReadonlyTable<InferTableRow<T>>;
  attachTables<T extends TableDefinitions>(defs: T): Tables<T>;
  attachReadonlyTables<T extends TableDefinitions>(defs: T): ReadonlyTables<T>;
  attachKv<T extends KvDefinitions>(defs: T): Kv<T>;
  [Symbol.dispose](): void; // destroys the ydoc
};

function openEncryptedDoc(options: OpenEncryptedDocOptions): EncryptedDoc;
```

Construction order:

1. `new Y.Doc({ guid: id, gc: true })`.
2. If `clientId !== undefined`, set `ydoc.clientID = clientId`.
3. Bind the keyring callback into an internal coordinator (current `attachEncryption(ydoc, { keyring })`).
4. Return the bundle with `[Symbol.dispose]()` that calls `ydoc.destroy()` (which triggers each store's `Symbol.dispose`).

### 3.2 `attachLocalStorage`

Replaces `LocalOwner.attachLocal`. Free function. Pairs encrypted IndexedDB persistence with a scoped BroadcastChannel under `epicenter.owner.<subject>.yjs.<ydoc.guid>`.

```ts
function attachLocalStorage(
  ydoc: Y.Doc,
  options: {
    /** Stable for the lifetime of the attachment. Becomes the IDB/BC namespace. */
    subject: string;
    /** Live callback: rotated keyrings are picked up on next encrypt. */
    keyring: () => SubjectKeyring;
  },
): IndexedDbAttachment;
```

The parameter shape is inline, not extracted into a named `Identity` type. `Identity` would be a phantom type with one consumer (this function), used in production only via `signedIn`. Structural typing already lets the per-app opener pass `signedIn` whole; the function's parameter shape documents what it actually depends on. Tests pass an ad-hoc `{ subject, keyring }` shape directly.

Behavior is exactly what `LocalOwner.attachLocal` does today: derive `databaseName = epicenter.owner.<subject>.yjs.<ydoc.guid>`, call `attachEncryptedIndexedDb` and `attachBroadcastChannel` with that name, return the IDB attachment (for `whenLoaded` / `whenDisposed`).

Naming: keep the IDB/BC prefix `epicenter.owner.<subject>.` so existing on-disk databases survive the refactor. The label `owner` is a stable storage namespace; the `subject` token in the middle is the rename-collapse path (no more `ownerId` ↔ `subject` shuffle in code).

### 3.3 `wipeLocalStorage`

Replaces `LocalOwner.wipeLocalYjsData`. Free function. Subject-scoped prefix scan only; no guid list parameter.

```ts
function wipeLocalStorage({ subject }: { subject: string }): Promise<void>;
```

Implementation: enumerate `indexedDB.databases()`, filter to those starting with `epicenter.owner.<subject>.yjs.`, call `clearDocument(name)` on each. Drop the today's explicit-guids fallback path: the prefix scan covers every encrypted IDB database, and the existing `LocalOwner.wipeLocalYjsData` tests confirm the prefix scan deletes everything the explicit list does.

### 3.4 Internal-only changes

`attachEncryption` (the current free function in `document/attach-encryption.ts`) collapses into `openEncryptedDoc`. The coordinator is no longer exported as a standalone primitive: every consumer goes through `openEncryptedDoc`. The internal `attachStore` / `deriveWorkspaceKeyring` machinery moves inside `openEncryptedDoc`'s closure or stays adjacent in the same file.

`createOwnedYjsKey` / `getOwnedYjsPrefix` (in `document/local-yjs-key.ts`) become internal-only: still used by `attachLocalStorage` and `wipeLocalStorage`, but no longer exported from the package root.

`document/local-owner.ts` and `document/local-owner.test.ts` are **deleted**. Their behavior tests are absorbed into new tests for `attachLocalStorage` and `wipeLocalStorage`.

`document/attach-encryption.test.ts` is rewritten against `openEncryptedDoc`.

## 4. Tier 2: per-app openers

One per app per environment. Single source of truth for "how this app mounts in {browser, daemon}." Fully inline composition: every line does real work and reads top-to-bottom.

### 4.1 Schema exports (`apps/<app>/src/lib/schema.ts`)

Four plain exports. No `defineWorkspace` umbrella, no `openFujiWorkspace`, no `attachFujiWorkspace`.

```ts
export const FUJI_ID = "epicenter.fuji";
export const fujiTables = { entries: entriesTable };
export const createFujiActions = (tables: FujiTables) =>
  defineActions({
    /* ...existing handlers... */
  });
export const entryContentDocGuid = (entryId: EntryId): string =>
  docGuid({
    workspaceId: FUJI_ID,
    collection: "entries",
    rowId: entryId,
    field: "content",
  });

export type FujiTables = Tables<typeof fujiTables>;
export type FujiActions = ReturnType<typeof createFujiActions>;
```

The old `openFujiWorkspace` / `attachFujiWorkspace` / `touchEntry` / `batch` / `entryContentDocGuid` workspace method all disappear. `touchEntry` is inlined into its one caller (the child-doc `onLocalUpdate`). `batch` is replaced by `ydoc.transact` at call sites. `entryContentDocGuid` becomes the free export above.

### 4.2 Per-app browser opener (`apps/<app>/src/lib/browser.ts`)

Takes exactly `{ signedIn, installationId }`. No `auth` parameter: `signedIn.auth` provides it. No `owner`: deleted.

```ts
export function openFujiBrowser({
  signedIn,
  installationId,
}: {
  signedIn: SignedIn;
  installationId: string;
}) {
  // 1. workspace root doc
  const ws = openEncryptedDoc({ id: FUJI_ID, keyring: signedIn.keyring });
  const tables = ws.attachTables(fujiTables);
  const kv = ws.attachKv({});
  const actions = createFujiActions(tables);

  // 2. local storage + cloud sync for root
  const idb = attachLocalStorage(ws.ydoc, signedIn);
  const collab = openCollaboration(ws.ydoc, {
    url: roomWsUrl(APP_URLS.API, ws.ydoc.guid),
    openWebSocket: signedIn.auth.openWebSocket,
    waitFor: idb.whenLoaded,
    installationId,
    actions,
  });

  // 3. child docs: plaintext Yjs + encrypted storage
  const entryContentDocs = createDisposableCache((entryId: EntryId) => {
    const ydoc = new Y.Doc({ guid: entryContentDocGuid(entryId), gc: true });
    const body = attachRichText(ydoc);
    const childIdb = attachLocalStorage(ydoc, signedIn);
    const sync = openCollaboration(ydoc, {
      url: roomWsUrl(APP_URLS.API, ydoc.guid),
      openWebSocket: signedIn.auth.openWebSocket,
      waitFor: childIdb.whenLoaded,
      installationId,
      actions: {},
    });
    onLocalUpdate(ydoc, () =>
      tables.entries.update(entryId, { updatedAt: DateTimeString.now() }),
    );
    return {
      body,
      sync,
      [Symbol.dispose]() {
        ydoc.destroy();
      },
    };
  });

  // 4. reconnect everything on auth transitions
  const unsubAuth = signedIn.auth.onStateChange(() => {
    collab.reconnect();
    for (const child of entryContentDocs.values()) child.sync.reconnect();
  });

  return {
    ydoc: ws.ydoc,
    tables,
    kv,
    actions,
    idb,
    collab,
    entryContentDocs,
    async wipe() {
      entryContentDocs[Symbol.dispose]();
      ws[Symbol.dispose]();
      await Promise.all([idb.whenDisposed, collab.whenDisposed]);
      await wipeLocalStorage({ subject: signedIn.subject });
    },
    [Symbol.dispose]() {
      unsubAuth();
      entryContentDocs[Symbol.dispose]();
      ws[Symbol.dispose]();
    },
  };
}

export type FujiBrowser = ReturnType<typeof openFujiBrowser>;
```

Apps without child docs (zhongwen, tab-manager today) omit section 3 and the for-loop inside section 4's listener; their `wipe()` still uses the same prefix-scan-only path.

### 4.3 Per-app daemon opener (`apps/<app>/src/lib/daemon.ts` or `apps/<app>/daemon.ts`)

Takes exactly `ctx: DaemonWorkspaceContext`. Includes the app's canonical materializers (SQLite mirror + Markdown source-of-truth for Fuji). Projects that want a different materializer set don't call `openFujiDaemon`; they write their own opener using the primitives.

```ts
export function openFujiDaemon(ctx: DaemonWorkspaceContext) {
  const ws = openEncryptedDoc({
    id: FUJI_ID,
    keyring: ctx.keyring,
    clientId: ctx.clientId,
  });
  const tables = ws.attachTables(fujiTables);
  const kv = ws.attachKv({});
  const actions = createFujiActions(tables);

  const sqliteDb = openWriterSqlite({
    filePath: join(ctx.projectDir, ".epicenter", "sqlite.db"),
    log: createLogger(`${ctx.route}-sqlite`),
  });
  ws.ydoc.once("destroy", () => sqliteDb.close());

  attachSqliteMaterializer(ws.ydoc, { db: sqliteDb }).table(tables.entries);
  attachMarkdownMaterializer(ws.ydoc, { dir: ctx.projectDir }).table(
    tables.entries,
    { filename: slugFilename("title") },
  );

  return attachDaemonInfrastructure(ws.ydoc, {
    projectDir: ctx.projectDir,
    openWebSocket: ctx.openWebSocket,
    installationId: ctx.installationId,
    actions,
  });
}

export type FujiDaemon = ReturnType<typeof openFujiDaemon>;
```

`examples/fuji/epicenter.config.ts` collapses to:

```ts
import { fuji } from "@epicenter/fuji/project";

export default [fuji()];
```

(`defineWorkspace` in this snippet is the existing `define-config.ts` shape, not a new schema umbrella.)

## 5. `DaemonWorkspaceContext` change

Drop `attachEncryption`. Add `keyring`. Everything else unchanged.

```ts
// BEFORE
type DaemonWorkspaceContext = {
  projectDir: ProjectDir;
  route: string;
  clientId: number;
  installationId: string;
  attachEncryption: (ydoc: Y.Doc) => EncryptionAttachment;
  openWebSocket: OpenWebSocket;
};

// AFTER
type DaemonWorkspaceContext = {
  projectDir: ProjectDir;
  route: string;
  clientId: number;
  installationId: string;
  keyring: () => SubjectKeyring;
  openWebSocket: OpenWebSocket;
};
```

`packages/workspace/src/workspace-apps/start-daemon-workspace-apps.ts`:

- Delete `createDaemonAttachEncryption`.
- Build `ctx.keyring` inline as a lazy callback that throws on signed-out, identical guard to today's `createDaemonAttachEncryption` closure.

## 6. `SignedIn` and `createSession` change

`createSession`'s role is unchanged: auth-state-aware lifecycle container with reauth-required mounting. Only the payload type changes.

```ts
// Flat type, defined where it is produced: next to createSession.
// Not an intersection of any other type. AuthClient sits alongside subject and
// keyring because createSession is the one place all three are bound together.
// packages/svelte-utils/src/session.svelte.ts
export type SignedIn = {
  subject: string;
  keyring: () => SubjectKeyring;
  auth: AuthClient;
};

export function createSession<T extends Disposable>({
  auth,
  build,
}: {
  auth: AuthClient;
  build: (signedIn: SignedIn) => T;
}): { current: T | null; require(): T; [Symbol.dispose](): void };
```

Per-app openers import `SignedIn` from `@epicenter/svelte-utils` (or wherever `createSession` lives for that runtime). They pass `signedIn` whole to `attachLocalStorage`; structural subtyping handles the shape match.

Per-app `session.ts` files change as:

```ts
// BEFORE
build: ({ owner }) => openFujiBrowser({ owner, installationId, auth }),

// AFTER
build: (signedIn) => openFujiBrowser({
  signedIn,
  installationId: createInstallationId({ storage: localStorage }),
}),
```

`installationId` is read at build time from `localStorage` via the existing `createInstallationId` helper, exactly like today. It is a real parameter to the per-app opener (not hardcoded inside): browser installation ids are persistent random GUIDs, one per browser profile, not derivable from the app id.

## 7. Migration order

Strict ordering to keep typecheck green between commits:

1. **Tier 1 primitives** in `packages/workspace`: add `openEncryptedDoc`, `attachLocalStorage`, `wipeLocalStorage`, `Identity` type, `SignedIn` type. Old `attachEncryption`, `LocalOwner`, exports stay temporarily so existing consumers compile.
2. **Tier 1 cleanup**: rewrite internal tests against new primitives. Delete `local-owner.ts`, `local-owner.test.ts`, the now-unused exports. Update `attach-encryption.test.ts` (rename/rewrite as `open-encrypted-doc.test.ts`).
3. **`DaemonWorkspaceContext` and `createSession`**: change signatures. Update `start-daemon-workspace-apps.ts`. Update `packages/svelte-utils/src/session.svelte.ts`.
4. **Fuji reference port**: schema, browser opener, daemon opener, session.ts, tests, architecture.test.ts, examples/fuji/epicenter.config.ts.
5. **Fan-out**: parallel subagents for honeycrisp, zhongwen, opensidian, tab-manager. Each agent works one app end-to-end.
6. **Verification sweep**: typecheck + tests + grep for stragglers (`LocalOwner`, `owner.attachEncryption`, `owner.attachLocal`, `wipeLocalYjsData`, `createDaemonAttachEncryption`, `openFujiWorkspace` and friends).

Steps 1-2 are one PR's worth of work but can be two commits. Step 3 is one commit. Step 4 is one commit. Step 5 is one commit per app (5 commits or one big squashed commit, author's choice). Step 6 is verification, not a commit.

## 8. Deletions

Files deleted:

- `packages/workspace/src/document/local-owner.ts`
- `packages/workspace/src/document/local-owner.test.ts`

Exports removed from `@epicenter/workspace`:

- `LocalOwner` type
- `createLocalOwner` factory
- `attachEncryption` free function (consumers go through `openEncryptedDoc`)
- `EncryptionAttachment` type (becomes internal)

Internal helpers removed:

- `createDaemonAttachEncryption` in `start-daemon-workspace-apps.ts`
- `LocalOwner.attachEncryption` (1-line delegate)
- `LocalOwner.attachLocal` (becomes `attachLocalStorage` free function)
- `LocalOwner.wipeLocalYjsData` (becomes `wipeLocalStorage`, signature drops `guids`)

Per-app deletions:

- `openFujiWorkspace`, `attachFujiWorkspace`, `AttachFujiEncryption` type alias, `touchEntry`, `batch`, `entryContentDocGuid` (becomes free export of same name).
- Same set for `openHoneycrispWorkspace`, `openZhongwenWorkspace`, `openOpensidianWorkspace`.
- Tab-manager: it uses `owner.attachEncryption` inline (no `openTabManagerWorkspace` factory); its `extension.ts` rewrites to use primitives directly.

Renames:

- `ownerId` → `subject` everywhere. The IDB/BC prefix string `epicenter.owner.<subject>.yjs.<guid>` stays unchanged (it's a stable on-disk namespace, not a code-level identifier).

## 9. Invariants and how they get enforced

| Invariant                                                     | Enforced by                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two different subjects on the same browser never share IDB/BC | `attachLocalStorage` derives `databaseName` from `subject` snapshot. Test in new `attach-local-storage.test.ts`.                                                                                                                                                                                                                            |
| Workspace root doc is encrypted by construction               | `openEncryptedDoc` is the only way to attach tables/KV; it always activates encryption. Plaintext `attachTable` against `ws.ydoc` is type-rejectable but stays a runtime risk; the construction-from-options shape makes it harder to hit accidentally because callers receive `ws.attachTables` not `ws.ydoc + attachTable(ws.ydoc, ...)`. |
| Keyring rotation works                                        | `keyring: () => SubjectKeyring` callback is read on every encrypt. Existing rotation behavior preserved by `openEncryptedDoc`'s internal coordinator.                                                                                                                                                                                       |
| `subject` is stable for the lifetime of an attachment         | Snapshotted at `attachLocalStorage` call time into `databaseName` string. `Identity.subject: string` (not callback) makes this evident at the type.                                                                                                                                                                                         |
| Sign-out disposes encrypted Y.Docs before keyring drop        | `createSession.reconcile` disposes the build callback's payload on signed-out, before dropping its hold on auth state. The per-app opener's `[Symbol.dispose]()` is the gate; it must call `ws[Symbol.dispose]()` (which destroys the ydoc and triggers each store's `Symbol.dispose`).                                                     |
| `clientId` stable across daemon restarts                      | `hashClientId(projectDir)` in `start-daemon-workspace-apps.ts`. Unchanged.                                                                                                                                                                                                                                                                  |

## 10. Open follow-ups (NOT in scope of this spec)

- Type-brand encrypted Y.Docs so `attachTable(ydoc, ...)` plaintext call against a `ws.ydoc` is a compile error. The current spec leaves this as runtime risk; the cleaner shape (`ws.attachTables`) makes it less reachable, but doesn't enforce it.
- Daemon-side rich-text materialization (markdown body of entry content docs). Today's daemon does not materialize child docs; that's tech debt to address separately, with the daemon opener using `entryContentDocGuid(...)` to address the same child doc the browser opens.

## 11. Reference: full call-site comparison

```ts
// ─── BEFORE (browser, fuji) ─────────────────────────────────────────────
// session.ts
build: ({ owner }) => openFujiBrowser({ owner, installationId, auth }),

// browser.ts (137 LOC)
const workspace = openFujiWorkspace(owner.attachEncryption);
const { ydoc: rootYdoc, tables, kv } = workspace;
const idb = owner.attachLocal(rootYdoc);
// ... +120 LOC of child docs, collab, listener, wipe, dispose

// ─── AFTER (browser, fuji) ──────────────────────────────────────────────
// session.ts
build: (signedIn) => openFujiBrowser({
  signedIn,
  installationId: createInstallationId({ storage: localStorage }),
}),

// browser.ts (~55 LOC) : see §4.2
```

```ts
// ─── BEFORE (daemon, fuji) ──────────────────────────────────────────────
// examples/fuji/epicenter.config.ts
const fuji = defineDaemonWorkspace({
  async open({
    projectDir,
    route,
    clientId,
    installationId,
    attachEncryption,
    openWebSocket,
  }) {
    const workspace = openFujiWorkspace(attachEncryption, { clientId });
    // ... materializer wiring inline
  },
});

// ─── AFTER (daemon, fuji) ───────────────────────────────────────────────
// apps/fuji/daemon.ts : see §4.3 (openFujiDaemon)
// examples/fuji/epicenter.config.ts
export default [fuji()];
```
