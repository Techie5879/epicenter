# OAuth launcher ownership collapse

OAuth client owns the PKCE/state/code-verifier transaction and token exchange; launcher owns the transport (redirect, web-auth, deep link, paste); auth core owns persisted identity, refresh, network gate, and same-owner guard.

That sentence is the whole architecture. The current code disagrees with it in eight specific places. This spec lists the disagreements and the collapses that fix them.

## Why this spec exists

Commit `bb0004df8` was directionally right (`redirectUri` is per-launch, not per-client; `OAuthLaunchResult` is a real union, not a nullable grant). It did not finish. The shapes are still split across the wrong owners, there are duplicate names for the same contract, and one-field types and one-caller helpers earn nothing.

We have no published v1, no external consumers, no compatibility constraint inside the monorepo. The only durable shapes are `PersistedAuth`, `ApiSessionResponse`, the OAuth wire protocol (RFC 6749), and the deployed token/revoke endpoints. Everything else is internal and movable.

## Current state

```
packages/auth/
├── src/create-oauth-app-auth.ts
│   ├─ defines OAuthLaunchResult            (wrong owner)
│   ├─ defines OAuthSignInLauncher          (duplicate)
│   └─ createOAuthAppAuth(...)              (auth core; correct)
├── src/oauth-launchers/index.ts
│   ├─ re-exports OAuthLaunchResult         (wrong direction)
│   ├─ defines OAuthLauncher                (duplicate)
│   ├─ defines OAuthClientConfig
│   ├─ defines OAuthAuthorizationRequest    (one-field type)
│   ├─ createOAuthClient(...)               (PKCE + token exchange; correct)
│   ├─ createBrowserOAuthLauncher(...)
│   └─ createExtensionOAuthLauncher(...)
├── src/node/oob-launcher.ts                (OOB; correct, separate dance)
└── src/node/machine-auth.ts
    └─ CommonConfig { redirectUri?: string } (leak; only OOB needs it)

apps/fuji/src/lib/
├── oauth-launcher.browser.ts               (9-line default-applying shim)
├── oauth-launcher.tauri.ts                 (real native launcher, 140 lines)
└── auth.ts                                 (imports './oauth-launcher', Vite
                                              resolves .browser.ts / .tauri.ts)
```

Data flow today, browser variant:

```
                 createOAuthAppAuth
                        │
                        │ launcher: OAuthSignInLauncher
                        ▼
              createBrowserOAuthLauncher
                        │
                        │ wraps
                        ▼
                 createOAuthClient
                  │            │
       createAuthorizationUrl  handleCallback
                  │            │
                  ▼            ▼
            storage.setItem    storage.getItem
            (PKCE + state +    + token exchange
             redirectUri)
```

`handleCallback` returns `MissingCallbackTransaction` for two distinct conditions:
1. URL has no `code` / `error` params (not an OAuth callback).
2. URL is a callback, but no PKCE transaction is stored.

Browser launcher uses (1) to decide "this is just a sign-in page load, start a fresh redirect." Condition (2) is a real bug (callback returned after transaction cleared), but it currently looks identical to (1) and silently restarts.

## Target state

```
packages/auth/
├── src/oauth-launchers/
│   ├── contract.ts                         OAuthLauncher, OAuthLaunchResult
│   ├── client.ts                           createOAuthClient
│   │                                       (isCallback + exchangeCallback,
│   │                                        createAuthorizationUrl)
│   ├── browser.ts                          createBrowserOAuthLauncher
│   └── extension.ts                        createExtensionOAuthLauncher
├── src/create-oauth-app-auth.ts            imports OAuthLauncher from
│                                            ./oauth-launchers/contract
├── src/node/oob-launcher.ts                unchanged shape; reports OAuthLauncher
└── src/node/machine-auth.ts                redirectUri lives only in
                                             LoginWithOobConfig

apps/fuji/src/lib/
├── oauth-launcher.tauri.ts                 real native launcher (kept)
├── auth.browser.ts                         inline createBrowserOAuthLauncher
└── auth.tauri.ts                           inline Tauri launcher wiring
                                             (no `oauth-launcher.browser.ts` shim,
                                              no `./oauth-launcher` indirection)
```

