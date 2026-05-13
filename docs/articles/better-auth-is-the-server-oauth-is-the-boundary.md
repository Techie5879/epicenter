# Better Auth Is the Server, OAuth Is the Boundary

> **Historical note (2026-05-12):** This article was written before the
> composable server cleanup. The composition story it sketches is still right
> in spirit, but the deployment framing is out of date.
>
> There is no separate `apps/cloud` deployable. Hosted features
>    (billing, dashboard, assets, storage registry) and product surfaces
>    (Ark, Betcha) are Cloud Apps inside the composable `apps/server`
>    host. Physical splitting across processes or domains is operational
>    topology, not a second product platform. See
>    `specs/20260512T150000-cloud-modules-and-networks.md`.
>
> The rest of the article is preserved as written for context. Read it as
> the older two-deployable framing; rely on the specs above for current
> architecture.

Epicenter uses Better Auth for auth-server machinery and OAuth for the
app/runtime boundary. Better Auth still owns users, account cookies, login,
consent, token issuing, revocation, JWKS, and metadata. Epicenter clients store
OAuth sessions, not Better Auth sessions.

The easy confusion is thinking OAuth replaces Better Auth. It does not. OAuth
is a protocol. Better Auth is the auth implementation. Epicenter uses Better
Auth to run the auth server, then exposes OAuth as the standard way apps talk
to OAuth protected resources.

`/workspace-identity` is the adapter between those worlds. The app presents an OAuth access
token; Epicenter Server verifies it, loads the Better Auth user, derives
encryption keys, and returns the local-first `WorkspaceIdentity`. The keys come from
Epicenter Server after token verification. They do not live in OAuth claims.

This is not the shortest Better Auth browser-cookie path, and that is the
point. It is a clean way to compose Better Auth for browser apps, extensions,
Tauri desktop apps, CLI tools, daemon processes, and WebSocket sync without
making every runtime invent its own credential shape.

```txt
OAuth:
  protocol for authorization and resource access

Better Auth:
  users, sessions, cookies, login, plugins, OAuth provider

Epicenter auth:
  WorkspaceIdentity, OAuthSession, token refresh, auth.fetch, auth.openWebSocket
```

That split is the whole design.

## Better Auth stays behind the server boundary

Better Auth is still doing the heavy generic auth work. It validates account login, owns account cookies, stores raw users and sessions, and issues OAuth tokens through its OAuth provider.

```txt
             account login
             cookies
             raw sessions
                 |
                 v
        Better Auth inside server
                 |
                 | oauthProvider
                 v
        OAuth access and refresh tokens
                 |
                 v
        Epicenter apps and resources
```

Epicenter does not want to own password flows, social login callbacks, cookie security, consent, token signing, refresh token storage, revocation, or OAuth metadata. Better Auth already exists for that.

Building those pieces by hand would make Epicenter responsible for the boring dangerous parts:

```txt
authorization code generation
PKCE validation
redirect URI validation
state and mix-up protections
trusted client registry
token signing
refresh token rotation
revocation
JWKS
issuer metadata
resource metadata
account cookies
session storage
password and social login
security fixes forever
```

That is not a good trade. The product-specific part is much smaller.

## OAuth is the app credential boundary

Epicenter does not let Better Auth session tokens become the credential that every app stores. The app runtime credential is an OAuth access token for a specific resource audience.

```txt
Better Auth session token:
  server-internal credential
  account pages
  Better Auth internals

OAuth access token:
  app runtime credential
  fetch
  WebSocket
  sync
  cloud APIs

WorkspaceIdentity:
  Epicenter workspace identity
  user + encryptionKeys
```

This is where Epicenter intentionally differs from the simplest Better Auth browser app. In a normal same-origin web app, the idiomatic Better Auth path is cookies:

```txt
browser app -> Better Auth cookie -> getSession/useSession
```

Epicenter has more runtimes than that.

```txt
browser SPA
browser extension
Tauri desktop app
CLI
daemon
WebSocket sync client
self-hosted server
hosted cloud dashboard
```

Cookies are excellent when the browser cookie jar is the runtime. They are not a universal runtime credential. OAuth gives every client the same app-to-resource contract.

