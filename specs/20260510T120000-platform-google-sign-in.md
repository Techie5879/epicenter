# Platform Social Sign-In

**Date**: 2026-05-10
**Status**: Superseded
**Author**: AI-assisted
**Branch**: codex/auth-bearer-omit-cookies
**Superseded by**: `specs/20260511T090000-auth-credential-families-minimal-production.md`

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

This file is a historical implementation note. Use `specs/20260511T090000-auth-credential-families-minimal-production.md` as the authoritative source for the auth credential-family migration, including the cookie and bearer family split, `AuthClient.signInWithSocial({ provider })`, and the `@epicenter/oauth-client` boundary.

## Overview

Social sign-in should have one app-facing shape: `auth.signInWithSocial({ provider })`. Cookie apps can continue through Better Auth's hosted redirect flow. Bearer apps should use Epicenter's existing OAuth provider as an OAuth 2.1 authorization server, then exchange an authorization code with PKCE for a bearer token.

One sentence: shared UI asks for social sign-in, while the platform auth module chooses the runtime transport that yields the right credential.

## Motivation

### Current State

Fuji already selects the auth implementation through `$platform/auth`:

```js
// apps/fuji/svelte.config.js
function selectAuthModule() {
	if (process.env.NODE_ENV === 'production') {
		return './src/lib/platform/auth/cookie.ts';
	}

	return './src/lib/platform/auth/bearer.ts';
}
```

Local development resolves to bearer auth:

```ts
// apps/fuji/src/lib/platform/auth/bearer.ts
export const auth = createBearerAuth({
	baseURL: APP_URLS.API,
	sessionStorage: createPersistedState({
		key: 'fuji.auth.session',
		schema: BearerSession.or('null'),
		defaultValue: null,
	}),
});
```

But Fuji route code still calls Better Auth redirect social sign-in directly:

```svelte
<!-- apps/fuji/src/routes/+layout.svelte -->
<AuthForm
	{auth}
	syncNoun="entries"
	onSocialSignIn={() =>
		auth.signInWithSocialRedirect({
			provider: 'google',
			callbackURL: window.location.origin,
		})}
/>
```

The same shape appears in `apps/fuji/src/routes/sign-in/+page.svelte` and `apps/fuji/src/routes/(signed-in)/components/AppHeader.svelte`.

This creates problems:

1. **Bearer Fuji uses a cookie-shaped flow**: direct Better Auth redirect OAuth creates a browser cookie during the callback, then redirects back to Fuji. That is fine for cookie auth, but local bearer auth needs a bearer session in `fuji.auth.session`.
2. **The API rejects mixed credentials by design**: `apps/api/src/auth/single-credential.ts` rejects requests carrying both a Better Auth session cookie and a bearer token. That is the right edge invariant. The social sign-in transport must respect it.
3. **Shared UI names the wrong abstraction**: route code asks for Google redirect auth. It should ask for social sign-in and let `$platform/auth` decide how the credential is acquired.
4. **Two social methods preserve the old split**: `signInWithSocialRedirect()` and `signInWithIdToken()` make caller code choose transport. The future shape should be one method per sign-in flow, not one method per transport trick.

### Desired State

`AuthClient` exposes one social method:

```ts
type AuthClient = {
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
};
```

Shared UI passes one handler:

```svelte
<AuthForm
	{auth}
	syncNoun="entries"
	onSocialSignIn={() => auth.signInWithSocial({ provider: 'google' })}
/>
```

Cookie platform modules can implement this with Better Auth redirect social sign-in. Bearer platform modules implement it with OAuth 2.1 authorization-code + PKCE against Epicenter's API.

Google Identity Services is intentionally not part of this plan. It is a provider-specific fast path that adds a second sign-in shape, browser quirks, and UI constraints. Fuji local bearer login should work through the standard OAuth client path.

## Research Findings

### Better Auth Bearer Flow

DeepWiki against `better-auth/better-auth` confirmed that the bearer plugin is an alternative to browser cookies. Successful sign-in responses expose the session token in `set-auth-token`, and clients send it back as `Authorization: Bearer`.

The installed package matches that. `node_modules/better-auth/dist/plugins/bearer/index.mjs` reads the Better Auth session cookie from the response and writes `set-auth-token`:

```js
const sessionCookie = parsedCookies.get(cookieName);
if (!sessionCookie || !sessionCookie.value || sessionCookie['max-age'] === 0)
	return;
const token = sessionCookie.value;
ctx.setHeader('set-auth-token', token);
```

Implication: any bearer social flow must end with a token that Epicenter can store as a `BearerSession`, then use on later requests.

### Better Auth Redirect Social Flow

DeepWiki against `better-auth/better-auth` confirmed the redirect flow split:

- `signIn.social({ callbackURL })` starts provider OAuth and returns a URL.
- `/callback/:id` later creates the Better Auth session, sets cookies, and redirects.
- This is the native cookie flow.

Installed source confirms `/callback/:id` sets the session cookie and redirects:

```js
await setSessionCookie(c, {
	session,
	user,
});
throw c.redirect(toRedirectTo);
```

Implication: direct redirect social sign-in is still correct for cookie apps, but not for bearer apps that need a local bearer session.

### Why Not Just Use Cookies And Built In OAuth

Cookies are the right credential for production browser apps that live in the same auth-cookie world as `api.epicenter.so`. Built in Better Auth social sign-in already handles that:

```txt
Cookie app
  |
  v
auth.signIn.social({ provider })
  |
  v
Better Auth callback creates session
  |
  v
Browser stores Better Auth session cookie
  |
  v
/auth/get-session resolves from the cookie
```

That is not enough for bearer runtimes. Local apps, extensions, and future non-cookie clients need an auth credential they can store, inspect, rotate, and attach to fetches and WebSockets as `Authorization: Bearer <token>`. A browser cookie does not give those runtimes a durable `BearerSession`, and it collides with the API edge rule that rejects mixed cookie plus bearer credentials.

The tempting shortcut was to make Better Auth treat an OAuth provider access token as if it were a Better Auth session bearer token:

```txt
OAuth provider access token
  |
  v
Better Auth bearer()
  |
  v
/auth/get-session
```

That shortcut is wrong. It hides the boundary between two token types:

```txt
Better Auth session token
  Purpose: authenticate to Better Auth session endpoints
  Used by: bearer(), /auth/get-session, auth.api.getSession

OAuth provider access token
  Purpose: authorize a public OAuth client for a resource server
  Used by: OAuth audience, issuer, scope, sid verification
```

The implemented exchange keeps the boundary visible:

```txt
OAuth provider access token
  |
  v
/auth/oauth-session
  |
  v
verifyAccessToken({ audience: API baseURL, issuer: API baseURL + "/auth" })
  |
  v
read sid
  |
  v
load Better Auth session and user
  |
  v
derive Epicenter encryption keys
  |
  v
return { user, session, encryptionKeys }
  |
  v
set-auth-token: durable Better Auth session token
```

The point of `/auth/oauth-session` is not to replace Better Auth's cookie OAuth. It is the adapter from OAuth resource-server proof to Epicenter's bearer session shape. Epicenter needs that shape because sync, storage, and offline app boot all depend on a persisted `BearerSession` with user data and encryption keys, not just a browser-managed cookie.

### OAuth Provider Flow

DeepWiki against `better-auth/better-auth` confirmed that Better Auth's `oauthProvider` plugin lets the API act as an OAuth 2.1 authorization server. It exposes `/oauth2/authorize` and `/oauth2/token`, supports authorization-code flow, and supports PKCE for public clients like SPAs and browser extensions.

Installed source confirms the endpoint surface in `node_modules/@better-auth/oauth-provider/dist/index.mjs`:

```txt
/oauth2/authorize
/oauth2/token
response_type: "code"
grant_type: "authorization_code"
code_verifier
redirect_uri
```

Epicenter already mounts this plugin in `apps/api/src/auth/create-auth.ts`:

```ts
oauthProvider({
	loginPage: '/sign-in',
	consentPage: '/consent',
	requirePKCE: true,
	allowDynamicClientRegistration: false,
});
```

The API already has sign-in and consent pages that continue OAuth flows by forwarding `oauth_query` through Better Auth:

```ts
// apps/api/src/auth-pages/scripts/sign-in.ts
if (oauthQuery) body.oauth_query = oauthQuery;
```

