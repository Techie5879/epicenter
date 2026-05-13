# OAuth Everywhere Auth Clean Break

**Date**: 2026-05-11
**Status**: Superseded. Do not execute directly.
**Author**: AI-assisted
**Branch**: `codex/auth-bearer-omit-cookies`
**Supersedes**: `specs/20260511T092357-auth-hosted-sign-in-clean-break.md`
**Superseded by**: `specs/20260511T150000-final-oauth-auth-architecture.md`

## Supersession Note

This spec is retained as migration history. Its OAuth-everywhere direction is
now folded into `specs/20260511T150000-final-oauth-auth-architecture.md`,
which also adds the accounts/resource origin split and the final machine-auth
boundary. Use the newer spec as the implementation source of truth.

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

## Current Worktree Handling

This branch already contains parts of the superseded credential-family implementation. Do not reset the branch wholesale. Treat the existing work as a staging area:

```txt
Salvage:
  packages/oauth-client PKCE and state machinery
  OAuth client ID constants and future trusted-client registry shape
  hosted auth page work
  Better Auth oauthProvider validAudiences setup
  app callback route experiments when they help OAuth code completion

Replace:
  POST /auth/oauth-session
  set-auth-token as an app runtime credential
  createCookieAuth versus createBearerAuth as the final public split
  public auth.bearerToken
  attachSync bearerToken getter
  protected app routes backed by Better Auth getSession()

Delete after replacement is covered:
  bridge endpoint tests
  app credential forms
  stale cookie-family and bearer-family docs
  stale AuthClient credential verbs
```

Foundation rule: build and prove the OAuth resource-server path before deleting the old bridge. The first code wave is server-only:

```txt
1. Add GET /auth/me.
2. Verify access tokens with oauthProviderResourceClient.
3. Load user by payload.sub.
4. Derive and return { user, encryptionKeys }.
5. Replace protected resource middleware with OAuth verification.
6. Keep Better Auth getSession() only on hosted auth and OAuth interaction pages.
```

## One-Sentence Thesis

Every Epicenter app is an OAuth client; Better Auth cookies exist only inside the hosted API auth server to complete login, consent, and account factors, never as an app runtime credential.

## Overview

This spec replaces the cookie-app versus bearer-app split with one app auth model. Apps start hosted sign-in, complete OAuth authorization code with PKCE, store an OAuth session, load Epicenter identity through `/auth/me`, and use auth-owned `fetch` and `openWebSocket` capabilities for protected resources.

The cleaner break is not "every app stores every credential forever." The break is narrower:

```txt
Hosted API auth server:
  Better Auth cookies
  email/password
  social login
  account recovery
  future MFA/passkeys
  OAuth authorize/consent/token endpoints

Every Epicenter app:
  OAuth access token
  OAuth refresh token
  cached AuthIdentity { user, encryptionKeys }
  no Better Auth session token
  no app-rendered credential form
```

## Motivation

### Current State

The shared auth surface still exposes credential methods to every app:

```ts
export type AuthClient = {
	readonly state: AuthState;
	readonly bearerToken: string | null;
	signIn(input: { email: string; password: string }): Promise<Result<undefined, AuthError>>;
	signUp(input: { email: string; password: string; name: string }): Promise<Result<undefined, AuthError>>;
	signInWithSocial(input: { provider: SocialProvider }): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
};
```

The server has a bridge endpoint that turns an OAuth access token back into a Better Auth session token:

```txt
POST /auth/oauth-session
  Authorization: Bearer <oauth access token>
  -> verify token
  -> find Better Auth session by sid
  -> return { user, encryptionKeys }
  -> set-auth-token: <Better Auth session token>
```

Protected API routes still rely on Better Auth session lookup:

```ts
const requireSession = factory.createMiddleware(async (c, next) => {
	const result = await c.var.auth.api.getSession({
		headers: c.req.raw.headers,
	});
	if (!result) return c.json(AiChatError.Unauthorized(), 401);

	c.set('user', result.user);
	c.set('session', result.session);
	await next();
});
```

Sync receives a raw token getter:

```ts
attachSync(doc, {
	url,
	bearerToken: () => auth.bearerToken,
});
```

That creates four problems.

1. App code still knows credential verbs.
2. Bearer clients still end up in Better Auth session-token world after OAuth.
3. Protected resources are not truly OAuth resource-server endpoints.
4. Sync reads a public token field instead of asking auth to open the transport.

