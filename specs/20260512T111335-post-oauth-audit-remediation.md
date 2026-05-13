# Post-OAuth Audit Remediation

**Date**: 2026-05-12
**Status**: In Progress (Phase 2 landed in working tree, Phase 3 superseded; Phase 1, 4, 5, 6 still live)
**Branch**: `codex/auth-bearer-omit-cookies`
**Depends on**: `specs/20260511T150000-final-oauth-auth-architecture.md`, `specs/20260512T100428-app-side-oauth-migration.md`
**Stack Map**: `specs/20260512T134603-auth-spec-stack-clean-break-map.md`
**Stack Position**: Immediate invariant patch after app migration.

## Audit (2026-05-12)

The live tree was audited against this spec. Result:

| Phase | Status | Notes |
| --- | --- | --- |
| 0 | Live | 0.3 (machine auth decision) still required before Phase 4. |
| 1 | Landed | `resolveRequestAppAccessTokenUser` enforces `workspaces:open`, returns an `InsufficientScope` error, and `createOAuthUnauthorizedResourceResponse` produces HTTP 403 / WS 4403 with `Bearer error="insufficient_scope" scope="workspaces:open"`. Coverage in `app-access-token-auth.test.ts` and `oauth-resource.test.ts`. The resolver now reads the Hono request directly instead of drilling a test-shaped dependency object. |
| 2 | Landed | Fuji and Honeycrisp child sync use `/documents/` as of `52e5e668e` (`fix(fuji,honeycrisp): point child doc sync at /documents`). |
| 3 | Superseded | Replaced by `specs/20260512T220000-session-two-axis-cohesive-reshape.md`. `Session<T>` is now `SessionPayload<T> \| null` and `createSession` disposes only on `signed-out` or different user. |
| 4 | Live | `packages/auth/src/node/machine-auth.ts` still calls dead `device.code`, `device.token`, and `getSession` paths. Server has no `deviceAuthorization()`. |
| 5 | Landed | `isWebSocketUpgrade(c)` makes the four upgrade-detection sites case-insensitive. `normalizeAppAccessToken` now rejects duplicate `bearer.*` entries and strips every `bearer.*` from `Sec-WebSocket-Protocol` before forwarding (deleting the header when nothing remains). Coverage in `app-access-token.test.ts`. |
| 6 | Live | Callback pages navigate on `startSignIn()` resolution without confirming `auth.state.status === 'signed-in'`. |

Highest-priority remaining items: **0.3** (machine auth decision) before Phase 4 code churn, then **Phase 5** (WebSocket credential normalization) as the next app access token route tightening now that Phase 1 sealed the HTTP path.

## One Sentence

Keep same-user local workspaces alive during temporary network auth failure, and require every app access token route to prove the OAuth scope it uses.

This is the cohesion test for the spec. Anything that does not protect local workspace lifetime or seal the OAuth protected resource boundary belongs in a sibling cleanup spec.

## Execution Shape

This is an invariant patch, not a general auth refactor.

```txt
LOCAL PLANE
  same-user workspace state stays mounted during reauth-required

NETWORK PLANE
  each app access token route verifies a scoped OAuth token

DRIFT PLANE
  clients call routes and auth surfaces that still exist
```

Do the work in this order when possible:

1. Seal the app access token route gate.
2. Fix route drift that blocks sync.
3. Preserve same-user local workspace lifetime during `reauth-required`.
4. Pick the machine auth path.
5. Tighten WebSocket normalization.
6. Polish callback and extension durability.

Refuse broad cleanup inside this spec. Billing, deployable split, token storage naming, and API middleware diet are sibling work unless a failing test proves they block one of the invariants above.

## Overview

The OAuth migration moved apps onto `auth.startSignIn`, `auth.fetch`, and `auth.openWebSocket`. That boundary is still the right shape, but the audit found five correctness gaps around it: app access token routes verify token validity without enforcing the required scope, machine auth still calls removed server endpoints, `reauth-required` destroys local workspaces, some child document sync clients call `/docs/*` while the API serves `/documents/*`, and WebSocket bearer normalization is not finished.

This spec fixes those gaps first. WebSocket origin checks, callback polish, extension launch durability, API middleware cleanup, and billing are included only when they directly affect the same auth boundary.

## Motivation

### Current State

`AuthClient` is intentionally small. Apps do not read raw tokens; they consume auth-owned capabilities.

```ts
type AuthClient = {
	state: AuthState;
	startSignIn(input?: { returnTo?: string }): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
	openWebSocket(url: string | URL, protocols?: string[]): Promise<WebSocket>;
};
```

