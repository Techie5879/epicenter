# Auth, Workspace Identity, And Transport Canonical Path

**Date**: 2026-05-15
**Status**: Recommendation
**Author**: AI-assisted

## One Sentence

Epicenter uses Better Auth as the OAuth server, stores one client-side `PersistedAuth` cell with an online grant and local workspace identity, mounts workspaces while local identity exists, and routes all network access through auth-owned HTTP and WebSocket transports.

This is the final recommendation for the current architecture pass. It replaces the older `OAuthSession`, `WorkspaceIdentityStore`, id-token-carried keys, raw token getter, device-authorization direction, and the too-broad `unlock.encryptionKeys` vocabulary.

## Recommendation

Keep the one-cell `{ grant, localIdentity }` architecture and harden it. Do not split identity into a second workspace store, do not move key material into `id_token`, do not reintroduce raw token getters, and do not revive Better Auth device authorization for the CLI.

Use this vocabulary:

```txt
RootKeyring
  server-side secret versions
  current source: ENCRYPTION_SECRETS
  future source: self-hosted env, tenant KMS, or customer KMS

SubjectKeyring
  per-subject key material returned by /api/me
  persisted inside localIdentity
  used offline

WorkspaceKeyring
  per-workspace keys derived locally from SubjectKeyring
  used by encrypted Yjs stores
```

The API issues a local workspace identity:

```txt
root keyring + subject
  -> SubjectKeyring
  -> client localIdentity
  -> workspace keyring
```

The `subject` is an opaque owner label for local workspace state. Today it can equal Better Auth `user.id`. Later it can become issuer-scoped or tenant-scoped without changing the persisted client shape.

The smallest coherent final shape is:

```txt
Better Auth
  owns account sessions, login pages, OAuth consent, authorization code,
  refresh token, revoke, JWKS, and trusted client metadata

Epicenter API
  owns /api/me and protected-resource authorization

@epicenter/auth
  owns PersistedAuth, refresh, revoke, /api/me verification,
  auth.fetch, and auth.openWebSocket

@epicenter/svelte
  owns workspace session mounting from auth.state

@epicenter/workspace
  owns LocalOwner, local Yjs persistence, encryption attachment,
  BroadcastChannel scoping, sync, and wipe
```

The durable cell should move to this shape:

```ts
type PersistedAuth = {
  grant: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
  };
  localIdentity: {
    subject: string;
    keyring: SubjectKeyring;
  };
};
```

The public auth state stays capability-only:

```ts
type AuthState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; localIdentity: LocalWorkspaceIdentity }
  | { status: 'reauth-required'; localIdentity: LocalWorkspaceIdentity };
```

Profile fields are application data. Email, display name, avatar, billing plan, and org membership are fetched by the surfaces that display them. Auth state does not carry them.

`/api/me` should return the profile projection and the local workspace identity as separate fields:

```ts
type ApiMeResponse = {
  user: AuthUser;
  localIdentity: LocalWorkspaceIdentity;
};
```

The old response `{ user, encryptionKeys }` should migrate in one clean wave with persisted auth. Do not keep both public response names after the migration.

## Security Model

The root of trust is the root keyring owner, not the subject string.

```txt
Epicenter Cloud
  Epicenter root keyring + subject -> SubjectKeyring

Self-hosted
  customer root keyring + subject -> SubjectKeyring

Managed enterprise BYOK
  customer-managed tenant root keyring + subject -> SubjectKeyring
```

All three modes keep the same client model. Only server-side root keyring resolution changes.

Do not derive client keyrings directly from organization ids. Enterprise packaging should evolve through root key ownership, SSO, SCIM, audit logs, DLP, admin controls, support, and customer-managed keys. It should not make org membership equal local decrypt scope.

The asymmetric win is refusing a hosted zero-knowledge mode and refusing org-derived keyrings. That keeps one encryption path, one persisted auth shape, and one local workspace identity model. Users who need a zero-knowledge trust boundary self-host or use a customer-managed root keyring.

## Final Names

Use these names in the clean break:

| Concept | Name |
| --- | --- |
| Persisted auth field | `localIdentity` |
| Local owner field | `subject` |
| Client-delivered keyring type | `SubjectKeyring` |
| Client-delivered keyring entry type | `SubjectKeyringEntry` |
| Server root keyring type | `RootKeyring` |
| Server root keyring entry type | `RootKeyringEntry` |
| Derivation function | `deriveSubjectKeyring` |
| Equality function | `subjectKeyringsEqual` |
| `/api/me` field | `localIdentity` |

Why not the old names:

```txt
unlock
  Too narrow. subject does not unlock cryptographically.

localWorkspaceIdentity
  Correct as a type name, too long as a persisted field name.

workspaceOwner
  Good for local storage, bad for key material.

UserKeyring
  Friendly, but too tied to Better Auth user records.

EncryptionKeys
  Too generic. The value is a versioned per-subject keyring.
```

`LocalWorkspaceIdentity` is the public shape. `localIdentity` is the field name
inside `PersistedAuth` and `/api/me`. The shorter field works because the
containing types already supply the workspace context.

## Checkpoint Evidence

### Checkpoint 1: Current Architecture And Invariants

Current code already implements the core split, but it still uses the older
`unlock.encryptionKeys` names. The clean break keeps the split and changes the
domain vocabulary.

| Concern | Current owner | Evidence |
| --- | --- | --- |
| Durable auth shape | `@epicenter/auth` | `packages/auth/src/auth-types.ts` defines `OAuthTokenGrant`, old `LocalUnlockBundle`, and `PersistedAuth`. Target: `LocalWorkspaceIdentity`. |
| Auth state | `@epicenter/auth` | `packages/auth/src/auth-contract.ts` defines three states; both identity-bearing states carry the old `unlock`. Target: `localIdentity`. |
| Network gate | `@epicenter/auth` | `packages/auth/src/create-oauth-app-auth.ts` refreshes, calls `/api/me`, and only then attaches bearer credentials. |
| Svelte reactivity | `@epicenter/auth-svelte` | `packages/auth-svelte/src/create-auth.svelte.ts` wraps core state with `createSubscriber`. |
| Workspace lifetime | `@epicenter/svelte` | `packages/svelte-utils/src/session.svelte.ts` keeps payload mounted for `signed-in` and `reauth-required`, and disposes only on `signed-out`. |
| Local owner | `@epicenter/workspace` | `packages/workspace/src/document/local-owner.ts` scopes IDB, BroadcastChannel, encryption, and wipe by old `userId`. Target: `subject`. |
| API identity | `apps/api` | `apps/api/src/app.ts` mounts `/api/me`; `apps/api/src/auth/resource-boundary.ts` verifies bearer token, issuer, audience, scope, and user existence. |
| Credential normalization | `apps/api` | `apps/api/src/auth/single-credential.ts` rejects cookie plus bearer ambiguity and lifts WebSocket bearer subprotocol into `Authorization`. |

Durable rules:

1. Raw OAuth tokens stay inside auth storage and auth transport.
2. `auth.fetch` and `auth.openWebSocket` are the app transport capabilities.
3. `/api/me` is the only client identity projection: verified bearer token plus Better Auth user plus derived local workspace identity.
4. Local decrypt can continue when network auth is paused.
5. Browser-local Yjs data is scoped by `(subject, ydoc.guid)`.
6. `reauth-required` is identity-bearing, not signed out.
7. Sign-out clears the auth cell but does not wipe Yjs data unless the user takes a separate destructive action.

