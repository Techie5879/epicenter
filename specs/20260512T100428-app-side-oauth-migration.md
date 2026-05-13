# App-Side OAuth Migration

**Date**: 2026-05-12
**Status**: Draft
**Author**: AI assisted
**Branch**: codex/auth-bearer-omit-cookies
**Depends on**: `specs/20260511T150000-final-oauth-auth-architecture.md`
**Stack Map**: `specs/20260512T134603-auth-spec-stack-clean-break-map.md`
**Stack Position**: Migration track from old app auth factories to the OAuth `AuthClient`.

> **Session vocabulary update (2026-05-12):** the app-side projection of
> `AuthState` has since landed in
> `specs/20260512T220000-session-two-axis-cohesive-reshape.md`. In the live code:
>
> - `Session<T>` is `SessionPayload<T> | null` (no discriminant field).
> - Apps gate route access on `if (session.current)` and reach the workspace
>   through `current.workspace`.
> - `createSession()` exposes `requireWorkspace()` for descendants and no
>   longer takes a `name` field.
> - The auth helper was renamed: `requireSignedIn` -> `requireIdentity`.
> - SvelteKit apps' session modules are now `src/lib/session.ts`, not
>   `session.svelte.ts`. Tab-manager keeps a custom wrapper until the async
>   storage/build unification follow-up.
>
> `AuthState` itself is unchanged and still has three states. Wherever this
> spec or its rewrite tables reference the older app-side projection (e.g.
> `current.status === 'pending'`, `current.status === 'signed-in'`,
> `current.status !== 'signed-out'`, `apps/<x>/src/lib/session.svelte.ts`),
> read them through the reshape spec's current names. The Edge Cases
> guidance about "branch on `current.status === 'signed-in'`" is now
> "branch on `if (session.current)`"; same intent, current shape.

## One Sentence

Migrate six consumer apps + `packages/svelte-utils` from
`createCookieAuth` / `createBearerAuth` / `auth.signIn*` to the OAuth-only
`AuthClient` surface (`state`, `startSignIn`, `signOut`, `fetch`,
`openWebSocket`), so the branch typechecks and ships the contract collapse
already landed in `packages/auth`.

Out of scope: server composition work in `apps/server` (base modules and
Cloud Apps), Wave 5 of the OAuth spec, and `apps/whispering` (no auth
client). There is no separate `apps/cloud` target; Cloud Apps live inside
the composable `apps/server` host (see
`specs/20260512T150000-cloud-modules-and-networks.md`).

## 1. Auth-Form Decision

**Decision: delete `packages/svelte-utils/src/auth-form/auth-form.svelte`
(option a).** Apps render a single "Sign in with Epicenter" button that
calls `auth.startSignIn({ returnTo: window.location.href })`. Hosted
sign-in at `api.epicenter.so/auth/sign-in` owns every credential family
(Google, email/password, future SSO).

Justification: the new `AuthClient` does not expose `signIn` / `signUp` /
`signInWithSocial`, so the form has no methods to call; a button-only
variant (option b) is just `AccountPopover` plumbing dressed as a separate
component, so the button collapses into `AccountPopover` instead.

Asymmetric win: deleting ~150 lines of UI + state + props removes the
"two credential paths" mental model. Product sentence (hosted-sign-in
is one door) survives.

Code family deleted:

```txt
packages/svelte-utils/src/auth-form/auth-form.svelte       (~150 lines)
packages/svelte-utils/src/auth-form/  (directory + package export)
six callers passing onSocialSignIn={() => auth.signInWithSocial(...)}
AccountPopover.onSocialSignIn          becomes onStartSignIn
```

## 2. Per-App Checklist

Common work for every app:

```txt
- replace platform/auth/{cookie,bearer}.ts with createOAuthAppAuth({ ... })
- add /auth/callback/+page.svelte that calls auth.startSignIn() and redirects
- delete AuthForm screens; render a single startSignIn button
- drop {status === 'pending'} branches (status is signed-in | reauth-required | signed-out)
- drop bearerToken arg from openWorkspace calls; thread openWebSocket: auth.openWebSocket
- drop bearerToken param from browser.ts / daemon.ts / script.ts; accept openWebSocket and pass to attachSync
- replace AccountPopover onSocialSignIn with onStartSignIn
```