`reauth-required` preserves identity and encryption keys:

```ts
type AuthState =
	| { status: 'signed-in'; identity: WorkspaceIdentity }
	| { status: 'reauth-required'; identity: WorkspaceIdentity }
	| { status: 'signed-out' };
```

But `packages/svelte-utils/src/session.svelte.ts` currently treats every non-signed-in state as a teardown signal:

```ts
if (state.status !== 'signed-in') {
	if (signedIn) {
		signedIn[Symbol.dispose]();
		signedIn = undefined;
	}
	return;
}
```

The API has two OAuth token verification paths:

```ts
// /workspace-identity
if (!hasScope(payload, WORKSPACES_OPEN_SCOPE)) {
	return { status: 'insufficient_scope', requiredScope: WORKSPACES_OPEN_SCOPE };
}

// app access token route middleware
const result = await resolveRequestAppAccessTokenUser(c);
if (result.status !== 'resolved') {
	return createOAuthUnauthorizedResourceResponse(c);
}
```

The first path checks `workspaces:open`; the second path only proves issuer, audience, and user existence. That second path guards `/ai/*`, `/workspaces/*`, `/documents/*`, `/api/billing/*`, and authed asset routes.

Machine auth also still calls endpoints removed by the OAuth cleanup:

```ts
plugins: [deviceAuthorizationClient()];
await authClient.deviceCode({ client_id: EPICENTER_CLI_OAUTH_CLIENT_ID });
await authClient.getSession({
	fetchOptions: {
		headers: { Authorization: `Bearer ${tokens.accessToken}` },
	},
});
```

The current server config installs `jwt()` and `oauthProvider()`, not `deviceAuthorization()` or `customSession()`.

Finally, Fuji and Honeycrisp child document sync still use `/docs/*`:

```ts
url: toWsUrl(`${APP_URLS.API}/docs/${ydoc.guid}`);
```

The API route is `/documents/:document`:

```ts
app.use('/documents/*', requireAppAccessToken);
app.get('/documents/:document', ...);
```

### Problems

1. **Scope is checked at boot, not at route use**: A token can pass app access token middleware without `workspaces:open` as long as it has the right issuer, audience, and subject.
2. **Machine auth is stale**: CLI login still depends on device and session endpoints that the live server no longer exposes.
3. **Local-first fallback is broken**: A refresh failure preserves identity in auth state but destroys the workspace that could use local IndexedDB data.
4. **Child document sync points at a dead route**: Rich-text child docs in Fuji and Honeycrisp can reconnect forever against `/docs/*`.
5. **WebSocket credential handling is only partly normalized**: `normalizeAppAccessToken` lifts the bearer subprotocol into `Authorization`, but the forwarded request can still carry the raw `bearer.*` entry.

### Desired State

```txt
OAuthSession
  user + encryptionKeys
  access token
  refresh token
        |
        v
AuthClient
  state
  fetch()
  openWebSocket()
        |
        v
App access token routes
  verify issuer
  verify audience
  verify required scope
  derive or load only what the route needs
```

`reauth-required` means local identity still exists and network auth needs repair. It must not mean signed out.

## Research Findings

### Better Auth

DeepWiki against `better-auth/better-auth` confirmed three points that matter here:

| Question | Finding | Spec impact |
| --- | --- | --- |
| Does `verifyAccessToken` enforce scopes automatically? | No. Scopes are enforced when the caller passes `opts.scopes`. | `resolveRequestAppAccessTokenUser` must request the required scope, or it must do an equivalent local scope check. |
| Does the OAuth provider expose refresh-token revocation? | Yes. The OAuth provider exposes `/oauth2/revoke`; revoking a refresh token also removes access tokens granted from it. | Machine logout should call the OAuth revoke endpoint instead of Better Auth `signOut` with a bearer header. |
| Are `/auth/device/code` and `/auth/device/token` always present? | No. They come from the separate device authorization plugin. | Machine login cannot call those endpoints unless the server installs that plugin again. |

Local installed source also shows `verifyAccessToken` checks `opts.scopes` only when provided in `node_modules/@better-auth/core/src/oauth2/verify.ts`.

### Cloudflare Workers and Hono

DeepWiki did not provide a definitive upstream rule for every WebSocket edge detail. It did confirm the shape that matters for this spec: validate before proxying to Durable Objects when possible, and avoid treating CORS middleware as WebSocket protection. The exact header-rewrite behavior should be proven with local tests around `normalizeAppAccessToken` and the Durable Object request path.

