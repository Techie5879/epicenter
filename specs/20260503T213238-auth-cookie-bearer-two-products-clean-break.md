# Auth Cookie Bearer Two Products Clean Break

**Date**: 2026-05-03
**Status**: Reconciled, partially implemented
**Author**: AI-assisted
**Branch**: codex/explicit-daemon-host-config

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

## Current Reconciliation (2026-05-07)

Do not execute the original checklist below as written. The thesis landed, but
the implementation shape changed while the auth packages kept evolving.

Current code now makes these invariants true:

```txt
cookie auth  -> browser cookie jar owns the credential
bearer auth  -> caller-owned token owns the credential
API edge     -> mixed cookie and bearer credentials are rejected globally
```

Landed pieces:

| Area | Current shape |
| --- | --- |
| Public factories | `createCookieAuth` and `createBearerAuth` live in `packages/auth/src/create-auth.ts` and are re-exported by `@epicenter/auth` and `@epicenter/auth-svelte`. |
| Cookie HTTP | `createCookieAuth.fetch` deletes `Authorization` and sends `credentials: 'include'`. |
| Bearer HTTP | `createBearerAuth.fetch` sets `Authorization: Bearer <token>` and sends `credentials: 'omit'`. |
| Persisted bearer session | `BearerSession` is one persisted value: `{ token, user, encryptionKeys }`. This is the atomic persisted session fix from the earlier auth storage work. |
| Cookie persistence | Cookie clients persist `AuthIdentity | null`, not a token-bearing session. The cookie jar is the credential source. |
| API boundary | `apps/api/src/auth/single-credential.ts` is mounted globally and rejects mixed cookie, HTTP bearer, and WebSocket bearer credentials before Better Auth sees the request. |
| Svelte wrapper | `packages/auth-svelte/src/create-auth.svelte.ts` is a thin reactive wrapper around the core factories. |

Intentional divergences from this draft:

| Original plan | Current decision |
| --- | --- |
| Split source into `cookie/`, `bearer/`, and `shared/` directories. | Keep one `create-auth.ts`. The factories are distinct enough at the public boundary; the shared Better Auth subscription machinery is small and easier to read in one file. |
| Delete the shared `AuthClient` surface. | Keep `AuthClient` as the common operational surface: `state`, `bearerToken`, `onStateChange`, auth actions, `fetch`, and dispose. The product split lives in construction and credential ownership, not in two parallel method sets. |
| Add `auth.openWebSocket` and `auth.onCredentialChange`. | Not landed. Workspace openers still receive `bearerToken: () => auth.bearerToken`, and sync reads it at connection boundaries. This remains the only substantive design fork from the original spec. |
| Make `attachSync` entirely credential-agnostic. | Partially landed. Sync no longer mutates tokens through `setToken`, but it still knows the bearer subprotocol and accepts a token callback. |
| Keep `@epicenter/auth-workspace` generic over both session shapes. | Superseded. `@epicenter/auth-workspace` is gone; app session builders now own workspace lifecycle directly. |

Remaining actionable:

1. Decide whether to finish the WebSocket inversion. The cleanest endpoint would
   be `openWebSocket` or a transport object owned by auth, so `packages/sync`
   no longer knows the bearer subprotocol. This is a design choice, not a bug.
   The current callback shape is simple and working; change it only if the
   sync package is still carrying too much auth vocabulary.
2. Migrate `apps/opensidian` and `apps/tab-manager` away from top-level
   `await waitForAuthState(auth, state => state.status === 'signed-in')`.
   They are bearer clients, so they do not map one-to-one to the cookie app
   session helpers, but the lifecycle smell is the same: signed-out boot should
   not hang module evaluation.
3. Treat the phase checklist below as historical research. Future work should
   start from the current package layout, not from the deleted
   `auth-workspace` plan or the old `createAuth` API.

## One-Sentence Test

`createCookieAuth` (the browser cookie jar owns the credential) and `createBearerAuth` (the client owns the token) are two distinct products; the API rejects any request that carries both a Better Auth session cookie and an `Authorization: Bearer` credential.

If the design needs the words "transport mode", "or both", "auto-detect", or a `transport: 'cookie' | 'bearer'` flag to read true, it is not clean yet.

## Overview

Split the single `createAuth` factory into two transport-specific factories with separate session shapes, move all credential placement (HTTP fetch, WebSocket subprotocol) inside the auth client, and enforce one credential authority per request at the API boundary.

The `token` field disappears from cookie sessions entirely; cookie auth has no token to read because the browser cookie jar is the credential. Bearer sessions keep the token; bearer clients own credential placement explicitly.

## Motivation

### Current State

A single `createAuth` factory in `packages/auth/src/create-auth.ts:117-337` produces one client that always sends both credentials in every request:

```ts
const client = createAuthClient({
	baseURL,
	basePath: '/auth',
	plugins: [InferPlugin<EpicenterCustomSessionPlugin>()],
	fetchOptions: {
		auth: {
			type: 'Bearer',
			token: () =>
				snapshot.status === 'signedIn' ? snapshot.session.token : undefined,
		},
		// Better Auth defaults credentials to 'include'
	},
});

async fetch(input, init) {
	await whenLoaded;
	const headers = new Headers(init?.headers);
	if (snapshot.status === 'signedIn') {
		headers.set('Authorization', `Bearer ${snapshot.session.token}`);
	}
	return fetch(input, { ...init, headers, credentials: 'include' });
}
```

Result: one browser request can carry `Cookie: better-auth.session_token=A` AND `Authorization: Bearer B` simultaneously.