### Desired State

The app-facing contract becomes transport-owned, not token-exposing:

```ts
export type AuthClient = {
	readonly state: AuthState;
	onStateChange(fn: (state: AuthState) => void): () => void;
	startSignIn(
		input?: { returnTo?: string },
		options?: { onUserCode?: (code: DeviceUserCode) => void },
	): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
	openWebSocket(url: string | URL, protocols?: string[]): Promise<WebSocket>;
	[Symbol.dispose](): void;
};
```

Apps do not decide whether the user enters email/password, signs up, uses Google, recovers access, or completes another factor. Apps only ask for an OAuth session.

`startSignIn` resolution semantics differ across launchers and the promise is not a "did sign-in finish" signal. It only confirms that the launcher's own portion completed:

- Redirect launchers (SvelteKit browser apps) navigate the page away. The function never resolves successfully because the page unloads mid-flight. Completion happens on the callback URL when the auth client constructor exchanges the code, persists `OAuthSession`, and transitions state to `signed-in`.
- Extension and device launchers resolve `Ok(undefined)` after tokens land and state transitions.

App code must observe `auth.state.status === 'signed-in'` to know if sign-in finished, never the return of `startSignIn`.

## Asymmetric Win

Product sentence:

```txt
Epicenter apps authenticate through hosted sign-in and use OAuth credentials to access Epicenter resources.
```

Candidate refusal:

```txt
Same-origin or same-site browser apps can use Better Auth cookies directly.
```

Code family it deletes:

```txt
createCookieAuth
cookie identity persistence
cookie app versus bearer app docs
cookie protected-resource branch
hybrid /auth/me question
auth.bearerToken
set-auth-token rotation on app fetches
Better Auth bearer plugin as app credential
```

User loss:

```txt
Browser apps store OAuth credentials in app storage instead of relying on
HttpOnly cookies. XSS impact is worse than cookie-only auth, but Epicenter apps
already hold local workspace data and encryption keys client-side. XSS is
already a serious compromise.
```

Decision:

```txt
Refuse cookie app auth. The app model becomes one OAuth model. Better Auth
cookies remain inside the auth server, where they are strongest and least
confusing.
```

## Research Findings

### Local Source Shape

`apps/epicenter` does not exist in this checkout. This spec treats `apps/api`,
the SvelteKit app family, `apps/tab-manager`, and the local auth and sync
packages as the Epicenter app surface.

`apps/api/src/app.ts` is a Hono app with ordered middleware:

```txt
cors
db connection and afterResponse queue
createAuth per request
singleCredential
routes
```

Specific routes matter:

```txt
/sign-in
/consent
/device
/auth/oauth-session
/auth/*
/.well-known/openid-configuration/auth
/.well-known/oauth-authorization-server/auth
protected app routes
```

The current protected route middleware calls Better Auth `getSession()`. In the
OAuth-everywhere target, app resources must instead validate OAuth access
tokens as resource-server requests.

### Better Auth 1.5.6

The installed package is `@better-auth/oauth-provider@1.5.6`. Its public export
map exposes the resource helper at:

```ts
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
```

The dist file is named `dist/client-resource.d.mts`, but the public subpath is
`resource-client`.

`oauthProviderResourceClient(...).getActions().verifyAccessToken()` is the
resource-server helper. With an auth instance it can fill issuer and JWKS data,
but `/auth/me` and protected resource middleware must still pass an audience:

```ts
await resource.getActions().verifyAccessToken(token, {
	verifyOptions: { audience: authBaseURL },
});
```

Better Auth token creation has two sharp edges:

```txt
Refresh token:
  Returned only when scopes include offline_access.

JWT access token:
  Returned when the token request includes resource and JWT plugin is enabled.
  Without resource, Better Auth creates an opaque access token.
```

Therefore every app sign-in must request:

```txt
scope = "openid profile email offline_access"
resource = <api base URL>
```

Every refresh request must also include:

```txt
grant_type = refresh_token
client_id = <app client id>
refresh_token = <current refresh token>
resource = <api base URL>
```

Better Auth rotates refresh tokens. If a revoked refresh token is reused, the
provider deletes the refresh tokens for that user and client pair. The client
must persist rotated tokens before retrying the request that needed refresh.