Decision class: local evidence plus design coherence, not upstream law.

### Yjs, y-indexeddb, and y-protocols

DeepWiki confirmed that keeping an existing `Y.Doc` mounted during network unavailability is sound. Yjs updates are designed for offline operation, IndexedDB persistence stores local updates, and sync providers can reconnect later with state-vector based catch-up.

The spec must still call out application-level pitfalls:

- Do not accept unauthenticated remote writes while local auth is broken.
- Distinguish IndexedDB loaded state from remote synced state.
- Reconnect sync with a fresh auth-owned WebSocket after auth repair.
- Do not destroy and recreate local docs just because network auth temporarily failed.

### SvelteKit and WXT

DeepWiki confirmed the general SvelteKit pattern: redirect only after an auth decision is known. These apps are static browser clients, so the local rule is the browser equivalent: do not navigate away from the callback page until `auth.state.status === 'signed-in'`. DeepWiki did not answer the WXT sidepanel versus background ownership question conclusively. Treat extension launch ownership as a design question to resolve with local WXT code and manual smoke tests, not as a fact from upstream docs.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Keep `AuthClient` as the app boundary | 2 coherence | Keep | The leak is around resource checks and lifecycle handling, not the public app contract. |
| Treat `reauth-required` as local-usable | 1 evidence, 2 coherence | Keep workspace payload mounted for the same user | Auth deliberately preserves identity and encryption keys. Yjs and IndexedDB support local work while offline. |
| Enforce `workspaces:open` on current app access token routes | 1 evidence | Pass `scopes: [WORKSPACES_OPEN_SCOPE]` to token verification or keep one equivalent canonical check | Better Auth only enforces scopes when asked. `/workspace-identity` already treats this scope as required. |
| Replace or restore machine login deliberately | 1 evidence | Choose one path before claiming CLI auth works | Device endpoints are absent unless the server installs the device plugin. `/auth/get-session` no longer returns workspace identity. |
| Change `/docs/*` child sync clients to `/documents/*` | 1 evidence | Update Fuji and Honeycrisp immediately | The API route is `/documents/:document`; `/docs/*` is dead. |
| Strip bearer WebSocket subprotocol after normalization | 2 coherence | Consume bearer once at the edge | `normalizeAppAccessToken` promises one canonical credential. Raw bearer material should not be forwarded beyond the app access token route middleware. |
| Do not add a static WebSocket `Origin` allowlist for bearer sync | 2 coherence, local evidence | Remove the helper idea | Sync is an OAuth protected resource. A valid scoped bearer token, not membership in the first-party `TRUSTED_ORIGINS` list, is the OAuth protected resource boundary. Unauthenticated upgrade load belongs to platform rate limits. |
| Defer billing remediation | 3 taste under constraint | Sibling spec | Billing issues are real, but they do not serve the one-sentence auth thesis. |
| Defer API middleware diet | 3 taste under constraint | Sibling spec | Route partitioning is useful but broad. Mixing it with auth fixes raises route-order risk. |

## Relationship To Adjacent Specs

| Source | Relationship | Conflict? |
| --- | --- | --- |
| `specs/20260511T150000-final-oauth-auth-architecture.md` | This spec enforces the same `AuthClient` boundary, `/workspace-identity`, `workspaces:open`, and `auth.openWebSocket` direction. | No. It is a follow-up hardening pass. |
| `specs/20260512T100428-app-side-oauth-migration.md` | That spec migrates apps onto OAuth. This spec fixes the audit gaps left after the migration. | No. It sharpens its `reauth-required` note. |
| `specs/20260512T114350-auth-token-capability-boundary.md` | That untracked sibling spec improves token vocabulary and storage ownership. This spec does not need that refactor to seal scope checks or preserve local lifetime. | No, but order matters. Run this invariant patch first unless the token shape refactor is already in flight. |
| `specs/20260504T233223-sign-out-preserves-local-data.md` | That spec says sign-out destroys the live workspace but preserves owner-scoped persisted data. This spec says same-user `reauth-required` keeps the live workspace mounted. | No. Sign-out is account exit; `reauth-required` is network repair for the same user. |
| `docs/encryption.md` | The doc still describes older names in places, including `/auth/get-session` and `bearerToken`. The current architecture moved identity to `/workspace-identity` and transport to `auth.openWebSocket`. | Documentation drift, not a design conflict. |

## Architecture