The WebSocket sync layer also reads the auth token directly to build the subprotocol (`packages/workspace/src/document/attach-sync.ts:301-303, 677-678`):

```ts
function tokenFromSnapshot(snapshot: AuthSnapshot): string | null {
	return snapshot.status === 'signedIn' ? snapshot.session.token : null;
}
// ...
const subprotocols = [MAIN_SUBPROTOCOL];
if (token) subprotocols.push(`${BEARER_SUBPROTOCOL_PREFIX}${token}`);
```

The server's `authGuard` lifts the WebSocket bearer into `Authorization` but never strips conflicting cookies (`apps/api/src/app.ts:282-289`):

```ts
const authGuard = factory.createMiddleware(async (c, next) => {
	const token = extractBearerToken(c.req.raw.headers);
	let headers = c.req.raw.headers;
	if (token) {
		headers = new Headers(headers);
		headers.set('authorization', `Bearer ${token}`);
	}
	const result = await c.var.auth.api.getSession({ headers });
	// ...
});
```

This creates problems:

1. **The client surface pretends two unlike operations are one.** Cookie auth and bearer auth are different products with different ownership of the credential, but `auth.fetch()` treats them as interchangeable. The asymmetry leaks at every consumer that reads `snapshot.session.token`.

2. **The `token` field on cookie sessions is a meaningless leftover.** Cookie clients store a token they never send and never need; the cookie is the credential. The schema invites code that reads it "just in case" (which is what `attachSync` does today).

3. **Mixed credentials hide the precedence rule.** Better Auth's bearer plugin currently overwrites the session_token cookie when bearer is set (verified via deepwiki against the upstream `setRequestCookie` and the `changeset/fix-bearer-cookie-parse-mutate-serialize.md` fix), so bearer wins. Older Better Auth versions had the opposite behavior. Either way, the resolution is implicit, undocumented at the call site, and version-dependent.

4. **`reconcileBetterAuthCandidate` carries a precedence that exists only because of mixed credentials.** `current?.token ?? next.token` (`packages/auth/src/create-auth.ts:242`) preserves a freshly rotated bearer token against the customSession server response. That precedence is correct only when one credential authority is in use; with mixed credentials it can silently project a token from a different session.

5. **`attachSync` reaches into auth internals.** The auth invariant ("how is this WebSocket authenticated?") leaks into the sync package, which has to know the word "token" and the bearer subprotocol shape.

### Desired State

Two factories. Two snapshot types. One credential per request, structurally enforced by the type system on the client and explicitly checked at the server boundary.

```ts
// Browser apps
const auth = createCookieAuth({ baseURL, sessionStorage });
await auth.fetch(url);                      // browser cookie travels; no Authorization
const ws = auth.openWebSocket(wsUrl);       // browser cookie travels on upgrade

// Node, daemon, CLI, Chrome extension
const auth = createBearerAuth({ baseURL, sessionStorage });
await auth.fetch(url);                      // Authorization: Bearer; credentials: 'omit'
const ws = auth.openWebSocket(wsUrl);       // adds bearer.<token> subprotocol
```

```ts
type CookieAuthSession = {
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};

type BearerAuthSession = {
	token: string;
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};
```

`attachSync` no longer knows the word "token":

```ts
attachSync(doc, {
	url,
	openWebSocket: auth.openWebSocket,
	onCredentialChange: auth.onCredentialChange,
});
```

The API boundary reduces to one normalize call:

```ts
const authGuard = factory.createMiddleware(async (c, next) => {
	const credential = singleCredential(c.req.raw.headers);
	if (credential.kind === 'mixed') return rejectMixed(c);
	const result = await c.var.auth.api.getSession({ headers: credential.headers });
	if (!result) return rejectUnauth(c);
	c.set('user', result.user);
	c.set('session', result.session);
	await next();
});
```

## Vocabulary

| Term | Meaning | Owner |
| --- | --- | --- |
| `CookieAuthClient` | Browser auth client where the cookie jar owns the credential. Has no token in memory. | `@epicenter/auth/cookie` |
| `BearerAuthClient` | Auth client where the runtime owns the credential as a string. Sends `Authorization: Bearer` and `bearer.<token>` subprotocol. | `@epicenter/auth/bearer` |
| `CookieAuthSession` | Signed-in session payload for cookie clients. `{ user, encryptionKeys }`. No token. | `@epicenter/auth/cookie` |
| `BearerAuthSession` | Signed-in session payload for bearer clients. `{ token, user, encryptionKeys }`. | `@epicenter/auth/bearer` |
| `singleCredential(headers)` | API-side normalizer that returns either a normalized headers object with exactly one credential or a `mixed` rejection. | `apps/api/src/auth` |

`AuthSession`, `AuthSnapshot`, `AuthClient`, and `createAuth` cease to exist. There is no shared union type that subsumes both products.

## Research Findings

### Better Auth bearer precedence (current, upstream)

DeepWiki query against `better-auth/better-auth` confirms current behavior:

- The bearer plugin's `before` hook calls `setRequestCookie` to write the bearer token into the request as a `better-auth.session_token` cookie.
- `setRequestCookie` replaces an existing cookie with the same name rather than appending it.
- `parseCookies` in `packages/better-auth/src/cookies/index.ts` uses a `Map` keyed by cookie name; a duplicate name overwrites the previous entry.
- The repository's `.changeset/fix-bearer-cookie-parse-mutate-serialize.md` describes a past defect where merged headers carried two entries for the same name. That defect is fixed.