### Hono and Cloudflare Workers

The API already uses Hono middleware and route ordering as the boundary. This is
the right place to install an OAuth resource middleware because all protected
routes already flow through `app.use('/ai/*', ...)`, `app.use('/workspaces/*', ...)`,
`app.use('/documents/*', ...)`, billing routes, and authed asset routes.

Cloudflare WebSocket upgrades are handled before Durable Object dispatch. The
API currently rejects unauthenticated WebSocket upgrades by returning a 101 with
a socket that immediately closes with code 4401. That structure can stay, but
the auth decision must come from OAuth access-token verification, not Better
Auth `getSession()`.

### SvelteKit, WXT, and Tauri

The launcher differs by runtime, but the token contract should not:

```txt
SvelteKit browser app:
  redirect to hosted authorize URL
  finish through /auth/callback

WXT extension:
  browser.identity.launchWebAuthFlow
  extension callback URL
  PKCE transaction in chrome.storage.session

Tauri:
  deep link, loopback, or device-style launcher
  same token response shape after completion
```

The launcher owns only the OAuth dance. It does not own refresh, identity
loading, or WebSocket auth. Those belong to `@epicenter/auth`.

### Yjs Sync

`packages/workspace/src/document/attach-sync.ts` opens a WebSocket, sends the
Yjs sync handshake, runs awareness and RPC over the same connection, and
reconnects with backoff after transport failure. The current token hook is lazy
on reconnect, but it is still a token leak from auth into sync.

The clean boundary is:

```txt
sync owns:
  Yjs protocol
  awareness
  RPC
  reconnect loop

auth owns:
  access token freshness
  refresh
  WebSocket subprotocol auth
```

`attachSync` should receive an `openWebSocket` capability, not a bearer token
getter.

### Broader References

The external repositories are grounding references, not all load-bearing
implementation inputs. The load-bearing sources for this spec are local API and
auth code, installed Better Auth source, Hono route structure, Cloudflare
Workers WebSocket behavior, SvelteKit/WXT/Tauri launcher constraints, and Yjs
sync protocol ownership.

Security-oriented projects like Signal and Bitwarden are useful pressure tests:
do not put encryption key material into a signed JWT just to delete `/auth/me`.
Keep key delivery explicit and app-owned.

## Architecture

### Before

```txt
App UI
  |
  +-- email/password/sign-up/social provider
  |
  v
AuthClient
  |
  +-- createCookieAuth
  |     -> Better Auth cookie session
  |     -> useSession/customSession
  |
  +-- createBearerAuth
        -> OAuth code + PKCE
        -> /auth/oauth-session
        -> Better Auth bearer session token
        -> set-auth-token rotation
        -> auth.bearerToken exposed to sync
```

### After

```txt
App UI
  |
  | startSignIn()
  v
Hosted API Auth Server
  |
  +-- /sign-in owns credentials and account factors
  +-- Better Auth cookie proves user to /oauth2/authorize
  +-- /oauth2/token returns OAuth tokens
  |
  v
App Auth Client
  |
  +-- stores OAuthSession
  +-- calls /auth/me for AuthIdentity
  +-- fetch() attaches fresh access token
  +-- openWebSocket() attaches fresh access token as subprotocol
```

### Server Boundary

```txt
Public auth server routes:
  /sign-in
  /consent
  /device
  /auth/*
  /.well-known/*

OAuth app identity route:
  GET /auth/me
    verify OAuth access token
    load user by payload.sub
    derive encryption keys
    return { user, encryptionKeys }

Protected app resource routes:
  /ai/*
  /workspaces/*
  /documents/*
  /api/billing/*
  /api/assets/*
    verify OAuth access token
    set c.var.user
    do not depend on Better Auth session token
```

### Client Session

```ts
export type OAuthSession = {
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAt: number;
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};
```

The app can boot offline from a cached complete `OAuthSession`. Network calls
refresh when online. If the refresh token is expired or revoked, the app
transitions to `reauth-required` and asks the user to sign in again without
clearing local workspace data.

Clearing an `OAuthSession` is not the same operation as wiping local workspace
data. Clearing the session removes tokens and cached identity material from auth
storage. Wiping local workspace data deletes persisted Yjs updates. Token expiry,
refresh failure, and WebSocket auth rejection may clear or repair network
credentials, but they must not wipe local workspace data.

