# Auth Credential Families: Minimal Production

**Date**: 2026-05-11
**Status**: Superseded. Do not execute.
**Author**: AI-assisted (Claude)
**Supersedes**: `specs/20260504T010000-drop-authclient-redirect-sign-in.md`, `specs/20260510T120000-platform-google-sign-in.md`
**Builds on**: `specs/20260503T213238-auth-cookie-bearer-two-products-clean-break.md` (the two-factory split, landed)
**Superseded by**: `specs/20260511T105846-auth-oauth-everywhere-clean-break.md`

## Supersession Note

This spec remains useful as an implementation record for:

```txt
OAuth public-client registration
extension callback handling
Tauri callback notes
CLI device flow behavior
manual verification coverage
```

Do not carry forward its runtime credential model. The current direction is:

```ts
await auth.beginSignIn({ returnTo });
```

Not:

```ts
await auth.signInWithSocial({ provider: 'google' });
```

And not:

```txt
OAuth access token -> /auth/oauth-session -> Better Auth session token
```

The provider choice, sign-up mode, account recovery, MFA, and passkeys belong to hosted `/sign-in`, not app UI. App runtime credentials are OAuth credentials. Better Auth session cookies and session tokens stay inside the hosted API auth server boundary.

The old transport split does not stand:

```txt
old:
  cookie family -> HttpOnly cookie session
  bearer family -> /auth/oauth-session -> Better Auth session token

current:
  every app -> OAuth code + PKCE -> OAuthSession
  identity -> GET /workspace-identity
  resources -> OAuth access token verification
```

When this document conflicts with `20260511T105846-auth-oauth-everywhere-clean-break.md`, follow the OAuth-everywhere spec.

## Current Reconciliation (2026-05-11)

This spec is no longer spec-only. The current worktree has implemented parts of this older direction: the OAuth client package, `/auth/oauth-session`, the auth core split into `auth-contract.ts`, `create-bearer-auth.ts`, and `create-cookie-auth.ts`, and cookie/bearer app platform files.

Treat those changes as salvage, not as the final plan. Keep the PKCE launcher machinery and trusted client registration work where useful. Replace the bridge and family split with `/workspace-identity`, `OAuthSession`, auth-owned `fetch`, and auth-owned `openWebSocket`.

---

## Historical Content Below

Everything below this marker is the superseded plan. It intentionally preserves the old vocabulary so the audit trail remains readable, but it is not implementation guidance. In particular, ignore any instruction below that says to build `/auth/oauth-session`, persist a Better Auth session token in app storage, keep cookie and bearer app families, or expose `auth.bearerToken`.

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

## Historical One-Sentence Test

Every Epicenter client belongs to exactly one credential family: the cookie family (browser owns the credential, same-eTLD+1 SPAs only) or the bearer family (the app owns an opaque Better Auth session token, used by extensions, CLI, daemons, Tauri, and cross-origin browser SPAs); every app calls the same `auth.signInWithSocial({ provider })` method, while each factory implements that method through its own credential family; OAuth provider access tokens are transient proof-of-identity that get exchanged at `/auth/oauth-session` for a durable session token, never persisted as a durable credential.

If the design needs the words "or both," "transport mode," "auto-detect," a `transport: 'cookie' | 'bearer'` flag, or a durable JWT session, it is not clean yet.

## Overview

This spec is the cohesive refinement of `20260504T010000-drop-authclient-redirect-sign-in.md`. The thesis of that spec stands (drop `signInWithIdToken` and `signInWithSocialRedirect`; route every social sign-in through OAuth 2.1 PKCE via the existing `oauthProvider` plugin), but two assumptions in its implementation plan did not survive verification against `better-auth/better-auth`:

```txt
1. The bearer() plugin DOES NOT accept oauthProvider access tokens. It expects an
   opaque Better Auth session token and rejects anything else. There is no jwt() HMAC
   reconfiguration that fixes this; oauthProvider access tokens are a different kind
   of credential, intended for resource servers (verifyAccessToken /
   oauthProviderResourceClient).

2. The three-package layout (oauth-client-spa, -extension, -tauri) collapses
   into one packages/oauth-client/ core with per-platform launchers. The
   transport differences are small enough to live as helpers in the same
   package; tree-shaking handles the dead-code concern.
```

This spec also adds explicit credential-family vocabulary so that adding any future client (mobile, IoT, third-party "Sign in with Epicenter") has a single decision: which family does it belong to?

## Vocabulary

| Term | Meaning | Owner |
| --- | --- | --- |
| **Cookie family** | Clients whose credential is the browser cookie jar at `.epicenter.so`. Same-eTLD+1 SPAs only. | `createCookieAuth` |
| **Bearer family** | Clients whose credential is an opaque Better Auth session token held in app-owned storage and sent as `Authorization: Bearer`. Cross-origin SPAs, extensions, CLI, daemons, Tauri. | `createBearerAuth` |
| **OAuth access token** | A short-lived JWT issued by `oauthProvider` (`/auth/oauth2/token`). Resource-server proof of identity. NOT a durable session token. NOT accepted by the `bearer()` plugin. | `@better-auth/oauth-provider` |
| **Durable session token** | The opaque Better Auth session token. Returned via `set-auth-token`. The only thing a bearer client persists. Looked up by the `bearer()` plugin via the session store. | `bearer()` |
| **`/auth/oauth-session`** | The Epicenter-owned exchange endpoint. Takes an OAuth access token, verifies it (issuer, audience, sid), loads the Better Auth session and user, derives encryption keys, returns the enriched session, and emits `set-auth-token` with the durable session token. | `apps/api/src/auth/oauth-session.ts` |
| **`oauth-client`** | One package with shared PKCE/state machinery and per-platform launchers (SPA full-page redirect, Chrome extension `launchWebAuthFlow`, Tauri loopback). Returns the OAuth access token to `createBearerAuth`; auth exchanges it via `/auth/oauth-session` so the live auth client can update in-memory state. | `packages/oauth-client/` |
| **`platform/auth/{cookie,bearer}.ts`** | Per-app file colocated with the app. Filename declares the family. The file owns the factory call (`createCookieAuth` or `createBearerAuth`), credential storage wiring, and (for bearer) the OAuth client adapter injected into `createBearerAuth`. Each app has exactly one. | `apps/*/src/lib/platform/auth/` |

