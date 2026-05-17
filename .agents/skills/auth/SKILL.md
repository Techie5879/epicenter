---
name: auth
description: Epicenter @epicenter/auth and @epicenter/auth-svelte: OAuth, OAuthSession, identity, auth-owned fetch/WebSocket, workspace lifecycle binding.
metadata:
  author: epicenter
  version: '5.0'
---

# Epicenter Auth

## Upstream Grounding

When changes depend on Better Auth OAuth provider behavior, bearer token
verification, device authorization, cookie handling, token rotation, plugin
shape, or generated API shape, ask DeepWiki a narrow question against
`better-auth/better-auth` before relying on memory. Use it to orient, then
verify decisive details against local installed types, source, tests, or
official docs before changing code.

Known Better Auth source landmarks:

```txt
packages/oauth-provider/src/oauth.ts
packages/oauth-provider/src/authorize.ts
packages/oauth-provider/src/token.ts
packages/oauth-provider/src/revoke.ts
packages/oauth-provider/src/client-resource.ts
packages/better-auth/src/plugins/device-authorization/index.ts
packages/better-auth/src/plugins/device-authorization/client.ts
packages/better-auth/src/plugins/custom-session/index.ts
```

Better Auth remains the auth server and session engine. Epicenter extends it
through plugins and options; it does not replace Better Auth's server-side
session model.

Use this composition sentence when explaining the architecture:

```txt
Epicenter uses Better Auth for auth-server machinery, OAuth for the app/resource boundary, and AuthIdentity for workspace boot.
```

That means Better Auth owns users, account cookies, login, consent, token
issuing, revocation, JWKS, and metadata. Epicenter clients store
`OAuthSession`, not Better Auth sessions. `/me` is the adapter that verifies an
OAuth access token, loads the Better Auth user, derives encryption keys, and
returns `AuthIdentity`.

When the user asks whether this is idiomatic Better Auth, be precise:

```txt
It is not the shortest Better Auth browser-cookie path.
It is an idiomatic composition of Better Auth as the auth server beneath a cross-client OAuth runtime.
```

Do not suggest removing Better Auth unless the user has a concrete blocker that
cannot be handled with configuration, a small adapter, or an upstream fix.
Building OAuth by hand means owning PKCE validation, redirect URI validation,
state and mix-up protections, trusted clients, token signing, refresh token
rotation, revocation, JWKS, metadata, consent, account sessions, and security
fixes forever.

## Current Model

Epicenter app clients use one OAuth app auth model:

```ts
const auth = createOAuthAppAuth({
	baseURL: APP_URLS.API,
	clientId,
	launcher,
	sessionStorage,
});
```

The old split between `createCookieAuth` and `createBearerAuth` is legacy.
Do not add new code using those factories, `BearerSession`, or
`auth.bearerToken`. When touching old app code that still uses those names,
migrate it to `createOAuthAppAuth` and auth-owned transports.

Two packages own the public surface:

- `@epicenter/auth`: framework-agnostic core. Owns OAuth session storage,
  identity loading, refresh, refresh-token revocation, authenticated fetch, and
  WebSocket opening.
- `@epicenter/auth-svelte`: Svelte 5 wrapper. Mirrors `auth.state` through
  `createSubscriber` so templates and `$derived` reads are reactive.

The API server composes Better Auth like this:

```txt
Hono app
  -> CORS
  -> per-request DB
  -> createAuth({ db, env, baseURL })
  -> singleCredential
  -> /auth/* Better Auth handler
  -> /auth/me OAuth identity projection
  -> protected resources
```

`createAuth()` configures Better Auth with Drizzle, Google sign-in,
email/password, `bearer`, `jwt`, `deviceAuthorization`, `oauthProvider`, and
`customSession`. The OAuth provider owns `/auth/oauth2/authorize`,
`/auth/oauth2/token`, and `/auth/oauth2/revoke`. Epicenter owns `/auth/me`,
which verifies an OAuth access token and returns the local-first identity.

## Public Surface

Auth has one public client interface:

```ts
type AuthIdentity = {
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
};

type AuthState =
	| { status: 'signed-in'; identity: AuthIdentity }
	| { status: 'reauth-required'; identity: AuthIdentity }
	| { status: 'signed-out' };

type AuthClient = {
	state: AuthState;
	onStateChange(fn: (state: AuthState) => void): () => void;
	startSignIn(input?: {
		returnTo?: string;
	}): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
	openWebSocket(url: string | URL, protocols?: string[]): Promise<WebSocket>;
	[Symbol.dispose](): void;
};
```

Read `auth.state` synchronously. Use `auth.onStateChange(fn)` for future
changes only; it does not replay. Consumers that need bootstrap behavior must
read `auth.state` once and then register the listener.

Do not expose raw tokens above auth storage and transport boundaries. UI,
workspace binding, AI fetches, and sync consume capabilities: `auth.fetch` and
`auth.openWebSocket`.

## OAuthSession

`OAuthSession` is the durable app session shape:

```ts
export const OAuthSession = type({
	'...': AuthIdentity,
	'+': 'delete',
	accessToken: 'string',
	refreshToken: 'string',
	accessTokenExpiresAt: 'number',
});
```