### Offline Auth Invariants

Offline editing is not an exception to OAuth everywhere. It is the local-first
half of the same model: cached identity unlocks local data, while OAuth tokens
authorize network resources.

```txt
Cached OAuthSession:
  proves who owns local encrypted workspace data
  provides user and encryptionKeys for offline boot

Fresh OAuth access token:
  proves the current process may call API resources
  required for fetch and WebSocket sync

Refresh token:
  repairs network auth when online
  failure pauses sync, not local editing
```

Auth failure must not delete unsynced local Yjs updates. A failed refresh,
expired refresh token, or 4401 WebSocket auth close moves the app into
`reauth-required`: local workspace data stays available, network transport is
paused, and the next successful same-user OAuth login resumes sync. If login
returns a different user, the app must not sync the cached workspace under that
new identity.

## Proposed API

### Auth Client

```ts
export type AuthState =
	| { status: 'pending' }
	| { status: 'signed-out' }
	| { status: 'signed-in'; identity: AuthIdentity }
	| { status: 'reauth-required'; identity: AuthIdentity };

export type AuthClient = {
	readonly state: AuthState;
	onStateChange(fn: (state: AuthState) => void): () => void;
	startSignIn(
		input?: { returnTo?: string },
		options?: { onUserCode?: (code: DeviceUserCode) => void },
	): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
	openWebSocket(
		url: string | URL,
		protocols?: string[],
	): Promise<WebSocket>;
	[Symbol.dispose](): void;
};

export type DeviceUserCode = {
	userCode: string;
	verificationUriComplete: string;
	expiresIn: number;
};
```

No public `bearerToken`. No public cookie family. No public credential verbs.

`startSignIn`'s promise resolution is not a sign-in completion signal. For redirect launchers it never resolves successfully (the page unloads). For extension and device launchers it resolves `Ok(undefined)` after tokens land and state transitions. App code observes `auth.state.status === 'signed-in'` for completion. The `onUserCode` callback is only invoked by device-flow launchers and is ignored by redirect and extension launchers.

### OAuth Launcher

```ts
export type HostedSignInLauncher = {
	begin(
		input: {
			returnTo?: string;
			scope: string;
			resource: string;
		},
		options?: {
			onUserCode?: (code: DeviceUserCode) => void;
		},
	): Promise<Result<HostedSignInTokens | null, unknown>>;
};

export type HostedSignInTokens = {
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresIn: number;
};
```

The launcher returns tokens or `null` for redirect-away flows. It does not load
identity, persist app sessions, refresh tokens, or open WebSockets.

### Fetch Refresh

```txt
auth.fetch(request)
  -> ensure access token is fresh enough
  -> attach Authorization: Bearer <accessToken>
  -> if 401:
       refresh once with resource
       await sessionStorage.set(rotated session)
       retry once
  -> if still 401 or refresh fails:
       preserve cached identity and encryptionKeys
       transition reauth-required
       stop network auth until sign-in repairs the session
```

### WebSocket Opening

```txt
auth.openWebSocket(url, protocols)
  -> ensure access token is fresh enough
  -> await any required refresh persistence
  -> new WebSocket(url, [
       ...protocols,
       "bearer.<accessToken>",
     ])
```

`attachSync` changes from:

```ts
attachSync(doc, {
	url,
	bearerToken: () => auth.bearerToken,
});
```

To:

```ts
attachSync(doc, {
	url,
	openWebSocket: auth.openWebSocket,
});
```