Implication for this spec: in current Better Auth, **bearer wins** when both credentials are present. The original problem framing assumed cookie wins (older behavior). The corruption risk is therefore smaller in steady state than the framing suggested.

Implication for the design: the *architectural* smell is independent of the resolution rule. Both behaviors (cookie wins, bearer wins) are implicit, version-dependent, and invisible at the call site. The clean break removes the possibility of the conflict, regardless of how upstream resolves it.

### App transport assignments (current code)

Walked the apps directory and the auth-svelte/auth-workspace packages. Today's effective assignments:

| Surface | File | Today | Target |
| --- | --- | --- | --- |
| `apps/dashboard` SPA at `/dashboard` (same-origin to API) | `apps/dashboard/src/lib/auth.ts` | `createAuth` | `createCookieAuth` |
| `apps/fuji` browser client | `apps/fuji/src/lib/fuji/client.ts` | `createAuth` | `createCookieAuth` |
| `apps/honeycrisp` browser client | `apps/honeycrisp/src/lib/honeycrisp/client.ts` | `createAuth` | `createCookieAuth` |
| `apps/opensidian` browser client | `apps/opensidian/src/lib/opensidian/client.ts` | `createAuth` | `createCookieAuth` |
| `apps/zhongwen` browser client | `apps/zhongwen/src/lib/zhongwen/client.ts` | `createAuth` | `createCookieAuth` |
| `apps/tab-manager` Chrome extension | `apps/tab-manager/src/lib/tab-manager/client.ts` | `createAuth` | `createBearerAuth` |
| `apps/*/daemon.ts` (zhongwen, fuji, honeycrisp, opensidian) | each `daemon.ts` | `createMachineAuthClient` | `createBearerMachineAuth` (bearer-mode wrapper) |
| `packages/cli` | `packages/cli/src/commands/auth.ts` | `createMachineAuth` | unchanged surface; bearer underneath |
| `apps/whispering` | none currently | none | none (out of scope) |

Same-origin vs cross-origin cookie config does not differ between dashboard and other browser apps, because the API server already sets `crossSubDomainCookies` (`apps/api/src/auth/create-auth.ts:109-118`) and `SameSite=None; Secure` for all cookies. One cookie factory works for both.

### Browser WebSocket cookie behavior

WebSocket upgrade is an HTTP request. Browsers send cookies on cross-origin WebSocket upgrades subject to `SameSite` rules, the same as cross-origin `fetch`. With `SameSite=None; Secure` (already configured), cookies travel on WS upgrades to `wss://api.epicenter.so/...` from any allowed origin.

Implication: cookie clients do not need a bearer subprotocol on WebSocket. `auth.openWebSocket` for cookie auth is just `new WebSocket(url, baseProtocols)`.

### Chrome extension cookie behavior

Chrome extensions can fetch with `credentials: 'include'` and the browser sends the host's cookies if `host_permissions` includes the host. We have an established bearer pattern (`tab-manager` stores `AuthSession` with token in `chrome.storage.local`), and the design preference for explicit credential ownership maps cleanly to bearer.

Recommendation captured below: keep the extension on bearer.

### Existing related specs in this repo

| Spec | What it established | How this spec relates |
| --- | --- | --- |
| `20260503T180000-auth-snapshot-three-state-clean-break.md` | `AuthSnapshot` is a real three-state machine. | Same shape carried into both new snapshots. |
| `20260503T010845-auth-credential-source-of-truth.md` | `AuthCredential` aggregate distinguishing `authorizationToken` from `serverSession.token`. | Bearer factory uses the same vocabulary; cookie factory has neither. |
| `20260503T012932-local-auth-session-clean-break.md` | Browser storage uses `AuthSession.or('null')` projection. | Browser storage moves to `CookieAuthSession.or('null')`. |
| `20260501T221831-auth-workspace-lifecycle-inversion.md` | `bindAuthWorkspaceScope` consumes a generic auth client. | Generic stays; signature widens to accept either client. |

## Design Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Number of factories | Two: `createCookieAuth`, `createBearerAuth` | Two products, not one product with a flag. |
| Shared snapshot union | None | A union resurrects the implicit decision the clean break is designed to remove. |
| Cookie session shape | `{ user, encryptionKeys }` (no `token`) | The browser cookie jar owns the credential. A token field invites consumers to send it. |
| Bearer session shape | `{ token, user, encryptionKeys }` | Bearer clients must own the token explicitly. |
| `auth.fetch` for cookie | `credentials: 'include'`, never sets `Authorization` | One credential, browser-owned. |
| `auth.fetch` for bearer | `credentials: 'omit'`, always sets `Authorization` | One credential, client-owned. |
| `auth.openWebSocket` | New method on both clients | Removes `attachSync`'s direct dependency on the snapshot's token field. |
| `attachSync` auth | Replace `auth: AuthClient` with `openWebSocket` and `onCredentialChange` capabilities | `attachSync` becomes auth-agnostic. |
| Server normalization | `singleCredential(headers)` returns ok with one credential, or `mixed` | Symmetric server-side enforcement of the client invariant. |
| Mixed credentials policy | Reject with HTTP 400 / WS 4400 | Strict surfaces bugs; silent stripping hides them. |
| Reconcile precedence | Bearer factory keeps `current?.token ?? next.token`; cookie factory has no token field at all | The precedence is meaningful only for bearer; with one-credential-per-request enforced, it cannot project a token from a different session. |
| Better Auth client `auth` config | Cookie factory does not configure `auth: { type: 'Bearer' }`; bearer factory does | Each factory speaks one transport to the underlying Better Auth client. |
| Backwards compatibility | None | The user has confirmed no users to migrate; one-sweep break per `cohesive-clean-breaks` skill. |
| Chrome extension transport | Stay on bearer | Existing pattern; explicit credential ownership matches extension storage idioms. |
| Whispering migration | Out of scope | App does not currently use auth. |
| `createMachineAuth` (CLI device flow) | Public surface unchanged | Internal storage uses `BearerAuthSession` instead of `AuthSession`. |
| Token rotation handler | Bearer-only; cookie has nothing to rotate client-side | The browser updates cookies via `Set-Cookie`. Bearer must read `set-auth-token`. |