Implication: Fuji local bearer sign-in does not need a Google browser SDK. It can use the API-hosted social sign-in page, then exchange the resulting OAuth code for a bearer token.

### API Edge Behavior

`apps/api/src/app.ts` already exposes `set-auth-token` through CORS:

```ts
return cors({
	origin: (origin) =>
		origin && TRUSTED_ORIGINS.includes(origin) ? origin : undefined,
	credentials: true,
	allowHeaders: ['Content-Type', 'Authorization', 'Upgrade'],
	allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	exposeHeaders: ['set-auth-token'],
})(c, next);
```

The API also mounts `singleCredential` globally:

```ts
app.use('*', singleCredential);
```

DeepWiki against `honojs/hono` and `cloudflare/cloudflare-docs` confirmed that `Access-Control-Expose-Headers` is the right way for browser JavaScript to read a custom cross-origin response header.

Implication: the API edge is already aligned with bearer token capture. Do not weaken `singleCredential`.

### SvelteKit Platform Alias

DeepWiki against `sveltejs/kit` confirmed that `kit.alias` can point an exact alias at a TypeScript file and consumers can import named exports from that resolved module. SvelteKit feeds the alias into Vite and generated TypeScript path config.

Implication: `$platform/auth` can export `auth` plus any platform-specific adapter wiring needed by the auth factory. The public route code should not import transport-specific helpers.

### WXT and Tab Manager

DeepWiki against `wxt-dev/wxt` confirmed that WXT does not replace browser extension identity APIs. Extension apps still use `browser.identity.launchWebAuthFlow()` and extension redirect URLs.

Tab Manager currently uses a Google ID-token flow. That path is not the target architecture. A clean break can migrate Tab Manager to `signInWithSocial({ provider: 'google' })` through an extension OAuth 2.1 adapter, even if that temporarily breaks or rewrites current Tab Manager auth.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Social auth surface | 2 coherence | `signInWithSocial({ provider })` | One method per sign-in flow. Provider is data, not a method name. |
| Google browser SDK fast path | 2 coherence | Do not implement | A provider-specific fast path preserves a second shape and forces browser/UI quirks. |
| Cookie apps | 1 evidence | Keep redirect social internally | Better Auth redirect social sign-in is the native cookie path. |
| Bearer apps | 1 evidence | OAuth 2.1 authorization-code + PKCE | Better Auth's OAuth provider supports public clients and PKCE. This yields a visible token exchange without provider-specific SDKs. |
| Fuji local bearer Google sign-in | 2 coherence | Must work through OAuth 2.1 | Local bearer mode is a first-class mode. Do not leave the button broken or disabled. |
| `signInWithIdToken` | 2 coherence | Remove from `AuthClient` | Tab Manager should move to the same social flow. Keeping this method preserves the old split. |
| `signInWithSocialRedirect` | 2 coherence | Remove from `AuthClient` | Cookie redirect remains an internal implementation detail of `createCookieAuth`. |
| Mixed credentials | 1 evidence | Preserve `singleCredential` | The API must keep rejecting cookie plus bearer ambiguity. |
| OAuth token to app session | 1 evidence | Exchange through `/auth/oauth-session` | OAuth token exchange alone is not enough. Fuji needs `BearerSession` with user data and encryption keys. |
| OAuth verifier | 1 evidence | Use `verifyAccessToken` directly | `oauthProviderResourceClient(auth)` verifies the same token class, but current local types force casts against the concrete Better Auth instance. Direct `verifyAccessToken` keeps issuer, audience, and JWKS wiring explicit. |

## Architecture

The app-facing call is the same everywhere:

```txt
Shared UI
  |
  v
auth.signInWithSocial({ provider: 'google' })
  |
  v
AuthClient implementation selected by platform
```

Cookie flow:

```txt
Cookie app
  |
  v
createCookieAuth.signInWithSocial({ provider })
  |
  v
Better Auth redirect social sign-in
  |
  v
API /auth/callback/google sets .epicenter.so cookie
  |
  v
Redirect back to app
```

Bearer flow:

```txt
Bearer app
  |
  v
createBearerAuth.signInWithSocial({ provider })
  |
  v
OAuth client builds authorize URL with PKCE
  |
  v
Browser navigates to API /auth/oauth2/authorize
  |
  v
API sign-in page handles Google through Better Auth
  |
  v
API redirects to app callback with authorization code
  |
  v
App exchanges code at /auth/oauth2/token with code_verifier
  |
  v
App fetches /auth/oauth-session with Authorization: Bearer <OAuth access token>
  |
  v
API verifies OAuth access token and reads sid
  |
  v
API loads Better Auth session, user, and encryption keys
  |
  v
API returns enriched session and set-auth-token
  |
  v
App persists BearerSession with durable Better Auth session token
```

## Implementation Plan

### Phase 1: Prove OAuth Tokens Work as Bearer Credentials

- [x] **1.1** Add an integration test around `apps/api/src/auth/create-auth.ts`: register or seed a public OAuth client, complete an authorization-code + PKCE token exchange, then resolve the OAuth access token through `/auth/oauth-session`.
- [x] **1.2** Confirm that `bearer()` is for Better Auth session bearer tokens, not OAuth provider access tokens.
- [x] **1.3** Add `/auth/oauth-session` as the app-specific exchange endpoint: validate the OAuth access token, read `sid`, load the Better Auth session and user, derive encryption keys, and return the same enriched session shape used by `getSession`.
- [x] **1.4** Prove `set-auth-token` rotation still works when a bearer request validates successfully.

### Phase 2: OAuth Client Core

- [x] **2.1** Add a shared OAuth client helper for public clients. It should own state generation, PKCE generation, authorization URL construction, callback validation, and token exchange.
- [x] **2.2** Use a proven OAuth client library such as `oauth4webapi` for browser and extension adapters. Do not hand-roll PKCE or token exchange parsing.
- [x] **2.3** Store `state` and `code_verifier` in environment-appropriate temporary storage: `sessionStorage` for browser SPAs, `chrome.storage.session` for extension flows.
- [x] **2.4** Add focused tests for state mismatch, missing verifier, token exchange failure, and successful token exchange.

### Phase 3: Auth Core Clean Break

- [x] **3.1** Replace `signInWithSocialRedirect()` and `signInWithIdToken()` on `AuthClient` with `signInWithSocial({ provider })`.
- [x] **3.2** Derive `SocialProvider` from Better Auth's `signIn.social` provider parameter instead of hard-coding Google.
- [x] **3.3** For `createCookieAuth()`, implement `signInWithSocial()` as the cookie redirect flow.
- [x] **3.4** For `createBearerAuth()`, accept an injected OAuth client adapter and implement `signInWithSocial()` as authorize redirect plus callback/token exchange support.
- [x] **3.5** After token exchange, fetch the enriched session with `Authorization: Bearer <token>` and persist a full `BearerSession`. Do not persist token-only state.
- [x] **3.6** Update contract tests so both auth factories expose the same public surface.

### Phase 4: Fuji Migration

- [x] **4.1** Register Fuji local bearer as an OAuth public client with an allowed redirect URI for local development.
- [x] **4.2** Wire Fuji bearer platform auth to the browser SPA OAuth adapter.
- [x] **4.3** Add a Fuji callback route that completes the OAuth client callback, persists the bearer session, and navigates back to the app.
- [x] **4.4** Change `apps/fuji/src/routes/+layout.svelte`, `apps/fuji/src/routes/sign-in/+page.svelte`, and `apps/fuji/src/routes/(signed-in)/components/AppHeader.svelte` to call `auth.signInWithSocial({ provider: 'google' })`.
- [ ] **4.5** Verify Fuji local bearer Google sign-in manually. `localStorage.getItem('fuji.auth.session')` should become a full bearer session with user and encryption keys.

### Phase 5: Tab Manager and Straggler Removal

- [x] **5.1** Migrate Tab Manager from the Google ID-token helper to the extension OAuth adapter, using `browser.identity.launchWebAuthFlow()` against Epicenter's `/auth/oauth2/authorize`.
- [x] **5.2** Remove `apps/tab-manager/src/lib/auth.ts` ID-token credential helper after the adapter is wired.
- [x] **5.3** Grep for `signInWithIdToken`, `signInWithSocialRedirect`, `getGoogleCredentials`, `getGoogleIdToken`, and Google browser SDK script references. Remove all live callers.
- [x] **5.4** Keep historical specs untouched, but update active auth skills/docs to name `signInWithSocial` as the only social path.