### Checkpoint 2: Candidate Boundaries

Four boundaries were compared.

| Candidate | Shape | Result |
| --- | --- | --- |
| A. Bundled session | `OAuthSession = tokens + user + keyring` | Reject. It couples token rotation to local identity and profile data. It already lost to `PersistedAuth`. |
| B. Separate workspace identity store | Auth stores tokens; workspace stores identity and keys | Reject. It adds a second lifecycle and same-user guard with no live consumer that needs independent storage. |
| C. id_token carries encryption keys | OAuth token response becomes identity source | Reject. Encryption keys are capability material, not profile claims. Loggers and libraries treat id tokens as identity objects. |
| D. One persisted cell with grant and local identity | Auth stores `{ grant, localIdentity }`; `/api/me` verifies and refreshes local identity | Choose. It matches the current implementation boundary, keeps offline local decrypt available, and keeps network credentials behind auth transport. |

Candidate D is the smallest shape that explains every runtime:

```txt
Browser redirect OAuth
Extension WebAuthFlow OAuth
Machine OOB OAuth
  -> OAuthTokenGrant
  -> /api/me
  -> PersistedAuth
  -> AuthState
  -> createSession
  -> LocalOwner
  -> auth.fetch and auth.openWebSocket
```

### Checkpoint 3: Final Boundary

The final boundary is not "auth owns identity." That sentence is too broad.

The final boundary is:

```txt
auth owns capabilities:
  online grant
  local workspace identity
  transport

workspace owns local data:
  Y.Doc
  local persistence
  encryption attachment
  sync attachment

application owns profile:
  email
  avatar
  billing display
  account labels
```

This keeps the product sentence compact:

```txt
Sign in once, open local encrypted workspaces offline, and use the server only through auth-owned transports when online.
```

### Checkpoint 4: Spec Output

This file is the canonical architecture spec. Implementation agents should read it before changing auth, workspace session, local workspace identity, or network transport code.

## Runtime Paths

There are three launch paths and one shared runtime.

```txt
Browser app
  launcher: browser redirect
  storage: app localStorage
  callback: app /auth/callback

Extension
  launcher: browser.identity.launchWebAuthFlow
  storage: chrome.storage.local
  callback: browser extension redirect URL

Machine
  launcher: OOB code paste
  storage: env-paths('epicenter').data/auth/<host>.json with 0600 mode
  callback: hosted /auth/cli-callback page
```

After launch, all three converge:

```txt
grant from /auth/oauth2/token
  -> GET /api/me with Authorization: Bearer
  -> write PersistedAuth
  -> expose AuthState
  -> build workspace session from localIdentity
  -> call protected resources through auth.fetch or auth.openWebSocket
```

Daemon is not a fourth auth path. Daemons load the machine cell and construct `createOAuthAppAuth` with a noninteractive launcher.

## Ownership

| Surface | Owner | Must not know |
| --- | --- | --- |
| OAuth provider routes | Better Auth inside `apps/api` | Workspace storage names, Yjs, local identity UI. |
| `/api/me` | Epicenter API | Browser storage adapters, Svelte session lifecycle. |
| `PersistedAuth` | `@epicenter/auth` | App profile display, workspace tables. |
| `auth.fetch` | `@epicenter/auth` | Resource-specific retry policy beyond one auth retry. |
| `auth.openWebSocket` | `@epicenter/auth` | Sync protocol details beyond subprotocol insertion. |
| `createSession` | `@epicenter/svelte` | Raw OAuth tokens, profile fields. |
| `LocalOwner` | `@epicenter/workspace` | Refresh tokens, account profile, hosted sign-in. |
| `openCollaboration` and sync | `@epicenter/workspace` | Token storage, `/api/me`, Better Auth cookies. |
| Account popover and billing UI | Application or shared UI | Refresh tokens, local encryption key derivation. |

## Storage Shape

Browser and extension storage should validate exactly `PersistedAuth | null`.

Machine storage should validate exactly the same shape, with file permissions enforced before parsing. Keep machine auth under `env-paths('epicenter').data/auth/<host>.json`; do not reintroduce top-level `~/.epicenter` or `EPICENTER_HOME`.

Old cells with the current shipped shape must migrate:

```ts
type OldPersistedAuth = {
  grant: OAuthTokenGrant;
  unlock: {
    userId: string;
    encryptionKeys: EncryptionKeys;
  };
};
```

Migration maps them directly:

```ts
{
  grant: old.grant,
  localIdentity: {
    subject: old.unlock.userId,
    keyring: old.unlock.encryptionKeys,
  },
}
```

This is a user-data migration, not a compatibility API. The runtime may accept
the old shape at storage boundaries, but public code should expose only
`localIdentity`, `subject`, and `keyring` after parsing.

Do not add:

```txt
OAuthSession
AuthIdentity
WorkspaceIdentityStore
profile bucket
token getter cache
idToken identity cache
```

Older storage keys from pre-`PersistedAuth` architectures are intentionally ignored. Compatibility would create a second session model and make local identity semantics harder to prove.

## State Machines

### Auth Client

```txt
signed-out
  persisted = null
  workspace session = null
  auth.fetch sends no bearer
  auth.openWebSocket sends no bearer

signed-in
  persisted exists
  localIdentity is readable
  bearer may be attached only after /api/me verifies current cell

reauth-required
  persisted exists
  localIdentity is readable
  network auth is paused
  workspace session stays mounted
```

Transitions:

```txt
startSignIn succeeds
  grant -> /api/me -> write PersistedAuth -> signed-in

cold boot with cell
  signed-in immediately for local identity
  first network call refreshes if stale, then verifies /api/me

refresh succeeds
  write grant only
  clear network verification
  verify /api/me before next bearer-bearing call

refresh fails
  keep localIdentity
  state = reauth-required

/api/me same-user guard fails
  clear cell
  state = signed-out

signOut
  clear cell
  state = signed-out
  revoke refresh token best effort unless a later migration strengthens it
```

### Workspace Session

```txt
auth signed-out
  dispose payload
  current = null

auth signed-in or reauth-required
  if no payload:
    build LocalOwner from ownerId = localIdentity.subject and lazy keyring()
  if payload exists:
    keep it mounted
```

The migration must harden the same-user assumption. Today, `createSession` keeps payload when any identity-bearing state follows another. That is coherent only if auth guarantees no same-runtime different-user transition without `signed-out` in between. Make that invariant explicit in tests.

### Local Owner

```txt
owner.ownerId
  -> createOwnedYjsKey(ownerId, ydoc.guid)
  -> encrypted IndexedDB database name
  -> BroadcastChannel key
  -> wipe prefix

owner.keyring()
  -> lazy read from current auth.state.localIdentity
  -> lets /api/me key rotation take effect without rebuilding workspace
```

Local owner is a browser concept. Daemons attach encryption directly and persist by filesystem.

The current durable IndexedDB name prefix is `epicenter.v1.user`. Do not rename
that string in this clean break unless a local database migration lands in the
same wave. Public names can move from `userId` to `subject` without changing
the persisted database prefix.

### Network Transport

```txt
auth.fetch(request)
  -> refresh grant if near expiry
  -> verify current cell with /api/me if needed
  -> attach Authorization: Bearer
  -> credentials: omit
  -> one forced refresh and retry on 401

auth.openWebSocket(url, protocols)
  -> refresh grant if near expiry
  -> verify current cell with /api/me if needed
  -> append bearer.<accessToken> subprotocol
```