`signInWithIdToken`, `signInWithSocialRedirect`, `getGoogleIdToken`, `GIS`, `One Tap`, `signInWithGoogle`: gone from `AuthClient` and from every consumer.

## Per-App Credential-Family Map

```
Cookie family (apps/*/src/lib/platform/auth/cookie.ts)
  apps/dashboard           same-origin to api.epicenter.so
  apps/fuji                .epicenter.so subdomain
  apps/honeycrisp          .epicenter.so subdomain
  apps/zhongwen            .epicenter.so subdomain

Bearer family (apps/*/src/lib/platform/auth/bearer.ts)
  apps/opensidian          opensidian.com (different eTLD+1, no cookie reach)
  apps/tab-manager         Chrome extension MV3
  apps/whispering          Tauri (deferred until the app adds auth)
  apps/*/daemon.ts         Node daemons (use createBearerMachineAuth helper)
  packages/cli             CLI device flow (already correct)
```

The filename in `platform/auth/` is the source of truth for which family the app belongs to. `cookie.ts` and `bearer.ts` are mutually exclusive per app; finding both in one app is a bug.

## AuthClient Surface

`AuthClient` keeps one social sign-in method. This is deliberate. A previous draft moved social sign-in out to per-app helper functions, but that creates a live-state problem for bearer clients: writing a new `BearerSession` into storage does not update the already-constructed auth client unless auth also receives and applies the session. Letting `createBearerAuth` own the exchange and persistence keeps the token lifecycle in one place.

```ts
export type AuthClient = {
  readonly state: AuthState;
  readonly bearerToken: string | null;
  onStateChange(fn: AuthStateChangeListener): () => void;
  signIn(input: {
    email: string;
    password: string;
  }): Promise<Result<undefined, AuthError>>;
  signUp(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<Result<undefined, AuthError>>;
  signInWithSocial(input: {
    provider: SocialProvider;
  }): Promise<Result<undefined, AuthError>>;
  signOut(): Promise<Result<undefined, AuthError>>;
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
  [Symbol.dispose](): void;
};
```

The factories implement `signInWithSocial` differently:

```txt
createCookieAuth
  signInWithSocial(provider)
    -> Better Auth signIn.social
    -> browser navigation / cookie callback
    -> Better Auth useSession updates identity

createBearerAuth
  signInWithSocial(provider)
    -> injected OAuth adapter returns oauthProvider access token
    -> auth calls /auth/oauth-session
    -> auth reads set-auth-token
    -> auth updates live BearerSession and persists it
```

This keeps consumers uniform:

```ts
import { auth } from '$lib/platform/auth';

await auth.signInWithSocial({ provider: 'google' });
```

The app still chooses the family once, at the platform file. Consumers do not branch on cookie vs bearer.

## Why Two Families, Not One

Spec `20260503T213238` already explained why two factories (cookie vs bearer) read truer than one factory with a flag. This spec extends that reasoning to the WHOLE credential lifecycle, not just the HTTP transport:

| Concern | Cookie family | Bearer family |
| --- | --- | --- |
| Who holds the credential? | Browser cookie jar (`.epicenter.so`) | App-owned storage (`localStorage`, `chrome.storage.local`, OS keychain) |
| Who sets the credential? | Server, via `Set-Cookie` | Server, via `set-auth-token` response header |
| How is it sent? | Implicit cookie on every request | Explicit `Authorization: Bearer <token>` |
| Sign-in UX | Same-origin or cross-subdomain navigation; cookie roundtrip | OAuth 2.1 PKCE through platform-specific launcher; `/auth/oauth-session` exchange |
| Sign-out UX | Server clears cookie via `Set-Cookie` | Server returns 200; client deletes its stored session |
| Token rotation | Browser writes `Set-Cookie` | Client `onSuccess` reads `set-auth-token` |
| Where the OAuth flow lives | Better Auth's built-in `signIn.social` (cookie path) | `packages/oauth-client/` + `createBearerAuth` + `/auth/oauth-session` |

Trying to share an OAuth flow across both families re-creates the leaks the two-factory split removed. Keep them separate end to end.

## The `/auth/oauth-session` Contract

This endpoint is the load-bearing addition that distinguishes this spec from its predecessor.

```txt
POST /auth/oauth-session
Headers:
  Authorization: Bearer <oauth_provider_access_token>

Response 200:
  Set: set-auth-token: <durable_better_auth_session_token>
  Body: {
    user: AuthUser,
    session: Session,             // Better Auth session row
    encryptionKeys: EncryptionKeys // customSession enrichment
  }

Response 401:
  Body: { code: 'invalid_oauth_token' }

Response 400:
  Body: { code: 'malformed_oauth_token' }
```

Server logic (`apps/api/src/auth/oauth-session.ts`):