### Auth State and Workspace Lifetime

```txt
signed-out
  no identity
  no workspace payload

signed-in
  identity exists
  network auth can be used
  workspace payload is mounted
  sync may connect

reauth-required
  identity exists
  encryption keys exist
  workspace payload stays mounted
  sync is paused, failed, or reconnecting
  UI offers repair without hiding local data
```

The disposal rule is simple: dispose on signed out or different user, not on same-user network auth failure.

Expected session shape (as originally proposed by this remediation):

```ts
type Session<TSignedIn> =
	| { status: 'signed-out' }
	| { status: 'signed-in'; signedIn: TSignedIn }
	| {
			status: 'reauth-required';
			identity: WorkspaceIdentity;
			signedIn: TSignedIn;
	  };
```

> **Superseded.** `specs/20260512T220000-session-two-axis-cohesive-reshape.md`
> collapsed this three-state discriminator to `SessionPayload<T> | null` (no
> discriminant field) and pushed credential freshness back to `auth.state`.
> The runtime invariant (same-user `reauth-required` keeps local workspace
> mounted) is the same; the shape that delivers it changed. The current code
> in `packages/svelte-utils/src/session.svelte.ts` follows the nullable shape.

### Protected Resource Check

```txt
Request
  Authorization: Bearer access_token
        |
        v
normalizeAppAccessToken
  rejects ambiguous credentials
  lifts WS bearer into Authorization
        |
        v
resolveRequestAppAccessTokenUser
  parse bearer
  verify issuer
  verify audience
  verify required scope
  load user
        |
        v
route handler
  sees c.var.user
```

### WebSocket Credential Flow

```txt
Client
  sec-websocket-protocol: epicenter, bearer.ACCESS_TOKEN
        |
        v
Worker middleware
  reject duplicate credentials
  set Authorization: Bearer ACCESS_TOKEN
  strip bearer.ACCESS_TOKEN from sec-websocket-protocol
        |
        v
Durable Object
  sec-websocket-protocol: epicenter
```

## Implementation Plan

The phases below are ordered patches, not parallel feature tracks. Do not start with token storage renaming, billing, deployable split, or API route diet. Start where the product invariant is already broken.

| Order | Patch | Why this order |
| --- | --- | --- |
| 1 | App access token route scopes | Smallest revert-safe security fix. |
| 2 | `/docs/*` route drift | Obvious dead route that blocks child sync. |
| 3 | `reauth-required` lifetime | Preserves the local-first promise after the server boundary is sealed. |
| 4 | Machine auth | Requires a product decision before code churn. |
| 5 | WebSocket normalization | Same app access token gate, but higher handshake edge-case risk. |
| 6 | Callback and extension durability | Important polish after the core invariant is true. |

### Phase 0: Freeze Scope and Protect Existing Work

- [x] **0.1** Confirmed `apps/epicenter` does not exist in this checkout. The current deployable is `apps/api`. The target host is `apps/server` with `cloud-apps/` inside it, tracked under `specs/20260512T150000-cloud-modules-and-networks.md`. There is no `apps/cloud` deployable.
- [x] **0.2** Existing uncommitted work in `apps/api/src/app.ts`, `apps/fuji/src/routes/(signed-in)/fuji/browser.ts`, and `apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts` was preserved through the reshape that landed in `specs/20260512T220000-session-two-axis-cohesive-reshape.md`.
- [ ] **0.3** Update this spec with the exact machine-auth decision before implementing Phase 4. Recommended choice is still Option A (loopback PKCE), see Phase 4 commentary. Still live.

### Phase 1: Seal Current App Access Token Routes

- [x] **1.1** Update `resolveRequestAppAccessTokenUser` (`apps/api/src/auth/app-access-token-auth.ts`) to require `workspaces:open` for the currently mounted app access token routes (`/ai/*`, `/workspaces/*`, `/documents/*`, `/api/billing/*`, `/api/assets/*` in `apps/api/src/app.ts`). Return `InsufficientScope` when the token misses the required scope.
- [x] **1.2** Local `hasScope` check used by both `resolveRequestAppAccessTokenUser` and `resolveRequestWorkspaceIdentity`. Better Auth verifier `scopes` option was not used: the local check is already proven, it surfaces the exact missing scope to the caller, and it avoids speculating about distinguishable error shapes from the verifier.
- [x] **1.3** Extended `createOAuthUnauthorizedResourceResponse` (`apps/api/src/auth/oauth-resource.ts`) with a `failure` parameter. App access token middleware in `app.ts` now returns HTTP 403 (`Bearer error="insufficient_scope" scope="workspaces:open"`) and closes WebSocket upgrades with `4403 insufficient_scope` carrying the same body. `invalid_token` keeps its existing 401 / 4401 path as the default.
- [x] **1.4** `apps/api/src/auth/app-access-token-auth.test.ts` added with: valid scoped token, missing scope, wrong audience, wrong issuer, malformed bearer input, missing user. Run with `bun --cwd apps/api test`.
- [x] **1.5** JSDoc on `resolveRequestAppAccessTokenUser` rewritten to state the enforced scope.
- [x] **1.6** Inlined the old `ResolverDeps` adapter into the Hono-facing request resolvers. This keeps `Authorization`, `authBaseURL`, and `db` in the layer that already owns them. Tests now exercise the request resolver with a small context-shaped fake instead of preserving a pure helper only for testing independence.