The spec explicitly refuses mid-connection token expiry enforcement for now.
WebSocket auth is checked at connection time. A live socket may outlast the
access token used to open it. Every reconnect gets a fresh token first.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| App credential model | 2 coherence | OAuth everywhere | One app auth model deletes cookie versus bearer branching. |
| Hosted credential entry | 2 coherence | Hosted `/sign-in` only | Account factors belong to the auth server boundary. |
| Better Auth cookies | 2 coherence | Auth server internal only | Cookies are still useful for `/sign-in` and `/oauth2/authorize`, but apps do not consume them as runtime credentials. |
| Resource credential | 1 evidence | OAuth access token | Better Auth ships `oauthProviderResourceClient.verifyAccessToken` for resource-server validation. |
| Resource helper import | 1 evidence | `@better-auth/oauth-provider/resource-client` | Installed package export map exposes this public subpath. |
| Refresh scope | 1 evidence | Require `offline_access` | Better Auth returns refresh tokens only when scopes include `offline_access`. |
| Token audience | 1 evidence | Always pass `resource` | Better Auth creates JWT access tokens for requested resource audiences; otherwise access tokens can be opaque. |
| `/auth/me` | 2 coherence | Keep | The app needs `{ user, encryptionKeys }`. Do not put encryption keys in signed JWT claims. |
| `/auth/oauth-session` | 2 coherence | Delete | It is the bridge back into Better Auth session-token world. |
| Protected route auth | 2 coherence | OAuth resource middleware | App resources should validate app credentials directly. |
| Public `bearerToken` | 2 coherence | Delete | Auth owns credential freshness and transport attachment. |
| Offline reauth | 2 coherence | Pause sync, keep local data | Token failure is a network-auth problem, not a local-data deletion event. |
| Same-user repair | 2 coherence | Required before sync resumes | Cached local workspace updates must not sync under a different user identity. |
| WebSocket expiry | 3 taste | Check at connection time | Mid-socket expiry enforcement adds timers, close scheduling, and recovery semantics for little product value. |
| Tauri launcher | Deferred | Decide later | Deep link, loopback, and device-style flows all fit the same token contract. |

## Implementation Plan

Use Build, Prove, Remove ordering even if this lands as one PR. The codebase may
be temporarily broken between commits, but deletion should happen after the new
path has tests and app imports have moved.

### Phase 1: Server OAuth Resource Foundation

- [ ] **1.1** Replace `POST /auth/oauth-session` with `GET /auth/me`.
  > Foundation progress: `GET /auth/me` now exists beside the old bridge and protected app resources use it through the shared OAuth identity resolver. The old bridge is still mounted until later app migration and removal waves.
- [x] **1.2** Import `oauthProviderResourceClient` from `@better-auth/oauth-provider/resource-client`.
  > Note: the implementation uses the no-auth resource client form with explicit `issuer`, `audience`, and `jwksUrl`. Passing the configured Better Auth instance hit an upstream generic mismatch during API typecheck.
- [x] **1.3** Implement `verifyOAuthAccessToken(c)` that extracts `Authorization: Bearer`, verifies audience, requires `payload.sub`, and loads the user.
  > Note: this lives in `apps/api/src/auth/me.ts` as `resolveOAuthIdentity(...)` so the route and tests can share the resource-server boundary.
- [x] **1.4** Add `/auth/me` tests for valid token, wrong audience, expired token, missing user, and missing bearer header.
  > Verified with `bun test apps/api/src/auth/me.test.ts`.
- [x] **1.5** Replace `requireSession` for app resource routes with `requireOAuthUser`.
  > App resources under `/ai/*`, `/workspaces/*`, `/documents/*`, `/api/billing/*`, and authenticated `/api/assets/*` now validate OAuth access tokens with audience and issuer checks.
- [x] **1.6** Keep Better Auth `getSession()` only on hosted auth pages and OAuth interaction pages.
  > API route scan now leaves `getSession()` only in `/sign-in`, `/consent`, and `/device`. `/auth/oauth-session` remains mounted for compatibility but is not used by protected app resources.
- [x] **1.7** Test WebSocket upgrade rejection still returns close code 4401 for invalid OAuth credentials.
  > Verified with `bun test apps/api/src/auth/me.test.ts apps/api/src/auth/oauth-resource.test.ts apps/api/src/auth/oauth-metadata.test.ts`.

### Phase 2: Trusted OAuth Client Registry

- [x] **2.1** Replace `EPICENTER_OAUTH_PUBLIC_CLIENTS` with `EPICENTER_TRUSTED_OAUTH_CLIENTS`.
- [x] **2.2** Include every current app that needs auth: dashboard, fuji, honeycrisp, zhongwen, opensidian, tab-manager, and CLI/device clients where applicable. Future desktop clients remain deferred until a Tauri auth wave needs them.
- [x] **2.3** Store per-client facts only: `clientId`, `name`, `runtime`, `redirectUris`.
- [x] **2.4** Project registry entries into Better Auth OAuth client rows with `skip_consent`, public client auth, authorization-code grant, PKCE, and allowed scopes including `offline_access`.
- [x] **2.5** Wire `cachedTrustedClients` only as a cache for DB-backed trusted clients, not as a replacement for client metadata.
- [x] **2.6** Test trusted clients skip consent and unknown clients do not.
  > Verified trusted-client behavior with `bun test apps/api/src/auth/trusted-oauth-clients.test.ts`. `bun run --filter @epicenter/api typecheck` passed before the separate dirty auth-session rename appeared; the current full-tree rerun is blocked by that unstaged auth-session work.