## Edge Cases

### OAuth Access Token Does Not Validate Through `bearer()`

This is the main token-boundary rule. Better Auth's bearer plugin consumes Better Auth session bearer tokens. OAuth provider access tokens are verified as OAuth resource-server tokens, then exchanged through `/auth/oauth-session` for the durable session token and enriched session shape.

### OAuth Callback Arrives Without Stored Verifier

Return a normal social sign-in error and leave auth state signed out. Do not retry with a weaker flow.

### User Has a Stale API Cookie

Bearer auth must exchange and fetch with bearer credentials only. If a request carries both cookie and bearer, `singleCredential` should continue returning `multiple_credentials`.

### Tab Manager Breakage During Clean Break

Breaking Tab Manager is acceptable if the migration replaces it with the OAuth extension adapter in the same implementation wave. Do not leave two social methods alive just to preserve the old Tab Manager helper.

### User Cancels API Sign-In

The callback route should surface the existing `SocialSignInFailed` result and keep the app signed out. No disabled Google button state is planned.

## Open Questions

1. What exact callback path should Fuji local bearer use?
   Recommendation: `/auth/callback` inside the app, because it describes the platform callback, not Google.
2. Should cookie apps call Better Auth redirect social directly or go through the OAuth provider authorize page too?
   Recommendation: keep direct redirect social internally for cookie apps in this pass. The clean break is the public AuthClient surface, not forcing cookie apps through an extra OAuth client.
3. Should the OAuth client helper live in `packages/auth` or a separate package?
   Recommendation: separate package if extension and future Tauri adapters share it. Inject the adapter into `createBearerAuth()` so `@epicenter/auth` stays runtime-neutral.
4. Should we keep `signInWithIdToken()` as a private helper for Tab Manager during migration?
   Recommendation: no. If clean break is allowed, migrate Tab Manager instead of preserving the old method.

## Verification Commands

```sh
bun test packages/auth
bun --cwd apps/fuji run typecheck
bun --cwd apps/tab-manager run typecheck
rg "signInWithIdToken|signInWithSocialRedirect|getGoogleCredentials|getGoogleIdToken|accounts.google.com/gsi" apps packages
```

Expected results:

- Auth tests prove the single social method and bearer session persistence.
- Fuji local bearer Google sign-in works through OAuth 2.1.
- Tab Manager no longer owns a Google ID-token helper.
- No live app code calls the old social methods.

## DeepWiki Questions Asked

- `better-auth/better-auth`: How does the bearer plugin use `set-auth-token`, and is it an alternative to browser cookies? Conclusion: bearer auth is intended as a cookie alternative, successful sign-in exposes `set-auth-token`, and clients send it back as `Authorization: Bearer`.
- `better-auth/better-auth`: How does redirect `signIn.social` behave? Conclusion: redirect social sign-in is cookie-shaped and completes in `/callback/:id`.
- `better-auth/better-auth`: How does `oauthProvider` work for public OAuth clients? Conclusion: it exposes authorize and token endpoints, supports authorization-code + PKCE, and can be used by SPAs and extensions instead of provider-specific browser SDKs.
- `honojs/hono`: How does CORS expose a custom response header? Conclusion: `exposeHeaders: ['set-auth-token']` is the right mechanism.
- `cloudflare/cloudflare-docs`: What does Worker CORS require for custom response headers? Conclusion: browser JavaScript needs `Access-Control-Expose-Headers` for a non-simple response header.
- `sveltejs/kit`: Can `kit.alias` point an exact alias at a TypeScript file with named exports? Conclusion: yes.
- `wxt-dev/wxt`: Does WXT replace extension OAuth primitives? Conclusion: no, extension sign-in still uses `browser.identity.launchWebAuthFlow()` and extension redirect URLs.

## References

- Better Auth bearer plugin docs: https://better-auth.com/docs/plugins/bearer
- Better Auth basic social sign-in docs: https://better-auth.com/docs/basic-usage
- Current broader OAuth client context: `specs/20260504T010000-drop-authclient-redirect-sign-in.md`
- Current platform auth mode context: `specs/20260507T151100-honeycrisp-platform-auth-modes.md`
- Current bearer cookie omission context: `specs/20260507T151049-bearer-client-omit-internal-cookies.md`
