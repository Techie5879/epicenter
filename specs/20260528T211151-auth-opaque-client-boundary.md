# Auth Opaque Client Boundary

Product sentence:
  `@epicenter/auth` owns credentials and authenticated transports. Apps receive local workspace capability state (`ownerId`, `keyring`) and network capabilities (`fetch`, `openWebSocket`), not token semantics.

Current surface:

```txt
OAuth launcher
  -> OAuthTokenGrant
  -> createOAuthAppAuth
  -> /api/session
  -> PersistedAuth { grant, userId, ownerId, keyring }
  -> AuthState { ownerId, keyring }
```

The thesis is mostly right, but it needs one sharper rule: clients may hold bearer strings as transport material inside auth core, but client and app code must not interpret them as JWTs. The resource server is the first layer allowed to verify signatures and read claims.

## Grill

### 1. Does offline editing need JWT/JWKS verification?

No.

Offline editing needs stable local partition identity and decryption material. It does not need to prove an online bearer token is still valid because there is no online server decision to make while offline.

```txt
offline workspace boot
  -> server base URL
  -> ownerId
  -> document id
  -> keyring
  -> encrypted IndexedDB
```

JWT/JWKS verification would add a second identity authority in the client. It would also give a false sense of freshness: a locally verified JWT can still be revoked, user-disabled, audience-wrong for a different server, or stale relative to the current server keyring. `packages/auth/src/create-oauth-app-auth.ts` already treats `accessTokenExpiresAt` as a refresh hint only, and it verifies network access by calling `/api/session`.

### 2. What exactly must be persisted for offline editing?

The current durable cell has the right offline fields:

```ts
{
  grant,     // online transport only
  userId,    // machine status and account identity
  ownerId,   // local partition key
  keyring,   // local decrypt material
}
```

For workspace persistence specifically, the required tuple is:

```txt
server + ownerId + document id + keyring
```

`packages/workspace/src/document/attach-local-storage.ts` derives the IndexedDB and BroadcastChannel key from `server`, `ownerId`, and `ydoc.guid`. `packages/workspace/src/document/derive-workspace-keyring.ts` derives per-document encryption keys from the owner keyring and workspace id. No JWT claim participates in either path.

### 3. Which code currently exposes token-shaped data outside auth core?

Concrete exposures:

```txt
packages/auth/src/index.ts
  exports PersistedAuth and OAuthTokenGrant from the public package root.

apps/fuji/src/lib/auth.browser.ts
apps/fuji/src/lib/auth.tauri.ts
apps/api/ui/src/lib/platform/auth/auth.ts
apps/honeycrisp/src/lib/platform/auth/auth.ts
apps/opensidian/src/lib/platform/auth/auth.ts
apps/zhongwen/src/lib/platform/auth/auth.ts
  imported PersistedAuth only to validate localStorage state.

apps/tab-manager/src/lib/platform/auth/auth.ts
  imports PersistedAuth to validate chrome.storage.local state.

packages/auth/src/node/machine-auth.ts
  reads and writes PersistedAuth directly for CLI and daemon auth files.
```

Claim-reading exposure is narrower:

```txt
packages/server/src/middleware/require-auth.ts
  verifies the bearer, reads payload.sub, then loads the user row.

packages/server/src/routes/auth.ts
  publishes OAuth protected-resource metadata.

packages/server/src/auth/plugins.test.ts
  decodes JWT payloads in tests.
```

I did not find production app/client code decoding JWT claims. The main smell is schema visibility: apps know that persisted auth is a token-bearing object even if they do not read the token fields.

### 4. Which deletions are genuinely greenfield-best, and which are premature?

Greenfield-best deletions:

```txt
delete app imports of PersistedAuth for localStorage auth setup
delete any client-side JWT/JWKS verification if it appears
delete any app code that reads accessToken, refreshToken, sub, exp, aud, or scope
delete any workspace dependency on userId when ownerId is the partition key
```

Premature deletions:

```txt
do not delete PersistedAuth from auth internals
do not hide machine-auth file format before replacing its storage API
do not split /api/session before a second boot/profile caller exists
do not replace JWT access tokens with reference tokens without a resource-server reason
do not change JWT signing algorithm in this slice
```

The boundary that has earned a clean break is app setup. App setup should pass a storage key and runtime storage, not import the schema for a credential-bearing cell.

### 5. What threat improves when token storage becomes private?

Private auth storage reduces accidental token handling by app code.

Improved threats:

```txt
ordinary app code cannot casually read refresh tokens
future UI code is less likely to log or display token-shaped data
workspace code cannot start depending on token claims for identity
storage migrations stay inside auth instead of spreading through apps
token format can change without app call-site churn
```

This is an ownership and blast-radius improvement. It does not make browser storage secret from code running in the same origin.

### 6. What threat does not improve, especially XSS/device compromise?

XSS and device compromise remain serious.

Not improved:

```txt
same-origin XSS can still call auth.fetch and auth.openWebSocket
same-origin XSS can still read localStorage unless storage moves to a stronger runtime boundary
malware or a stolen unlocked device can read local files and browser profiles
an attacker with keyring access can decrypt persisted local workspace data
a stolen refresh token remains valuable until revoked or rotated
```