`attachSync` already takes `openWebSocket?: OpenWebSocket` and no longer
accepts `bearerToken` (`packages/workspace/src/document/attach-sync.ts:221`).
That's why apps currently break.

### 2.1 fuji

```txt
Rewrite:
  apps/fuji/src/lib/platform/auth/cookie.ts:1,4              createCookieAuth -> createOAuthAppAuth
  apps/fuji/src/lib/session.svelte.ts:23                     bearerToken -> openWebSocket
  apps/fuji/src/routes/(signed-in)/fuji/browser.ts:39,44,66,97   bearerToken (param + 2 attachSync calls)
  apps/fuji/src/routes/(signed-in)/fuji/daemon.ts:60         bearerToken
  apps/fuji/src/routes/+layout.svelte:20,27                  pending branch + AuthForm + signInWithSocial
  apps/fuji/src/routes/sign-in/+page.svelte:18               AuthForm + signInWithSocial
  apps/fuji/src/routes/(signed-in)/components/AppHeader.svelte:72   signInWithSocial (AccountPopover prop)

New file:
  apps/fuji/src/routes/auth/callback/+page.svelte
```

### 2.2 honeycrisp

Same shape as fuji; both web SvelteKit + workspace + sync + script.

```txt
Rewrite:
  apps/honeycrisp/src/lib/platform/auth/cookie.ts:1,4
  apps/honeycrisp/src/lib/session.svelte.ts:19
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/browser.ts:39,44,66,97
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/daemon.ts:46
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/script.ts:29
  apps/honeycrisp/src/routes/+layout.svelte:24,31           pending + signInWithSocial
  apps/honeycrisp/src/routes/sign-in/+page.svelte:18        signInWithSocial
  apps/honeycrisp/src/routes/(signed-in)/components/Sidebar.svelte:30   signInWithSocial

New file:
  apps/honeycrisp/src/routes/auth/callback/+page.svelte
```

### 2.3 zhongwen

No `attachSync` in the browser factory (no doc sync). Daemon and script
factories do sync. Sign-in is bespoke (no AuthForm). Two layouts have
pending branches.

```txt
Rewrite:
  apps/zhongwen/src/lib/platform/auth/cookie.ts:1,4
  apps/zhongwen/src/routes/(signed-in)/zhongwen/daemon.ts:46
  apps/zhongwen/src/routes/(signed-in)/zhongwen/script.ts:29
  apps/zhongwen/src/routes/+layout.svelte:15                auth.state.status === 'pending'
  apps/zhongwen/src/routes/(signed-in)/+layout.svelte:19    current.status === 'pending'
  apps/zhongwen/src/routes/sign-in/+page.svelte:15-36       signInWithSocial -> startSignIn
  apps/zhongwen/src/routes/(signed-in)/zhongwen/browser.ts: NO change (no sync today)
  apps/zhongwen/src/routes/(signed-in)/chat/chat-state.svelte.ts:103   auth.fetch (keep)
  apps/zhongwen/src/routes/(signed-in)/+page.svelte:39      auth.signOut() (keep)

New file:
  apps/zhongwen/src/routes/auth/callback/+page.svelte
```

### 2.4 opensidian

Already on bearer. Rename `createBrowserOAuthAdapter` to
`createBrowserOAuthLauncher`. Replace `BearerSession` schema with
`OAuthSession`. Rewrite existing callback page (it calls
`auth.signInWithSocial`).

```txt
Rewrite:
  apps/opensidian/src/lib/platform/auth/bearer.ts           rewrite + rename to auth.ts
  apps/opensidian/src/lib/session.svelte.ts:37              bearerToken -> openWebSocket
  apps/opensidian/src/lib/opensidian/browser.ts:29,34,108   bearerToken
  apps/opensidian/src/lib/opensidian/daemon.ts:46           bearerToken
  apps/opensidian/src/lib/opensidian/script.ts:29           bearerToken
  apps/opensidian/src/routes/+layout.svelte:21,28           pending + signInWithSocial
  apps/opensidian/src/routes/auth/callback/+page.svelte:14  signInWithSocial -> startSignIn
  apps/opensidian/src/lib/components/editor/TabBar.svelte:66  signInWithSocial
  apps/opensidian/src/lib/chat/chat-state.svelte.ts:117     auth.fetch (keep)
```

