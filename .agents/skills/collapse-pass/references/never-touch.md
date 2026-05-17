# Never-Touch and Pause List

Codebase-specific facts that the collapse pass must respect. These strings, shapes, and packages outlive any individual session; changing them silently breaks on-disk data, sync, or downstream consumers.

## Durable strings: never change without explicit product decision

These appear in encrypted blobs, on-disk paths, sync wire format, or schemas other apps validate against. They are part of the durable vocabulary of Epicenter.

### HKDF info labels

```
"subject:{subject}"
"workspace:{workspaceId}"
```

Used by the encryption package to derive workspace-scoped keys. Changing the label rotates every derived key.

### IndexedDB prefix

```
"epicenter.owner.{ownerId}.yjs.{guid}"
```

Used by the browser-side workspace runtime. Changing the prefix detaches every existing IndexedDB store from its consumer.

### Durable Object name format

```
"subject:{subject}:rooms:{room}"
```

Used by the sync hub to address rooms. Changing the format breaks the routing contract between client and hub.

### EncryptedBlob format bytes

- `blob[0] = 1` (format version)
- `blob[1] = key version`

Both bytes are part of the on-disk and on-wire encryption envelope. Bumping them is a migration, not a refactor.

### Public arktype schemas

Other apps validate inputs against these by name and shape. Renaming a field or changing a brand silently invalidates their parsers.

- `PersistedAuth`
- `ApiMeResponse`
- `SubjectKeyring`
- `RootKeyring`

### Identity strings inside documents

- Y.Doc guid values (workspace identity for sync and persistence)
- Sync room names
- Child document GUIDs (deterministic per row, used by materializers and editors)

### Migration shims

- `LegacyPersistedAuth` (and any other `*Legacy*` validator). These carry the historic on-disk vocabulary by design. Even when no current writer produces the legacy shape, readers must still accept it. Do not delete legacy migration shims; their presence is the migration contract.

## Pause and ask before

The collapse pass should stop and surface to the user (not silently proceed) when about to:

- Change any string from the list above
- Delete a public exported name that has zero in-repo callers but plausible external CLI or SDK consumers (the `@epicenter/cli` binary and the `@epicenter/workspace` published API are the load-bearing examples)
- Collapse two files where one's JSDoc documents a non-obvious invariant (the JSDoc is the documentation of a contract; losing it loses the contract)
- Merge packages or move exports across package boundaries
- Change a function signature that crosses a published package boundary

## Scope tiers

Default collapse-pass targets, narrowest to widest:

1. `packages/auth`
2. `packages/auth-svelte`
3. `packages/encryption`
4. `packages/workspace`
5. `packages/svelte-utils`
6. `packages/cli`
7. `apps/api`

Out of scope without an explicit pass declaration:

- First-party apps: `apps/whispering`, `apps/tab-manager`, `apps/fuji`, `apps/honeycrisp`, `apps/opensidian`, `apps/zhongwen`. These are owned by separate waves and have their own architecture tests.
- `specs/`, `docs/articles/`, migration history (`*-legacy-*.md`, archived ADRs)