The auth boundary prevents misuse by honest code. It is not a sandbox against hostile same-origin JavaScript.

### 7. Should /api/session stay unified or split into boot/profile?

Keep it unified for this slice.

`packages/server/src/routes/session.ts` currently returns a boot manifest:

```txt
user.email      profile display
user.id         auth identity
ownerId         workspace partition
keyring         workspace decrypt material
```

The impurity is real: profile display and local boot material are in one response. But splitting it now adds another endpoint and another client round trip without fixing the main leak. The clean boundary is that `/api/session` remains the authenticated server-derived boot manifest, and apps do not infer boot material from JWT claims.

Revisit the split when profile surfaces need richer profile data, caching, or public display fields that do not belong beside key material.

### 8. Should Better Auth reference tokens be rejected for now?

Reject for now.

JWT access tokens are a good fit for the current server shape because `packages/server/src/middleware/require-auth.ts` can verify issuer, audience, signature, expiry, and subject at the resource boundary. Reference tokens would move the resource server from local verification to online introspection or shared storage lookup. That may be useful later for immediate revocation or smaller bearer values, but it is not a greenfield win for local-first clients.

The thesis should say:

```txt
JWT access tokens stay.
Clients treat them as opaque bearer credentials.
Resource servers verify them.
```

This keeps the current Better Auth OAuth provider shape and avoids confusing opaque-to-client with opaque-to-server.

### 9. What is the smallest first implementation slice?

The smallest useful slice is:

```txt
1. Write the invariant in the spec and auth-facing API docs:
   clients must not decode or verify JWTs.

2. Add a static guard:
   app/client code cannot import JWT decoding or resource-server verification helpers.

3. Hide PersistedAuth from Web-Storage-backed app setup:
   createWebStoragePersistedAuthStorage({ key, storage })

4. Leave extension storage for the next slice:
   chrome.storage uses a local WXT helper, so hiding PersistedAuth there needs a small extension-owned adapter.

5. Do not split /api/session, switch token classes, or change JWT alg.
```

## Execution Plan

### Slice 1

- [x] Add this spec with the critique and implementation plan.
- [x] Add `createWebStoragePersistedAuthStorage({ key, storage })` to `@epicenter/auth` core (next to `PersistedAuth` and the `PersistedAuthStorage` type it implements; it has no Svelte dependency, so it does not belong in `@epicenter/auth-svelte`). `storage` is required, matching the OAuth launcher call sites.
- [x] Replace localStorage-backed app imports of `PersistedAuth` with the helper.
- [x] Add a focused static guard that fails when app/client code imports JWT decoding, `jose` verification, or Better Auth resource verifier helpers.
- [x] Keep `apps/tab-manager` on its local `createStorageState` shape for now (migrated in Slice 2 instead of deferred).
- [x] Run focused auth tests and typechecks.

### Slice 2

- [x] Extract the cell codec (`parsePersistedAuthCell` / `serializePersistedAuthCell`) into `persisted-auth-storage.ts`; route the Web Storage adapter and `machine-auth`'s write through it. `machine-auth`'s read stays bespoke because it logs the discarded cell.
- [x] Add `loadPersistedAuthStorage(AsyncAuthCellStore)`: pre-load an async string store into a synchronous `PersistedAuthStorage`. The auth runtime reads `get()` once at construction, so async substrates pre-load behind the app's existing readiness gate rather than forcing an async `get()` on the six synchronous apps.
- [x] Migrate `apps/tab-manager` onto `loadPersistedAuthStorage` over a WXT `defineItem<string>`. The extension persists an opaque serialized string and imports nothing credential-shaped. Chosen over the side-panel `localStorage` shortcut because `chrome.storage` survives "clear browsing data", matches the app's storage convention, and the readiness gate already exists.
- [x] Drop `PersistedAuth` (and `OAuthTokenGrant`) from the `@epicenter/auth` root. The `exports` map exposes no path to `auth-types.js`, so apps structurally cannot reach the cell shape; a client-boundary test pins its absence from the root.
- No node-owned storage adapter: `machine-auth` already owns its file format and its read logs on corruption, which the generic swallow-to-null adapters do not. Forcing it onto a shared reader would be false symmetry.

### Slice 3

- Revisit `/api/session` only when a caller needs profile data independently from boot material.
- Revisit Better Auth reference tokens only if revocation latency or bearer size becomes a resource-server requirement.
- Revisit JWT algorithm only through the existing JWKS signing-key spec path, not as part of client opacity.

## Notes on Better Auth Source

After `bun install`, the installed Better Auth source confirmed the current repo shape:

```txt
@better-auth/oauth-provider/dist/client-resource.mjs
  oauthProviderResourceClient().getActions().verifyAccessToken(...)
  delegates to better-auth/oauth2 verifyAccessToken with issuer, audience, and JWKS URL.

better-auth/dist/plugins/jwt/sign.mjs
  signs JWTs with jose SignJWT, issuer, audience, exp, kid, and configured alg.

better-auth/dist/plugins/jwt/verify.mjs
  verifies JWTs with jose jwtVerify against the JWKS adapter and checks sub plus aud.
```

That supports the rejection of reference tokens in this slice: Better Auth already gives the resource server a JWT verification path, and Epicenter's client-side issue is token interpretation outside auth core, not token format.