New auth file shape:

```ts
import { createOAuthAppAuth } from '@epicenter/auth-svelte';
import { OAuthSession } from '@epicenter/auth';
import { EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID } from '@epicenter/constants/oauth';
import { APP_URLS } from '@epicenter/constants/vite';
import {
  createBrowserOAuthLauncher,
  createStorageAdapter,
} from '@epicenter/oauth-client';
import { createPersistedState } from '@epicenter/svelte';
import { base } from '$app/paths';

export const auth = createOAuthAppAuth({
  baseURL: APP_URLS.API,
  clientId: EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID,
  sessionStorage: createPersistedState({
    key: 'opensidian.auth.session',
    schema: OAuthSession.or('null'),
    defaultValue: null,
  }),
  launcher: createBrowserOAuthLauncher({
    issuer: `${APP_URLS.API}/auth`,
    clientId: EPICENTER_OPENSIDIAN_OAUTH_CLIENT_ID,
    redirectUri: `${window.location.origin}${base}/auth/callback`,
    resource: APP_URLS.API,
    storage: createStorageAdapter(window.sessionStorage),
  }),
});
```

### 2.5 dashboard

No workspace, no sync, no daemon. Same-origin special case: lives at
`api.epicenter.so/dashboard` and previously relied on first-party Better
Auth cookies. Architecture spec forbids treating Better Auth cookies as
runtime credentials, so dashboard moves to OAuth like the others. Redirect
URI registered: `packages/constants/src/oauth.ts:25-28`.

```txt
Rewrite:
  apps/dashboard/src/lib/platform/auth/cookie.ts:1,3
  apps/dashboard/src/routes/+layout.svelte:21,39            pending + AuthForm + signInWithSocial
  apps/dashboard/src/lib/api.ts:55,70                       auth.fetch (keep, unchanged signature)
  apps/dashboard/src/lib/components/UserMenu.svelte:41      auth.signOut() (keep)

New file:
  apps/dashboard/src/routes/auth/callback/+page.svelte
```

### 2.6 tab-manager

Chrome extension. Cannot use loopback redirects; must use
`browser.identity.launchWebAuthFlow` via `createExtensionOAuthLauncher`.
No `/auth/callback` page route needed (the popup catches the redirect).

```txt
Rewrite:
  apps/tab-manager/src/lib/platform/auth/bearer.ts          rewrite + rename to auth.ts
                                                             (rename createExtensionOAuthAdapter -> createExtensionOAuthLauncher)
                                                             (change schema BearerSession -> OAuthSession)
  apps/tab-manager/src/lib/session.svelte.ts:3,45,63,143    createBearerAuth + bearerToken + 'pending' wrapper
  apps/tab-manager/src/lib/tab-manager/extension.ts:36,41,61   bearerToken -> openWebSocket
  apps/tab-manager/src/entrypoints/sidepanel/App.svelte:17,25     pending + signInWithSocial
  apps/tab-manager/src/entrypoints/sidepanel/SignedInApp.svelte:185  signInWithSocial
  apps/tab-manager/src/lib/chat/chat-state.svelte.ts:142    auth.fetch (keep)
```

`auth.ts`:

```ts
export const auth = createOAuthAppAuth({
  baseURL: APP_URLS.API,
  clientId: EPICENTER_TAB_MANAGER_OAUTH_CLIENT_ID,
  sessionStorage: authSessionStorage,   // OAuthSession-shaped chrome.storage.local
  launcher: createExtensionOAuthLauncher({
    issuer: `${APP_URLS.API}/auth`,
    clientId: EPICENTER_TAB_MANAGER_OAUTH_CLIENT_ID,
    redirectUri: browser.identity.getRedirectURL(),
    resource: APP_URLS.API,
    storage: { /* chrome.storage.session adapter, as today */ },
    launchWebAuthFlow: (url) =>
      browser.identity.launchWebAuthFlow({ url, interactive: true }),
  }),
});
```