## Architecture

### Current

```
                packages/auth/src/create-auth.ts
                       |
                       v
                +----------------+
                |   createAuth   |   <-- single factory, both transports
                +----------------+
                       |
                       +-- AuthSession { token, user, encryptionKeys }
                       +-- AuthSnapshot { loading | signedOut | signedIn }
                       +-- fetch(): credentials:'include' + Authorization: Bearer
                       +-- snapshot.session.token  <-- read by attachSync
                                |
                                v
                packages/workspace/src/document/attach-sync.ts
                       |
                       +-- subprotocol = [MAIN, bearer.<token>]
                                |
                                v
                apps/api/src/app.ts
                       |
                       +-- authGuard: lift WS bearer to Authorization;
                           never strips cookies
                                |
                                v
                       Better Auth getSession (bearer wins on conflict in current upstream)
```

### Target

```
              packages/auth/src/cookie/create-cookie-auth.ts
                     |
                     v
              +----------------------+
              |  createCookieAuth    |
              +----------------------+
                     |
                     +-- CookieAuthSession { user, encryptionKeys }
                     +-- CookieAuthSnapshot { loading | signedOut | signedIn }
                     +-- fetch(): credentials:'include', no Authorization
                     +-- openWebSocket(url, baseProtocols?): WebSocket
                     +-- onCredentialChange(handler): unsubscribe


              packages/auth/src/bearer/create-bearer-auth.ts
                     |
                     v
              +----------------------+
              |  createBearerAuth    |
              +----------------------+
                     |
                     +-- BearerAuthSession { token, user, encryptionKeys }
                     +-- BearerAuthSnapshot { loading | signedOut | signedIn }
                     +-- fetch(): credentials:'omit', Authorization: Bearer
                     +-- openWebSocket(url, baseProtocols?): adds bearer.<token>
                     +-- onCredentialChange(handler): unsubscribe


              packages/workspace/src/document/attach-sync.ts
                     |
                     +-- consumes openWebSocket capability
                     +-- consumes onCredentialChange capability
                     +-- no token reading, no subprotocol assembly


              apps/api/src/app.ts
                     |
                     +-- singleCredential(headers)
                     |     -> ok | mixed
                     +-- authGuard: rejectMixed | getSession(normalized)
                                |
                                v
                       Better Auth getSession (sees exactly one credential)
```

### Per-app surface map (target)

```
apps/dashboard            createCookieAuth         (same-origin)
apps/fuji/.../client      createCookieAuth         (cross-origin browser)
apps/honeycrisp/.../client createCookieAuth        (cross-origin browser)
apps/opensidian/.../client createCookieAuth        (cross-origin browser)
apps/zhongwen/.../client   createCookieAuth        (cross-origin browser)
apps/tab-manager/.../client createBearerAuth       (Chrome extension)
apps/*/daemon.ts           createBearerMachineAuth (Node, OS keychain)
packages/cli               createMachineAuth (unchanged surface)
```

## Implementation Plan

### Phase 1: Split the auth package

- [ ] **1.1** Create `packages/auth/src/shared/` containing `auth-user.ts` (AuthUser), `auth-error.ts` (AuthError), `session-storage.ts` (SessionStorage, SessionStateAdapter, createSessionStorageAdapter), and `better-auth-bridge.ts` (BetterAuthSessionResponse plus normalize functions). Move existing types from `auth-types.ts`, `session-store.ts`, and `contracts/auth-session.ts` here.
- [ ] **1.2** Create `packages/auth/src/cookie/auth-types.ts` with `CookieAuthSession` (arktype, no `token` field), `CookieAuthSnapshot`, and the snapshot-change listener type. The session schema must validate exactly `{ user, encryptionKeys }`.
- [ ] **1.3** Create `packages/auth/src/bearer/auth-types.ts` with `BearerAuthSession` (arktype, includes `token`), `BearerAuthSnapshot`, and the snapshot-change listener type.
- [ ] **1.4** Create `packages/auth/src/cookie/create-cookie-auth.ts` with `createCookieAuth(config): CookieAuthClient`. Internals:
  - Build `createAuthClient` with `fetchOptions` that omit `auth: Bearer` and rely on default `credentials: 'include'`.
  - `fetch(input, init)` sets `credentials: 'include'`, never sets `Authorization`.
  - `openWebSocket(url, baseProtocols = [MAIN_SUBPROTOCOL])` returns `new WebSocket(url, baseProtocols)`. Browser sends cookies on upgrade.
  - `onCredentialChange(handler)` triggers when `snapshot.session.user.id` changes between snapshots (no token to watch).
  - No `set-auth-token` rotation hook.
  - Snapshot reconcile: project Better Auth response into `{ user, encryptionKeys }`. No token logic.