Acceptance: `bun --cwd apps/api test` passes (56 pass / 0 fail at landing); `apps/api` and `apps/fuji` typechecks are clean.

### Phase 2: Fix Dead Sync Routes

- [x] **2.1** Fuji child document sync uses `/documents/${ydoc.guid}` (`apps/fuji/src/routes/(signed-in)/fuji/browser.ts:65`). Committed in `52e5e668e`.
- [x] **2.2** Honeycrisp child document sync uses `/documents/${ydoc.guid}` (`apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts:65`). Committed in `52e5e668e`.
- [x] **2.3** ~~Add a tiny route helper~~. Refused: two call sites do not justify the indirection; both already share `APP_URLS.API` and `toWsUrl`.
- [x] **2.4** Resolved as stale. No app-side sync URL test seam exists; the typed `AppType` consumed by `hc<AppType>` in the dashboard plus the API route handlers in `apps/api/src/app.ts:594-661` already pin `/documents/:document`. Reopen only if the URL string regresses.

### Phase 3: Preserve Local Workspaces During Reauth

> **Superseded by `specs/20260512T220000-session-two-axis-cohesive-reshape.md`.**
> That spec reshapes `Session<T>` to `SessionPayload<T> | null` (collapsing the
> three-state discriminator), renames `requireSignedIn` to `requireIdentity`,
> renames each app's `getSignedInSession` to `requireWorkspace`, and lands the
> same `reauth-required` workspace preservation invariant via one final
> migration pass instead of the hybrid shape proposed here. Do not implement
> the tasks below; the reshape spec covers them.

- [ ] ~~**3.1** Change `Session<TSignedIn>` so same-user `reauth-required` carries the current signed-in payload.~~ Superseded.
- [ ] ~~**3.2** Change `createSession.reconcile()` to dispose only on `signed-out`, different user, or an explicit app-owned reload boundary.~~ Superseded.
- [ ] ~~**3.3** Update Fuji, Honeycrisp, Opensidian, Tab Manager, Dashboard, and Zhongwen gates so workspace apps treat `reauth-required` as local-usable instead of signed out.~~ Superseded.
- [ ] ~~**3.4** Make reconnect actions call `auth.startSignIn()` or the app-owned repair path without remounting the workspace.~~ Superseded.
- [ ] ~~**3.5** Add tests proving `signed-in -> reauth-required -> signed-in` preserves the same payload instance.~~ Superseded.
- [ ] ~~**3.6** Add tests proving `signed-in user A -> signed-in user B` disposes the old payload and reloads or otherwise refuses the live switch.~~ Superseded.

Guardrail: do not keep a live workspace after real sign-out. This phase only changes same-user network auth failure.

### Phase 4: Repair Machine Auth

Current state of the live tree (still broken):

- `packages/auth/src/node/machine-auth.ts:31` installs `deviceAuthorizationClient()`.
- `loginWithDeviceCode` calls `authClient.deviceCode` (line 103) and `authClient.deviceToken` (line 255).
- `fetchOAuthSession` (line 328) still calls `authClient.getSession` and expects `WorkspaceIdentity` back.
- `logout` (line 207) calls `authClient.signOut` with a bearer header instead of `/auth/oauth2/revoke`.
- The server (`apps/api/src/auth/create-auth.ts:173-197`) installs only `jwt()` and `oauthProvider()`. No `deviceAuthorization()` plugin.
- `packages/constants/src/oauth.ts:74-78` still declares the `epicenter-cli` trusted client with `runtime: 'device'`.

