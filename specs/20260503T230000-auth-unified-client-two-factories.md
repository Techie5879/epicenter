# Auth Unified Client, Two Transport Factories

**Date**: 2026-05-03
**Status**: Implemented (Waves 1-6; app/manual verification blocked)
**Author**: AI-assisted (Claude)
**Branch**: codex/sync-create-auth
**Supersedes**: `specs/20260503T213238-auth-cookie-bearer-two-products-clean-break.md`
**Sibling specs**: `specs/20260504T010000-drop-authclient-redirect-sign-in.md` (drops the `signInWithSocialRedirect` method; each browser app mints its own ID token), `specs/20260504T020000-workspace-identity-reset-deterministic-teardown.md` (Wave-5 carryover; replaces the partial reset path with a deterministic teardown sequence)

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

## One-Sentence Test

`AuthClient` is the credential's lifecycle handle on this runtime; `createCookieAuth` and `createBearerAuth` produce the same interface, differing only in how they acquire, persist, and present the credential.

If the design exposes the bearer token outside the auth client, splits the consumer interface by transport, or asks consumers to branch on which factory was used, it is not clean yet.

## Overview

Collapse `AuthSnapshot` and `AuthSession` into one observable identity. Hide the bearer token entirely. Two factories with one interface. Sync consumes auth as a capability bag, not as a token reader. The API enforces one credential per request.