```ts
export const oauthSession = factory.createHandlers(async (c) => {
  const accessToken = parseHttpBearer(c.req.raw.headers.get('authorization'));
  if (!accessToken) return c.json({ code: 'malformed_oauth_token' }, 400);

  // 1. Verify the access token. oauthProviderResourceClient or verifyAccessToken
  //    from @better-auth/oauth-provider. Checks signature, issuer, audience,
  //    expiry, and resolves the session id (sid) claim. No DB call required for
  //    the signature check; sid lookup hits the session store.
  const verified = await verifyAccessToken(c.var.auth, accessToken, {
    issuer: c.var.auth.options.baseURL,
    audience: EPICENTER_OAUTH_AUDIENCE,
  });
  if (!verified) return c.json({ code: 'invalid_oauth_token' }, 401);

  // 2. Load the Better Auth session row by sid. The session row already exists
  //    because oauthProvider created it when the user approved on /consent.
  const session = await c.var.auth.api.getSession({
    headers: new Headers({ cookie: betterAuthSessionCookie(verified.sid) }),
  });
  if (!session) return c.json({ code: 'invalid_oauth_token' }, 401);

  // 3. Derive encryption keys (same logic as the customSession plugin).
  const encryptionKeys = await deriveUserEncryptionKeys(session.user.id);

  // 4. Emit set-auth-token with the durable session token. The bearer plugin
  //    already does this on getSession; we emit it explicitly so the client
  //    learns the durable token without an extra round-trip.
  c.header('set-auth-token', session.session.token);

  return c.json({
    user: session.user,
    session: session.session,
    encryptionKeys,
  } satisfies BetterAuthSessionResponse);
});
```

Why this is necessary and not over-engineered:

```txt
Confirmed against better-auth/better-auth via DeepWiki:

  - bearer() plugin only accepts opaque Better Auth session tokens.
    OAuth access tokens are a different credential class.

  - Better Auth provides NO built-in endpoint that takes an oauthProvider
    access token and returns a customSession-enriched session + set-auth-token.
    customSession only wraps /get-session, which already requires a session
    credential (cookie or bearer).

  - Without /auth/oauth-session, a bearer client that completes OAuth has an
    access token it cannot use as a durable bearer credential and has no way
    to obtain one.

The previous spec attempted to dodge this by configuring jwt() to use HMAC
so that bearer() could verify oauthProvider tokens directly. That conflates
two token classes and creates a footgun: any access token that passes
signature would be treated as a session credential, defeating the whole
"OAuth tokens are short-lived resource-server proofs" model.
```

Mounting:

```ts
// apps/api/src/app.ts
app.post('/auth/oauth-session', ...oauthSession);
```

Apply `singleCredential` (it already runs globally, so the request must carry only the OAuth access token; mixing with a session cookie is rejected at the edge).

## `packages/oauth-client/` Shape

One package, one core, platform adapters. No per-platform sub-packages.

```
packages/oauth-client/
  package.json
  src/
    index.ts                    // public API, shared PKCE/state machinery, browser and extension adapters
```

Public surface:

```ts
export type OAuthClientConfig = {
  /** Better Auth oauthProvider issuer, e.g. https://api.epicenter.so/auth */
  issuer: string;
  /** Per-app client_id registered with oauthProvider */
  clientId: string;
  /** Per-app redirect URI registered with oauthProvider */
  redirectUri: string;
  /** Optional OAuth resource audience, usually the API base URL */
  resource?: string;
  storage: OAuthTemporaryStorage;
  fetch?: typeof fetch;
};

export type OAuthSignInResult = {
  accessToken: string;
};

export type OAuthAccessTokenAdapter = {
  signInWithSocial(input: {
    provider: SocialProvider;
  }): Promise<Result<OAuthSignInResult | null, OAuthClientError>>;
};

export function createOAuthClient(config: OAuthClientConfig): {
  createAuthorizationUrl(): Promise<Result<URL, OAuthClientError>>;
  handleCallback(
    url: string | URL,
  ): Promise<Result<OAuthSignInResult | null, OAuthClientError>>;
};

export function createBrowserOAuthAdapter(config: {
  apiBaseURL: string;
  clientId: string;
  redirectUri: string;
  storage?: Storage;
}): OAuthAccessTokenAdapter;

export function createExtensionOAuthAdapter(
  config: OAuthClientConfig & {
    launchWebAuthFlow: (url: string) => Promise<string>;
  },
): OAuthAccessTokenAdapter;
```

`oauth4webapi` powers discovery, PKCE, state validation, and the authorization-code token exchange. The browser adapter starts with full-page redirect and completes on the callback route. The extension adapter launches `browser.identity.launchWebAuthFlow`. `oauth-client` returns the OAuth access token; `createBearerAuth` owns the access-token-to-session exchange. Do not make `oauth-client` depend on `@epicenter/auth` or `BearerSession`.

`SocialProvider` derives from Better Auth, no narrowing:

```ts
import type { createAuthClient } from 'better-auth/client';
type SocialSignInArgs = NonNullable<Parameters<ReturnType<typeof createAuthClient>['signIn']['social']>[0]>;
export type SocialProvider = NonNullable<SocialSignInArgs['provider']>;
```

## `apps/*/src/lib/platform/auth/{cookie,bearer}.ts`

Per app, exactly one file. The filename declares the family. Each file exports `auth`; consumers call methods on that object.

### Cookie family example

`apps/dashboard/src/lib/platform/auth/cookie.ts`:

```ts
import { createCookieAuth } from '@epicenter/auth-svelte';
import { APP_URLS } from '@epicenter/constants/vite';

export const auth = createCookieAuth({
  baseURL: APP_URLS.API,
  getSocialCallbackURL: () => window.location.href,
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
```

Cookie-family consumers call:

```ts
await auth.signInWithSocial({ provider: 'google' });
```

Internally, `createCookieAuth` calls Better Auth `signIn.social`. The platform file owns the optional social callback URL through `getSocialCallbackURL`; auth core does not read browser globals to guess it. The browser owns the cookie callback. There is no `oauth-client` import and no `/auth/oauth-session` call in cookie-family apps.

### Bearer family example (cross-origin SPA)

`apps/opensidian/src/lib/platform/auth/bearer.ts`:

```ts
import { BearerSession, createBearerAuth } from '@epicenter/auth-svelte';
import { APP_URLS } from '@epicenter/constants/vite';
import {
  createBrowserOAuthAdapter,
} from '@epicenter/oauth-client';
import { EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID } from '@epicenter/constants/oauth';
import { createPersistedState } from '@epicenter/svelte';

const sessionStorage = createPersistedState({
  key: 'opensidian:authSession',
  schema: BearerSession.or('null'),
  defaultValue: null,
});

const oauthAdapter = createBrowserOAuthAdapter({
  apiBaseURL: APP_URLS.API,
  clientId: EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID,
  redirectUri: `${window.location.origin}/auth/callback`,
});

export const auth = createBearerAuth({
  baseURL: APP_URLS.API,
  sessionStorage,
  oauthAdapter,
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
```