Expanded:

```ts
type OAuthSession = {
	user: AuthUser;
	encryptionKeys: EncryptionKeys;
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAt: number;
};
```

It deliberately combines local identity and network credentials:

```txt
OAuthSession
  user + encryptionKeys  -> local identity and offline unlock
  accessToken            -> fetch and WebSocket credential
  refreshToken           -> renew network access
  accessTokenExpiresAt   -> transport refresh hint
```

The app can boot from a cached `OAuthSession` without calling the network.
Refresh failure must preserve the cached identity and encryption keys so local
workspace data can remain available.

The current cleanup direction is stricter than some live code: token expiry
should be transport freshness only. `reauth-required` should mean a refresh
failed or the server rejected auth for an existing `OAuthSession`, not merely
that `accessTokenExpiresAt` is in the past.

## Sign-In Flow

Apps ask auth to start hosted sign-in:

```ts
await auth.startSignIn({ returnTo: location.href });
```

The launcher decides how the runtime completes OAuth:

- Browser redirect launchers navigate to the hosted `/sign-in` and usually do
  not resolve before the page unloads.
- Extension and device launchers may resolve after receiving tokens.
- CLI and daemon flows use device authorization and machine session storage.

The return value of `startSignIn` is not the "user is signed in" signal.
Observe `auth.state.status === 'signed-in'` for completion.

After tokens arrive, auth calls `/auth/me` with
`Authorization: Bearer <accessToken>`. The API verifies the token with
`oauthProviderResourceClient().verifyAccessToken`, loads the user, derives
encryption keys, and returns `AuthIdentity`. Auth stores that as `OAuthSession`.

## Transport

Use `auth.fetch` for HTTP resources:

```ts
const response = await auth.fetch(`${APP_URLS.API}/ai/chat`, {
	method: 'POST',
	body,
});
```

Auth refreshes before network use when the access token is near expiry, retries
one 401 after a forced refresh, and sends `credentials: 'omit'` for OAuth app
requests. Storage writes are awaited before the refreshed token is used.

Use `auth.openWebSocket` for sync:

```ts
const collaboration = openCollaboration(ydoc, {
	url: websocketUrl(`${APP_URLS.API}/workspaces/${ydoc.guid}`),
	waitFor: idb.whenLoaded,
	openWebSocket: auth.openWebSocket,
	replicaId,
	actions,
});
```

Browsers cannot attach `Authorization` headers to `new WebSocket()`, so auth
adds the bearer token as a WebSocket subprotocol. The API's `singleCredential`
middleware normalizes that subprotocol into `Authorization` and rejects
requests that carry multiple credentials.

## Workspace Binding

Workspace construction reads identity from `createSession` and gives lower
layers callbacks for data they need at their own boundary:

```ts
import { requireSignedIn } from '@epicenter/auth';
import { createSession, type InferSignedIn } from '@epicenter/svelte';

export const session = createSession({
	auth,
	build: (identity) => {
		const userId = identity.user.id;
		const fuji = openFuji({
			userId,
			peer,
			openWebSocket: auth.openWebSocket,
			encryptionKeys: () => requireSignedIn(auth).encryptionKeys,
		});
		return {
			userId,
			fuji,
			[Symbol.dispose]() {
				fuji[Symbol.dispose]();
			},
		};
	},
});

export type FujiSignedIn = InferSignedIn<typeof session>;
```

`createSession` owns workspace lifecycle. A sign-out disposes the workspace. A
same-user identity refresh is a no-op at the session boundary. A different-user
transition must dispose or reload before sync resumes.

Local workspace data must not be wiped just because network auth failed. Wiping
Yjs or IndexedDB storage is a separate destructive user action.

## Server Routes

In `apps/api/src/app.ts`, keep OAuth discovery routes before the `/auth/*`
catch-all because Hono matches in registration order.

Protected resources use `requireOAuthUser`:

```txt
/ai/*
/workspaces/*
/documents/*
/api/billing/*
/api/assets/*
```

`requireOAuthUser` calls `/auth/me` logic internally: verify bearer token, load
the user, derive identity, then set `c.var.user`.

WebSocket sync enters through the same protected workspace and document routes.
The API accepts the upgrade only after `singleCredential` and
`requireOAuthUser` have resolved one user.

## Common Pitfalls

- Do not add `auth.bearerToken`. Token reading leaks transport details back
  into app code.
- Do not reintroduce cookie-vs-bearer app factories. Better Auth still uses
  cookies for hosted sign-in pages, but app resources use OAuth access tokens.
- Do not treat `startSignIn()` resolving as signed-in. State is the source of
  truth.
- Do not clear local workspace data on refresh failure. Move to
  `reauth-required` and keep identity available.
- Do not let `accessTokenExpiresAt` decide local identity state after the auth
  core cleanup lands. It belongs to refresh decisions.
- Do not send both cookies and bearer tokens to resource routes.
  `singleCredential` should reject ambiguity before Better Auth sees it.
- Do not hide persistence failures in storage adapters used by auth core. If
  storage cannot save the refreshed session, the client should not keep using
  the new token as if it is durable.