Server middleware converts a WebSocket bearer subprotocol into `Authorization` before protected resource middleware runs. Resource routes then verify the token with Better Auth's OAuth resource client.

## Race Handling

These are first-wave hardening items before new architecture work.

| Risk | Current evidence | Required checkpoint |
| --- | --- | --- |
| Refresh writes stale grant after sign-out | `refreshGrant` writes storage before the stale check after `set` returns. | Re-check `persisted === startedFrom` before and after storage writes, or make storage writes compare-and-swap. Add a regression test. |
| `/api/me` key update writes stale local identity after sign-out | `verifyIdentity` writes updated keys before the stale check after `set` returns. | Same stale-write test pattern for key update. |
| Identity-bearing subject changes without signed-out gap | `createSession` keeps existing payload whenever payload exists. | Either enforce signed-out gap in auth or compare `localIdentity.subject` in `createSession` and rebuild on change. |
| WebSocket without bearer after verification failure | `openWebSocket` can construct without bearer when `bearerForNetwork` returns null. | For protected sync URLs, return a failed promise or close early instead of opening anonymous. Decide in the sync transport migration. |
| Fetch retry with non-replayable body | `auth.fetch` retries once after 401. | Document caller constraint and add a test for `Request` clone behavior. Do not hide arbitrary stream replay. |
| Machine OOB state verification | OOB launcher generates state; current paste flow does not verify it from user input. | Render a copyable `{ code, state }` payload or remove state and comments claiming local verification. |
| Machine temp-file collision | Machine store uses a fixed temp path. | Use a random or process-specific temp path before claiming concurrent login or refresh safety. |

## External Precedents