### Phase 3: OAuth Launcher Package

- [x] **3.1** Rename public concepts away from social/provider names.
- [x] **3.2** Require `scope: "openid profile email offline_access"` for app sign-in unless a caller deliberately narrows it.
- [x] **3.3** Send `resource` on authorization-code exchange.
- [x] **3.4** Parse and require `access_token`, `refresh_token`, and `expires_in`.
- [x] **3.5** Keep browser, extension, and future Tauri launchers as platform adapters returning the same token shape.
- [x] **3.6** Tests: PKCE, state mismatch, callback error, missing refresh token, missing expires_in, resource parameter.
  > Verified with `bun test packages/oauth-client/src` and `bun run --filter @epicenter/oauth-client typecheck`.

### Phase 4: Auth Core

- [x] **4.1** Replace `createCookieAuth` and `createBearerAuth` with one OAuth app auth factory.
- [x] **4.2** Remove `AuthClient.signIn`, `signUp`, `signInWithSocial`, `SocialProvider`, and `bearerToken`.
- [x] **4.3** Add `startSignIn`, `fetch`, and `openWebSocket`. `startSignIn`'s promise must not be treated as a sign-in completion signal; document explicitly that callers observe `auth.state` for completion.
- [x] **4.4** Store `OAuthSession` with `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `user`, and `encryptionKeys`.
- [x] **4.5** Implement refresh with `resource` and awaited `sessionStorage.set`.
- [x] **4.6** Refresh proactively before requests or socket opens when near expiry. Use reactive 401 retry for fetch correctness.
- [x] **4.7** On refresh failure, preserve cached identity and encryption keys, transition to `reauth-required`, and pause network transports.
- [x] **4.8** Sign out by revoking the refresh token where possible, then clearing the OAuth session only when the user explicitly signs out.
  > Auth core now posts the refresh token to `/auth/oauth2/revoke` with `client_id` and `token_type_hint=refresh_token`, then clears local storage even if best-effort revocation fails.
- [x] **4.9** Tests: begin sign-in, `/auth/me` identity load, refresh atomicity, 401 retry, refresh failure, reauth-required local unlock, sign out, openWebSocket token attachment.
  > Sign-out coverage now includes refresh-token revocation, revocation failure, and the default revoke endpoint request body.
- [x] **4.10** Wave 3.5 auth core state collapse.
  > Implemented by `specs/20260511T140228-auth-core-state-collapse.md`. `accessTokenExpiresAt` now controls transport refresh only, expired cached `OAuthSession` boots signed-in, refresh failure and refreshed 401 rejection preserve cached identity and storage, stale refresh writes are epoch-guarded, machine auth storage failures propagate, and `Request` inputs with bodies retry through fresh clones.

### Phase 5: Sync Boundary

- [x] **5.1** Change `attachSync` config from `bearerToken?: () => string | null` to `openWebSocket?: (url, protocols) => Promise<WebSocket> | WebSocket`.
- [x] **5.2** Keep the default `new WebSocket(url, protocols)` for unauthenticated or test transports if needed.
- [x] **5.3** Ensure `attemptConnection()` awaits the opener before wiring handlers.
- [x] **5.4** Preserve reconnect backoff, liveness, awareness, and RPC behavior.
  > Verified by keeping the existing lifecycle, awareness, and RPC tests green while adding opener retry and reconnect coverage.
- [x] **5.5** Report auth close 4401 to the app/session binding so it can enter `reauth-required`; `attachSync` does not own `AuthState`.
  > `attachSync` still surfaces 4401 as `status.phase === 'failed'` with an auth reason. It does not import or mutate auth state.
- [x] **5.6** Tests: opener called on every reconnect, opener failure retries, auth close 4401 can be reset by same-user reauth plus `reconnect()`.
  > Verified with `bun test packages/workspace/src/document/attach-sync.test.ts`.

### Phase 6: Apps

- [ ] **6.1** Replace all app credential forms with one sign-in action calling `auth.startSignIn({ returnTo })`. UI gates on `auth.state.status`, not on the `startSignIn` promise.
- [ ] **6.2** Give every browser app a callback route or static fallback compatible with its SvelteKit deployment mode.
- [ ] **6.3** Wire tab-manager through `browser.identity.launchWebAuthFlow` and persist PKCE transaction data to `chrome.storage.session`.
- [ ] **6.4** Leave Tauri implementation deferred unless a Tauri app needs auth in this PR.
- [ ] **6.5** Update AI chat, billing, assets, workspace, and document consumers to use `auth.fetch` or auth-backed sync only.

### Phase 7: Remove Old Paths

- [x] **7.1** Verify typecheck and targeted tests pass.
- [ ] **7.2** Smoke sign-in for one browser app and tab-manager.
- [ ] **7.3** Smoke WebSocket sync reconnect after forced refresh.
- [ ] **7.4** Delete `createCookieAuth`, Better Auth bearer app-session handling, `/auth/oauth-session`, `set-auth-token` app handling, `AuthForm`, and stale docs.
- [ ] **7.5** Run straggler searches and leave matches only in historical specs or hosted auth page internals.

## Edge Cases

### User Is Signed In On API But App Has No OAuth Session

The app calls `startSignIn()`. Hosted `/sign-in` sees the Better Auth cookie and
continues OAuth authorize without asking for credentials again. The app still
receives normal OAuth tokens.

### Access Token Expires While App Is Online

`auth.fetch` and `auth.openWebSocket` refresh before work when the token is near
expiry. `auth.fetch` also retries once after a 401.

### Access Token Expires While WebSocket Is Open

Nothing happens immediately. WebSocket auth is connection-time auth in this
break. If the socket later reconnects, `auth.openWebSocket` refreshes first.

### Refresh Token Is Revoked Or Replayed

Refresh fails. Auth preserves cached identity and encryption keys, transitions
to `reauth-required`, pauses network transports, and asks the user to sign in
again. Do not retry with older refresh tokens.

### Same User Reauth After Offline Edits

The app completes hosted sign-in again. If `/auth/me` returns the same user ID as
the cached local workspace owner, auth replaces the old OAuth tokens, keeps the
local Yjs data, and calls sync reconnect. Pending local Yjs updates then sync
through the normal CRDT protocol.

### Different User Reauth After Offline Edits

If hosted sign-in returns a different user ID, auth must not reconnect sync for
the cached workspace. The app should keep the old local data isolated and ask
the user whether to switch accounts, sign back in as the original user, or
explicitly remove local data.

### User Row Is Deleted After Token Issue

`/auth/me` and protected resource middleware return 401. The client transitions
to `reauth-required` if cached local identity exists. Local data is removed only
through an explicit local-data removal action.

### Offline Boot

The app can unlock local data from cached `OAuthSession` identity and
`encryptionKeys`. Network calls wait until online and then refresh if possible.

### Extension Service Worker Eviction

PKCE verifier and state must be in `chrome.storage.session` before
`launchWebAuthFlow` opens. In-memory transaction state is not enough.

## Open Questions

1. What exact access-token lifetime should the OAuth provider use?
   - Recommendation: start with 15 minutes for app access tokens and revisit after sync smoke tests. One hour is Better Auth's default, but shorter tokens reduce damage if app storage is compromised.

2. Should app resource routes require a custom scope beyond `openid profile email offline_access`?
   - Recommendation: defer until third-party API access exists. First-party apps can start with audience validation and trusted-client registration.

3. Which Tauri launcher should be first?
   - Options: deep link, loopback, device-style flow.
   - Recommendation: defer. The auth core only requires a launcher conforming to `HostedSignInLauncher`, including the optional `onUserCode` for device-flow surfaces. Any of the three options can land later without changing the auth surface.

4. Should refresh tokens be stored in a stronger runtime store per platform?
   - Recommendation: use the best practical store per app during implementation. Browser local storage is acceptable for this clean break only because local workspace data and encryption keys are already client-side.

## Decisions Log

- Keep cached `user` and `encryptionKeys` in `OAuthSession`: offline local-first unlock depends on complete identity at boot.
  Revisit when: Epicenter adds an explicit lock screen or user-held key flow.

- Allow WebSocket connections to outlive the access token used at handshake: enforcing expiry mid-connection adds DO timers and close coordination without changing the app's local data risk.
  Revisit when: third-party real-time API access exists or server-side ACLs become document-granular.

## Success Criteria

- [ ] No app imports `AuthForm`, `signIn`, `signUp`, `signInWithSocial`, or `SocialProvider`.
- [ ] No app auth path reads `set-auth-token`.
- [ ] No app auth path calls `/auth/oauth-session`.
- [ ] No public `AuthClient.bearerToken` remains.
- [ ] Every protected app resource validates OAuth access tokens with audience.
- [ ] Every app sign-in requests `offline_access` and sends `resource`.
- [ ] Refresh persists rotated tokens before retrying a request or opening a WebSocket.
- [ ] Sync receives `openWebSocket`, not a bearer token getter.
- [ ] Refresh failure, expired refresh tokens, and WebSocket 4401 pause sync without clearing local Yjs updates.
- [ ] Same-user reauth resumes sync and preserves pending local edits.
- [ ] Different-user reauth cannot sync cached local data under the new user identity.
- [ ] Local workspace data is wiped only by an explicit user action.
- [ ] Cookie sessions are used only by hosted auth server routes.

## Straggler Searches

```txt
rg -n "signIn\\(|signUp\\(|signInWithSocial|SocialProvider|AuthForm"
rg -n "bearerToken|set-auth-token|oauth-session|createCookieAuth|createBearerAuth"
rg -n "getSession\\(" apps/api/src packages
rg -n "Authorization: `Bearer|Authorization', `Bearer|bearer\\."
```

Expected survivors:

```txt
apps/api/src/auth-pages/
  hosted credential UI may still call Better Auth sign-in endpoints