Effect: `epicenter auth login` cannot complete; `status` cannot verify; `logout` cannot revoke. The CLI is shipped (`packages/cli`) but the path is dead.

Pick one option before editing. Do not leave both half-alive.

#### Option A: Loopback PKCE (recommended)

- [ ] **4A.1** Replace Better Auth device client usage in `packages/auth/src/node/machine-auth.ts` with an OAuth authorization-code-with-PKCE launcher suitable for CLI or daemon contexts. The launcher should reuse `createOAuthAppAuth` (`packages/auth/src/create-oauth-app-auth.ts`) and a Bun-side `OAuthSignInLauncher` that spins up a localhost listener, opens a browser, and exchanges the code at `/auth/oauth2/token`.
- [ ] **4A.2** Stop calling `authClient.getSession`. Use `loadIdentity()` against `/workspace-identity` (already shipped at `apps/api/src/app.ts:238-268`). Remove the `WorkspaceIdentity.assert(data)` path that consumes Better Auth session shape.
- [ ] **4A.3** Persist the `OAuthSession` shape via the existing `packages/auth/src/node/machine-session-store.ts`. No new key.
- [ ] **4A.4** On logout, call `revokeOAuthRefreshTokenWithEndpoint` (`packages/auth/src/create-oauth-app-auth.ts:325-352`) against `/auth/oauth2/revoke`. Drop the bearer `signOut` call.
- [ ] **4A.5** Rewrite `packages/auth/src/node/machine-auth.test.ts` to fake the PKCE exchange against `/auth/oauth2/token` and `/workspace-identity`. Remove the device-code test scaffolding.
- [ ] **4A.6** Change `packages/constants/src/oauth.ts:74-78` so the CLI client is registered as `runtime: 'native'` with a loopback `redirectUris` entry; update `apps/api/src/auth/trusted-oauth-clients.ts:86-96` accordingly so `toOAuthClientType` no longer reads `device`. Rebuild `bun --cwd apps/api test`.

#### Option B: Restore Device Authorization

- [ ] **4B.1** Reinstall Better Auth `deviceAuthorization()` in `apps/api/src/auth/create-auth.ts:173-197`.
- [ ] **4B.2** Confirm the device grant issues tokens that satisfy `workspaces:open` and `/workspace-identity`.
- [ ] **4B.3** Re-add the `/device` page and `db/schema.ts:96` `device_code` table integration (the schema is already there).
- [ ] **4B.4** Keep `runtime: 'device'` in the trusted-client config and add an integration-style test against the same plugin set production uses.

Recommended choice: **Option A**. The branch already removed the server-side device path; restoring it re-introduces a Better Auth surface the resource-scope model does not need. Loopback PKCE reuses `createOAuthAppAuth` and `/workspace-identity` end-to-end.

Acceptance: `bun --cwd packages/auth test` passes; running `epicenter auth login` from a fresh checkout completes against a dev `apps/api` and `epicenter auth status` returns `Session: verified`.

### Phase 5: Tighten WebSocket Auth

- [x] **5.1** Decision: no static `Origin` allowlist for bearer WS sync. Current code has no such gate (`apps/api/src/app.ts:121-130` skips CORS on upgrades and there is no separate WS origin check). Item resolved as "do not add."
- [x] **5.2** Shared `isWebSocketUpgrade(c)` helper at `apps/api/src/is-websocket-upgrade.ts` lowercases the `Upgrade` header before comparing to `websocket`. Used at the CORS bypass (`app.ts`), both `/workspaces/:workspace` and `/documents/:document` upgrade gates, and `createOAuthUnauthorizedResourceResponse`.
- [x] **5.3** `parseWsBearer` now collects every `bearer.*` subprotocol entry and returns a discriminated result; two or more entries throw `HTTPException(400, 'multiple_credentials')` from `normalizeAppAccessToken` instead of silently picking the first.
- [x] **5.4** After consuming a single bearer, `normalizeAppAccessToken` rewrites `Sec-WebSocket-Protocol` to drop every `bearer.*` entry (and removes the header entirely when no other entries remain) before downstream handlers and the DO `fetch` see the request. Raw credential material no longer crosses the middleware boundary.
- [x] **5.5** `app-access-token.test.ts` covers: protocol stripped when only a WS bearer is present, full header removed when no non-bearer entries remain, two `bearer.*` entries rejected as `multiple_credentials`, mixed-case `Upgrade: WebSocket` still strips and lifts, and path-scoped mounting leaves hosted auth routes untouched. Cookie-plus-bearer rejection is no longer part of this middleware.
- [x] **5.6** Folded into Open Questions item 3: default is client-side reconnect ahead of expiry; server-side close stays deferred.