Data flow, browser variant (target):

```
              createOAuthAppAuth
                     │
                     │ launcher: OAuthLauncher
                     ▼
           createBrowserOAuthLauncher
                     │
                     ▼
              createOAuthClient
            │           │           │
       isCallback  createAuthUrl  exchangeCallback
            │           │           │
            ▼           ▼           ▼
      cheap check   storage.set  storage.get +
                                  token exchange
```

`isCallback(url)` is a pure check. `exchangeCallback(url)` is only called when `isCallback(url)` is true. `MissingCallbackTransaction` then means a real broken-state condition: the user returned to a callback URL after the transaction was cleared.

## Value ownership

| Value | Owner | Where it lives | Lifetime |
|------|------|---------------|----------|
| `issuer` | OAuth client | `OAuthClientConfig` | Process |
| `clientId` | OAuth client + auth core | `OAuthClientConfig` and `CreateOAuthAppAuthConfig` (refresh + revoke) | Process |
| `resource` | OAuth client | `OAuthClientConfig` | Process |
| `scope` | OAuth client | `OAuthClientConfig` (default `EPICENTER_OAUTH_SCOPE`) | Process |
| `redirectUri` | Launcher | Launcher config, passed into `createAuthorizationUrl(redirectUri)` per launch | One sign-in |
| `state` | OAuth client | Generated in `createAuthorizationUrl`, stored in transaction, checked in `exchangeCallback` | One sign-in |
| `codeVerifier` | OAuth client | Generated in `createAuthorizationUrl`, stored in transaction, used by `oauth.authorizationCodeGrantRequest` | One sign-in |
| Transaction storage | OAuth client | `OAuthClientConfig.storage: OAuthTemporaryStorage` | One sign-in |
| Callback URL | Launcher | Launcher captures via deep link (Tauri), web-auth response (extension), `window.location` (browser), or paste (OOB) | One sign-in |
| Token grant | Launcher returns it; auth core stores it | `OAuthLaunchResult.completed.grant` then `PersistedAuth.grant` | Until refresh / revoke |
| Persisted auth (grant + identity + keyring) | Auth core | `PersistedAuthStorage` (per app: `createPersistedState`, `chrome.storage.local`, machine auth file) | Durable |

Refuse: an `OAuthAuthorizationRequest` type to wrap `redirectUri`. It is one parameter; pass it inline.

## RFC 6749 anchor: redirect URI invariant

`oauth4webapi` exposes the protocol shape:

- `validateAuthResponse(as, client, parameters, expectedState)` validates `code`, `error`, `iss`, and `state`. It does not validate `redirect_uri` because the callback URL itself is the redirect URI.
- `authorizationCodeGrantRequest(as, client, clientAuth, callbackParameters, redirectUri, codeVerifier, options)` sends `redirect_uri` in the token request body. The authorization server requires it to match the value sent in the authorization request.

So the invariant is: **the `redirect_uri` sent at authorization time must equal the `redirect_uri` sent at token exchange time**. The current client honors this by storing `redirectUri` in the transaction. That part is right. The client is the only place that should hold this invariant; launchers must not bypass it by calling `oauth.authorizationCodeGrantRequest` directly. They do not, today; preserve that.