| Precedent | What it shows | Consequence for Epicenter |
| --- | --- | --- |
| [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider) | OAuth provider owns authorization code, refresh token, revocation, trusted clients, public clients, JWT and JWKS behavior, and resource verification helpers. | Keep Better Auth as the auth server. Do not build OAuth by hand. |
| [Better Auth resource client](https://better-auth.com/docs/plugins/oauth-provider) | API servers verify `Authorization: Bearer` tokens with issuer, audience, expiration, signature or introspection, and scope checks. | Keep `/api/me` and protected resources behind server-side token verification. |
| [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Durable Objects are the right coordination point for long-lived WebSocket sessions. Hibernation resets memory and requires durable or attached state. | Keep Room DOs as room coordinators; do not put auth session truth in DO memory. |
| [Hono middleware](https://hono.dev/docs/guides/middleware) | Middleware runs in registration order. | Keep `singleCredential` before protected resources and OAuth discovery before `/auth/*` catch-all routes. |
| [Yjs document updates](https://docs.yjs.dev/api/document-updates) | Updates are commutative, associative, idempotent binary deltas. | Sync should move bytes and presence, not profile or auth state. |
| [y-protocols awareness](https://docs.yjs.dev/api/about-awareness) | Awareness is network-agnostic presence and schemaless local state, usually implemented by providers. | Treat awareness `replica` as client-claimed presence, not verified account identity. Server-stamped `subject` belongs outside awareness. |
| [y-indexeddb](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb) | `docName` is the durable browser database identity and enables offline editing. | Use owner-scoped database names for authenticated browser workspaces. |
| [Svelte createSubscriber](https://svelte.dev/docs/svelte/svelte-reactivity) | External event sources can be reflected into reactive reads. | Keep `auth-svelte` as a thin reactive wrapper over framework-agnostic auth. |
| [SvelteKit load](https://svelte.dev/docs/kit/load) | Universal load runs in both server and browser; server load has request-only data. | Keep raw OAuth tokens out of universal app code. Use client auth transport for browser-only resource calls. |
| [Tauri opener](https://tauri.app/reference/javascript/opener/) | Opening URLs is an explicit platform capability with URL scope configuration. | Browser-launch auth belongs in launchers, not in core auth state. |
| [WXT storage](https://wxt.dev/storage) | Extension storage is key-based and async, with `local`, `session`, and metadata APIs. | Extension storage is a runtime adapter for the same `PersistedAuth` shape, not a different auth model. |
| [Drizzle Turso docs](https://orm.drizzle.team/docs/connect-turso) | Drizzle supports runtime-specific database drivers and serverless databases. | Keep database concerns in API composition. Auth clients should not learn DB adapter shapes. |
| [Cloudflare Workers Turso tutorial](https://developers.cloudflare.com/workers/tutorials/connect-to-turso-using-workers/) | Worker database connections are runtime concerns. | Per-request DB setup stays server-side. |
| [TanStack AI provider tools](https://tanstack.com/ai/latest/docs/tools/provider-tools) | Provider-specific capabilities are branded and gated at the adapter boundary. | Mirror this: expose `auth.fetch` and `auth.openWebSocket` capabilities, not raw token data. |
| `~/Code/ai` provider source | `/Users/braden/Code/ai/packages/openai/src/openai-provider.ts` hides API-key header construction inside provider instances. | Capability-owned transport is a local precedent, not just an auth preference. |
| `~/Code/ai` UI source | `/Users/braden/Code/ai/packages/react/src/use-chat.ts` exposes state and actions, not the provider key. | UI surfaces should consume actions and state, not secrets. |
| [jsrepo registry](https://jsrepo.dev/docs/registry) | Registry blocks are installed as local source with explicit manifests. | Installed app or component templates should depend on public capabilities, not hidden host auth internals. |
| [libsignal Sesame](https://signal.org/docs/specifications/sesame/) | Devices store identity and session state locally; servers are not the source of encrypted-session secrets. | Local workspace identity belongs to the client capability layer, while server auth verifies account access. |
| [Bitwarden log in vs unlock](https://bitwarden.com/help/understand-log-in-vs-unlock/) | Login requires server access; unlock works against already stored encrypted local data. | `reauth-required` must not unmount local encrypted workspaces. |
| [shadcn-svelte installation](https://www.shadcn-svelte.com/docs/installation) | Components are copied into local projects and imported through local files. | UI components should receive auth/profile data as props or queries, not import auth internals. |
| [shadcn-svelte-extras](https://www.shadcn-svelte-extras.com/docs/introduction) | Extras emphasize composability and do not force defaults that belong to the host app. | Shared UI should stay composable around auth state and profile queries. |
| [TanStack Table Svelte state](https://tanstack.com/table/latest/docs/framework/svelte/guide/table-state) | Control only the state you need; leave the rest internal. | Auth state should expose only capability state. Profile freshness and UI labels should stay outside. |
| [Autumn usage tracking](https://docs.useautumn.com/documentation/customers/tracking-usage) | Billing tracks usage against a customer id after the customer exists. | Billing depends on verified user id at protected API routes, not profile data in auth state. |

## Call Sites To Preserve

Browser auth clients:

```txt
apps/dashboard/src/lib/platform/auth/auth.ts
apps/opensidian/src/lib/platform/auth/auth.ts
apps/fuji/src/lib/platform/auth/auth.ts
apps/honeycrisp/src/lib/platform/auth/auth.ts
apps/zhongwen/src/lib/platform/auth/auth.ts
apps/tab-manager/src/lib/platform/auth/auth.ts
```

Workspace session builders:

```txt
apps/opensidian/src/lib/session.ts
apps/fuji/src/lib/session.ts
apps/honeycrisp/src/lib/session.ts
apps/zhongwen/src/lib/session.ts
apps/tab-manager/src/lib/session.svelte.ts
```

Transport consumers:

```txt
apps/opensidian/src/lib/opensidian/browser.ts
apps/fuji/src/routes/(signed-in)/fuji/browser.ts
apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts
apps/tab-manager/src/lib/tab-manager/extension.ts
apps/*/blocks/daemon-route.ts
packages/workspace/src/document/open-collaboration.ts
packages/workspace/src/document/internal/sync-supervisor.ts
```

Server gates:

```txt
apps/api/src/app.ts
apps/api/src/auth/create-auth.ts
apps/api/src/auth/resource-boundary.ts
apps/api/src/auth/single-credential.ts
apps/api/src/auth/trusted-oauth-clients.ts
```

## Migration Checkpoints

### Phase 1: Prove Existing Invariants

- [x] Add auth tests for stale refresh write after sign-out.
  > Evidence: `packages/auth/src/contract.test.ts` covers `concurrent refresh shares one promise and signOut during refresh wins`. The test proves a refresh response that resolves after sign-out does not restore storage, bearer attachment, or signed-in state.
- [x] Add auth tests for stale `/api/me` key-update write after sign-out.
  > Evidence: `packages/auth/src/contract.test.ts` currently covers `/api/me key update after signOut is discarded without writing unlock`. Rename this during the clean break so it proves the rotated local identity is not written.
- [ ] Add a session test for same-user identity-bearing transitions.
- [ ] Add or update a test proving `reauth-required` keeps the workspace mounted.
- [ ] Add a transport test proving protected sync does not open an anonymous WebSocket when auth verification fails.

### Phase 2: Harden Auth Core

- [x] Fix stale storage writes in refresh and `/api/me` verification.
  > Evidence: `packages/auth/src/create-oauth-app-auth.ts` re-checks the started cell before and after storage writes, and the two Phase 1 stale-response tests cover refresh and `/api/me` local identity updates after sign-out.
- [x] Decide whether `AuthClient.signOut()` should await revoke in machine contexts or stay best effort everywhere.
  > Decision: keep storage-first sign-out plus best-effort revoke everywhere. Evidence: `packages/auth/src/contract.test.ts` covers `signOut clears cell and network pause even when revoke fails`; `packages/auth/src/node/machine-auth.test.ts` covers `logout survives revoke failure and still deletes the file`; `packages/cli/README.md` now says logout clears the local file first, then makes a best-effort RFC 7009 revoke call.
- [x] Share the OAuth token response parser across browser, extension, refresh, and OOB launchers.
  > Evidence: `packages/auth/src/oauth-token-response.ts` is used by `packages/auth/src/oauth-launchers/index.ts`, `packages/auth/src/node/oob-launcher.ts`, and `packages/auth/src/create-oauth-app-auth.ts`.
- [x] Import the bearer subprotocol prefix from `@epicenter/sync` or move it to a shared no-cycle package.
  > Evidence: `packages/constants/src/auth.ts` owns `BEARER_SUBPROTOCOL_PREFIX`; `packages/sync/src/auth-subprotocol.ts` re-exports it; `packages/auth/src/create-oauth-app-auth.ts` imports the same constant directly. This keeps the dependency direction clean.

### Phase 3: Harden Machine OOB

- [x] Fix OOB state semantics by copying `{ code, state }`, or remove the local state check language.
  > Evidence: `packages/auth/src/node/oob-launcher.ts` no longer sends an unverifiable `state` parameter in the OOB authorize URL. `packages/auth/src/node/oob-launcher.test.ts` asserts the authorize URL has no `state`.
- [ ] Replace the fixed auth temp path with a unique temp path.
- [ ] Decide self-hosted CLI callback registration. Either require explicit `redirectUri` for non-production `baseURL`, or seed trusted redirect URIs through setup.

### Phase 4: Align App Surfaces

- [ ] Treat `reauth-required` as signed-in for identity-bearing layouts.
- [ ] Make network-only controls show reconnect while local workspace controls remain usable.
- [ ] Keep profile queries in account surfaces, not auth state.
- [ ] Update stale docs that still show `auth.state.identity`, `OAuthSession`, `getToken`, or direct `openWebSocket: auth.openWebSocket` examples that contradict the current transport shape.
  > Partial evidence: `packages/cli/README.md` was updated so daemon route examples consume injected `auth` from `start({ auth })` instead of constructing route-local machine auth. Broader docs remain deferred.

### Phase 5: Sync Identity Cleanup

- [ ] Reconcile `20260513T083755-open-workspace-clean-break.md` with `20260513T220000-document-sync-and-identity-collapse.md`.
- [ ] Use `replica` for client-claimed presence.
- [ ] Use server-stamped `subject` for verified account identity.
- [ ] Do not put profile fields in awareness by default.

## Validation Plan

Run these after Phase 1 and again after Phase 2:

```bash
bun test packages/auth/src/contract.test.ts
bun test packages/auth/src/node/machine-auth.test.ts
bun test packages/workspace/src/document/local-owner.test.ts
bun test packages/workspace/src/document/open-collaboration.test.ts
```

Run these greps before any implementation PR is marked done:

```bash
rg -n "OAuthSession|AuthIdentity|WorkspaceIdentityStore|/workspace-identity|LocalUnlockBundle|auth\\.state\\.unlock|unlock\\.encryptionKeys" packages apps docs specs
rg -n "getToken\\(|bearerToken|auth\\.state\\.identity|auth\\.state\\.email" packages apps docs specs
rg -n "deviceAuthorization|deviceAuthorizationClient|device_code|deviceCode" packages apps docs specs
perl -ne 'print "$ARGV:$.:$_" if /[\x{2013}\x{2014}]/' specs/20260515T010000-auth-canonical-path-audit.md
```

Expected results:

```txt
No live package or app references to OAuthSession.
No live package or app references to AuthIdentity.
No live package or app raw token getter.
No live package or app device authorization machine path.
No profile fields on AuthState.
No live public `unlock` or `encryptionKeys` names after the clean break.
No em dash or en dash in changed files.
```

Historical specs may still contain rejected terms, but new implementation specs must point back here and say they are historical.

## Phase 1 Execution Evidence

Completed on 2026-05-15.

Falsification gate result:

```txt
No architecture-changing contradiction found.

Live contradictions found and handled:
1. Machine OOB generated state, but the paste flow only accepted code.
2. Logout docs implied guaranteed revoke, while code is storage-first plus best-effort revoke.
3. Auth and sync duplicated the bearer WebSocket subprotocol prefix.
4. Browser callback, OOB callback, and refresh parsed OAuth token responses separately.
5. CLI README daemon example constructed machine auth inside the route instead of consuming injected auth.

Live non-blocking findings deferred:
1. `apps/api` still has the historical `device_code` table and migration metadata, but no active device-authorization runtime path was found.
```

Implemented changes:

```txt
Canonical launch path count:
  3 launch paths: browser app, extension, machine OOB.
  1 shared runtime after launch.
  Daemon is not a fourth auth path.

Persisted auth naming decision:
  Historical Phase 1 decision kept PersistedAuth = { grant, unlock }.
  This naming pass supersedes that decision. Target shape is
  PersistedAuth = { grant, localIdentity }.

OOB state:
  packages/auth/src/node/oob-launcher.ts
    removed generated state from the OOB authorize URL because the CLI paste
    flow does not receive state back from the hosted callback page.

OAuth token parsing:
  packages/auth/src/oauth-token-response.ts
    added one shared parser for access_token, refresh_token, expires_in,
    and bearer token_type validation.
  packages/auth/src/oauth-launchers/index.ts
    browser and extension auth-code exchange use the shared parser.
  packages/auth/src/node/oob-launcher.ts
    OOB auth-code exchange uses the shared parser.
  packages/auth/src/create-oauth-app-auth.ts
    refresh uses the shared parser and keeps the previous refresh token
    when the refresh response omits rotation.

WebSocket bearer prefix:
  packages/constants/src/auth.ts
    owns BEARER_SUBPROTOCOL_PREFIX.
  packages/sync/src/auth-subprotocol.ts
    re-exports the shared prefix for server and sync callers.
  packages/auth/src/create-oauth-app-auth.ts
    imports the same shared prefix for client WebSocket construction.

Logout semantics:
  packages/cli/README.md
    now documents logout as local file clear first, then best-effort RFC 7009
    revoke.
  packages/auth/src/contract.test.ts
    covers local sign-out plus best-effort revoke failure.
  packages/auth/src/node/machine-auth.test.ts
    covers machine logout surviving revoke failure and deleting the file.

Daemon docs:
  packages/cli/README.md
    daemon route example now receives injected auth through start({ auth })
    and no longer calls createMachineAuthClient() inside the route.
```

Deferred changes:

```txt
Session tests:
  Same-user identity-bearing transition and reauth-required mounted-session
  tests remain deferred. The live implementation documents the invariant in
  packages/svelte-utils/src/session.svelte.ts, but this pass did not add a
  Svelte-runes test harness.

Protected sync anonymous WebSocket behavior:
  Deferred because changing openWebSocket failure behavior would alter the
  auth/sync contract. Current coverage proves bearer insertion waits for
  /api/me verification, not that protected sync rejects anonymous opens.

Machine temp-file collision:
  Deferred. packages/auth/src/node/machine-tokens-store.ts still uses a fixed
  .tmp path. That is Phase 3 hardening and not required for the Phase 1
  canonicalization pass.

Self-hosted CLI callback registration:
  Deferred pending the trusted-client setup decision.

Broader stale docs:
  packages/cli/README.md was fixed in the Phase 1 commit.
  A follow-up cleanup also removed the live tab-manager OAuthSession comment
  and the workspace README auth.state.identity example. Historical docs still
  contain rejected terms and old examples.
```

Commands run during Phase 1 execution:

```bash
bun install
bun test packages/auth
bun test packages/sync
rg -n "OAuthSession|AuthIdentity|WorkspaceIdentityStore|/workspace-identity|getToken\\(|bearerToken|auth\\.state\\.identity|auth\\.state\\.email|deviceAuthorization|deviceAuthorizationClient|device_code|deviceCode" packages apps -g '!**/*.test.ts' -g '!**/*.bench.ts'
rg -n "createMachineAuthClient\\(" packages apps docs -g '*.md' -g '*.ts' -g '!**/*.test.ts'
rg -n "const BEARER_SUBPROTOCOL_PREFIX = 'bearer\\.'|parseTokenResponse|readPositiveNumber|readOptionalString|readString\\(" packages/auth/src packages/sync/src packages/constants/src
LC_ALL=C perl -ne 'print "$ARGV:$.:$_" if /\\xE2\\x80[\\x93\\x94]/' packages/auth/src/create-oauth-app-auth.ts packages/auth/src/oauth-token-response.ts packages/auth/src/oauth-launchers/index.ts packages/auth/src/node/oob-launcher.ts packages/auth/src/contract.test.ts packages/auth/src/oauth-launchers/index.test.ts packages/auth/src/node/oob-launcher.test.ts packages/sync/src/auth-subprotocol.ts packages/sync/src/auth-subprotocol.test.ts packages/constants/src/auth.ts packages/cli/README.md specs/20260515T010000-auth-canonical-path-audit.md
```

Results:

```txt
bun install:
  Pass. Saved lockfile. Checked 1610 installs across 1690 packages.

bun test packages/auth:
  First run after adding the stale key-update test failed because the test
  temporarily referenced a removed helper. This was a test edit mistake.
  Final run passed: 50 pass, 0 fail, 159 expect calls.

bun test packages/sync:
  Pass: 27 pass, 0 fail, 52 expect calls.

apps/api tests:
  Not run because no apps/api auth code changed.

Live grep results:
  device_code remains only in DB schema and migration metadata.
  No live package or app OAuthSession, AuthIdentity, auth.state.identity,
  raw token getter, or device authorization machine path remains.

Dash check:
  Pass after replacing two existing dashes in packages/sync/src/auth-subprotocol.ts.
```

## Device Code Schema Residue Decision

Completed on 2026-05-15.

Falsification gate result:

```txt
No live route, Better Auth plugin config, client flow, CLI flow, daemon flow,
or non-historical app/package test uses Better Auth device authorization.

Pre-cleanup live API residue count:
  1 stale database table export: deviceCode in apps/api/src/db/schema.ts.
  20 matched strings across 4 files:
    apps/api/src/db/schema.ts: 5
    apps/api/drizzle/0000_equal_thor_girl.sql: 3
    apps/api/drizzle/meta/0000_snapshot.json: 6
    apps/api/drizzle/meta/0001_snapshot.json: 6

Post-cleanup live API residue count:
  0 live schema exports.
  0 live route, plugin, client, CLI, daemon, or test users.
  16 remaining repo matches across 4 migration-history files:
    apps/api/drizzle/0000_equal_thor_girl.sql: 3
    apps/api/drizzle/meta/0000_snapshot.json: 6
    apps/api/drizzle/meta/0001_snapshot.json: 6
    apps/api/drizzle/0002_salty_hex.sql: 1
```

Current evidence:

```txt
apps/api/src/auth/create-auth.ts
  Runtime plugins are jwt() and oauthProvider().
  deviceAuthorization() is not installed.

apps/api/src/app.ts
  /auth/* is the Better Auth catch-all.
  There is no /device page and no route that calls deviceCode, deviceToken,
  deviceApprove, or deviceDeny.

packages/auth/src/node/*
  Machine login uses OOB OAuth authorization code with PKCE through
  /auth/oauth2/authorize, /auth/cli-callback, /auth/oauth2/token, and /api/me.
  Machine logout revokes through /auth/oauth2/revoke.

packages/auth/src/create-oauth-app-auth.ts
  Shared auth uses authorization_code, refresh_token, /api/me, revoke,
  auth.fetch, and auth.openWebSocket. It has no device grant path.

packages/cli/README.md
  Public CLI docs describe the OOB OAuth 2.1 code flow and PersistedAuth.
```

Upstream ownership check:

```txt
Better Auth device authorization:
  deviceAuthorization() owns the deviceCode schema model and /device/*
  endpoints. The installed source defines the schema at
  node_modules/better-auth/dist/plugins/device-authorization/schema.mjs and
  merges it only from the deviceAuthorization plugin entrypoint.

Better Auth OAuth provider:
  oauthProvider() owns oauthClient, oauthRefreshToken, oauthAccessToken,
  and oauthConsent. The installed oauth-provider package does not reference
  deviceCode.

Drizzle migrations:
  drizzle-kit migrate applies new migration SQL according to the migration
  log. Editing 0000 or snapshot history would rewrite committed history.
```

Options:

| Option | Change | Risk | Decision |
| --- | --- | --- | --- |
| Keep residue | Leave schema and historical migrations as-is. | Low runtime risk, but the live schema exports a stale table. | Rejected after the local row count was confirmed empty. |
| Drop with migration | Remove `deviceCode` from `apps/api/src/db/schema.ts` and generate a new `DROP TABLE "device_code"` migration. | Destructive unless the target row count is proven empty and rollback is planned. | Chosen for local cleanup. Remote/prod migration still requires target row-count proof before running. |
| Ignore historical migration only | Remove the live schema export while keeping 0000 and meta history. | Drizzle will still see drift and likely wants a drop migration. This creates an unclear half-state. | Reject. It hides the table from code while leaving DB drift unresolved. |

Chosen path:

```txt
Drop with a new forward migration.

Remove the live schema export, keep historical migrations intact, generate
0002_salty_hex.sql, and apply that migration to the local API database after
confirming local device_code row count is 0.
```

Rollback story:

```sql
-- forward
DROP TABLE "device_code";

-- rollback
CREATE TABLE "device_code" (
  "id" text PRIMARY KEY NOT NULL,
  "device_code" text NOT NULL,
  "user_code" text NOT NULL,
  "user_id" text,
  "expires_at" timestamp NOT NULL,
  "status" text NOT NULL,
  "last_polled_at" timestamp,
  "polling_interval" integer,
  "client_id" text,
  "scope" text
);
```

Validation:

```bash
rg -n --hidden -S "deviceAuthorization|deviceAuthorizationClient|device_code|deviceCode|/auth/device|device\\.code|device\\.token|urn:ietf:params:oauth:grant-type:device_code|user_code" apps packages --glob '!**/node_modules/**'
rg --count-matches --hidden -S "deviceAuthorization|deviceAuthorizationClient|device_code|deviceCode|/auth/device|device\\.code|device\\.token|urn:ietf:params:oauth:grant-type:device_code|user_code" apps packages --glob '!**/node_modules/**'
bun x drizzle-kit check
bun test apps/api
```

Run the Drizzle command with `apps/api` as the current working directory.
Drizzle resolves `out: './drizzle'` from the current working directory, so
running the app config from the repo root can create a root `drizzle/meta`
artifact.

Results:

```txt
Live app/package grep:
  Only apps/api migration artifacts matched.

Residue count:
  apps/api/drizzle/0000_equal_thor_girl.sql: 3
  apps/api/drizzle/meta/0001_snapshot.json: 6
  apps/api/drizzle/meta/0000_snapshot.json: 6
  apps/api/drizzle/0002_salty_hex.sql: 1
  Total: 16 matched strings across 4 files.

Local row count:
  select count(*) from "device_code" returned 0 before the drop.

Generated migration:
  apps/api/drizzle/0002_salty_hex.sql contains only:
    DROP TABLE "device_code";

Local migration application:
  Applied apps/api/drizzle/0002_salty_hex.sql to the local API database.
  select to_regclass('public.device_code') returned null afterward.

Local database application note:
  Local dev uses db:push:local, not migrate. The local database already had
  the 0000 tables but an empty drizzle.__drizzle_migrations log, so a plain
  drizzle-kit migrate replayed 0000 and exited with code 1. The generated
  0002 SQL was applied directly after the empty row-count guard. Remote/prod
  migration was not run.

Drizzle migration check:
  Pass from the apps/api working directory. drizzle-kit check reported:
  Everything's fine.

Root Drizzle artifact:
  A first root-level check created drizzle/meta/_journal.json because the app
  config has out: './drizzle'. The artifact was removed. A follow-up check
  confirmed the root drizzle directory is absent.

apps/api tests:
  Pass. bun test apps/api ran 64 tests across 10 files.
```

## Rejected Alternatives

| Alternative | Refusal |
| --- | --- |
| Raw token getter on `AuthClient` | Refused. It leaks transport details and lets app code race refresh and verification. |
| Profile data in auth state | Refused. Profile is application data and can be queried where displayed. |
| `OAuthSession` compatibility shim | Refused. Old storage should fail validation and be ignored. |
| Better Auth device authorization machine path | Refused. OOB authorization code covers CLI, SSH, Docker, CI, and headless use with one token endpoint family. |
| Separate workspace identity store | Refused unless a real consumer needs independent identity persistence after auth storage is gone. No such consumer exists. |
| id-token-carried key material | Refused. Subject keyrings are local workspace capability material, not identity claims. |
| Cookie-first app resource auth | Refused for resource routes. Cookies remain for hosted login pages; app resources use OAuth bearer transport. |
| Clearing local Yjs data on auth failure | Refused. Local wipe is destructive and user-driven. |
| Awareness as verified identity | Refused. Awareness is client-claimed presence. Verified identity is server-stamped. |
| Daemon-specific auth state model | Refused. Daemon uses machine storage plus `createOAuthAppAuth`. |

## Open Questions

These are implementation choices, not architecture blockers:

1. Should protected sync reject anonymous `openWebSocket` attempts in auth or in workspace sync?
2. Should `createSession` rebuild on a different `localIdentity.subject`, or should auth guarantee a signed-out transition first?
3. Should self-hosted CLI login require explicit trusted-client setup, or should setup seed redirect URIs?
4. Should `/api/me` remain both network verification and account profile fetch, or should account profile get a separate route later?

Resolved during Phase 1 execution:

```txt
Machine logout does not await revoke. All logout remains storage-first and
revoke-best-effort.
```

## Pause Conditions

Pause implementation if any of these become true:

1. Better Auth OAuth provider cannot support the required OOB authorization-code path without unsafe client registration.
2. `/api/me` cannot derive encryption keys without adding profile data back into auth state.
3. A real product requirement needs simultaneous multi-account local identity in one runtime.
4. A migration would delete encrypted local Yjs data automatically.
5. A protected sync endpoint must accept anonymous WebSockets for a real shipping use case.
6. Self-hosted CLI login requires an unresolved product decision about trusted redirect registration.

## Commands Run

Local commands used while preparing this spec:

```bash
sed -n '1,240p' AGENTS.md
sed -n '1,260p' packages/auth/src/auth-contract.ts
sed -n '1,260p' packages/auth/src/auth-types.ts
sed -n '1,700p' packages/auth/src/create-oauth-app-auth.ts
sed -n '1,360p' packages/svelte-utils/src/session.svelte.ts
sed -n '1,260p' packages/workspace/src/document/local-owner.ts
sed -n '1,760p' apps/api/src/app.ts
sed -n '1,260p' apps/api/src/auth/create-auth.ts
sed -n '1,280p' apps/api/src/auth/resource-boundary.ts
sed -n '1,260p' apps/api/src/auth/single-credential.ts
sed -n '1,620p' packages/auth/src/contract.test.ts
sed -n '1,420p' packages/auth/src/node/machine-auth.ts
rg -n "(createOAuthAppAuth|createSession|AuthIdentity|OAuthSession|PersistedAuth|LocalUnlockBundle|openWebSocket|requireSignedIn|bearerToken|getToken|accessToken|local owner|localOwner|ownerId|userId)" packages apps specs/202605*.md specs/202604*.md
rg -n "\"(better-auth|@better-auth/oauth-provider|hono|yjs|y-protocols|y-indexeddb|svelte|@sveltejs/kit|@tauri-apps/plugin-opener|wxt|drizzle-orm|@libsql/client|@tanstack/ai|autumn-js|@tanstack/svelte-table|bits-ui|shadcn-svelte-extras)\"" --glob "package.json"
rg -n "(createSession\\(|auth\\.state\\.status|reauth-required|auth\\.fetch\\('/api/me'|openWebSocket: auth\\.openWebSocket|createLocalOwner|attachIndexedDb\\(|wipeLocalYjsData)" apps packages --glob "!**/*.test.ts"
sed -n '1,180p' /Users/braden/Code/ai/packages/react/src/use-chat.ts
sed -n '1,180p' /Users/braden/Code/ai/packages/openai/src/openai-provider.ts
sed -n '1,140p' /Users/braden/Code/ai/packages/provider/src/language-model/v1/language-model-v1.ts
```

External sources consulted:

```txt
Better Auth OAuth Provider docs
Cloudflare Durable Objects WebSockets docs
Hono middleware docs
Yjs document update docs
Yjs awareness and y-protocols docs
y-indexeddb docs
Svelte createSubscriber docs
SvelteKit load docs
Tauri opener docs
WXT storage docs
Drizzle Turso docs
Cloudflare Workers Turso docs
TanStack AI provider tools docs
jsrepo registry docs
Signal Sesame docs
Bitwarden log in vs unlock docs
shadcn-svelte installation docs
shadcn-svelte-extras introduction docs
TanStack Table Svelte state docs
Autumn usage tracking docs
```

## Key Hierarchy Audit Addendum

Completed on 2026-05-15. This addendum re-grills the persisted auth and local
workspace identity boundary against four candidate key hierarchies. The
conclusion confirms the existing spec: keep `RootKeyring -> SubjectKeyring ->
WorkspaceKeyring`. The other three hierarchies are recorded here so a future
reader can see what was rejected and why.

### Product Sentence Used For The Audit

```txt
Sign in once through hosted OAuth; the server derives a per-subject
keyring from a versioned root keyring and ships it inside the same
session response; the client persists subject + keyring; every workspace
key is HKDF-derived locally from that keyring; the server only sees
ciphertext and only authorizes by Better Auth user id.
```

Every layer added below this sentence must justify itself against this
sentence, not against speculative future product lines.

### Candidates Compared

| Candidate | Layers | Extra Storage | Extra Surface | Verdict |
| --- | --- | --- | --- | --- |
| A. Root -> Subject -> Workspace (current) | RootKeyring -> SubjectKeyring -> WorkspaceKeyring | none | 0 | Keep. Smallest design that explains every runtime today. |
| B. DeploymentRoot -> Subject -> Workspace | Rename A's top layer to make ownership explicit | none | ~8 type renames | Reject. "Root" matches Signal and Bitwarden vocabulary; the JSDoc already disambiguates ownership. The clarity win does not pay for the vocabulary churn. |
| C. Root -> Tenant -> Subject -> Workspace | Add a tenant HKDF step between root and subject | tenants table + per-tenant secret resolver | ~600-1000 LOC server, ~200 LOC client, new durable field on `SubjectKeyringEntry` or new HKDF info string | Reject. Adds an axis that does not exist in Epicenter's product vocabulary, locks in "what is a tenant" before any customer asks, and forces a breaking change to existing encrypted blobs. |
| D. CustomerKMS / TenantRoot -> Subject -> Workspace | Same shape as A but the root layer becomes a resolver backed by AWS KMS, GCP KMS, HashiCorp Vault, or a local HSM | resolver config | ~150 LOC abstraction; today's env-backed root is one implementation of the resolver | Defer. This is the only future layer worth the abstraction tax, but the right time to introduce it is when the first BYOK customer asks. Today, A is byte-compatible with D's "env" implementation. |

### Leak Scope Sanity Check

```txt
A  Root leak      every subject, every workspace
   Subject leak   every workspace for that subject
   Workspace leak only that workspace

C  Root leak      every tenant, every subject, every workspace
   Tenant leak    every subject inside that tenant
   Subject leak   every workspace for that subject
   Workspace leak only that workspace

D  KMS leak       every subject, every workspace (only via hostile control of
                  the customer's KMS; Epicenter Cloud DB leak alone leaks
                  zero key bytes)
```

C only buys defence in depth if tenants are physically isolated, which is
exactly the deployment story A already supports through self-hosting.

### Assumption Challenges Logged

```txt
Is tenant just deployment?
  Epicenter Cloud: tenant does not exist; users are the unit.
  Self-hosted: tenant == deployment exactly.
  Managed BYOK: tenant != deployment, but BYOK is candidate D, not C.
  Verdict: no live product requires C.

Is RootKeyring the right name?
  Yes. "Root" is the standard cryptography position name. Ownership is
  documented in JSDoc and in the "Security Model" section of this spec.

Should SubjectKeyring be persisted?
  Yes. Offline workspace open is a load-bearing product promise and requires
  local decrypt material. The asymmetric refusal of hosted zero-knowledge
  (Bitwarden's model) is recorded in the Security Model section.

Should workspace keys ever be stored?
  No. They are HKDF-derived at attach time and live only inside the
  workspace's Y.Doc lifetime.

Should org membership be cryptographic?
  No. Putting org id in HKDF info makes org renames and membership changes
  break decrypt. Sharing belongs in an ACL/wrap layer, not in derivation.

Are "user:{subject}" and "epicenter.v1.user" durable?
  Yes, until a re-encrypt or rename migration is scheduled. Both labels are
  durable in users' browsers and on machine daemons. Public types have
  already moved from `userId` to `subject` while these durable labels were
  intentionally pinned (`packages/encryption/src/derivation.ts:100`,
  `packages/workspace/src/document/local-yjs-key.ts:5`).
```

### Mechanical Vocabulary Cleanups Applied With This Audit

JSDoc-only edits, no runtime change, no HKDF labels, no IDB prefix:

```txt
packages/cli/src/commands/auth.ts          "local-unlock bundle" -> "local workspace identity"
packages/auth/src/auth-errors.ts           "cached `unlock`" -> "cached `localIdentity`"
packages/auth/src/node/oob-launcher.ts     "`unlock` section" -> "`localIdentity` section"
packages/workspace/src/document/attach-encryption.ts   "encryptionKeys()" -> "keyring()" (x2)
packages/workspace/src/document/attach-kv.ts           "{ encryptionKeys }" -> "{ keyring }"
packages/workspace/src/document/attach-table.ts        "{ encryptionKeys }" -> "{ keyring }" (x2)
```

The `LegacyPersistedAuth` migration in `packages/auth/src/auth-types.ts`
keeps the `unlock` and `encryptionKeys` field names because those are the
durable on-disk names being migrated away from; they intentionally outlive
the public-type rename.

### Residual Risks

```txt
1. Same-subject HKDF info string "user:{subject}" is durable in every
   encrypted Yjs blob. Any future rename requires either lazy re-encrypt
   on read with dual-info support or a one-shot re-encrypt wave.

2. IndexedDB prefix "epicenter.v1.user" is durable in every browser that
   has ever signed in. Renaming requires a database migration that uses
   indexedDB.databases() to find and rewrite by prefix.

3. Today's `RootKeyring` is bound to `cloudflare:workers` env access in
   `apps/api/src/auth/encryption.ts`. Introducing candidate D requires
   replacing that module-level parse with a resolver interface that
   degenerates to the env case. No durable-shape change.

4. DO name format `user:{userId}:rooms:{room}` is server-side identity
   only. It does not enter encryption derivation, so it can be renamed
   independently if a future product axis demands it.
```

### Tests Run In This Audit

```txt
None. This pass was code review, spec reasoning, and JSDoc text edits only.
No HKDF labels, blob layouts, durable prefixes, or runtime control flow
were changed, so no regression surface was created.
```

## Clean-Break Rename Wave

Completed on 2026-05-15. The branch was pre-production, so the durable strings
documented above as "future rename targets" were renamed in one wave instead
of deferred. This section records the new canonical names and the reasoning.

### Strings Renamed

| Surface | Before | After |
| --- | --- | --- |
| HKDF subject info | `user:{subject}` | `subject:{subject}` |
| HKDF workspace info | `workspace:{workspaceId}` | unchanged |
| IndexedDB prefix | `epicenter.v1.user.{s}.yjs.{guid}` | `epicenter.owner.{ownerId}.yjs.{guid}` |
| DO name format | `user:{userId}:rooms:{room}` | `subject:{subject}:rooms:{room}` |
| Public type | `LocalWorkspaceIdentity` | `SubjectIdentity` |
| Public type | `WorkspaceKeyring` (anonymous `Map<number, Uint8Array>`) | `WorkspaceKeyring` (named alias) |
| Public type | `ReadonlyWorkspaceKeyring` (new) | added |
| `/api/me` response | three duplicated `ApiMeResponse` schemas | one canonical `ApiMeResponse` in `@epicenter/auth` |
| Server helper | `resolveRequestWorkspaceIdentity` | `resolveRequestApiMe` |
| Server local type | `WorkspaceIdentity` (resource-boundary.ts) | deleted; uses `ApiMeResponse` |
| CLI display type | `WorkspaceIdentity` (machine-auth.ts) | `MachineIdentity` |

### Why No Version In The HKDF Info

The blob format byte (`blob[0]`) already discriminates derivation schemes. A
`v1` baked into the HKDF info string would have been redundant: any future
derivation change must bump the blob format version anyway, and the v2
decoder uses whatever info string the v2 scheme calls for. The clean-break
removes the redundancy.

The IndexedDB prefix similarly drops `v1`. The y-indexeddb database schema is
owned by the library; if a future change cannot live under the same prefix,
that change ships under a sibling prefix, not under an inner version segment.

### Why `subject:` For HKDF And `epicenter.owner.` For Storage

HKDF info strings are domain separators. Different inputs (root key vs
subject key) already cannot collide via info string; the info just needs to
distinguish the *step* from other steps that could use the same input. A
short `subject:{subject}` carries that meaning. A namespace prefix would buy
nothing because we never share root key material with other tools.

The IndexedDB prefix does benefit from the `epicenter` namespace because the
same browser profile can host multiple tools on the same origin. Inside that
namespace, `owner` describes the local persistence role. Session code passes
`localIdentity.subject` as `ownerId`; storage names do not need to expose the
auth term.

### Why DO Names Move To `subject:`

The previous spec argued for keeping `user:` in DO names because the DO is
server-side and `user.id` is server-side. The clean-break revisits that and
unifies on `subject` because the DO addresses the same workspace whose Yjs
data is encrypted under the subject-derived keys. Server-side DO names and
HKDF labels stay in auth vocabulary. Browser-local IndexedDB and
BroadcastChannel names use `owner` because their job is local persistence
isolation, not token identity. The abstraction boundary stays inside
`apps/api/src/auth/`, where Better Auth's `user` table is still the row
identity.

### Why `SubjectIdentity` Over `LocalWorkspaceIdentity`

The type is `{ subject, keyring: SubjectKeyring }`. Both fields use
"subject"; the keyring half is already `SubjectKeyring`. Pairing the type
name `SubjectIdentity` with `SubjectKeyring` makes the cryptographic intent
the dominant reading.

The persisted-cell field stays `localIdentity` because that field name
documents WHERE the data lives (cached client-side, offline-decryptable). The
type name documents WHAT it is (subject id plus subject keyring).

### Why The Canonical `ApiMeResponse` Lives In `@epicenter/auth`

Before this pass, `ApiMeResponse` was defined three times: once in
`packages/auth/src/create-oauth-app-auth.ts`, once in
`packages/auth/src/node/machine-auth.ts`, and once as
`WorkspaceIdentity` in `apps/api/src/auth/resource-boundary.ts`. All three
shapes were identical, but the duplication invited drift.

`@epicenter/auth` is imported by both the API server and every client, so it
is the natural home for the wire contract. The arktype + type pair exports
through the package barrel. Server, CLI, and browser all assert against the
same schema.

### Files Changed In The Rename Wave

```txt
packages/encryption/src/keys.ts                              add WorkspaceKeyring, ReadonlyWorkspaceKeyring
packages/encryption/src/blob.ts                              use ReadonlyWorkspaceKeyring
packages/workspace/src/document/derive-workspace-keyring.ts  return WorkspaceKeyring
packages/workspace/src/document/local-yjs-key.ts             drop v1 from IDB prefix
packages/workspace/src/document/local-owner.ts               drop v1 from wipe prefix
packages/workspace/src/document/local-owner.test.ts          update prefix expectations
packages/workspace/src/document/local-yjs-key.test.ts        update prefix expectations
packages/workspace/src/shared/y-keyvalue/y-keyvalue-lww-encrypted.ts  use ReadonlyWorkspaceKeyring
packages/auth/src/auth-types.ts                              add ApiMeResponse, rename SubjectIdentity
packages/auth/src/auth-contract.ts                           use SubjectIdentity
packages/auth/src/auth-state-store.ts                        use SubjectIdentity
packages/auth/src/create-oauth-app-auth.ts                   consume canonical ApiMeResponse
packages/auth/src/index.ts                                   export ApiMeResponse + SubjectIdentity
packages/auth/src/node/machine-auth.ts                       consume canonical ApiMeResponse, MachineIdentity
packages/auth/src/node.ts                                    export MachineIdentity
packages/auth-svelte/src/index.ts                            re-export ApiMeResponse + SubjectIdentity
apps/api/src/app.ts                                          subject: DO names, AuthUser in Env, resolveRequestApiMe
apps/api/src/auth/resource-boundary.ts                       consume canonical ApiMeResponse, resolveRequestApiMe
apps/api/src/room.ts                                         subject: DO parser, regex, error message
apps/api/src/api-me.test.ts                                  SubjectIdentity
packages/auth/src/contract.test.ts                           SubjectIdentity
```

### Tests Run

```bash
bun test packages/encryption packages/auth packages/workspace
# 660 pass, 0 fail, 1 todo, 1685 expect calls

bun test apps/api
# 61 pass, 0 fail, 201 expect calls

cd apps/api && bun run typecheck         # clean
cd packages/auth && bun run typecheck    # clean
cd packages/workspace && bun run typecheck    # clean
cd packages/encryption && bun run typecheck   # clean
cd packages/auth-svelte && bun run typecheck  # 0 errors, 1 warning (pre-existing)
cd packages/svelte-utils && bun run typecheck # 0 errors, 0 warnings
```

### Open Items After The Rename

```txt
1. App-level callers of `@epicenter/auth` still wired against the old type
   names will pick up the new names through the barrel re-export, but any
   app-local re-exports should be checked once during the next app pass.

2. The `WorkspaceIdentity` name is now only used as a regex match in old
   commit messages and historical specs. No live code references it.

3. The deprecated paragraphs in this spec (residual risks #1 and #2, and the
   "Why not the old names" table that lists `localWorkspaceIdentity` as too
   long) are superseded by this section. They are kept above for trail
   readability; new readers should treat this section as the current state.
```