apps/api/src/app.ts or auth helper files
  hosted auth pages may still call Better Auth getSession

historical specs and docs
  old architecture notes
```

## References

Local files:

- `apps/api/src/app.ts`: Hono route order, protected routes, WebSocket upgrade handling.
- `apps/api/src/auth/create-auth.ts`: Better Auth plugin setup, OAuth provider config, cookie config.
- `apps/api/src/auth/oauth-session.ts`: bridge endpoint to delete.
- `packages/auth/src/auth-contract.ts`: app-facing auth surface to replace.
- `packages/auth/src/create-bearer-auth.ts`: pending token, bridge, and public token surfaces to delete.
- `packages/auth/src/create-cookie-auth.ts`: cookie app transport to delete.
- `packages/oauth-client/src/index.ts`: OAuth launcher package to rename and harden.
- `packages/workspace/src/document/attach-sync.ts`: WebSocket opener boundary.
- `apps/tab-manager/src/lib/platform/auth/bearer.ts`: WXT launchWebAuthFlow and async storage constraints.
- `apps/opensidian/src/lib/platform/auth/bearer.ts`: browser callback route pattern.

Primary upstream references consulted:

- [better-auth/better-auth](https://github.com/better-auth/better-auth)
- [honojs/hono](https://github.com/honojs/hono)
- [cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs)
- [yjs/yjs](https://github.com/yjs/yjs)
- [yjs/y-protocols](https://github.com/yjs/y-protocols)
- [yjs/y-indexeddb](https://github.com/yjs/y-indexeddb)
- [sveltejs/svelte](https://github.com/sveltejs/svelte)
- [sveltejs/kit](https://github.com/sveltejs/kit)
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)
- [wxt-dev/wxt](https://github.com/wxt-dev/wxt)
- [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm)
- [tursodatabase/turso](https://github.com/tursodatabase/turso)
- [TanStack/ai](https://github.com/tanstack/ai)
- `/Users/braden/Code/ai`
- [jsrepojs/jsrepo](https://github.com/jsrepojs/jsrepo)
- [signalapp/libsignal](https://github.com/signalapp/libsignal)
- [bitwarden/server](https://github.com/bitwarden/server)
- [huntabyte/shadcn-svelte](https://github.com/huntabyte/shadcn-svelte)
- [ieedan/shadcn-svelte-extras](https://github.com/ieedan/shadcn-svelte-extras)
- [TanStack/table](https://github.com/TanStack/table)
- [useautumn/autumn](https://github.com/useautumn/autumn)