### Phase 6: Callback and Extension Durability

- [ ] **6.1** Update callback pages so `goto('/')` only fires after `auth.state.status === 'signed-in'`. Today each callback page calls `auth.startSignIn()` and then redirects on `!error`, but `startSignIn` returns `Ok(undefined)` even when the launcher resolved with `null` (popup closed, no token grant). Files:
  - `apps/fuji/src/routes/auth/callback/+page.svelte:8-17`
  - `apps/honeycrisp/src/routes/auth/callback/+page.svelte:8-17`
  - `apps/opensidian/src/routes/auth/callback/+page.svelte:8-17`
  - `apps/zhongwen/src/routes/auth/callback/+page.svelte:8-17`
  - `apps/dashboard/src/routes/auth/callback/+page.svelte:8-17`
  After the `await auth.startSignIn()`, check `auth.state.status === 'signed-in'` before navigating; otherwise show a "Sign-in was cancelled" message and link back to home.
- [ ] **6.2** Extract a shared `runCallback(auth)` helper into `packages/svelte-utils` only after one app (recommend Fuji) ships the corrected flow and proves the shared shape. Defer.
- [ ] **6.3** Tab Manager `launchWebAuthFlow` currently lives in the sidepanel auth wiring (`apps/tab-manager/src/lib/platform/auth/auth.ts:49-57`) and `App.svelte:15-24` initiates it. Closing the sidepanel mid-flow strands the PKCE transaction in `browser.storage.session`. Decide: move the launcher into the background entrypoint, or make the sidepanel launcher resumable by persisting the PKCE state in `browser.storage.local` instead of `browser.storage.session`. Track decision on this spec; implementation is sized for a follow-up patch.
- [ ] **6.4** Stale until 6.1 lands. Once callback pages gate on `auth.state.status`, add a unit covering: `startSignIn` resolves to `Ok(undefined)` with `auth.state.status === 'signed-out'` (cancelled flow) and the callback page does NOT navigate. No separate "overlapping sign-in" coverage today; revisit if 6.3 unifies the launcher.

## Out of Scope

- Billing and credit accounting fixes. Real, but separate.
- API middleware diet and public-route database avoidance. Useful, but separate.
- Full shared sign-in UI replacement. Add it only if three app fixes prove the duplicated state machine is still too expensive.
- Per-message Yjs authorization. Start with connection auth and reconnect policy.
- Rewriting Better Auth or removing it. The issue is how Epicenter composes it, not that Better Auth exists.

## Edge Cases

### Refresh Fails While Offline

1. App has a cached `OAuthSession`.
2. Refresh fails because the network is unavailable.
3. Auth enters `reauth-required`.
4. Existing workspace payload remains mounted.
5. IndexedDB-backed local data remains visible.
6. Sync shows a repair state until reconnect succeeds.

### Same User Reauth Succeeds

1. App is in `reauth-required`.
2. User repairs auth.
3. OAuth returns tokens for the same user.
4. Existing workspace payload stays mounted.
5. Sync reconnects through `auth.openWebSocket()`.

### Different User Signs In

1. Workspace payload is mounted for user A.
2. OAuth returns identity for user B.
3. Session refuses the live switch, disposes user A payload, and reloads.
4. User A decrypted data is not kept in heap for user B.

### Under-Scoped Token Hits a Protected Route

1. Token has valid issuer and audience.
2. Token lacks `workspaces:open`.
3. HTTP route returns 403.
4. WebSocket route fails before Durable Object traffic starts.

### WebSocket Sends Duplicate Credentials

1. Request includes cookie plus bearer, HTTP bearer plus WS bearer, or multiple WS bearers.
2. `normalizeAppAccessToken` rejects the request.
3. Durable Object code never sees raw bearer material.

## Verification Plan

Run focused tests after each phase:

```bash
bun test apps/api/src/auth
bun test packages/auth
bun test packages/svelte-utils
bun --cwd apps/fuji run typecheck
bun --cwd apps/honeycrisp run typecheck
bun --cwd apps/tab-manager run typecheck
```

Manual smoke checks:

```txt
Fuji:
  sign in
  create an entry
  edit rich text body
  confirm child sync uses /documents/*
  force refresh failure
  confirm local entry remains visible

Honeycrisp:
  sign in
  create a note
  edit rich text body
  confirm child sync uses /documents/*
  force refresh failure
  confirm local note remains visible

Tab Manager:
  start sign-in from sidepanel
  close and reopen sidepanel during auth if possible
  confirm there is no stuck PKCE transaction
```