## `/workspace-identity` is the Epicenter adapter

The OAuth token proves the app can call a resource. It should not carry the workspace keys directly. Epicenter resolves those through `/workspace-identity`.

```txt
1. app exchanges OAuth code for tokens
2. app calls resource /workspace-identity with Authorization: Bearer <access token>
3. server verifies issuer and audience
4. server reads payload.sub
5. server loads the Better Auth user row
6. server projects AuthUser
7. server derives encryptionKeys from user.id
8. server returns WorkspaceIdentity
```

That makes `/workspace-identity` the bridge between generic OAuth and Epicenter's local-first workspace model.

```ts
type WorkspaceIdentity = {
  user: AuthUser;
  encryptionKeys: EncryptionKeys;
};

type OAuthSession = WorkspaceIdentity & {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
};
```

`OAuthSession` can contain credentials because it is private auth storage. UI code, workspace code, and sync code should consume capabilities like `auth.fetch()` and `auth.openWebSocket()` instead of passing tokens around.

## The hosted domains say what each surface owns

The public domains describe protocol roles. The deployables describe product ownership. Those are related, but not identical.

```txt
epicenter.so
|
|-- accounts.epicenter.so
|   `-- apps/server
|       |-- Better Auth
|       |   |-- account cookies
|       |   |-- login/session engine
|       |   |-- social/email auth
|       |   `-- oauthProvider
|       |
|       |-- /sign-in
|       |-- /consent
|       |-- /oauth2/authorize
|       |-- /oauth2/token
|       |-- /oauth2/revoke
|       |-- /jwks
|       `-- /.well-known/*
|
|-- sync.epicenter.so
|   `-- apps/server
|       |-- OAuth resource verification
|       |-- /workspace-identity
|       |   `-- WorkspaceIdentity = user + encryptionKeys
|       |-- /workspaces/*
|       `-- /documents/*
|
`-- api.epicenter.so
    `-- apps/cloud
        |-- OAuth resource verification
        |-- /dashboard/*
        |-- /api/billing/*
        |-- /api/storage/*
        `-- /api/assets/*
```

`apps/server` serves both accounts and sync because self-hosted Epicenter should be one useful server: auth plus workspace sync, no Postgres required. `apps/cloud` serves hosted control-plane features because billing, hosted storage registry, asset management, and dashboard APIs are cloud concerns.

## The first sign-in has several round trips

The round trips are not accidental. They keep account login, OAuth token exchange, and workspace identity resolution as separate steps.

```txt
1  app      -> accounts   start authorize with PKCE + resource
2  accounts -> app/user   if no cookie, show sign-in
3  user     -> accounts   submit account login
4  accounts -> provider   maybe Google/social redirect
5  provider -> accounts   provider callback
6  accounts -> user       consent, if needed
7  accounts -> app        redirect back with auth code
8  app      -> accounts   exchange code for OAuth tokens
9  app      -> sync /workspace-identity   bearer access token
10 sync     -> app                        WorkspaceIdentity with encryptionKeys
```

Returning users with an account cookie take the shorter path.

```txt
1  app      -> accounts   authorize with PKCE + resource
2  accounts -> app        redirect back with code
3  app      -> accounts   exchange code for tokens
4  app      -> sync /workspace-identity   bearer access token
5  sync     -> app                        WorkspaceIdentity with encryptionKeys
```

This is why OAuth belongs at the app boundary. The account cookie can stay on `accounts.epicenter.so`; the app gets an audience-bound token for the resource it actually needs.

## The composition rule is small

Use Better Auth for auth-server machinery.

Use OAuth for app-to-resource credentials.

Use Epicenter code only for Epicenter-specific identity and workspace keys.

```txt
Good:
  Better Auth oauthProvider issues access and refresh tokens.
  Apps store OAuthSession.
  Protected resources verify OAuth access tokens.
  /workspace-identity returns WorkspaceIdentity.

Bad:
  Apps store Better Auth session tokens.
  OAuth tokens include encryption keys.
  Cloud derives workspace encryption keys.
  Every client type invents a different credential shape.
```

This is an idiomatic composition of Better Auth, not a replacement for it. The library stays where it is strongest. Epicenter adds the boundary that the product needs.