Bearer-family consumers call the same surface:

```ts
await auth.signInWithSocial({ provider: 'google' });
```

`createBearerAuth` calls the injected adapter, receives an OAuth access token, exchanges it at `/auth/oauth-session`, updates live auth state, and persists the resulting `BearerSession`.

### Bearer family example (Chrome extension)

`apps/tab-manager/src/lib/platform/auth/bearer.ts`:

Identical shape to the SPA file, except the launcher swaps:

```ts
import { createExtensionOAuthAdapter } from '@epicenter/oauth-client';
// ...
oauthAdapter: createExtensionOAuthAdapter({ ... }),
// ...
redirectUri: `https://${browser.runtime.id}.chromiumapp.org/`,
```

`getGoogleCredentials`, `GOOGLE_CLIENT_ID`, and the `signInWithIdToken` call are deleted. The extension goes through the same OAuth 2.1 PKCE path as opensidian; the only platform-specific bit is the launcher.

## Cookie Family Sign-In Flow

```
SPA (dashboard)             api.epicenter.so          Google
   |                              |                       |
   | window.location.href = /sign-in?provider=google      |
   |----------------------------->|                       |
   |                              | redirect to Google    |
   |                              |---------------------->|
   |                              |   user signs in       |
   |                              |<----------------------|
   |                              | Set-Cookie:           |
   |                              |   __Secure-           |
   |                              |   better-auth.        |
   |                              |   session_token=...   |
   |                              |   Domain=.epicenter.so|
   |                              | redirect to           |
   |                              | dashboard?callbackURL |
   |<-----------------------------|                       |
   | Browser already has cookie. createCookieAuth's       |
   | useSession subscription fires, snapshot becomes      |
   | signed-in. Done.                                     |
```

No `oauth-client` package, no `/auth/oauth-session`. Cookie family pays nothing for OAuth machinery the bearer family needs.

## Bearer Family Sign-In Flow

```
SPA (opensidian) or Extension          api.epicenter.so            Google
        |                                    |                        |
        | auth.signInWithSocial({ provider })                         |
        |  createBearerAuth calls injected OAuth adapter              |
        |  adapter generates PKCE verifier + challenge                |
        |  state = random                                             |
        |  launcher opens authorizeUrl                                |
        |--------------------------------------->|                    |
        |                                        | redirect to Google |
        |                                        |------------------->|
        |                                        | user signs in      |
        |                                        |<-------------------|
        |                                        | redirect to        |
        |                                        | redirectUri?code=  |
        |<---------------------------------------|                    |
        | launcher returns code                                       |
        |                                                             |
        | POST /auth/oauth2/token                                     |
        |   grant_type=authorization_code                             |
        |   code, code_verifier, client_id, redirect_uri              |
        |--------------------------------------->|                    |
        |                                        |                    |
        |<--------------------------------------|                     |
        | { access_token, token_type, expires_in } (JWT)              |
        |                                                             |
        | POST /auth/oauth-session                                    |
        |   Authorization: Bearer <access_token>                      |
        |--------------------------------------->|                    |
        |                                        | verifyAccessToken  |
        |                                        | load session by sid|
        |                                        | derive encryption  |
        |                                        |   keys             |
        |<--------------------------------------|                     |
        | set-auth-token: <durable_session_token>                     |
        | { user, session, encryptionKeys }                           |
        |                                                             |
        | createBearerAuth applies session in memory                  |
        | createBearerAuth persists BearerSession                     |
        | auth.state becomes signed-in. Done.                         |
```

Subsequent requests use `Authorization: Bearer <durable_session_token>`; the OAuth access token is discarded after the exchange.

## Why CLI Stays on `deviceAuthorization`, Not OAuth 2.1 PKCE

```
CLI                                           api.epicenter.so
  |                                                  |
  | POST /auth/device/code  (client_id)              |
  |------------------------------------------------->|
  |                                                  |
  |<-------------------------------------------------|
  | { user_code, verification_uri_complete, ... }    |
  |                                                  |
  | open user's browser to verification_uri_complete |
  | poll POST /auth/device/token                     |
  | (grant_type=device_code, device_code, client_id) |
  |------------------------------------------------->|
  |                                                  |
  |<-------------------------------------------------|
  | { access_token: <Better Auth session token> }    |
  |                                                  |
  | persist as BearerSession.token                   |