## Grill Pass

These are the questions that must stay answered as implementation proceeds.

1. **Is this one spec or several?** One spec for OAuth resource security plus local workspace lifetime. Billing and middleware diet are explicitly out of scope.
2. **What is the first revert-safe fix?** Scope enforcement on protected routes. It is small, testable, and does not require app UI changes.
3. **What is the highest-risk design choice?** Machine auth. The branch must pick loopback PKCE or restore device authorization before editing.
4. **What is the easiest bug to miss?** Treating `reauth-required` as signed out in an app layout after `createSession` is fixed.
5. **What upstream claim is weakest?** WebSocket header rewrite constraints. Prove locally with tests instead of citing DeepWiki as authority.
6. **What should be refused?** Billing cleanup in this spec. It is real work, but it does not serve the one-sentence thesis.

## Open Questions

1. Should all current protected routes use `workspaces:open`, or should AI, billing, and assets get narrower scopes before launch?
2. Is CLI/device login currently shipped to users? If yes, restore a working machine login path immediately. If no, delete or hide the stale surface until loopback PKCE lands.
3. Should WebSocket token expiry be enforced by client reconnect only, server close only, or both? Default proposal: client-side reconnect ahead of expiry via `auth.openWebSocket`'s fresh access token. Server-side close is deferred unless a malicious-client threat model is identified that the local-first product is willing to defend against at the DO boundary. Long-lived hibernated DOs are the case this question protects against.
4. Resolved: `apps/epicenter` is not a deployable. Use `apps/api` for current work. The target host is `apps/server` with Cloud Apps under `apps/server/src/cloud-apps`, tracked under `specs/20260512T150000-cloud-modules-and-networks.md`.

## Next Implementation Prompt

The highest-priority remaining item is Phase 1 (app access token route scope enforcement). The following is a self-contained prompt for the next implementation pass.

```txt
Goal
  Seal /ai/*, /workspaces/*, /documents/*, /api/billing/*, and /api/assets/*
  so they only accept OAuth access tokens that carry the workspaces:open
  scope. Today resolveRequestAppAccessTokenUser verifies issuer + audience + user but
  not scope, so a token issued for a different audience passes.

Files to edit
  apps/api/src/auth/app-access-token-auth.ts
    - Add 'insufficient_scope' variant to OAuthPrincipalResult (mirror
      resolveRequestWorkspaceIdentity in app-access-token-auth.ts).
    - Pass scopes: [WORKSPACES_OPEN_SCOPE] to verifyOAuthAccessToken. If the
      Better Auth verifier does not surface scope failure distinctly, copy
      the local hasScope() helper and use
      it after the verify step.
    - Replace the misleading JSDoc on resolveRequestAppAccessTokenUser.
      It must document that workspaces:open is enforced.

  apps/api/src/auth/oauth-resource.ts
    - Extend createOAuthUnauthorizedResourceResponse to accept a
      { reason: 'invalid_token' | 'insufficient_scope' } argument.
    - For insufficient_scope, HTTP returns 403 with
      `WWW-Authenticate: Bearer error="insufficient_scope" scope="workspaces:open"`,
      WebSocket closes with code 4403 and reason
      JSON.stringify({ code: 'insufficient_scope' }).
    - Keep the 401 / 4401 path for malformed and invalid.

  apps/api/src/app.ts
    - Update requireAppAccessToken to forward the new variant to
      createOAuthUnauthorizedResourceResponse.

  apps/api/src/auth/app-access-token-auth.test.ts  (new)
    - Model after the existing OAuth verifier setup.
    - Cover: valid scoped token, missing scope, wrong audience, wrong
      issuer, malformed bearer input, missing user.

Acceptance
  - bun --cwd apps/api test passes, including the new test file.
  - bun --cwd apps/fuji run build still typechecks.
  - Manual: against a dev apps/api, a token issued with scope `openid email`
    (no workspaces:open) hitting /workspaces/abc returns 403 with the
    insufficient_scope WWW-Authenticate header; a token issued with
    workspaces:open succeeds.

Out of scope
  - Do not touch /workspace-identity (already correct).
  - Do not touch normalizeAppAccessToken, machine auth, or callback pages. Those
    are tracked in later phases of this spec.
  - Do not introduce narrower scopes for AI/billing/assets. Open Question 1
    tracks that decision separately.
```