- [ ] **1.5** Create `packages/auth/src/bearer/create-bearer-auth.ts` with `createBearerAuth(config): BearerAuthClient`. Internals:
  - Build `createAuthClient` with `fetchOptions.auth: { type: 'Bearer', token }` and `fetchOptions.credentials: 'omit'`.
  - `fetch(input, init)` sets `credentials: 'omit'` and always sets `Authorization: Bearer ${token}` when signed in.
  - `openWebSocket(url, baseProtocols = [MAIN_SUBPROTOCOL])` returns `new WebSocket(url, signedIn ? [...baseProtocols, 'bearer.${token}'] : baseProtocols)`.
  - `onCredentialChange(handler)` triggers when `snapshot.session.token` changes.
  - Keep `set-auth-token` rotation hook on `onSuccess`.
  - Snapshot reconcile: keep `current?.token ?? next.token` for token rotation; project user and encryption keys from the response.
- [ ] **1.6** Update `packages/auth/src/index.ts` to export both factories, both snapshot types, both session schemas, the shared `AuthUser`, `AuthError`, `SessionStorage`, `SessionStateAdapter`, `createSessionStorageAdapter`. Delete the `AuthSession`, `AuthSnapshot`, `AuthClient`, `CreateAuthConfig`, `createAuth` exports.
- [ ] **1.7** Delete `packages/auth/src/create-auth.ts`, `packages/auth/src/auth-types.ts`, `packages/auth/src/session-store.ts` (after moving content). Delete `packages/auth/src/contracts/` if empty.
- [ ] **1.8** Mirror the test layout: `cookie/create-cookie-auth.test.ts` and `bearer/create-bearer-auth.test.ts`. Adapt the existing `create-auth.test.ts` cases. The "BA emission before boot cache resolves" invariant must hold for both factories.

### Phase 2: attachSync inversion of control

- [ ] **2.1** In `packages/workspace/src/document/attach-sync.ts`, replace the `auth?: AuthClient` field on `SyncAttachmentConfig` with two capability fields:
  ```ts
  openWebSocket: (url: string, baseProtocols: string[]) => SyncWebSocket;
  onCredentialChange?: (handler: () => void) => () => void;
  ```
  When `onCredentialChange` is omitted, the supervisor never reconnects on credential change.
- [ ] **2.2** Delete `tokenFromSnapshot`, `currentToken`, `readToken`, `requiresToken`, and the bearer subprotocol assembly inside `attemptConnection`. The supervisor calls `openWebSocket(url, [MAIN_SUBPROTOCOL])` and lets the auth client decide what to add.
- [ ] **2.3** Update `attachSync`'s exported types to remove the `AuthClient` import.
- [ ] **2.4** Update tests for `attachSync` that pass a fake `auth`. They should pass a fake `openWebSocket` and (optionally) a fake `onCredentialChange`.

### Phase 3: Server boundary

- [ ] **3.1** Create `apps/api/src/auth/single-credential.ts` exporting `singleCredential(headers): { kind: 'ok'; headers: Headers } | { kind: 'mixed' } | { kind: 'none' }`. Implementation outline:
  - Read WS subprotocol bearer via `extractBearerToken`.
  - Read `Authorization: Bearer` from headers.
  - Read presence of any cookie whose name starts with `better-auth.` or matches the configured session cookie prefix.
  - If both bearer (HTTP or WS) and a Better Auth session cookie are present, return `mixed`.
  - If WS bearer is present and HTTP Authorization is not, lift it into a cloned Headers and return ok.
  - If only one credential is present, return ok with the original or cloned headers.
  - If neither, return `none`.
- [ ] **3.2** Replace `apps/api/src/app.ts:282-304` `authGuard` with the normalized version. Mixed credentials return HTTP 400 with `{ error: 'mixed_credentials' }` for normal requests; WebSocket upgrades close with code 4400 and reason `{ code: 'mixed_credentials' }`. Note: confirm 4400 versus 4401 separation in `packages/sync` so the client distinguishes mixed-credentials from invalid-token.
- [ ] **3.3** Apply `singleCredential` to the auth pages too: `/sign-in`, `/consent`, `/device`, and the Better Auth handler at `/auth/*`. Each call site that does `c.var.auth.api.getSession({ headers: c.req.raw.headers })` becomes `c.var.auth.api.getSession({ headers: singleCredential(c.req.raw.headers).headers })`, with mixed credentials handled per the route's needs (sign-in tolerates none; consent and device require ok).
- [ ] **3.4** Add unit tests for `singleCredential`: only-cookie passes, only-bearer passes, only-WS-bearer becomes Authorization, mixed cookie+bearer rejects, mixed cookie+WS-bearer rejects, neither yields none.

### Phase 4: Migrate browser apps to createCookieAuth

- [ ] **4.1** `apps/dashboard/src/lib/auth.ts`: import `createCookieAuth` and `CookieAuthSession`. Rename the `createPersistedState` schema from `AuthSession` to `CookieAuthSession`. Replace the `createAuth` call.
- [ ] **4.2** `apps/fuji/src/lib/fuji/client.ts`: same migration. Update the `bindAuthWorkspaceScope` call: the `applyAuthSession` callback signature changes (no token parameter, but the workspace scope already only reads `session.encryptionKeys` and `session.user.id`).
- [ ] **4.3** `apps/honeycrisp/src/lib/honeycrisp/client.ts`: same as fuji.
- [ ] **4.4** `apps/opensidian/src/lib/opensidian/client.ts`: same as fuji.
- [ ] **4.5** `apps/zhongwen/src/lib/zhongwen/client.ts`: same as fuji.
- [ ] **4.6** Confirm `bindAuthWorkspaceScope` (`packages/auth-workspace/src/index.ts`) reads only common fields. Today: `session.user.id` and `session.encryptionKeys`. Both are present in `CookieAuthSession`. Make `AuthWorkspaceScopeOptions` generic over the auth client and the session shape so it accepts either factory's output.