Gotchas:
- The `'pending'` wrapper in `session.svelte.ts:143` IS load-bearing today
  (storage init is async). Collapse it by awaiting
  `authSessionStorage.whenReady` once before exporting `auth`, then let
  `{#await tabManagerSession.whenReady}` in `App.svelte` gate the UI.
- Stored sessions from earlier builds parse-fail and users sign in once.
  See section 6.1.

### Summary

| App | Old auth | Browser factory | Daemon | Script | Callback route |
| --- | --- | --- | --- | --- | --- |
| fuji | cookie | drop bearerToken, add openWebSocket | drop+add | none | add |
| honeycrisp | cookie | drop+add | drop+add | drop+add | add |
| zhongwen | cookie | unchanged (no sync) | drop+add | drop+add | add |
| opensidian | bearer | drop+add | drop+add | drop+add | rewrite |
| dashboard | cookie | no workspace | none | none | add |
| tab-manager | bearer | drop+add | none | none | extension flow (no page) |

## 3. Shared Primitives

**Recommendation: each app implements its own `/auth/callback/+page.svelte`
from scratch.** No shared component.

The whole route is ~10 lines:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$platform/auth';
  import { Loading } from '@epicenter/ui/loading';

  let errorMessage = $state<string | null>(null);

  $effect(() => {
    void (async () => {
      const { error } = await auth.startSignIn();
      if (error) {
        errorMessage = error.message;
        return;
      }
      await goto('/', { replaceState: true });
    })();
  });
</script>