```

DeepWiki against `better-auth/better-auth` confirms: when `deviceAuthorization` is used standalone (without routing through `oauthProvider`), `/auth/device/token` returns a Better Auth session token directly via `createSession()`. NOT an oauthProvider access token. So no exchange step is needed.

This means the CLI path is already minimal-production today. `/auth/oauth-session` exists for clients that go through `oauthProvider` (SPAs, extensions, Tauri). The CLI does not.

## Implementation Plan

Three sequential waves. Pre-work ships as one PR; per-app waves can ship in parallel; final cleanup is one PR after all apps migrate.

### Pre-work wave: oauth-client + /auth/oauth-session (one PR)

- [x] **P.1** Add `packages/oauth-client/` skeleton with `oauth4webapi` dep. Implement `createOAuthClient`, `createBrowserOAuthAdapter`, and `createExtensionOAuthAdapter`. The package performs discovery, PKCE, state validation, and authorization-code-to-access-token exchange only. It returns `{ accessToken }`; it does not import `@epicenter/auth`, `BearerSession`, or call `/auth/oauth-session`. Tests cover PKCE invariants, state mismatch rejection, token exchange happy path, and launch failure mapping. Tauri remains deferred until a real loopback launcher is needed.
- [x] **P.2** Ensure `createBearerAuth` owns the access-token-to-session exchange. Its `signInWithSocial` calls the injected OAuth adapter, sends the returned access token to `/auth/oauth-session`, reads `set-auth-token`, normalizes the body into `BearerSession`, updates live auth state, and persists through `sessionStorage.set`. Add or update tests that prove no reload is required after bearer social sign-in.
- [x] **P.3** Add `apps/api/src/auth/oauth-session.ts`. Verify access tokens via `verifyAccessToken` from Better Auth OAuth support. Reuse `deriveUserEncryptionKeys` from the existing `customSession` enrichment. Mount at `app.post('/auth/oauth-session', ...)` in `apps/api/src/app.ts`. `singleCredential` already runs globally; nothing extra to wire.
- [x] **P.4** Configure the `oauthProvider` plugin with `validAudiences: [baseURL]`. `/auth/oauth-session` verifies the same `baseURL` audience.
- [ ] **P.5** Register per-app oauthProvider clients server-side. Add to `packages/constants/src/oauth.ts`:
  - `EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID`
  - `EPICENTER_TAB_MANAGER_OAUTH_CLIENT_ID`
  - (Future) `EPICENTER_WHISPERING_OAUTH_CLIENT_ID`
  Each app's `redirect_uri` must be registered as an allowed callback. Cookie family apps do NOT need oauthProvider client registration; the API's existing direct sign-in serves them.
  > **Remaining**: constants exist, but the API still needs a seed or registration owner while dynamic registration is disabled.
- [x] **P.6** Add `apps/api/src/auth/oauth-session.test.ts` with at least: malformed token => 400, expired token => 401, valid token => 200 with `set-auth-token` header and the customSession-shaped body.
- [x] **P.7** Verification: `bun run --filter @epicenter/oauth-client typecheck`, `bun run --filter @epicenter/auth typecheck`, `bun run --filter @epicenter/api typecheck`, `bun test packages/oauth-client/src`, `bun test apps/api/src/auth/oauth-session.test.ts`, `bun test packages/auth/src`.

### Per-app waves (any order after P; each ships independently)

For each cookie family app (`dashboard`, `fuji`, `honeycrisp`, `zhongwen`):

- [x] **C.1** Create `apps/<app>/src/lib/platform/auth/cookie.ts`. Move the existing `apps/<app>/src/lib/auth.ts` contents into it and export `auth = createCookieAuth(...)`.
- [x] **C.2** Update every `signInWithSocialRedirect` call site in the app to call `auth.signInWithSocial({ provider })`.
- [x] **C.3** Delete `apps/<app>/src/lib/auth.ts`.
- [ ] **C.4** Per-app verification: `bun run --filter <app> typecheck`, manual sign-in pass.

For each bearer family app (`opensidian`, `tab-manager`):

- [x] **B.1** Create `apps/<app>/src/lib/platform/auth/bearer.ts`. Move existing `auth.ts` contents into it; wire the platform OAuth adapter into `createBearerAuth({ oauthAdapter })`; export `auth`.
- [x] **B.2** Add `/auth/callback` route (SPA) or extension launch flow that completes the OAuth flow on return.
- [x] **B.3** Update every `signInWithIdToken` and `signInWithSocialRedirect` call site to call `auth.signInWithSocial({ provider })`. Specifically for `apps/tab-manager`:
  - `apps/tab-manager/src/entrypoints/sidepanel/App.svelte` (line 26-32)
  - `apps/tab-manager/src/entrypoints/sidepanel/SignedInApp.svelte` (line 186-189)
  - Drop the `getGoogleCredentials` import; the helper becomes dead code.
- [x] **B.4** Delete `apps/<app>/src/lib/auth.ts`. For `apps/tab-manager`, delete `getGoogleCredentials` and `GOOGLE_CLIENT_ID` from the file before removing.
- [ ] **B.5** Per-app verification: `bun run --filter <app> typecheck`, manual sign-in pass through the OAuth flow, then a workspace WebSocket connection.

### Final wave (after all per-app PRs land)

- [x] **F.1** Drop `signInWithIdToken` from `AuthClient` in `packages/auth/src/auth-contract.ts`.
- [x] **F.2** Drop `signInWithSocialRedirect` from `AuthClient` in `packages/auth/src/auth-contract.ts`.
- [x] **F.3** Keep `AuthError.SocialSignInFailed`; `AuthClient.signInWithSocial` still produces it for both families.
- [x] **F.4** Update `packages/auth/src/contract.test.ts` to drop the `signInWithIdToken` and `signInWithSocialRedirect` cases.
- [x] **F.5** Update `.agents/skills/auth/SKILL.md` to remove any reference to `signInWithIdToken` or `signInWithSocialRedirect`. Add the credential-family vocabulary and reference this spec.
- [x] **F.6** Grep `signInWithIdToken`, `signInWithSocialRedirect`, `getGoogleCredentials`, `getGoogleIdToken`, `signInWithGoogle`, and `accounts.google.com/gsi` across `apps/` and `packages/`. Should match only this spec, the predecessor spec, and historical specs. Server-side Google provider config such as `apps/api` `GOOGLE_CLIENT_ID` is allowed.

## Edge Cases

### A signed-in cookie client tries to call /auth/oauth-session

`singleCredential` rejects with HTTP 400 `multiple_credentials` because the request would carry both a Better Auth session cookie and an `Authorization: Bearer`. Cookie clients have no reason to call `/auth/oauth-session`; if one tries, the boundary blocks it.

### A bearer client carrying a stale durable session token tries to sign in again via OAuth

The OAuth flow opens a fresh authorize URL. If the user is already signed in to the API (cookie still valid in the system browser or extension popup view), the consent page short-circuits. Else the user re-authenticates. Either way, `/auth/oauth-session` returns a fresh `set-auth-token`; `sessionStorage.set` overwrites the stale token.

### OAuth access token expires before /auth/oauth-session is called

`/auth/oauth-session` returns 401 `invalid_oauth_token`. The caller's `signInWithSocial` propagates `AuthError.SignInFailed`; the user retries. Access tokens are short-lived precisely so this is the worst-case outcome.

### Durable session token expires (30+ days later)

The bearer plugin's standard rotation: each `getSession` returns a fresh `set-auth-token` in the response. The `createBearerAuth.onSuccess` hook reads it and calls `sessionStorage.set` with the rotated token. Same as today.

### oauthProvider issues refresh tokens but client never uses them

By design. The durable Better Auth session token is the credential. `oauthProvider` refresh tokens are an artifact of OAuth 2.1 that the bearer family does not consume after the initial exchange. The token store will GC them when they expire.

If a future client (e.g., a third-party app calling Epicenter's OAuth) actually needs refresh tokens, that is its concern, not Epicenter's first-party clients. First-party clients keep the durable session token and rotate it through the bearer plugin.

### A request carries an oauthProvider access token via Authorization: Bearer to a non-/auth/oauth-session route

The `bearer()` plugin tries to look up the token in the session store. It fails (no matching session). `getSession` returns null. Protected routes 401. This is correct: oauthProvider access tokens are not durable session credentials.

### Extension service worker eviction during OAuth flow

`browser.identity.launchWebAuthFlow` returns the redirect URL synchronously (the Promise resolves). The PKCE verifier and state must be persisted to `chrome.storage.session` before launch and read back after. The extension adapter in `packages/oauth-client/src/index.ts` owns this; no app code touches it.

### Tauri loopback port conflict

The Tauri path is deferred. When it lands, it should bind an ephemeral port and register `http://127.0.0.1/callback` (port-flexible per RFC 8252) with `oauthProvider`. Better Auth 1.6.0+ matches loopback URIs port-agnostically. If the Tauri app and the Better Auth version are below 1.6.0, the redirect will 400; bump Better Auth as a dependency of `apps/whispering`.