The current client does not verify that the inbound callback URL's path matches the configured `redirectUri`. That is correct: matching is the launcher's job (Tauri's `isRedirectUrl`, the browser's natural same-origin landing, the extension's `launchWebAuthFlow` return URL).

## Decisions

Classification:
- **Class 1** evidence: the codebase or RFC tells us the answer.
- **Class 2** design coherence: one shape collapses several spread-out shapes; the win is naming, not behavior.
- **Class 3** taste under constraints: defensible either way; pick one and move.

| # | Decision | Class | Rationale |
|---|---------|-------|----------|
| 1 | Move `OAuthLaunchResult` and the launcher contract to `oauth-launchers/contract.ts`. `create-oauth-app-auth.ts` imports it. | 2 | The launcher package defines the protocol it implements. Auth core consumes it. Today the import goes the wrong way and `oauth-launchers/index.ts` re-exports it. |
| 2 | Collapse `OAuthSignInLauncher` and `OAuthLauncher` into one type, `OAuthLauncher`. Error is `unknown`. Internal launchers can satisfy with narrower errors. | 1 | Two names, same shape. The narrower-error version is still assignable to the wider one. `OAuthSignInLauncher` redundantly says "sign in." |
| 3 | Delete `OAuthAuthorizationRequest`. `createAuthorizationUrl(redirectUri: string)` takes a string. | 1 | One-field type that adds no contract. Removing it removes `Partial<OAuthAuthorizationRequest>` in Fuji. |
| 4 | Split `handleCallback` into `isCallback(url): boolean` and `exchangeCallback(url): Result<OAuthTokenGrant, OAuthClientError>`. `MissingCallbackTransaction` becomes a real error. | 1 | The current overload hides a broken-state case. Browser launcher logic becomes readable. |
| 5 | Delete `apps/fuji/src/lib/oauth-launcher.browser.ts`. Split `apps/fuji/src/lib/auth.ts` into `auth.browser.ts` and `auth.tauri.ts`. Each inlines its launcher creation. | 3 | The browser shim exists only because `auth.ts` has one import line. Splitting `auth.*.ts` matches the other apps (`honeycrisp`, `dashboard`, `opensidian`, `zhongwen`) and removes the indirection. Cost: tiny duplication of `createOAuthAppAuth` config between the two `auth.*.ts` files. Worth it. |
| 6 | In Fuji Tauri, drop `waitForOAuthCallback`'s `handleCallback` parameter. Helper returns the callback URL string. Caller exchanges. Inline `completeLaunchFromCallback` (5 lines, 2 callers). | 2 | The helper is doing two things behind one name. Split or inline; do not pass behavior into a helper that already owns the timing. |
| 7 | Remove `redirectUri` from `CommonConfig` in `machine-auth.ts`. Keep it only on `LoginWithOobConfig`. | 1 | `status`, `logout`, `createMachineAuthClient` never read it. |
| 8 | Keep OOB launcher separate from `createOAuthClient`. It does not use state, has a fixed CLI callback redirect, reads code by paste, and never returns `launched`. It satisfies `OAuthLauncher` and that is the entire seam. | 3 | Forcing OOB through the shared client would buy nothing and require special-casing state and storage. The protocol seam (`OAuthLauncher`) is exactly the right boundary. |
| 9 | Keep `OAuthLaunchResult = { status: 'completed'; grant } | { status: 'launched' }`. | 1 | Nullable `OAuthTokenGrant | null` cannot distinguish "no grant" from "handed off." The union is the right shape. |
| 10 | Derive types from factories where the type is exactly the returned object: `type OAuthClient = ReturnType<typeof createOAuthClient>`. Keep `OAuthLauncher` declared because it is a contract type, not a factory return. | 1 | TypeScript convention in `AGENTS.md`. |

## Refuse list

Delete these unless a real published contract protects them. None do.

- `type OAuthAuthorizationRequest = { redirectUri: string }`.
- `type OAuthSignInLauncher` (keep `OAuthLauncher`).
- Re-export `export type { OAuthLaunchResult } from '../create-oauth-app-auth.js'` in `oauth-launchers/index.ts`.
- `Partial<OAuthAuthorizationRequest>` in Fuji configs.
- `apps/fuji/src/lib/oauth-launcher.browser.ts` (replace with inline `auth.browser.ts`).
- `MissingCallbackTransaction` as a stand-in for "not a callback."
- `redirectUri?: string` on `CommonConfig` (machine auth).
- `completeLaunchFromCallback` and `waitForOAuthCallback({ handleCallback })` in `oauth-launcher.tauri.ts`. Inline; do not pass behavior into a wait helper.

## Keep list

What I would add again from scratch.

- `OAuthLaunchResult` discriminated union (`completed | launched`). Honest. Documents the handoff case the nullable shape could not.
- Per-launch `redirectUri` passed into `createAuthorizationUrl` and stored in the transaction. Matches the RFC invariant exactly.
- `OAuthTemporaryStorage` as an injected abstraction. Browser uses `sessionStorage`, extension uses `browser.storage.session`, Tauri can use either. Right boundary.
- `createOAuthClient` as the only place that touches `oauth4webapi`. Launchers compose it; they never call `validateAuthResponse` or `authorizationCodeGrantRequest` directly.
- OOB as a standalone launcher satisfying `OAuthLauncher`. Different dance, same contract.
- `MissingCallbackTransaction` after the split (it becomes a real broken-state error).
- The auth core / launcher seam: launcher returns a grant, auth core decides whether to install it. Decoupling sign-in transport from session installation is correct.

## Collapse plan

Ordered safest first. Each commit stands alone; each runs targeted tests before moving on.

### Commit 1: collapse the launcher contract (no behavior change)

- Move `OAuthLaunchResult` and `OAuthLauncher` to `packages/auth/src/oauth-launchers/contract.ts`.
- Delete `OAuthSignInLauncher` in `create-oauth-app-auth.ts`.
- `createOAuthAppAuth` imports `OAuthLauncher` from the launchers package.
- Delete `export type { OAuthLaunchResult } from '../create-oauth-app-auth.js'` in `oauth-launchers/index.ts`.
- Update barrel exports in `packages/auth/src/index.ts` to re-export `OAuthLauncher` and `OAuthLaunchResult` from `oauth-launchers/contract.ts`.

Tests touched:
- `contract.test.ts`: rename `OAuthSignInLauncher` references to `OAuthLauncher`. Types only.
- `index.test.ts`, `oob-launcher.test.ts`, `machine-auth.test.ts`: same.

```
bun test --filter packages/auth
```

### Commit 2: delete `OAuthAuthorizationRequest`

- `createAuthorizationUrl(redirectUri: string)` takes a string.
- `createBrowserOAuthLauncher` and `createExtensionOAuthLauncher` destructure `redirectUri` directly without `OAuthAuthorizationRequest`.
- Update all call sites.

Tests touched: `index.test.ts` only (test calls `createAuthorizationUrl({ redirectUri })` and asserts `redirect_uri` query param). Update to `createAuthorizationUrl(REDIRECT_URI)` and adjust the stored transaction shape if necessary.

```
bun test packages/auth/src/oauth-launchers/index.test.ts
```

### Commit 3: split `handleCallback` into `isCallback` + `exchangeCallback`

- New shape on `createOAuthClient` return:
  ```ts
  return {
    createAuthorizationUrl,
    isCallback,
    exchangeCallback,
  };
  ```
- `isCallback(url): boolean` checks `searchParams.has('code') || searchParams.has('error')`.
- `exchangeCallback(url)` assumes `isCallback(url)`. On missing transaction, returns `MissingCallbackTransaction`. On error/state/exchange failure, returns the corresponding error.
- Browser launcher:
  ```ts
  async startSignIn() {
    if (client.isCallback(window.location.href)) {
      const { data: grant, error } = await client.exchangeCallback(window.location.href);
      if (error) return Err(error);
      return Ok({ status: 'completed', grant } satisfies OAuthLaunchResult);
    }
    const { data: url, error } = await client.createAuthorizationUrl(redirectUri);
    if (error) return Err(error);
    await redirectTo(url.toString());
    return Ok({ status: 'launched' } satisfies OAuthLaunchResult);
  }
  ```
- Extension launcher continues to call `exchangeCallback(responseUrl)` directly; the `launchWebAuthFlow` return is always a callback URL.
- Tauri launcher calls `exchangeCallback(callbackUrl)` directly.

Tests touched:
- `index.test.ts`: rename `handleCallback` tests to `exchangeCallback`. The "rejects missing stored transaction" test now asserts a real broken-state path. Add an `isCallback` unit test.

```
bun test packages/auth/src/oauth-launchers/index.test.ts
bun test packages/auth/src/contract.test.ts
```

### Commit 4: split Fuji's `auth.ts` into `auth.browser.ts` and `auth.tauri.ts`

Two files, each inlining its launcher:

```ts
// apps/fuji/src/lib/auth.browser.ts
import { PersistedAuth } from '@epicenter/auth';
import { createBrowserOAuthLauncher } from '@epicenter/auth/oauth-launchers';
import { createOAuthAppAuth } from '@epicenter/auth-svelte';
import { EPICENTER_FUJI_OAUTH_CLIENT_ID } from '@epicenter/constants/oauth';
import { APP_URLS } from '@epicenter/constants/vite';
import { createPersistedState } from '@epicenter/svelte';

export const auth = createOAuthAppAuth({
  baseURL: APP_URLS.API,
  clientId: EPICENTER_FUJI_OAUTH_CLIENT_ID,
  persistedAuthStorage: createPersistedState({
    key: 'fuji.auth.persisted',
    schema: PersistedAuth.or('null'),
    defaultValue: null,
  }),
  launcher: createBrowserOAuthLauncher({
    issuer: `${APP_URLS.API}/auth`,
    clientId: EPICENTER_FUJI_OAUTH_CLIENT_ID,
    resource: APP_URLS.API,
    redirectUri: `${window.location.origin}/auth/callback`,
    storage: window.sessionStorage,
  }),
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => auth[Symbol.dispose]());
}
```

```ts
// apps/fuji/src/lib/auth.tauri.ts
// same shape, launcher imports from ./oauth-launcher.tauri
```

Delete `apps/fuji/src/lib/oauth-launcher.browser.ts`. Keep `apps/fuji/src/lib/oauth-launcher.tauri.ts` but inline `waitForOAuthCallback` and `completeLaunchFromCallback` per Commit 5.

Confirm Vite resolution picks up `.browser.ts` / `.tauri.ts` extensions for `./auth` imports already; the existing `vite.config.ts` lists them.

```
bun --filter @epicenter/fuji run check
bun --filter @epicenter/fuji run build
```

### Commit 5: inline Tauri launcher helpers

```ts
// apps/fuji/src/lib/oauth-launcher.tauri.ts (after collapse)
export function createFujiOAuthLauncher({
  redirectUri = EPICENTER_FUJI_TAURI_OAUTH_REDIRECT_URI,
  ...config
}: OAuthClientConfig & { redirectUri?: string }): OAuthLauncher {
  const client = createOAuthClient(config);

  return {
    async startSignIn() {
      const currentUrls = await getCurrent().catch(() => null);
      const currentCallback = currentUrls?.find((url) =>
        isRedirectUrl(url, redirectUri),
      );
      if (currentCallback) {
        const { data: grant, error } = await client.exchangeCallback(currentCallback);
        if (error) return Err(error);
        return Ok({ status: 'completed', grant } satisfies OAuthLaunchResult);
      }

      const { data: authorizationUrl, error: urlError } =
        await client.createAuthorizationUrl(redirectUri);
      if (urlError) return Err(urlError);

      const callbackUrl = await waitForRedirectUrl({
        authorizationUrl: authorizationUrl.toString(),
        redirectUri,
      });
      if (callbackUrl.error) return Err(callbackUrl.error);

      const { data: grant, error } = await client.exchangeCallback(callbackUrl.data);
      if (error) return Err(error);
      return Ok({ status: 'completed', grant } satisfies OAuthLaunchResult);
    },
  };
}

// waitForRedirectUrl opens the URL, installs the deep-link listener,
// and resolves with the first matching callback URL. It does not exchange.
```

`waitForRedirectUrl` returns `Result<string, OAuthClientError>`. The helper does one thing: wait for the first matching URL. Exchange is the launcher's job above.

```
bun --filter @epicenter/fuji run check
```

### Commit 6: remove `redirectUri` from `CommonConfig`

- `machine-auth.ts`: drop `redirectUri?: string` from `CommonConfig`. Keep on `LoginWithOobConfig`.
- Update `loginWithOob` to spread its `redirectUri` into the OOB launcher config directly.

```
bun test packages/auth/src/node/machine-auth.test.ts
```

### Commit 7: post-implementation review pass

Run `post-implementation-review`. Confirm:
- No `OAuthSignInLauncher` references anywhere.
- No `OAuthAuthorizationRequest` references anywhere.
- No `Partial<OAuthAuthorizationRequest>` anywhere.
- No `handleCallback` symbol; only `isCallback` + `exchangeCallback`.
- `oauth-launchers/index.ts` no longer re-exports from `create-oauth-app-auth.ts`.
- Fuji `auth.ts` no longer exists; `auth.browser.ts` and `auth.tauri.ts` do.
- Tests still green.

```
bun --filter @epicenter/auth run typecheck
bun --filter @epicenter/auth run test
bun --filter @epicenter/fuji run check
bun --filter @epicenter/honeycrisp run check
bun --filter @epicenter/dashboard run check
bun --filter @epicenter/opensidian run check
bun --filter @epicenter/zhongwen run check
bun --filter @epicenter/tab-manager run check
```

## Anti-changes (do not do these)

- Do not change `PersistedAuth`, `ApiSessionResponse`, `OAuthTokenGrant`, or wire-level OAuth shapes. Durable.
- Do not change `OAUTH_ROUTES` paths or the `/auth/cli-callback` redirect URI. Deployed.
- Do not collapse OOB into `createOAuthClient`. They are different dances. The launcher seam is correct.
- Do not delete tests to make new shapes pass. Update the test wording to match the new function names and the split callback semantics. The behavioral coverage must stay.
- Do not introduce a third launcher type (`BrowserLauncher`, `NativeLauncher`, etc.). One contract: `OAuthLauncher`. Each launcher's specific errors live with that launcher.

## Open questions

- Should `createOAuthClient` expose `isCallback` as a method, or as a sibling free function in `oauth-launchers/client.ts`? Tradeoff: method keeps colocation with `exchangeCallback`, free function makes the purity clearer. Pick method for now; revisit if it shows up as a dead method on any launcher path.
- Should the browser launcher consume `window.location.href` itself, or take it as a parameter? Today it reads `window.location.href` inside `startSignIn`. Greenfield: keep that read here. The launcher's whole job is to know about the browser's transport surface. Injecting `currentUrl` would push that knowledge up into the caller for no testing benefit; the tests already stub `window`.
- Tauri's `isRedirectUrl` does prefix matching (`url === redirectUri || url.startsWith(`${redirectUri}?`)`). Confirm the deep-link plugin never delivers a URL with a fragment before the query in the failure path; if it can, broaden the match. (Class 1 once we look; not a blocker for this spec.)

## Implementation note

Implemented on 2026-05-27.

The OAuth launcher ownership collapse now matches the target split: `OAuthLauncher` and `OAuthLaunchResult` live in `oauth-launchers/contract.ts`, OAuth client owns authorization URL creation plus `isCallback` and `exchangeCallback`, launchers own transport, and machine auth keeps `redirectUri` only on OOB login.

Fuji now resolves `$lib/auth` through `auth.browser.ts` or `auth.tauri.ts`; the old browser launcher shim and shared `auth.ts` were removed. The Tauri wait helper now returns only the callback URL, and token exchange is performed by the launcher after the URL is captured.

Deviations: the spec's package check commands use `bun --filter <pkg> run check`, but this workspace's Bun invocation is `bun run --filter '<pkg>' <script>`, and Fuji/tab-manager expose `typecheck` rather than `check`. Verification used those package scripts directly.