{#if errorMessage}
  <div class="flex h-dvh items-center justify-center text-sm text-destructive">
    {errorMessage}
  </div>
{:else}
  <Loading class="h-dvh" label="Signing in..." />
{/if}
```

Cheaper than packaging because:
- 5 SvelteKit apps, ~10 lines each = 50 lines vs. shared component + 5
  imports + tests.
- Redirect target ("/" vs. last visited) varies per app.
- Base path (opensidian uses `$app/paths.base`) is per-app.
- A shared component would still need props for redirect, base path, and
  error rendering, equal in volume to the duplication it removes.

What DOES live in `packages/svelte-utils`: the `AccountPopover` change
from section 1 (rename `onSocialSignIn` -> `onStartSignIn`, drop any
AuthForm-render fallback). That update is shared because every app embeds
`AccountPopover`.

## 4. Commit Boundaries

**Recommendation: one commit per app (option a).**

```txt
- Each app's migration is a self-contained unit: auth file + callback +
  sign-in page + layout + session + browser/daemon/script + popover wiring.
- Every intermediate state is currently broken (TypeScript). Per-app commits
  give exactly one clean working state per commit. Per-concern commits
  guarantee every intermediate is broken across the whole repo.
- Per-app commits enable partial revert, parallel review, and per-app
  staging deploys. Per-concern forces all-or-nothing merge.
- Shared changes (svelte-utils AccountPopover + AuthForm delete) go in a
  prep commit at the front of the stack.
```

Suggested order:

```txt
1. refactor(svelte-utils): delete AuthForm, switch AccountPopover to onStartSignIn
2. feat(dashboard): migrate to OAuth AuthClient        (no workspace, smallest blast radius)
3. feat(zhongwen): migrate to OAuth AuthClient         (no browser sync to retouch)
4. feat(fuji): migrate to OAuth AuthClient
5. feat(honeycrisp): migrate to OAuth AuthClient
6. feat(opensidian): migrate to OAuth AuthClient       (rename adapter -> launcher)
7. feat(tab-manager): migrate to OAuth AuthClient      (extension launcher, stored-session shape change)
```

Dashboard first to exercise bare `auth.fetch`. Tab-manager last because of
the unique extension launcher and the session-shape risk.

## 5. Smoke Test Protocol

Run against local API (`bun run dev` in `apps/api` plus the app).

### 5.1 SvelteKit web apps (fuji, honeycrisp, zhongwen, opensidian, dashboard)

```txt
1. Open http://localhost:<port>/ in a clean profile.
   Expect: "Sign in with Epicenter" button on a signed-out screen.
2. Click "Sign in with Epicenter".
   Expect: redirect to api.epicenter.so/auth/sign-in (or local equivalent).
3. Complete sign-in (Google or email/password as configured on the hub).
   Expect: redirect to /auth/callback, then to / (app home).
4. Refresh the page.
   Expect: still signed-in, no flash back to sign-in screen.
5. Open a workspace document (entry / note / character).
   Expect: content loads. Sync indicator settles to "connected" within 2s.
   (Dashboard substitute: navigate to /usage, expect billing data via auth.fetch.)
   (Zhongwen substitute: open a chat, send a message, expect AI response via auth.fetch.)
6. Open AccountPopover -> Sign out.
   Expect: redirect to signed-out screen. Workspace IDB preserved
   (data is keyed by userId). Refresh stays signed-out.
7. Sign back in.
   Expect: same user reconnects, no workspace double-build, no "user
   mismatch" console warnings.
```

### 5.2 Chrome extension (tab-manager)

```txt
1. Run `bun run dev` in apps/tab-manager. Load the unpacked extension from
   .output/chrome-mv3.
2. Open the side panel in a clean profile.
   Expect: "Sign in with Epicenter" button.
3. Click it.
   Expect: chrome.identity popup opens at api.epicenter.so/auth/sign-in.
4. Complete sign-in.
   Expect: popup closes; side panel renders SignedInApp within 1s.
5. Close and reopen the side panel.
   Expect: still signed-in; tabs/bookmarks load from chrome.storage + sync.
6. Open AccountPopover -> Sign out.
   Expect: side panel returns to sign-in button. chrome.storage.local
   `auth.session` cleared.
7. Sign back in.
   Expect: steps 3-4 succeed again.
```

### 5.3 Tauri apps

None in scope. `apps/whispering` has no auth client today.

## 6. Risks

### 6.1 Stored session shape mismatch (tab-manager, opensidian)

Both apps persist a `BearerSession`-shaped value today. New schema is
`OAuthSession` (`packages/auth/src/auth-types.ts`). First load after
migration: schema parse fails -> session reads as `null` -> user appears
signed-out once.

Affected keys:

```txt
opensidian:  localStorage         "opensidian.auth.session"  BearerSession
tab-manager: chrome.storage.local "auth.session"             BearerSession
```

Mitigation options:

```txt
(a) Forced sign-out (default). Stored sessions parse-fail; user re-signs-in
    once. Workspace IDB is untouched (keyed by userId). Cost: one extra
    sign-in.
(b) Schema migration: read old shape, project to OAuthSession by copying
    accessToken/refreshToken/accessTokenExpiresAt. Risk: encryptionKeys /
    user shape may differ; needs verification before shipping.
```

Recommendation: (a). The login-only UX promise (memory:
[[epicenter-login-only-ux]]) is that sign-in is free; one extra sign-in
during a major auth migration is acceptable.

### 6.2 Extension permission changes

`chrome.identity` permission is already in
`apps/tab-manager/wxt.config.ts`. No manifest changes. Verify the extension
ID in `packages/constants/src/oauth.ts:62`
(`mkbnicfhpacdofmoocppnjjmdfmkkgda.chromiumapp.org`) matches the deployed
extension. Mismatch produces `redirect_uri_mismatch` at sign-in.

### 6.3 Tauri deep-link registration

Not applicable. No Tauri app in scope.

### 6.4 returnTo URL lost on redirect

`auth.startSignIn({ returnTo })` exists in the contract but the browser
launcher doesn't persist `returnTo` across `window.location.href = ...`
today. Users land on `/` regardless of trigger location. Acceptable for
migration; capture as a follow-up. Workaround if needed per-app: store
returnTo in `sessionStorage` keyed by OAuth state before redirect, read
back in the callback page.

### 6.5 Same-origin cookies on dashboard

Dashboard previously relied on first-party Better Auth cookies on
`api.epicenter.so`. After migration it sends `Authorization: Bearer` via
`auth.fetch`. Verify billing endpoints (`apps/dashboard/src/lib/api.ts:55,
70`) are behind `requireAppAccessToken`, not the old cookie middleware.
Existing API routes already use `requireAppAccessToken` per the architecture
spec; this is a verification step, not a code change.

### 6.6 User-visible reset

Only #6.1 forces a visible reset: a one-time sign-in. No data loss; IDB
keys are userId-based and survive the session-shape change. Communicate
in release notes for tab-manager and opensidian users.

## Edge Cases

```txt
- reauth-required: AccountPopover surfaces a "Reconnect" CTA wrapping
  auth.startSignIn(). Workspace data stays available offline; sync resumes
  after re-auth. Layouts should branch on `current.status === 'signed-in'`,
  not `current.status !== 'signed-out'`, so reauth-required shows the
  workspace + a banner rather than the sign-in screen.

- HMR after rotating clientId: the existing `import.meta.hot.dispose` in
  each platform/auth file disposes the AuthClient cleanly. Keep that block
  during migration so dev HMR doesn't leak listeners.

- auth.startSignIn() while already signed-in: short-circuits inside the
  launcher (handleCallback returns no-match, createAuthorizationUrl
  redirects). Do NOT gate the trigger behind a status check; let the API
  be idempotent.

- Sign-out then close tab before refresh: cookie auth would have left a
  stale cookie. OAuth auth clears OAuthSession and revokes the refresh
  token inside signOut(), so no zombie state survives.

- Callback page reached without OAuth params (user typed URL directly):
  auth.startSignIn() returns MissingCallbackTransaction. Show errorMessage
  or redirect to /; do not retry.
```

## Implementation Plan

### Wave 0 (prep): shared svelte-utils

- [ ] **0.1** Delete `packages/svelte-utils/src/auth-form/`.
- [ ] **0.2** Remove `./auth-form` from `packages/svelte-utils/package.json`
  exports.
- [ ] **0.3** `AccountPopover.svelte`: rename `onSocialSignIn` -> `onStartSignIn`,
  update JSDoc to reference `createOAuthAppAuth()`, drop any AuthForm-render
  fallback in favor of a startSignIn button.
- [ ] **0.4** `bun run typecheck` in `packages/svelte-utils`.

### Wave 1: dashboard

- [ ] **1.1** Rewrite `apps/dashboard/src/lib/platform/auth/cookie.ts` ->
  `auth.ts` with `createOAuthAppAuth` + `createBrowserOAuthLauncher`,
  clientId `EPICENTER_DASHBOARD_OAUTH_CLIENT_ID`.
- [ ] **1.2** Add `apps/dashboard/src/routes/auth/callback/+page.svelte`.
- [ ] **1.3** `+layout.svelte`: drop `pending` branch + AuthForm; render a
  startSignIn button on signed-out.
- [ ] **1.4** Smoke test (5.1, dashboard substitute for step 5).
- [ ] **1.5** Commit: `feat(dashboard): migrate to OAuth AuthClient`.

### Wave 2: zhongwen, fuji, honeycrisp

Per app, in order (zhongwen first, simplest browser factory):

- [ ] **N.1** `platform/auth/cookie.ts` -> `auth.ts` with
  `createOAuthAppAuth` + `createBrowserOAuthLauncher`, per-app clientId.
- [ ] **N.2** `session.svelte.ts`: drop `bearerToken: () => auth.bearerToken`,
  thread `openWebSocket: auth.openWebSocket` into the workspace factory.
- [ ] **N.3** `browser.ts` / `daemon.ts` / `script.ts`: drop `bearerToken`
  param + type; accept `openWebSocket: OpenWebSocket`; pass to
  `attachSync`. Zhongwen browser.ts unchanged (no sync).
- [ ] **N.4** Root `+layout.svelte` (and `(signed-in)/+layout.svelte` for
  zhongwen): drop `pending` branches; replace AuthForm with a startSignIn
  button.
- [ ] **N.5** `sign-in/+page.svelte`: single "Sign in with Epicenter"
  button calling `auth.startSignIn({ returnTo: window.location.href })`.
- [ ] **N.6** AccountPopover-consuming components (AppHeader, Sidebar,
  zhongwen sign-in page): drop `onSocialSignIn`; pass `onStartSignIn` if
  the popover still surfaces a sign-in CTA, otherwise drop the prop.
- [ ] **N.7** Add `routes/auth/callback/+page.svelte`.
- [ ] **N.8** Smoke test (5.1).
- [ ] **N.9** Per-app commit.

### Wave 3: opensidian

- [ ] **3.1** Rename `platform/auth/bearer.ts` -> `auth.ts`. Rewrite to
  `createOAuthAppAuth` + `createBrowserOAuthLauncher` (rename
  `createBrowserOAuthAdapter`). Replace `BearerSession` with `OAuthSession`
  in the persisted state schema.
- [ ] **3.2** Same factory + session + layout + sign-in updates as Wave 2.
- [ ] **3.3** Rewrite existing
  `apps/opensidian/src/routes/auth/callback/+page.svelte` to use
  `auth.startSignIn()` instead of `auth.signInWithSocial(...)`.
- [ ] **3.4** Smoke test (5.1). Accept the one-time forced sign-out (6.1).
- [ ] **3.5** Commit.

### Wave 4: tab-manager

- [ ] **4.1** Rename `platform/auth/bearer.ts` -> `auth.ts`. Replace
  `createExtensionOAuthAdapter` with `createExtensionOAuthLauncher`.
  Change `authSessionStorage` schema from `BearerSession` to `OAuthSession`.
- [ ] **4.2** Rewrite `session.svelte.ts`: construct `auth` with
  `createOAuthAppAuth`; collapse the `'pending'` wrapper by awaiting
  `authSessionStorage.whenReady` once before exporting.
- [ ] **4.3** `tab-manager/extension.ts` factory: drop `bearerToken`, add
  `openWebSocket`.
- [ ] **4.4** `App.svelte` + `SignedInApp.svelte`: drop `'pending'`
  branches; replace AuthForm + signInWithSocial with the startSignIn
  button + AccountPopover.onStartSignIn.
- [ ] **4.5** Smoke test (5.2). Accept one-time forced sign-out (6.1).
- [ ] **4.6** Commit.

### Wave 5: verify

- [ ] **5.1** `bun run typecheck` at repo root.
- [ ] **5.2** `bun run test` for `packages/auth`, `packages/auth-svelte`,
  `packages/workspace`, `packages/svelte-utils`.
- [ ] **5.3** Run all six smoke tests against staging API once the branch
  is deployable.

## Decisions Log

```txt
- Keep: AccountPopover as a shared component (vs. inlining per app).
  Constraint: every app embeds it and the user-info / sign-out shape is
  uniform across apps. The prop rename (onSocialSignIn -> onStartSignIn)
  is one edit, not a divergence signal.
  Revisit when: an app needs a fundamentally different account UI
  (multi-account, profile editing, org switcher).

- Refuse: shared OAuthCallback component.
  Constraint: ~10 lines per app, per-app redirect targets and base paths.
  A shared component would need props for every per-app variant, equal in
  volume to the duplication it removes.
  Revisit when: a third runtime (Tauri deep link, mobile) needs the same
  callback shape; that's the extraction threshold.

- One commit per app over per-concern.
  Constraint: every intermediate state is currently broken; per-app
  commits give exactly one clean working state per commit.
  Revisit when: a future cleanup spans 10+ apps where per-app churn would
  bury a shared change worth highlighting on its own.
```

---

**Success criteria** (must hold before merge):

```txt
- bun run typecheck passes at repo root
- No remaining references to createCookieAuth, createBearerAuth,
  auth.signIn, auth.signUp, auth.signInWithSocial, auth.bearerToken,
  or BearerSession outside packages/auth/src/contract.test.ts
- No {status === 'pending'} branch in any app layout or page
- packages/svelte-utils/src/auth-form/ removed (directory + export)
- AccountPopover exposes onStartSignIn, not onSocialSignIn
- All six smoke tests pass against the local API
```

**Key references**:

```txt
specs/20260511T150000-final-oauth-auth-architecture.md           target contract
packages/auth/src/auth-contract.ts:5-19                          AuthClient surface
packages/auth/src/create-oauth-app-auth.ts:42-52                 config
packages/oauth-client/src/index.ts:90-135                        browser + extension launchers
packages/constants/src/oauth.ts:11-79                            per-app client IDs + redirect URIs
packages/workspace/src/document/attach-sync.ts:211-232           openWebSocket param
packages/auth/src/contract.test.ts:59-63                         asserts deleted methods stay deleted
```