### Sign-out (bearer family)

Same as today: `auth.signOut()` calls Better Auth `/auth/sign-out` with the durable session token. Server invalidates the session row. Client clears `sessionStorage`.

### Sign-out (cookie family)

Same as today: `auth.signOut()` calls `/auth/sign-out`. Server clears `Set-Cookie`. Browser drops the cookie.

### Cookie SPA hosted on a domain other than .epicenter.so in the future

It joins the bearer family. There is no migration path within the cookie family for cross-origin hosting; that's the point of the family split. The redirect-to-API-page navigation a cookie SPA performs depends on the cookie reaching it, which only works on `.epicenter.so`.

## Hard Constraints

Carried forward from the source prompt and enforced by this spec:

- Runtime changes in this worktree must stay inside the credential-family migration.
- `signInWithIdToken` is not reintroduced. The dropped method stays dropped.
- `signInWithSocialRedirect` is not reintroduced as a public auth method. `AuthClient.signInWithSocial` is the only social method, and it is implemented by the selected factory.
- No Google Identity Services. No GIS popup. No `getGoogleCredentials`. No provider-specific token helpers in app/client code.
- `singleCredential` stays exactly as it is; this spec adds no carve-outs and weakens nothing.
- No durable JWT sessions. The `jwt()` plugin remains because `oauthProvider` requires it to sign access tokens; it is not used as a session credential. If a future, separate resource server emerges that needs stateless verification, that is a different spec.
- No em or en dashes in any spec edit, source file, or commit message.
- Use `bun`, not `npm`, `yarn`, `pnpm`, or `npx`.
- Worktree changes unrelated to this spec are not reverted.

## Success Criteria

- [x] `apps/api/src/auth/oauth-session.ts` exists and is mounted; tests pass.
- [x] `packages/oauth-client/` exists with one core plus browser and extension adapters; tests pass.
- [x] Every app under `apps/` (except `apps/whispering`, deferred) has exactly one `platform/auth/{cookie,bearer}.ts` file. Finding both in one app fails review.
- [x] No source file imports `signInWithIdToken` or `signInWithSocialRedirect`.
- [x] `AuthClient` does not declare `signInWithIdToken` or `signInWithSocialRedirect`.
- [x] `AuthClient` does declare `signInWithSocial`, and bearer social sign-in updates live auth state without reloading the page.
- [x] No app/client source file references `getGoogleCredentials`, `getGoogleIdToken`, `signInWithGoogle`, or `accounts.google.com/gsi`.
- [x] `bun run --filter @epicenter/auth typecheck` passes.
- [x] `bun run --filter @epicenter/oauth-client typecheck` passes.
- [x] `bun run --filter @epicenter/api typecheck` passes.
- [x] `bun test packages/oauth-client/src`, `bun test apps/api/src/auth/oauth-session.test.ts`, and `bun test packages/auth/src` pass.
- [ ] Manual smoke against staging: dashboard cookie sign-in, opensidian bearer OAuth sign-in, tab-manager bearer OAuth sign-in, CLI device-flow sign-in. Each verifies the WebSocket sync establishes against the new credential.

## References

Files this spec touches in the current worktree:

- `packages/oauth-client/`
- `packages/constants/src/oauth.ts` (per-app client IDs and public-client metadata)
- `apps/api/src/auth/oauth-session.ts`
- `apps/api/src/auth/oauth-session.test.ts`
- `apps/api/src/app.ts` (mount the route)
- `apps/dashboard/src/lib/platform/auth/cookie.ts` (move from `lib/auth.ts`)
- `apps/fuji/src/lib/platform/auth/cookie.ts` (move from `lib/auth.ts`)
- `apps/honeycrisp/src/lib/platform/auth/cookie.ts` (move from `lib/auth.ts`)
- `apps/zhongwen/src/lib/platform/auth/cookie.ts` (move from `lib/auth.ts`)
- `apps/opensidian/src/lib/platform/auth/bearer.ts` (move from `lib/auth.ts`)
- `apps/tab-manager/src/lib/platform/auth/bearer.ts` (move from `lib/auth.ts`; delete `getGoogleCredentials`)
- `packages/auth/src/auth-contract.ts` (drop `signInWithIdToken`, `signInWithSocialRedirect` in F-wave)
- `packages/auth/src/create-bearer-auth.ts` (bearer OAuth exchange and session persistence)
- `packages/auth/src/create-cookie-auth.ts` (cookie social sign-in and callback URL injection)
- `packages/auth/src/contract.test.ts` (drop the dropped-method cases)
- `.agents/skills/auth/SKILL.md` (refresh vocabulary)