### Phase 5: Migrate bearer surfaces

- [ ] **5.1** `apps/tab-manager/src/lib/auth.ts`: switch the storage schema from `AuthSession.or('null')` to `BearerAuthSession.or('null')`. Existing extension-stored sessions become invalid and fall back to `null`; users must sign in again. Acceptable per "no users" assumption.
- [ ] **5.2** `apps/tab-manager/src/lib/tab-manager/client.ts`: switch the factory to `createBearerAuth`.
- [ ] **5.3** `packages/auth/src/node/machine-auth.ts`: replace internal `AuthSession` with `BearerAuthSession`. The keychain blob shape is the same fields. `parseStoredSession`, `sessionSummary`, and `MachineSessionSummary` keep their structure. `createMachineAuthClient()` returns a `BearerAuthClient`.
- [ ] **5.4** Rename `createMachineAuthClient` to `createBearerMachineAuthClient` (open question on whether to do this rename).
- [ ] **5.5** All `apps/*/daemon.ts` files: confirm they use `createMachineAuthClient`. They should still compile after the internal switch; the type they import is `AuthClient` -> change to `BearerAuthClient`.

### Phase 6: Sync wiring per app

- [ ] **6.1** In each app's `client.ts` and `browser.ts` and `daemon.ts` that calls `attachSync({ auth })`, change to:
  ```ts
  attachSync(doc, {
      url,
      openWebSocket: auth.openWebSocket,
      onCredentialChange: auth.onCredentialChange,
      // ... waitFor, awareness, etc.
  });
  ```
- [ ] **6.2** Update the `SyncAttachmentConfig` documentation comment to describe the new capabilities.

### Phase 7: Update auth-svelte and auth-workspace

- [ ] **7.1** `packages/auth-svelte/src/create-auth.svelte.ts`: split into `create-cookie-auth.svelte.ts` and `create-bearer-auth.svelte.ts`. Each wraps the corresponding core factory with a Svelte 5 $state mirror. Re-export both from the package index.
- [ ] **7.2** `packages/auth-svelte/src/index.ts`: export `createCookieAuth`, `createBearerAuth`, `CookieAuthSession`, `BearerAuthSession`, both snapshot types, both client types. Delete `createAuth`, `AuthSession`, `AuthSnapshot`, `AuthClient` exports.
- [ ] **7.3** `packages/auth-workspace/src/index.ts`: parameterize `AuthWorkspaceScopeOptions` over the auth client type. `SignedInSession` becomes a generic placeholder satisfied by both `CookieAuthSession` and `BearerAuthSession`.

### Phase 8: Skill and documentation sweep

- [ ] **8.1** Update `.agents/skills/auth/SKILL.md` (or equivalent path; see `specs/20260503T180000-auth-snapshot-three-state-clean-break.md` step 3.6 for the precedent) to describe the two-factory model. Delete any reference to a single `createAuth` factory.
- [ ] **8.2** Grep the repo for `from '@epicenter/auth'` and `from '@epicenter/auth-svelte'`. Confirm every consumer imports either `createCookieAuth` or `createBearerAuth`. No surface should still import `createAuth`.
- [ ] **8.3** Grep for `AuthSession`, `AuthSnapshot`, `AuthClient`. Replace each with the cookie or bearer variant. Where the symbol is used in a generic context (e.g. `auth-workspace`), parameterize.
- [ ] **8.4** Update or delete spec references in older specs that describe the single-factory model. Add a one-line "Superseded by" reference in those specs pointing at this one if they document a now-stale shape.

### Phase 9: Verify