The structural insight: state, ops, and transport are not three concerns. They are one concern (the credential's lifecycle) viewed three ways. The auth client owns all three because they are inseparable. Hiding the token from the public surface lets a single interface describe both transports.

The corollary insight, after grounding against Better Auth's actual capabilities (verified via deepwiki against `better-auth/better-auth`): most of the hard questions (offline tolerance, cross-origin SPAs, cached identity hydration) already have first-class answers in Better Auth's existing primitives. This spec composes them honestly rather than reinventing them.

## Why Better Auth Already Solves This

Three problems that initially looked like load-bearing design questions turn out to have idiomatic Better Auth answers. This section maps each one before the rest of the spec references them. The maps are the thing; the rest of the spec is composition.

### 1. Offline-tolerant identity (no special handling needed)

Better Auth's client `useSession` is built on `useAuthQuery`, which implements stale-while-revalidate. Verified behavior:

```
init                  isPending: true,  data: null (or sync-hydrated cached value)
fetch in flight       isPending: true,  data: previous value preserved
fetch ok              isPending: false, data: fresh value
fetch network error   isPending: false, data: previous value preserved, error populated
fetch 401             isPending: false, data: null (explicit sign-out)
```

Plus `refetchWhenOffline` defaults to `false`. The client does not hammer the network when the device is offline; it serves the last-known session.

**How this spec uses it**: `whenReady` resolves the moment `isPending` first flips false, which Better Auth guarantees on any network outcome. There is no hang condition, no rejection condition, no timeout to set. Apps that want offline UX render `auth.identity` (which carries the cached value, preserved across network failures); apps that need verified state await `whenReady`.

**Local-first invariant that falls out**: document editing never awaits `whenReady`. Auth state, document state, and sync state are three orthogonal layers. Going offline mid-edit does not hang the document because the document layer does not consult the auth layer.

### 2. Cross-origin SPAs (four canonical patterns)

For SPAs deployed on a domain that cannot share cookies with the auth server, Better Auth's docs and source list four solutions:

| Pattern | Mechanism | Cost |
|---|---|---|
| `bearer()` plugin | Client owns token in localStorage; sends `Authorization: Bearer`. Server's `before` hook converts it to a session cookie internally so `useSession` works normally. | localStorage XSS exposure for the token. |
| `@better-auth/oauth-provider` | API server acts as OAuth IdP. SPA does authorization_code + PKCE. We already configure this for the CLI. | Heavier flow; SPA needs OAuth client registration. |
| Reverse proxy | SPA's host (Vercel, Netlify, Cloudflare) rewrites `/api/auth/*` to `api.epicenter.so/auth/*`. Browser sees first-party. Cookies work. | One rewrite rule per app deploy. |
| Shared parent domain | All apps live under `*.epicenter.so` with `crossSubDomainCookies`. Already configured server-side. | Doesn't apply to standalone domains. |

The Storage Access API is not supported by Better Auth.

**How this spec uses it**: opensidian.com (the only standalone-domain app) gets `createBearerAuth` by default. Reverse proxy is documented as the upgrade path if XSS exposure ever becomes load-bearing. The OAuth provider option is held in reserve for third-party SPAs we don't own. The earlier draft of the per-app map silently put opensidian on cookies; this revision corrects it.

### 3. Sync identity hydration on reload (historical pattern)

> Superseded on 2026-05-07 by
> `20260507T150000-bearer-auth-session-storage-adapter.md`: bearer clients now
> pass `sessionStorage: { get, set }`. Auth still reads storage synchronously
> during construction and owns the live in-memory session afterward.

Better Auth's `expoClient` plugin demonstrates the canonical pattern for non-web runtimes: read cached session synchronously from storage at init, populate the session atom immediately, validate via `/get-session` in the background. The client never blocks on storage during construction.

This codebase already adopted the same pattern (see commits `d8eccf7f3`, `92f7ca5bb`, `ceb16e9fc`, `01e19854d`, `7a3f43c49`, plus the article `docs/articles/20260503T220500-pass-the-loaded-value-not-the-loader.md`). Today's `createBearerAuth` accepts `sessionStorage` because:

- The caller does the async storage read once before construction.
- The factory stays sync.
- Identity is populated at construction; useSession overwrites once it fires.
- Writes go through `sessionStorage.set()` on every change.

**Current shape**: the bearer factory contract is `sessionStorage: { get, set }`, not a `{ read, write }` storage object. Async storage still loads before construction, then passes a synchronous adapter. The browser factory exposes `initialIdentity` + `saveIdentity` for cookie-auth offline-friendly UX.

```ts
const cachedSession = await storage.read(); // caller awaits
let currentSession = cachedSession;

const auth = createBearerAuth({
  baseURL,
  sessionStorage: {
    get: () => currentSession,
    set: async (next) => {
      currentSession = next;
      await storage.write(next);
    },
  },
});
```

The earlier draft of this spec proposed a `storage: TokenStorage` abstraction. The hostile review correctly flagged it as a "sync construction with async storage" contradiction. The fix is not to make construction async; it is to recognize that the caller-resolved pattern is already established here and is what Better Auth itself uses.

### 4. Bearer token rotation and credential precedence (already standard)

When `bearer()` is enabled and a request carries `Authorization: Bearer`, the server's bearer plugin parses the token, converts it to a session cookie internally, and overrides any existing cookie. Edge case: if the bearer is *invalid* and the cookie is *valid*, the cookie wins. The server emits `set-auth-token` on every authenticated response so clients can rotate their stored token.

**How this spec uses it**: bearer factory has a `set-auth-token` handler (already present). Rotation does not fire `onChange` because identity did not change. The `singleCredential` middleware exists not to fight Better Auth's precedence rule but to remove the implicit decision entirely; clients send one credential, the server enforces one.

## Motivation

### Current State

The auth package exposes one factory and accumulated several smells:

```ts
type AuthClient = {
  readonly snapshot: AuthSnapshot;          // discriminated union, but loading is dead
  onSnapshotChange(fn): () => void;
  signIn / signUp / signInWithIdToken / signInWithSocialRedirect / signOut;
  fetch(input, init?): Promise<Response>;   // sets Authorization AND credentials:'include'
  [Symbol.dispose](): void;
};

type AuthSnapshot =
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: { token, user, encryptionKeys } };
```

Smells visible today:

1. **`AuthSnapshot` is isomorphic to `AuthSession | null`.** The `loading` variant was removed when async-init landed. The discriminated union now carries the same information as a nullable.

2. **`auth.fetch` double-credentials.** Every browser request carries both `Cookie: better-auth.session_token=...` and `Authorization: Bearer ...`. Bearer wins on conflict (per Better Auth upstream), but the resolution is implicit and version-dependent.

3. **`attachSync` reads `snapshot.session.token` directly.** The sync package imports `AuthClient` and `AuthSnapshot`, knows the word "token", and assembles the bearer subprotocol itself. The auth invariant leaks into sync.

4. **`signInWithSocialRedirect` lies about its result.** Both social methods call `client.signIn.social()` with different args. The redirect path's `Result<undefined, AuthError>` Ok branch is unreachable because the page navigates away on success. Google supports OIDC ID tokens, so the redirect path is redundant.

### Desired State

```ts
type AuthIdentity = { user: AuthUser; encryptionKeys: EncryptionKeys };

type AuthClient = {
  readonly identity: AuthIdentity | null;
  readonly whenReady: Promise<void>;
  onChange(fn: (id: AuthIdentity | null) => void): () => void;

  signIn(input: { email; password }): Promise<Result<undefined, AuthError>>;
  signUp(input: { email; password; name }): Promise<Result<undefined, AuthError>>;
  signInWithIdToken(input: { provider; idToken; nonce }): Promise<Result<undefined, AuthError>>;
  signOut(): Promise<Result<undefined, AuthError>>;

  fetch(input, init?): Promise<Response>;
  openWebSocket(url, protocols?): WebSocket;

  [Symbol.dispose](): void;
};

createCookieAuth({
  baseURL?,
  initialIdentity?: AuthIdentity | null,
  saveIdentity?: (next: AuthIdentity | null) => MaybePromise<void>,
}): AuthClient

createBearerAuth({
  baseURL?,
  sessionStorage: BearerSessionStorage,
}): AuthClient
```

Both factories return a sync `AuthClient`. The caller awaits any storage read before construction, matching the established pattern in this codebase and Better Auth's `expoClient` plugin.

## Vocabulary

| Term | Meaning | Owner |
|------|---------|-------|
| `AuthClient` | Unified credential lifecycle handle. Same shape regardless of transport. | `@epicenter/auth` |
| `AuthIdentity` | `{ user, encryptionKeys }`. Transport-agnostic; no token. | `@epicenter/auth` |
| `BearerSession` | `{ token, user, encryptionKeys }`. Exported arktype schema for caller-side storage validation. The token never appears on `AuthClient`, but the persistence payload is necessarily visible inside storage adapters passed as `sessionStorage`. | `@epicenter/auth` |
| `createCookieAuth` | Factory for browser SPAs that share an origin (or subdomain) with the auth server. Uses cookie jar; optional cached identity hydration. | `@epicenter/auth` |
| `createBearerAuth` | Factory for runtimes without a usable cookie jar (extension, CLI, daemon, cross-domain SPA). Owns its token via synchronous caller-provided `sessionStorage`. | `@epicenter/auth` |
| `singleCredential` | API-side header normalizer. Returns `ok | mixed | none`. | `apps/api` |

`AuthSession`, `AuthSnapshot`, `createAuth` cease to exist. `signInWithSocialRedirect` stays on the surface for the duration of this spec; its removal is tracked in `specs/20260504T010000-drop-authclient-redirect-sign-in.md` (per-app local credential minting; ships independently). There is no exported `TokenStorage` or generic async storage abstraction; persistence is the caller's concern, expressed as a synchronous `sessionStorage` adapter. `BearerSession` is exported as an arktype schema so callers can validate persisted blobs.

**The boundary is at construction.** Two factories, two construction shapes, two effects (cookie vs bearer). After construction, `AuthClient` is uniform and consumers cannot distinguish which factory produced it. The bearer token, the cookie jar, and the storage adapter all live below this boundary. `AuthClient` carries identity and capabilities; nothing transport-shaped leaks above the construction line.

## Research Findings

### Runtime contexts and transports

Four runtimes, two transports, three deployment shapes:

```
Browser tab, same-origin or *.epicenter.so subdomain
   cookie jar via crossSubDomainCookies; createCookieAuth.

Browser tab, standalone domain (e.g. opensidian.com)
   third-party cookies blocked by browser; createBearerAuth (default)
   or createCookieAuth + reverse proxy (deferred upgrade).

Browser extension, Node CLI, Tauri webview, daemon
   no first-party cookie jar; createBearerAuth.
```

Cross-origin behavior verified against Better Auth source: third-party `Set-Cookie` is blocked on Safari ITP, Chrome Privacy Sandbox, and Firefox ETP. The server already comments on this for the OAuth state cookie (`apps/api/src/auth/create-auth.ts:56-65`); session cookies face the same constraint.

### Better Auth credential precedence

Bearer wins on conflict in current upstream. Edge: invalid bearer + valid cookie causes the cookie path to be used. The clean break removes the conflict entirely: each client sends exactly one credential, and the server enforces this with `singleCredential`.

### One interface vs two

The earlier spec proposed two interfaces (`CookieAuthClient`, `BearerAuthClient`) to prevent a shared union from re-introducing implicit transport decisions. That reasoning is correct *when the surfaces differ*. They do not need to.

Hiding the bearer token from the public surface makes the two factories produce structurally identical clients. There is no union to write because consumers cannot distinguish them at runtime; the only divergence is at construction.

The load-bearing invariant: **the bearer token never appears on the public `AuthClient` surface.** Every smell that motivated two separate interfaces (token field on cookie sessions, special bearer-only methods, transport-specific consumer code) traced back to this one leak.

### Why hide the token

The token has zero legitimate consumer. Today's consumers:

- `auth.fetch()` reading the token: internal, can stay internal.
- `attachSync` reading the snapshot to mint a subprotocol: moves into `auth.openWebSocket()`.
- App code reading `snapshot.session.token` for any reason: none of the 5 consumer apps does this.

Anything that *would* need the token is an authentication concern (transport, signing, API call) that belongs inside the auth client. Hiding the token forces auth-related code to live in the auth package, which is where it should live.

### Caller-resolved storage (not a storage abstraction)

A storage abstraction (`{ read, write }`) on the factory would make construction async, since `read` is async on every supported runtime. The current codebase deliberately rejects async construction (see commits cited above); the article in `docs/articles/20260503T220500-pass-the-loaded-value-not-the-loader.md` documents why.

Better Auth's `expoClient` plugin uses the same caller-resolved pattern. The factory contract therefore stays sync, and the storage read is a synchronous adapter boundary.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Number of factories | Two: `createCookieAuth`, `createBearerAuth` | Two transports, two construction methods. |
| Number of interfaces | One: `AuthClient` | Consumers do not need to distinguish at runtime. |
| Token visibility | Private to factory implementation | Enables single interface. Removes leaks to sync. |
| State encoding | `identity: AuthIdentity \| null` | Collapse isomorphic `AuthSnapshot`. |
| `loading` state | None | `whenReady: Promise<void>` is the validation gate. UI consumers prefer `identity` (cached). |
| `whenReady` semantics | Resolves on first non-pending `useSession` event; never rejects | Better Auth's `useAuthQuery` flips `isPending` on any network outcome (success, network error, 401). No timeout to set. |
| Bearer persistence | `sessionStorage: { get, set }` | Sync construction; matches Better Auth's `expoClient` pattern without preserving the old two-option mental model. |
| Browser persistence | Optional `initialIdentity` + `saveIdentity` callbacks | Same shape, but optional because the browser cookie jar is already the credential. Apps that want offline UX provide them. |
| Social sign-in | `signInWithIdToken` only | Drop `signInWithSocialRedirect`; Google supports OIDC, redirect path is dishonest. |
| `baseURL` | Optional, defaults to `APPS.API.urls[0]` | Default works for production. Explicit override for dev or self-hosting. |
| Sync auth dependency | `attachSync` consumes `openWebSocket` + `onChange` capabilities | Sync no longer imports from `@epicenter/auth`. |
| API mixed credentials | `singleCredential(headers)` rejects mixed | Defense-in-depth; structurally enforced on clients. |
| Cross-domain SPA strategy | Bearer with localStorage by default; reverse proxy held as upgrade path | opensidian.com cannot rely on third-party cookies; bearer is the simplest answer; reverse-proxy keeps cookies if XSS exposure becomes load-bearing. |
| Backwards compatibility | None | No customers per user direction; one-sweep break. |

## Architecture

### Current

```
                   packages/auth/createAuth
                            │
                            ▼
                   ┌────────────────────┐
                   │ AuthSnapshot       │
                   │   loading|in|out   │
                   │ AuthSession        │
                   │   token,user,keys  │
                   │ fetch (both creds) │
                   └────────────────────┘
                            │ snapshot.session.token
                            ▼
                   packages/workspace/attach-sync
                            │ subprotocol = bearer.<token>
                            ▼
                   apps/api/authGuard
                            │ lift WS bearer; pass cookies through
                            ▼
                   Better Auth.getSession
                   (resolves bearer-vs-cookie implicitly)
```

### Target

```
   packages/auth/createCookieAuth      packages/auth/createBearerAuth
   (sync; optional cached identity)     (sync; required sessionStorage)
              │                                      │
              ▼                                      ▼
   ┌─────────────────────────┐         ┌─────────────────────────────┐
   │ AuthClient              │         │ AuthClient                  │
   │  identity (no token)    │         │  identity (no token)        │
   │  whenReady              │         │  whenReady                  │
   │  signIn/Up/Out/IdToken  │         │  signIn/Up/Out/IdToken      │
   │  fetch                  │         │  fetch                      │
   │  openWebSocket          │         │  openWebSocket              │
   │                         │         │                             │
   │  internal:              │         │  internal:                  │
   │    cookie jar           │         │    bearer in memory         │
   │    fetch credentials:   │         │    fetch credentials:'omit' │
   │      'include'          │         │    Authorization header     │
   │    no subprotocol       │         │    bearer.<token> subproto  │
   │    saveIdentity?        │         │    sessionStorage.set       │
   └─────────────────────────┘         └─────────────────────────────┘
              │                                      │
              └──────────────┬───────────────────────┘
                             │ both produce same AuthClient interface
                             ▼
              packages/workspace/attach-sync
                             │ openWebSocket capability
                             │ onChange capability
                             │ no token reading, no subprotocol assembly
                             ▼
              apps/api/authGuard
                             │ singleCredential(headers): ok|mixed|none
                             │ rejects mixed
                             ▼
              Better Auth.getSession
              (sees exactly one credential)
```

### Per-app surface map

```
apps/dashboard       createCookieAuth   (same-origin; cookie via crossSubDomainCookies)
apps/fuji            createCookieAuth   (subdomain *.epicenter.so; cookie)
apps/honeycrisp      createCookieAuth   (subdomain; cookie)
apps/zhongwen        createCookieAuth   (subdomain; cookie)
apps/opensidian      createBearerAuth    (own domain opensidian.com; localStorage)
                                         (upgrade path: reverse proxy → createCookieAuth)
apps/tab-manager     createBearerAuth    (Chrome extension; chrome.storage.local)
apps/*/daemon.ts     createBearerAuth    (Node; OS keychain)
packages/cli         createBearerAuth    (Node; same machine-auth wrapper)
apps/whispering      none for now        (Tauri; out of scope)
```

## Implementation Plan

End state is one design. Six waves; each one compiles and tests pass at the end of the wave. The wave order is **load-bearing**:

```
Wave 1   Capabilities (additive)         introduces openWebSocket, whenReady; migrates
                                         attach-sync. No legacy types removed yet.
Wave 2   Identity collapse (subtractive) safe to remove AuthSnapshot/AuthSession because
                                         attach-sync no longer reads them.
Wave 3   Two factories + client migration cookie/bearer split; apps single-credential.
Wave 4   Server enforcement              singleCredential + reject mixed.
                                         Safe ONLY because clients migrated in Wave 3.
Wave 5   Cleanup                         delete legacy files, move shared types.
Wave 6   Verify                          full typecheck, contract test, smoke.
```

The redirect-sign-in removal that previously rode here as "Wave 7" is now `specs/20260504T010000-drop-authclient-redirect-sign-in.md`. It ships independently per app and finishes with one auth-package deletion commit.

Two ordering invariants:

1. **Wave 1 before Wave 2**: capabilities must exist and `attach-sync` must consume them before legacy types are removed. Otherwise Wave 2 breaks the workspace package mid-flight.
2. **Wave 3 before Wave 4**: clients must stop double-sending credentials before the server rejects mixed. Otherwise an in-flight build breaks on the next deploy.

Each wave has a "Per-wave verification" line at the end. The acid test ("no `token` references outside the auth package") is a **final-state check** for the end of Wave 6; it is not a per-wave gate.

### Wave 1: Auth client capabilities (additive)

This wave is purely additive. `AuthClient` gains two new members, `attachSync` migrates to use them, and nothing existing is removed. The legacy `snapshot`, `session`, `onSnapshotChange`, and `whenLoaded` all still work. The codebase compiles and tests pass at the end of every commit in this wave.

- [x] **1.1** Add `openWebSocket(url, protocols?): WebSocket | null` as a method on the existing `AuthClient`. Internals: read the existing internal token (currently `snapshot.session.token`); return a `WebSocket` with `[MAIN_SUBPROTOCOL, bearer.<token>]` when signed in; return `null` when signed out so callers know to wait for a credential change.
- [x] **1.2** Add `whenReady: Promise<void>` as an alias for the existing `whenLoaded`. Same instance, two names; Wave 2 drops `whenLoaded`.
- [x] **1.3** Replace `attachSync`'s `auth: AuthClient` parameter with two flat capabilities: `openWebSocket: (url, protocols?) => WebSocket | null` and `onCredentialChange: (handler) => () => void`. The `onCredentialChange` parameter binds to today's `auth.onSnapshotChange` (Wave 2 renames it). No structural type alias is exposed; `attachSync` lists the two parameters individually in its config.
- [x] **1.4** In `packages/workspace/src/document/attach-sync.ts`: delete `tokenFromSnapshot`, `currentToken`, `readToken`, `requiresToken`, and the bearer subprotocol assembly. Delete the `@epicenter/auth` import. Update the supervisor: when `openWebSocket` returns `null`, stay in `offline` and re-trigger when `onCredentialChange` fires.
- [x] **1.5** Update sync wiring in each app's client/browser/daemon files: pass `openWebSocket: auth.openWebSocket` and `onCredentialChange: auth.onSnapshotChange` instead of `auth: AuthClient`.
- [x] **1.6** `attach-sync` tests use a fake `openWebSocket` (returns mock WS when "signed in", `null` otherwise) and a fake `onCredentialChange`.

**Per-wave verification (Wave 1)**:

- `packages/workspace/src/document/attach-sync.ts` does not import from `@epicenter/auth`.
- `auth.openWebSocket(url)` returns `null` when signed out, a `WebSocket` when signed in.
- `auth.whenReady` resolves to the same value as `auth.whenLoaded`.
- All existing tests pass; the legacy `snapshot`, `session`, `onSnapshotChange`, `whenLoaded` surface still works.

### Wave 2: Identity collapse and listener rename (subtractive)

This wave removes the legacy state shape and renames the listener API. `attachSync` was decoupled in Wave 1, so nothing in `packages/workspace` blocks this; the affected files are auth-svelte, auth-workspace, app UI components, and app storage code (about ten files in lockstep).

- [x] **2.1** Replace `AuthSnapshot` with `identity: AuthIdentity | null` on `AuthClient`. Drop the `signedOut`/`signedIn` discriminator. The bearer token, tracked internally, is no longer reachable via the public surface.
- [x] **2.2** Replace `AuthSession` (the public type) with `AuthIdentity` (`{ user, encryptionKeys }`). Add `BearerSession` (`{ token, user, encryptionKeys }`) as an exported arktype schema for caller-side storage validation. The factory keeps using `BearerSession` internally.
- [x] **2.3** Rename `onSnapshotChange` → `onChange`. Internal `setSnapshot` becomes `setIdentity`. The equality check compares `user` and `encryptionKeys` only; token rotation no longer fires the listener.
- [x] **2.4** Drop `whenLoaded`. Only `whenReady` remains. (Wave 1 added it as an alias; this commit removes the old name.)
- [x] **2.5** Update `packages/auth-svelte/src/create-auth.svelte.ts`: expose `identity` instead of `snapshot`; bind the Svelte `$state` mirror to `onChange`.
- [x] **2.6** Update `packages/auth-workspace/src/index.ts`: consume `identity` (its bindings read `identity.user.id` and `identity.encryptionKeys` instead of `session.user.id` and `session.encryptionKeys`).
- [x] **2.7** Update each app's sync wiring: `onCredentialChange: auth.onSnapshotChange` becomes `onCredentialChange: auth.onChange`.
- [x] **2.8** Update apps' storage code: `AuthSession.or('null')` becomes `BearerSession.or('null')`. The schema is identical; only the name changes.
- [x] **2.9** Update apps' UI components that read `auth.snapshot`: switch to `auth.identity`. Affected files include `apps/zhongwen/src/routes/+page.svelte`, `apps/opensidian/src/lib/components/AppShell.svelte`, `apps/tab-manager/src/lib/components/AiDrawer.svelte`, `apps/dashboard/src/routes/+layout.svelte`, and `packages/svelte-utils/src/account-popover/account-popover.svelte`.
- [x] **2.10** Adapt tests in `packages/auth/src/create-auth.test.ts` and `packages/auth-workspace/src/index.test.ts`.

**Per-wave verification (Wave 2)**:

- `bun run --filter @epicenter/auth typecheck` passes.
- Grep for `AuthSnapshot` and `AuthSession` (the type, not `BearerSession`) returns nothing in `packages/` or `apps/`.
- Grep for `onSnapshotChange` and `whenLoaded` returns nothing.
- `auth.identity` is the only state observable on the public surface; the bearer token is unreachable from `AuthClient`.

### Wave 3: Two factories and client migration

- [x] **3.1** Rename `createAuth` → `createBearerAuth`. Current contract is `{ baseURL?, sessionStorage }`. Internals: `auth: { type: 'Bearer' }` config on Better Auth client; `fetch` uses `credentials: 'omit'` and sets `Authorization` from the in-memory token; `openWebSocket` adds `bearer.<token>` to subprotocols; `onSuccess` hook reads `set-auth-token` and writes through.
- [x] **3.2** Add `createCookieAuth({ baseURL?, initialIdentity?, saveIdentity? })`. Internals: no `auth: { type: 'Bearer' }` on the underlying Better Auth client; `fetch` uses `credentials: 'include'`, never sets `Authorization`; `openWebSocket` returns plain `new WebSocket(url, protocols)` when `identity` is non-null and `null` otherwise. If `initialIdentity` is provided, `auth.identity` returns that value until `useSession` first fires. `saveIdentity` is called on identity changes.
- [x] **3.3** Migrate `apps/{dashboard,fuji,honeycrisp,zhongwen}` to `createCookieAuth`. Optional offline UX: hydrate `initialIdentity` from `localStorage` and wire `saveIdentity` to write back. Sign-in still uses `signInWithSocialRedirect` (redirect removal tracked separately in the GIS-migration spec).
- [x] **3.4** Migrate `apps/opensidian` to `createBearerAuth({ sessionStorage })` with a `localStorage` adapter (validate the read with the exported `BearerSession` schema; treat parse failure as `null`). Document the reverse-proxy upgrade path in the app's README.
- [x] **3.5** Migrate `apps/tab-manager` to `createBearerAuth({ sessionStorage })` with a `chrome.storage.local` adapter. Caller awaits storage readiness before construction; pre-existing pattern.
- [x] **3.6** Migrate `apps/*/daemon.ts` to `createBearerAuth`. `packages/cli` likewise. Caller awaits OS keychain read first.

After Wave 3, no client double-sends credentials. The server still tolerates mixed (because `authGuard` hasn't tightened yet); browsers and bearer clients each send exactly one. This is the safe ordering.

> **Wave 3 note**: Browser-cookie apps now call `createCookieAuth` without bearer session persistence. Opensidian and tab-manager still validate and persist `BearerSession` through their existing storage adapters. `createMachineAuthClient` now builds daemons and CLI clients through `createBearerAuth`. Auth package verification passes; app typechecks still fail on pre-existing shared UI, result-shape, and app-local errors unrelated to this wave.

### Wave 4: Server credential normalization

- [x] **4.1** Add `apps/api/src/auth/single-credential.ts` exporting `singleCredential(headers)`. Return type:

    ```ts
    type SingleCredentialResult =
      | { status: 'ok'; kind: 'cookie' | 'bearer'; headers: Headers }
      | { status: 'none'; headers: Headers }
      | { status: 'mixed' };
    ```

    Implementation reads HTTP `Authorization: Bearer`, WS subprotocol bearer, and Better Auth session cookies. The `'ok'` and `'none'` cases return normalized `headers` so the caller passes them directly to `auth.api.getSession({ headers })`. WS bearer is lifted into `Authorization` in the `headers` field. The `'mixed'` case has no headers because the caller rejects the request.
- [x] **4.2** Replace `authGuard` in `apps/api/src/app.ts` with the normalized version. `'mixed'` returns HTTP 400 with `{ error: 'mixed_credentials' }`; WebSocket upgrades close with code 4400. `'none'` returns HTTP 401 / WS 4401. `'ok'` calls `getSession` with the normalized headers and proceeds.
- [x] **4.3** Delete the bearer-lifting hack (`extractBearerToken` + manual `Authorization` header set) from `app.ts`. `singleCredential` subsumes it.
- [x] **4.4** Update `apps/api/src/app.ts` (`/sign-in`, `/consent`, `/device`) to call `singleCredential` before `getSession`. Sign-in tolerates `'mixed'` (renders form as if signed-out); consent/device treat `'mixed'` as 400.
- [x] **4.5** Add unit tests for `singleCredential`: only-cookie, only-bearer, only-WS-bearer (lifted), mixed cookie+bearer, mixed cookie+WS-bearer, neither.

> **Wave 4 note**: `singleCredential` now detects Better Auth session-token cookies, HTTP bearer headers, and WebSocket bearer subprotocols. WebSocket bearer credentials are lifted into `Authorization` before session lookup. The API guard rejects mixed credentials before calling `getSession`; sign-in treats mixed credentials as signed out, while consent and device pages return 400. This wave also fixed the Wave 3 carryovers: `headersFromRequest` now uses `Headers.forEach`, and shared Svelte auth component JSDoc references mention `createCookieAuth()` and `createBearerAuth()`.

### Wave 5: Cleanup

- [x] **5.1** Delete `packages/auth/src/auth-types.ts` (`AuthSession`, `AuthSnapshot` no longer exist).
- [x] **5.2** Move shared types to `packages/auth/src/contracts/` (`AuthUser`, `AuthError`, `BetterAuthSessionResponse`).
- [x] **5.3** Update `.agents/skills/auth/SKILL.md` to describe the two-factory model and the Better Auth grounding section above.
- [x] **5.4** Grep for `from '@epicenter/auth'` and confirm no consumer imports `createAuth`, `AuthSnapshot`, `AuthSession`.
- [x] **5.5** Update `docs/architecture.md` and `docs/guides/consuming-epicenter-api.md`.

### Wave 6: Verify

- [x] **6.1** `bun run --filter @epicenter/auth typecheck`
- [x] **6.2** `bun run --filter @epicenter/auth-svelte typecheck`
- [x] **6.3** `bun run --filter @epicenter/auth-workspace typecheck`
- [x] **6.4** `bun run --filter @epicenter/workspace typecheck`
- [ ] **6.5** Per-app typechecks for dashboard, fuji, honeycrisp, opensidian, zhongwen, tab-manager. Blocked by pre-existing shared UI, Svelte, result-shape, and app-local diagnostics unrelated to this spec.
- [x] **6.6** Add a shared contract test (`packages/auth/src/contract.test.ts`) parameterized over both factories, exercising every public method against a mocked Better Auth client. Drift prevention.
- [ ] **6.7** Manual smoke: dashboard signs in via cookies; opensidian signs in via bearer; tab-manager signs in via bearer; CLI device flow signs in via bearer. Each WS sync establishes against the new server normalizer.

## Edge Cases

### Offline document editing (key local-first invariant)

Document editing is independent of auth state. The layers are orthogonal:

```
Document layer        local-first via attachIndexedDb
                      edits work without network, ever
Sync layer            attachSync's supervisor (offline → connecting → connected)
                      handles network state separately from auth state
                      reconnects with backoff; queues edits locally
Auth layer            cached identity from last sign-in
                      Better Auth's useAuthQuery preserves stale data on network failure
                      whenReady resolves promptly with whatever state is known
```

A user editing a document who goes offline sees:

- Document UI keeps rendering and accepting edits (local).
- `auth.identity` keeps showing the last-known user (cached, preserved by Better Auth).
- attachSync's supervisor enters `connecting`, retries with backoff. No hang.
- When network returns: WS reconnects, sync delta-merges, `/auth/get-session` confirms (or 401s).

Document UI never awaits `whenReady`. It just consumes `auth.identity`. `whenReady` is a validation gate for components that explicitly need "the server has confirmed this session" (billing, sensitive operations).

### Cookie auth: first-render flicker

UI renders before `/auth/get-session` resolves. If `initialIdentity` is provided to `createCookieAuth`, identity is the cached value immediately. If not, identity is `null` until first `useSession` event arrives.

Apps that want offline UX wire `initialIdentity` (about three lines via `localStorage`); apps that don't accept the brief skeleton.

### Bearer auth: stale identity at boot

Caller awaits any async storage readiness before construction, then passes a synchronous `sessionStorage` adapter. Identity is rendered immediately on reload from `sessionStorage.get()`. `whenReady` resolves after first `/auth/get-session` validates the token. If validation fails (token expired), `signOut()` is called internally, identity becomes null, `whenReady` still resolves (with signed-out state).

### Token rotation (bearer only)

`set-auth-token` response header. Bearer factory updates internal token, calls `sessionStorage.set()` with the new value. `onChange` does NOT fire (identity didn't change, only the credential rotated). Open WebSocket connections continue using the old subprotocol; the WS subprotocol authenticates only the upgrade handshake, then the connection is plain. New connections via `openWebSocket` use the rotated token.

### Cross-tab sign-out (cookie)

Tab A signs out: Better Auth clears cookie. Tab B's next request fails 401. Tab B's `useSession` subscription detects this and updates identity to null. `onChange` fires.

### Cross-tab/cross-context sign-out (bearer)

Bearer auth clients in different runtimes do not share state. Each runtime has its own storage. Sign-out clears the local copy only. See Open Questions for `BroadcastChannel` / `chrome.storage.onChanged` adapter for browser-extension contexts.

### Open WebSockets after server-side session revocation

If a session is revoked server-side (sign-out from another device), open WebSocket connections that authenticated at upgrade time stay alive. Per Better Auth, there is no built-in revocation broadcast to open connections. This is an existing gap, not introduced by this spec. See Open Questions.

### Mixed credentials at the API

`singleCredential` returns `mixed`. HTTP returns 400 with `{ error: 'mixed_credentials' }`. WebSocket upgrades close with code 4400. Cookie or bearer clients in normal operation cannot produce mixed credentials.

### `signInWithIdToken` for non-Google providers

Auth client accepts `provider: string`. Today only Google is configured server-side. Adding Apple, Microsoft, or any OIDC provider requires:

- Server config: add to `socialProviders` in `apps/api/src/auth/create-auth.ts`.
- Client helper: per-app `getAppleIdToken()` etc.

No change to auth client surface.

### GitHub or non-OIDC providers

Out of scope. If needed later, `signInWithSocialRedirect` returns. Per YAGNI, not now.

### Self-hosting

`baseURL` is optional with `APPS.API.urls[0]` default. Self-hosters pass their own URL. No code change.

### Storage write failure

Bearer factory: if `sessionStorage.set(...)` rejects (quota, private mode, chrome.storage error), the in-memory state still updates and `onChange` fires. The next reload won't see the latest state (best-effort persistence). Errors are logged.

### Storage read returns corrupt data

The caller is responsible for parse validation inside the storage adapter. If the cached session is corrupt, `sessionStorage.get()` returns `null` and the user re-authenticates.

## Open Questions

1. **Cross-domain reverse proxy upgrade path**
   opensidian.com defaults to bearer with localStorage. If XSS exposure becomes a real concern, deploy with a reverse proxy (`/api/auth/* → api.epicenter.so/auth/*`) and switch to `createCookieAuth`. Vercel/Netlify/Cloudflare all support a single-rule rewrite.
   **Recommendation**: defer. Bearer is fine until evidence demands the upgrade. Document the path so it stays available.

2. **OAuth provider for third-party SPAs**
   The `oauthProvider` plugin is already configured server-side for the CLI. If we ever ship a third-party SPA we don't own (or want to formalize the boundary for opensidian.com), reuse this plugin: SPA does authorization_code + PKCE.
   **Recommendation**: defer. We own all current SPAs; bearer is sufficient.

3. **Cross-context bearer sync via `BroadcastChannel` / `chrome.storage.onChanged`?**
   Bearer in a Chrome extension has multiple contexts (background, popup, sidepanel). Should they share state?
   **Recommendation**: defer. Today the extension uses a single context for auth UI; if pain emerges, add a sync adapter outside auth.

4. **Open WebSocket revocation on cross-device sign-out**
   Per deepwiki, Better Auth doesn't broadcast session revocations to open connections. Existing gap.
   Options: (a) periodic re-auth frame on the WS, (b) DO-side broadcast on sign-out via a Better Auth `databaseHooks.session.delete`, (c) accept the gap with documentation.
   **Recommendation**: (c) for now; revisit when sensitive operations grow.

5. **Shared contract test**
   The "two factories produce identical clients" claim needs a parameterized test exercising every public method against both factories. Without it, the interfaces drift.
   **Recommendation**: required; landed in Wave 5.

6. **HMR teardown helper?**
   Each app has three lines of `import.meta.hot.dispose(() => auth[Symbol.dispose]())`. Could be a helper.
   **Recommendation**: defer. Three lines per app, no real cost.

7. **`@epicenter/auth/node` and `@epicenter/auth/extension` subpaths for runtime-specific defaults?**
   For ready-made keychain or chrome.storage adapters that satisfy `sessionStorage`.
   **Recommendation**: defer. Apps can ship their own adapters. If pain emerges, add the subpaths.

## Success Criteria

- [x] No source file imports `createAuth`, `AuthSession`, or `AuthSnapshot` from `@epicenter/auth` or `@epicenter/auth-svelte`.
- [x] No runtime source file imports anything from `@epicenter/auth` inside `packages/workspace/`.
- [x] `AuthClient` interface has zero methods or properties that expose the bearer token.
- [x] `apps/api/src/app.ts` `authGuard` calls `singleCredential` and rejects mixed credentials.
- [x] `bun run --filter @epicenter/auth test` passes, including the shared contract test.
- [ ] Each migrated app typechecks (modulo pre-existing unrelated failures).
- [ ] Manual smoke: dashboard cookie sign-in; opensidian bearer sign-in; tab-manager bearer sign-in; CLI device flow; each WS sync establishes against the new server normalizer.

## References

Files this spec touches:

- `packages/auth/src/index.ts`
- `packages/auth/src/auth-types.ts` (deleted)
- `packages/auth/src/create-auth.ts` (replaced)
- `packages/auth/src/contracts/auth-session.ts` (moved to `shared/`)
- `packages/auth/src/cookie/create-browser-auth.ts` (new)
- `packages/auth/src/bearer/create-bearer-auth.ts` (new; renamed from existing)
- `packages/auth/src/shared/auth-types.ts` (new; `AuthIdentity`, `AuthUser`, `AuthError`)
- `packages/auth/src/contract.test.ts` (new; shared contract test)
- `packages/auth-svelte/src/create-auth.svelte.ts`
- `packages/auth-workspace/src/index.ts`
- `packages/workspace/src/document/attach-sync.ts`
- `apps/api/src/app.ts`
- `apps/api/src/auth/single-credential.ts` (new)
- `apps/dashboard/src/lib/auth.ts`
- `apps/fuji/src/lib/fuji/client.ts`
- `apps/honeycrisp/src/lib/honeycrisp/client.ts`
- `apps/opensidian/src/lib/opensidian/client.ts`
- `apps/zhongwen/src/lib/zhongwen/client.ts`
- `apps/tab-manager/src/lib/auth.ts`
- `apps/tab-manager/src/lib/tab-manager/client.ts`
- `apps/*/daemon.ts`
- `packages/cli/src/commands/auth.ts`

Prior specs that shaped the current state:

- `specs/20260503T180000-auth-snapshot-three-state-clean-break.md`
- `specs/20260503T010845-auth-credential-source-of-truth.md`
- `specs/20260503T012932-local-auth-session-clean-break.md`
- `specs/20260501T221831-auth-workspace-lifecycle-inversion.md`
- `specs/20260503T002441-auth-client-sync-clean-break.md`
- `specs/20260503T213238-auth-cookie-bearer-two-products-clean-break.md` (superseded by this spec)

Articles cited:

- `docs/articles/20260503T220500-pass-the-loaded-value-not-the-loader.md` (the case for caller-resolved storage; bearer auth now applies it through synchronous `sessionStorage.get()`)

Better Auth research (verified via deepwiki against `better-auth/better-auth`):

- `bearer()` plugin: token-to-cookie conversion, `set-auth-token` rotation, bearer-wins-on-conflict precedence with cookie-wins fallback for invalid bearer.
- `useSession` and `useAuthQuery`: stale-while-revalidate; `isPending` flips on any network outcome; `refetchWhenOffline` defaults to false; cached data preserved across network failures.
- `expoClient` plugin: caller-resolved sync hydration pattern. Read once, populate atom synchronously, validate in background.
- `@better-auth/oauth-provider`: cross-domain OAuth IdP option (already configured for the CLI in `apps/api/src/auth/create-auth.ts:219-227`).
- Cross-domain cookie blocking: Safari ITP, Chrome Privacy Sandbox, Firefox ETP. Recommended workarounds: bearer, OAuth provider, or reverse proxy.

External references:

- [Better Auth Bearer Plugin docs](https://better-auth.com/docs/plugins/bearer)
- [Better Auth Cookies docs](https://better-auth.com/docs/concepts/cookies)
- [Better Auth Session Lifecycle](https://better-auth.com/docs/concepts/session-management)
- [WebSocket browser API and subprotocols](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)

## Notes for the Implementer

Hold one invariant above all: **the bearer token never appears on the public `AuthClient` surface.**

Every smell that motivated this break traces back to that one leak. If during implementation you find yourself adding `auth.token` or `auth.session.token` or any field that exposes the token externally, stop and revisit the design. The token is meant to be private to the bearer factory; sync interacts with it only through `openWebSocket`; HTTP interacts with it only through `fetch`.

Three corollaries worth stating explicitly:

1. **`whenReady` is a validation gate, not a rendering gate.** Apps that show user info do so by reading `auth.identity` (cached, available offline, preserved by Better Auth across network failures). Apps that need confirmed server state (billing, account deletion) await `whenReady`. Document UI never awaits `whenReady` because document editing is local-first and does not depend on auth.

2. **No fourth option for the token on `AuthClient`.** If a consumer believes it needs the bearer token *via `auth`*, the answer is one of: (a) it's a Better Auth call and should go through `auth.fetch`; (b) it's a sync call and should go through `auth.openWebSocket`; (c) it's a different system that needs its own credential. There is no `auth.token` accessor. There is no `auth.getAuthHeaders()` escape hatch.

   The exported `BearerSession` schema is *not* a violation of this rule. `BearerSession` is the storage payload that callers validate inside the `sessionStorage` adapter. It exists below the construction boundary, in the caller's storage adapter, never on the `AuthClient` returned by the factory. The hard rule is: **the token never appears on `AuthClient`**, not "no exported type can contain a token."

3. **The factory is sync; the caller is async.** Storage reads happen before `createBearerAuth(...)` returns; the factory itself never awaits. This matches Better Auth's `expoClient` pattern and the established convention in this codebase. Do not introduce a `storage: TokenStorage` parameter; that path leads to async construction and the flicker we are trying to remove.

The acid test before declaring this done (final state, after Wave 6): read every place that imports from `@epicenter/auth` or `@epicenter/auth-svelte` and confirm none of them say "token" anywhere outside the auth package itself. The one allowed exception is per-app storage adapters that validate `BearerSession` blobs. The acid test is NOT a per-wave gate; each wave has its own narrow "Per-wave verification" line in the Implementation Plan.