Files consulted (no expected changes):

- `apps/api/src/auth/create-auth.ts` (existing oauthProvider, bearer, customSession config)
- `apps/api/src/auth/single-credential.ts` (already enforces one credential per request)
- `packages/auth/src/node/machine-auth.ts` (CLI device flow; already correct)
- `packages/cli/src/commands/auth.ts` (CLI auth commands; already correct)

Prior specs that produced the current shape:

- `specs/20260503T213238-auth-cookie-bearer-two-products-clean-break.md` (the two-factory split)
- `specs/20260503T230000-auth-unified-client-two-factories.md` (the unified client surface)
- `specs/20260504T010000-drop-authclient-redirect-sign-in.md` (the predecessor; this spec supersedes it)

External references:

- Better Auth bearer plugin: opaque session tokens, `set-auth-token` rotation
- Better Auth oauthProvider plugin: OAuth 2.1 + OIDC server, JWT access tokens, `verifyAccessToken`, `oauthProviderResourceClient`
- Better Auth deviceAuthorization plugin: `/device/token` returns a Better Auth session token directly (no oauthProvider exchange)
- Better Auth customSession plugin: enriches `/get-session`; does NOT issue tokens
- RFC 6749 + RFC 7636 (PKCE)
- RFC 8252 (Native apps + loopback redirect URIs)
- `oauth4webapi` (https://github.com/panva/oauth4webapi)

## Notes for the Implementer

Three cautions worth holding while executing this plan:

1. **`/auth/oauth-session` must verify the access token's audience.** Without an audience claim check, any oauthProvider access token issued for any client could be exchanged for a session by any other client. The audience binds the token to Epicenter as the resource server. `oauthProvider` config must be set up to include an audience claim; verify this before P.1 ships.

2. **`AuthClient.signInWithSocial` is intentionally still on `AuthClient`.** Moving it to a per-app helper makes bearer sign-in awkward because the helper would have to update storage and live in-memory auth state. Keep token lifecycle inside auth. The selected factory decides how social sign-in works.

3. **Launcher selection still stays out of `@epicenter/auth`.** `platform/auth/bearer.ts` builds the OAuth adapter with the SPA, extension, or Tauri launcher and injects it into `createBearerAuth`. If you find yourself adding launcher selection logic into `@epicenter/auth`, you have crossed the boundary.

The acid test before declaring this done: read every consumer that imports from `@epicenter/auth`, `@epicenter/auth-svelte`, or `@epicenter/oauth-client`, and confirm none of them branch on which credential family they belong to beyond importing the right `platform/auth/*.ts` file. The family choice is made once, at filename selection time. After that, every consumer treats the result as `AuthClient` and goes about its business.

## Agent Handoff Prompts

Use these prompts to split the implementation into independent agents. Each prompt assumes the agent starts from the repository root.

### Prompt 1: Pre-work, OAuth Client Package

```txt
Implement the `packages/oauth-client/` pre-work from `specs/20260511T090000-auth-credential-families-minimal-production.md`.

Context:
- Epicenter uses bun only. Use `bun install`, `bun test`, and `bun run`.
- The package must use `oauth4webapi` for PKCE, state, discovery, and authorization-code token exchange.
- The package must not import `@epicenter/auth`, `BearerSession`, or call `/auth/oauth-session`.
- It returns `{ accessToken }` to `createBearerAuth`; `@epicenter/auth` owns exchanging that token for a durable session.
- One package only: do not create `oauth-client-spa`, `oauth-client-extension`, or `oauth-client-tauri`.

Build:
- `packages/oauth-client/package.json`
- `packages/oauth-client/src/index.ts`
- shared OAuth client machinery
- browser SPA adapter or launcher
- extension web auth adapter or launcher
- Tauri loopback placeholder if the runtime pieces are not ready
- tests for PKCE/state invariants, state mismatch rejection, token exchange success, and launch failure mapping

Guardrails:
- Do not hand-roll PKCE or state validation.
- Do not persist OAuth access tokens.
- Do not add durable JWT sessions.
- Do not touch app migrations in this prompt.

Verify:
- `bun run --filter @epicenter/oauth-client typecheck`
- `bun test packages/oauth-client/src`
```

### Prompt 2: Pre-work, API OAuth Session Exchange

```txt
Implement `/auth/oauth-session` from `specs/20260511T090000-auth-credential-families-minimal-production.md`.

Context:
- `apps/api/src/app.ts` already creates a Better Auth instance per request and mounts global `singleCredential`.
- `apps/api/src/auth/create-auth.ts` already configures Better Auth plugins including bearer, jwt, deviceAuthorization, oauthProvider, and customSession.
- OAuth provider access tokens are short-lived JWTs. They are not durable bearer credentials.
- The endpoint exchanges an OAuth access token for an opaque Better Auth session token.

Build:
- `apps/api/src/auth/oauth-session.ts`
- mount `app.post('/auth/oauth-session', ...oauthSession)` in `apps/api/src/app.ts`
- add `EPICENTER_OAUTH_AUDIENCE` or equivalent to `packages/constants/src/oauth.ts`
- verify access token issuer, audience, expiry, and `sid`
- load Better Auth session and user by `sid`
- derive encryption keys with the same logic as customSession
- return the customSession-shaped body
- set `set-auth-token` to the durable Better Auth session token
- add tests for malformed token => 400, invalid or expired token => 401, valid token => 200 with `set-auth-token`

Guardrails:
- Do not make bearer() accept oauthProvider access tokens.
- Do not configure JWTs as durable sessions.
- Do not weaken `singleCredential`.
- Do not accept tokens without audience verification.

Verify:
- `bun run --filter @epicenter/api typecheck`
- `bun test apps/api/src/auth/oauth-session.test.ts`
```

### Prompt 3: Auth Core Integration

```txt
Update `@epicenter/auth` to match the credential-family spec.

Context:
- `AuthClient.signInWithSocial({ provider })` stays on `AuthClient`.
- `createCookieAuth` implements it through Better Auth social sign-in and browser cookie flow.
- `createBearerAuth` implements it through an injected OAuth adapter. The adapter returns `{ accessToken }`.
- `createBearerAuth` must call `/auth/oauth-session`, read `set-auth-token`, normalize the body into `BearerSession`, update live auth state, and persist through `sessionStorage.set`.

Build:
- update `packages/auth/src/auth-contract.ts`
- update `packages/auth/src/create-bearer-auth.ts`
- update `packages/auth/src/create-cookie-auth.ts`
- update `packages/auth/src/contract.test.ts`
- keep `AuthError.SocialSignInFailed`
- remove only `signInWithIdToken` and `signInWithSocialRedirect`
- add tests proving bearer social sign-in updates `auth.state` without page reload
- add tests proving cookie auth does not set Authorization and bearer auth uses `credentials: 'omit'`

Guardrails:
- Do not expose bearer tokens above `AuthClient.bearerToken`.
- Do not add platform launcher logic to `@epicenter/auth`.
- Do not add `transport` flags or auto-detection.

Verify:
- `bun run --filter @epicenter/auth typecheck`
- `bun test packages/auth/src`
```

### Prompt 4: Cookie Family App Migration

```txt
Migrate cookie-family apps to the new platform auth file convention.

Apps:
- `apps/dashboard`
- `apps/fuji`
- `apps/honeycrisp`
- `apps/zhongwen`

Context:
- These apps are same-eTLD+1 browser SPAs and belong to the cookie family.
- Each app should have exactly one `apps/<app>/src/lib/platform/auth/cookie.ts`.
- Consumers call `auth.signInWithSocial({ provider })`.
- Cookie apps do not import `@epicenter/oauth-client`.
- Cookie apps do not call `/auth/oauth-session`.

Build:
- move each app's existing auth construction from `src/lib/auth.ts` into `src/lib/platform/auth/cookie.ts`
- update imports to use the new platform auth module
- replace old `signInWithSocialRedirect` call sites with `auth.signInWithSocial({ provider })`
- delete the old `src/lib/auth.ts` only after imports are updated

Guardrails:
- Do not create `bearer.ts` in these apps.
- Do not add local bearer storage.
- Do not add OAuth callback routes.

Verify:
- `bun run --filter dashboard typecheck`
- `bun run --filter fuji typecheck`
- `bun run --filter honeycrisp typecheck`
- `bun run --filter zhongwen typecheck`
- grep each app to confirm no `signInWithSocialRedirect`
```

### Prompt 5: Bearer Family App Migration

```txt
Migrate bearer-family apps to the new platform auth file convention.

Apps:
- `apps/opensidian`
- `apps/tab-manager`

Context:
- Opensidian is cross-origin (`opensidian.com`) and cannot rely on `.epicenter.so` cookies.
- Tab Manager is a Chrome extension and owns its credential in extension storage.
- Each app should have exactly one `apps/<app>/src/lib/platform/auth/bearer.ts`.
- Consumers call `auth.signInWithSocial({ provider })`.
- `createBearerAuth` receives an injected OAuth adapter.

Build:
- move each app's existing auth construction from `src/lib/auth.ts` into `src/lib/platform/auth/bearer.ts`
- wire Opensidian with the browser SPA OAuth adapter and its registered client ID
- wire Tab Manager with the extension web auth adapter and its registered client ID
- add or update the SPA callback route or extension return handler needed by the adapter
- delete `signInWithIdToken`, `signInWithSocialRedirect`, `getGoogleCredentials`, `GOOGLE_CLIENT_ID`, and GIS code
- delete old `src/lib/auth.ts` after imports are updated

Guardrails:
- Do not persist OAuth access tokens.
- Do not add cookies as a fallback.
- Do not branch in consumers on credential family.

Verify:
- `bun run --filter opensidian typecheck`
- `bun run --filter tab-manager typecheck`
- manual sign-in pass for each app
- manual workspace WebSocket sync pass for each app
```

### Prompt 6: Final Cleanup And Review

```txt
Run the final cleanup for `specs/20260511T090000-auth-credential-families-minimal-production.md` after pre-work and app migrations land.

Tasks:
- remove `signInWithIdToken` from `AuthClient`
- remove `signInWithSocialRedirect` from `AuthClient`
- remove stale tests for those methods
- update `.agents/skills/auth/SKILL.md` with the credential-family vocabulary and the final `AuthClient` surface
- add a guard script or documented grep check that fails review if one app has both `platform/auth/cookie.ts` and `platform/auth/bearer.ts`
- run straggler searches for `signInWithIdToken`, `signInWithSocialRedirect`, `getGoogleCredentials`, `getGoogleIdToken`, `signInWithGoogle`, and `accounts.google.com/gsi`

Guardrails:
- Keep `AuthClient.signInWithSocial`.
- Keep `AuthError.SocialSignInFailed`.
- Do not remove CLI device auth. It is already the correct bearer path.

Verify:
- `bun run --filter @epicenter/auth typecheck`
- `bun run --filter @epicenter/oauth-client typecheck`
- `bun run --filter @epicenter/api typecheck`
- `bun test packages/oauth-client/src apps/api/src/auth packages/auth/src`
- manual smoke against staging: dashboard cookie sign-in, opensidian bearer sign-in, tab-manager bearer sign-in, CLI device-flow sign-in
```