- [ ] **9.1** `bun run --filter @epicenter/auth typecheck`
- [ ] **9.2** `bun run --filter @epicenter/auth-svelte typecheck`
- [ ] **9.3** `bun run --filter @epicenter/auth-workspace typecheck`
- [ ] **9.4** `bun test packages/auth/src`
- [ ] **9.5** `bun test packages/workspace/src/document/attach-sync.test.ts` (or equivalent)
- [ ] **9.6** Per-app typechecks for `dashboard`, `fuji`, `honeycrisp`, `opensidian`, `zhongwen`, `tab-manager`. Document any pre-existing failures (per the precedent in `20260503T180000`'s review section).
- [ ] **9.7** Manual smoke: dashboard signs in via cookies; tab-manager signs in via bearer; CLI device flow signs in via bearer. Each verifies the WS sync establishes.

## Edge Cases

### Cookie client tries to send Authorization

It cannot. `createCookieAuth.fetch()` does not set the header, and the underlying `createAuthClient` is configured without `auth: { type: 'Bearer' }`. There is no client surface that exposes a token to read.

### Bearer client tries to send cookies

It cannot. `createBearerAuth.fetch()` sets `credentials: 'omit'`, and `createAuthClient` is configured the same way. The browser cookie jar is bypassed even if cookies happen to exist for the host.

### Server receives mixed credentials

`singleCredential` returns `mixed`. HTTP routes 400. WS upgrades close with code 4400. Cookie clients and bearer clients in normal operation cannot produce this state; only a misbehaving custom client or a debug tool can. The error names the contract.

### Better Auth changes the bearer-vs-cookie precedence again

Irrelevant. The server boundary refuses the conflict before reaching Better Auth.

### Token rotation (bearer only)

Server returns `set-auth-token` on responses. Bearer factory's `onSuccess` hook updates the in-memory token. `onCredentialChange` fires, which causes `attachSync` to reconnect with the new bearer subprotocol. Same behavior as today, but isolated to the bearer factory.

### Cookie token rotation

Cookie clients have no token to rotate. The browser updates the cookie via `Set-Cookie` from the response. `onCredentialChange` fires only on user-id transitions (sign-in / sign-out / cross-user), not on cookie refresh.

### Sign-in flow (cookie)

`auth.signIn(...)` calls Better Auth's email sign-in. Server response includes `Set-Cookie: better-auth.session_token=...`. Browser stores it. The Better Auth client's `useSession` subscription emits the new session; the cookie factory writes the snapshot.

### Sign-in flow (bearer)

`auth.signIn(...)` calls Better Auth's email sign-in. Server response includes `set-auth-token: ...` (the bearer plugin emits this). The bearer factory's `onSuccess` reads it and stores the token in the snapshot. The `useSession` subscription emits user details; reconcile keeps the freshly stored token.

### Sign-out flow

Both factories call `client.signOut()` which clears server state. The client writes `{ status: 'signedOut' }`. Cookie clients stop sending cookies (server has cleared them). Bearer clients drop the in-memory token.

### Persisted browser snapshot is invalid after upgrade

Existing apps store `AuthSession.or('null')`. After this break, browser apps store `CookieAuthSession.or('null')`, which has no `token`. Existing entries fail validation and fall back to `null`. The user signs in again. Acceptable per the no-users assumption.

### Existing tab-manager Chrome extension storage

`AuthSession.or('null')` becomes `BearerAuthSession.or('null')`. Same fields, no schema break in practice (token + user + encryption keys). Existing entries should validate; double-check by reading current `AuthSession` shape and confirming `BearerAuthSession` is a structural superset minus.

Actually, the schema is the same shape today; `BearerAuthSession` is `{ token, user, encryptionKeys }`. So tab-manager storage continues to validate without forcing re-auth. Worth confirming during implementation.

### Server-rendered auth pages with mixed credentials

The `/sign-in` page is reachable while signed-out. If the request carries a cookie AND a bearer (which it shouldn't in practice), the page should still render the form rather than 400. Decision: `singleCredential` is a normalize utility; the auth pages decide whether to treat `mixed` as 400 or as "no session" depending on the page semantics. Sign-in and sign-up tolerate `mixed` (rendering as if signed-out); consent and device require `ok`.

### `bindAuthWorkspaceScope` generic over session shape

Today's signature reads `session.user.id` and `session.encryptionKeys` only. Both are common fields. The generic parameter can be a structural type with those two fields, satisfied by both `CookieAuthSession` and `BearerAuthSession`. No app-side change beyond the migration.

## Open Questions

1. **Should `createMachineAuthClient` be renamed to `createBearerMachineAuthClient`?**
   - Options: (a) rename to make the transport explicit; (b) keep the name because "machine auth" already implies bearer in this codebase.
   - **Recommendation**: keep the name. Machines are bearer in practice, and the new factory name space (`createBearerAuth` is the public contract; machine auth is a packaging detail) makes the rename redundant.

2. **Where does `singleCredential` live?**
   - Options: (a) `apps/api/src/auth/single-credential.ts` (server-only utility); (b) `packages/sync/src/single-credential.ts` (shared with anything that handles WS subprotocols); (c) `packages/auth/src/server/` if we add a server-side surface to the auth package.
   - **Recommendation**: (a). Only `apps/api` enforces the boundary today. If a second server emerges, promote.

3. **Should mixed credentials respond with 400 or 401?**
   - Options: (a) 400 (malformed request); (b) 401 (rejecting a credential proposal); (c) custom 4xx.
   - **Recommendation**: 400. Mixed credentials are a client bug, not a credential validity question. WS uses 4400 to leave 4401 for "invalid token".

4. **Should `attachSync` accept a single `auth` capability bag or two flat parameters?**
   - Options: (a) two flat parameters (`openWebSocket`, `onCredentialChange`); (b) one `auth: { openWebSocket, onCredentialChange }` bag.
   - **Recommendation**: (a). The flat signature is more honest about what attachSync actually consumes (one capability + one optional event source), and the single-method bag is the smell `cohesive-clean-breaks` warns about.

5. **Should the cookie factory expose a `whenLoaded` distinct from the bearer factory's, or a shared interface?**
   - Both factories return `whenLoaded: Promise<void>`. The shape is identical; the timing is identical (boot cache load + Better Auth subscription open). No reason to diverge.
   - **Recommendation**: identical shape. Document as a contract both factories honor.

6. **Should the `auth-svelte` package collapse into one factory now that the underlying auth has two?**
   - Options: (a) one Svelte wrapper that takes either client and produces a $state mirror (the wrapper is identical); (b) two wrappers mirroring the core factories.
   - **Recommendation**: (a). The wrapper does not depend on the snapshot shape; it just mirrors `client.snapshot` into `$state`. Generic over the client.

7. **Should there be a runtime assertion in `singleCredential` against header smuggling (e.g. `Cookie: foo=bar; better-auth.session_token=...; bar=baz` in a single line)?**
   - The default cookie parser handles this. We rely on the parser semantics.
   - **Recommendation**: no extra assertion. The boundary trusts standard parsing.

8. **Future: Whispering on bearer or cookie?**
   - Out of scope for this spec. When Whispering adopts auth, it will choose at that time. Tauri webview = bearer is the most likely answer per the design preference for explicit credential ownership.

## Success Criteria

- [ ] No source file imports `createAuth`, `AuthSession`, `AuthSnapshot`, or `AuthClient` from `@epicenter/auth` or `@epicenter/auth-svelte`.
- [ ] `packages/auth/src/index.ts` exports two factories and zero union types over them.
- [ ] `CookieAuthSession` has no `token` field; the schema rejects payloads that include one.
- [ ] `BearerAuthSession` has a required `token` field.
- [ ] `attachSync` does not import any symbol from `@epicenter/auth`.
- [ ] `apps/api/src/app.ts` `authGuard` calls `singleCredential` and rejects mixed credentials.
- [ ] `singleCredential` has unit tests covering the four boundary cases (cookie-only, bearer-only, WS-bearer-only, mixed).
- [ ] `bun run --filter @epicenter/auth test` passes.
- [ ] Each migrated app typechecks (modulo pre-existing unrelated failures, documented in the review).
- [ ] Manual smoke: dashboard cookie sign-in works; tab-manager bearer sign-in works; CLI device flow works; each WebSocket sync establishes against the new server normalizer.

## References

Files this spec touches:

- `packages/auth/src/index.ts`
- `packages/auth/src/auth-types.ts` (deleted; content moved)
- `packages/auth/src/create-auth.ts` (deleted; replaced by two factories)
- `packages/auth/src/session-store.ts` (moved to `shared/`)
- `packages/auth/src/contracts/auth-session.ts` (moved to `shared/better-auth-bridge.ts`)
- `packages/auth/src/cookie/auth-types.ts` (new)
- `packages/auth/src/cookie/create-cookie-auth.ts` (new)
- `packages/auth/src/bearer/auth-types.ts` (new)
- `packages/auth/src/bearer/create-bearer-auth.ts` (new)
- `packages/auth/src/node/machine-auth.ts` (internal type swap)
- `packages/auth-svelte/src/index.ts`
- `packages/auth-svelte/src/create-auth.svelte.ts` (replaced by per-factory wrappers, or one generic wrapper)
- `packages/auth-workspace/src/index.ts`
- `packages/workspace/src/document/attach-sync.ts`
- `apps/api/src/app.ts`
- `apps/api/src/auth/single-credential.ts` (new)
- `apps/dashboard/src/lib/auth.ts`
- `apps/fuji/src/lib/fuji/client.ts`
- `apps/fuji/src/lib/fuji/browser.ts` (attachSync wiring only)
- `apps/honeycrisp/src/lib/honeycrisp/client.ts`
- `apps/honeycrisp/src/lib/honeycrisp/browser.ts`
- `apps/opensidian/src/lib/opensidian/client.ts`
- `apps/opensidian/src/lib/opensidian/browser.ts`
- `apps/zhongwen/src/lib/zhongwen/client.ts`
- `apps/tab-manager/src/lib/auth.ts`
- `apps/tab-manager/src/lib/tab-manager/client.ts`
- `apps/*/daemon.ts` (sync wiring)

Files consulted (no expected changes):

- `apps/api/src/auth/create-auth.ts` (the API still uses `bearer()` and cookies; only the boundary changes)
- `apps/api/src/base-sync-room.ts`
- `packages/sync/src/auth-subprotocol.ts`
- `packages/cli/src/commands/auth.ts`

Prior specs that produced the current shape:

- `specs/20260503T180000-auth-snapshot-three-state-clean-break.md`
- `specs/20260503T010845-auth-credential-source-of-truth.md`
- `specs/20260503T012932-local-auth-session-clean-break.md`
- `specs/20260501T221831-auth-workspace-lifecycle-inversion.md`
- `specs/20260503T002441-auth-client-sync-clean-break.md`

External references:

- Better Auth bearer plugin source and `setRequestCookie` semantics (verified via deepwiki against `better-auth/better-auth`).
- `node_modules/.bun/better-auth@*/.../plugins/bearer/index.mjs` (installed source).
- `node_modules/.bun/better-call@*/dist/cookies.mjs` (installed cookie parser, now superseded by the parseCookies in the core package).
- `.changeset/fix-bearer-cookie-parse-mutate-serialize.md` (in better-auth repo) documenting the bearer-cookie collision fix.
- [Better Auth Bearer Plugin docs](https://better-auth.com/docs/plugins/bearer)
- [Better Auth Cookies](https://better-auth.com/docs/concepts/cookies)
- [WebSocket browser API and subprotocols](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)

## Notes for the Implementer

Two cautions worth holding while executing this plan:

1. **The Better Auth client is configured once at construction, but the auth client surface is consumed across the app over time.** When you write the factory, audit every callback that reads from `snapshot.session` (`onSuccess` rotation, reconcile, `auth.fetch`, `auth.openWebSocket`) and confirm each one is honest about the transport. Cookie callbacks should not even reference a token; bearer callbacks should not assume cookies travel.

2. **`bindAuthWorkspaceScope` is a generic consumer.** It is the test for whether the new types are honestly common. If you find yourself adding `if ('token' in session)` inside `auth-workspace`, the parameterization is wrong; the workspace scope should consume only the union shape (user + encryption keys), and the parameter should let TypeScript prove that.

The acid test before declaring this done: read every place that imports from `@epicenter/auth` or `@epicenter/auth-svelte` and confirm none of them say "or" inside a single product. If any consumer needs to know whether it has a cookie client or a bearer client (beyond construction), the boundary is in the wrong place.
