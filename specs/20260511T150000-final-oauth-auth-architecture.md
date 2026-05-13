# Final OAuth And Server Composition Architecture

**Date**: 2026-05-11
**Status**: Draft, clean-break revision
**Author**: AI assisted
**Stack Map**: `specs/20260512T134603-auth-spec-stack-clean-break-map.md`
**Stack Position**: North star for the auth stack.
**Companion spec**: `specs/20260512T150000-cloud-modules-and-networks.md` (product-layer north star; owns the composable server shape, including server core, compile-time Cloud Apps, and per-Cloud-App OAuth resources)

> **Session vocabulary update (2026-05-12):** the app-side projection of
> `AuthState` has since landed in
> `specs/20260512T220000-session-two-axis-cohesive-reshape.md`. In the live code:
>
> - `Session<T>` is `SessionPayload<T> \| null` (no discriminant field).
> - Apps gate route access on `if (session.current)` and reach the workspace
>   through `current.workspace`.
> - `createSession()` exposes `requireWorkspace()` for descendants and no
>   longer takes a `name` field.
> - The auth helper was renamed: `requireSignedIn` → `requireIdentity`.
> - Each app's session module is now `src/lib/session.ts`, not
>   `session.svelte.ts`.
>
> `AuthState` itself is unchanged and still has three states. Wherever this
> spec or its examples reference the older app-side projection (e.g.
> `getSignedInSession`, `current.status === 'signed-in'`, `InferSignedIn`,
> `apps/<x>/src/lib/session.svelte.ts`), read them through the reshape spec's
> current names.

**Supersedes**:

- `specs/20260511T105846-auth-oauth-everywhere-clean-break.md`
- `specs/20260511T141800-accounts-origin-auth-server-clean-break.md`

## One Sentence

Every Epicenter app talks to an `AuthClient` that exposes `state`, `startSignIn`, `signOut`, `fetch`, and `openWebSocket`; OAuth protocol machinery stays inside Better Auth, workspace identity and key release stay inside `/workspace-identity`, and physical deployable splitting is a separate operational decision.

## Overview

This spec has two layers, and they must be read separately.

```txt
Layer 1: App auth contract (the main subject)
  AuthClient surface:
    state, startSignIn, signOut, fetch, openWebSocket
  Shared types:
    AuthState, WorkspaceIdentity, AuthUser
  Internal to auth package:
    OAuthSession, OAuthTokenGrant, OAuthTransaction, refresh, /workspace-identity calls

Layer 2: Server composition (a separate decision)
  Epicenter Server: composable host
  Base modules: auth, /workspace-identity, workspace sync, document sync
  Optional Cloud Apps: billing, assets, dashboard, Ark, Betcha
  Hosted domains: accounts.epicenter.so, sync.epicenter.so, api.epicenter.so, Cloud App hosts
```

The auth contract collapse and route-family auth cleanup must land before the
server composition cleanup. Apps must already be consuming `AuthClient`
capabilities before file moves out of `apps/api`, or the rename ships with the
old credential shapes still in place.

The target is not "Better Auth everywhere." The target is narrower:

```txt
Epicenter Server core:
  account cookies
  Better Auth raw User and Session records
  OAuth login and consent
  OAuth token issuance and revocation
  OAuth JWKS
  OAuth access-token verification
  AuthUser projection
  encryption-key derivation
  workspace-identity release
  workspace and document sync

Optional Cloud Apps:
  Drizzle and Postgres bindings
  billing
  hosted storage registry
  asset management
  dashboard and hosted control APIs
  Cloud Apps such as Ark and Betcha

Epicenter clients:
  private OAuthSession storage
  AuthState and WorkspaceIdentity
  token refresh behind auth.fetch and auth.openWebSocket
  auth-owned fetch and WebSocket transport
```

## Better Auth Composition

One sentence:

```txt
Epicenter uses Better Auth as the auth server, OAuth as the app/resource protocol, and WorkspaceIdentity as the Epicenter workspace boundary.
```

OAuth does not replace Better Auth. Better Auth still owns the hard generic auth
machinery: users, account sessions, account cookies, email and social login,
OAuth consent, OAuth token issuing, revocation, JWKS, and metadata. Epicenter
does not reimplement those pieces.

Epicenter composes Better Auth by making OAuth the only credential family that
leaves the server boundary.

```txt
Better Auth inside Epicenter Server:
  account login
  account cookies
  raw User and Session records
  oauthProvider authorize/token/revoke
  JWKS and issuer metadata

OAuth outside Epicenter Server:
  access tokens for protected resources
  refresh tokens in private app auth storage
  audience-bound resource calls
  WebSocket sync credentials

Epicenter-specific layer:
  /workspace-identity
  AuthUser projection
  encryption key derivation
  WorkspaceIdentity
  OAuthSession
  auth.fetch()
  auth.openWebSocket()
```

This is not the most direct Better Auth browser-cookie implementation. A normal
single-origin browser app can let Better Auth cookies be the whole runtime auth
story. Epicenter is not only a single-origin browser app. It has browser apps,
extensions, Tauri apps, CLI tools, daemon processes, local workspace boot, and
WebSocket sync. OAuth is the shared protocol across those runtimes.

The composition rule:

```txt
Use Better Auth for auth-server machinery.
Use OAuth for app-to-resource credentials.
Use Epicenter code only for Epicenter-specific identity and workspace keys.
```

The anti-rule:

```txt
Do not let Better Auth session tokens become app runtime credentials.
Do not make every client type invent a credential shape.
Do not put encryption keys in OAuth token claims.
```

## Trust And Deployment Composition

This section makes the trust model, the scope model, and the hosted versus
self-hosted composition explicit. The clean-break question for this spec is
where encryption key delivery lives. The answer below is "a single workspace
identity endpoint authorized by an OAuth resource scope," and the rest of this
section says why and how that endpoint composes across deployments.

### Encryption Trust Model

Epicenter is server-trusted encryption, not end-to-end encryption.

```txt
Epicenter Server holds ENCRYPTION_SECRETS.
Encryption keys are derived from user.id at workspace-identity release time:
  rootKey       = SHA-256(ENCRYPTION_SECRETS.current.secret)
  userKey       = HKDF(rootKey, info="user:{userId}")
  workspaceKey  = HKDF(userKey, info="workspace:{workspaceId}")
An OAuth access token with the workspaces:open scope authorizes key release.
```

Two deployments, two trust readings:

```txt
Hosted Epicenter:
  Epicenter-the-company owns ENCRYPTION_SECRETS.
  Epicenter-the-company can derive any user's workspace keys.
  This is not zero knowledge relative to Epicenter-the-company.

Self-hosted Epicenter:
  The self-hosted operator owns ENCRYPTION_SECRETS.
  Epicenter-the-company cannot derive keys without operator cooperation.
  This is zero knowledge relative to Epicenter-the-company.
  This is not zero knowledge relative to the operator or server.
```

Not part of this architecture:

```txt
Client-managed master keys.
Passphrase or device-bound recovery.
Per-workspace wrapped keys held client-side.
True end-to-end encryption where the server cannot read plaintext.
```

If any of those become product requirements, they need a separate spec. They
would also change the endpoint shape: client-managed E2EE pushes the key
boundary out of `/workspace-identity` and into the device. This spec does not
pretend to deliver that.

### Why The Endpoint Must Exist

A newcomer reading this spec should be able to understand that
`/workspace-identity` is not a design choice. It is a consequence of the
constraints above. This subsection walks the chain so the rest of the
architecture stops looking arbitrary.

The constraint that drives everything is the product sentence:

```txt
The user signs in. Sync starts. No recovery code, no QR scan, no extra prompt
unless they explicitly opt into an advanced mode.
```

That UX promise picks three of four corners of a known cryptographic
trilemma:

```txt
1. Server cannot read your data         (end-to-end encrypted)
2. Login is the only thing the user does (no recovery codes or scans)
3. New devices sync automatically on login
4. Forgetting your password does not lose your data
```

Any system can have three. No system can have all four. This is settled
cryptographic literature, not a tooling gap. iCloud (default), Notion, and
Dropbox sit at the corner that sacrifices 1. Signal and iMessage sit at the
corner that sacrifices 3 (new devices need approval). Bitwarden and 1Password
sit at the corner that sacrifices 4 (password loss equals data loss).

Epicenter keeps 2, 3, and 4. Epicenter sacrifices 1.

```txt
Sacrifice 2 means recovery codes or device-to-device handoffs.
  Rejected: violates the login-only UX promise.

Sacrifice 3 means a new device cannot sync until an old device approves.
  Rejected: violates the automatic-sync promise for multi-device users.

Sacrifice 4 means forgetting your password loses your data.
  Rejected: OAuth sign-in has no password to derive a recovery key from,
  and data loss on credential reset is a brutal user experience.

Sacrifice 1 means the server holds key material.
  Accepted: server-trusted encryption, hosted by Epicenter or operator.
```

Once 1 is sacrificed, the server holds key material the client needs. The
client must receive that material after login. The OAuth token endpoint
stays standard (no key claims). OIDC ID tokens and UserInfo stay unused (no
key claims there either). That leaves exactly two delivery paths:

```txt
HTTP endpoint:
  GET /workspace-identity returns { user, encryptionKeys }.
  One round trip on boot. Cacheable. Reusable by non-sync clients
  (CLI, backup, snapshot decryption, future tools).

WebSocket handshake:
  The first frame of /workspaces/* WebSocket carries identity and keys.
  Saves one round trip. Couples key delivery to sync transport.
```

The HTTP path wins because keys are not sync-shaped. Anything that needs to
decrypt local data without holding a live sync session needs an HTTP path
to keys anyway: a CLI command that decrypts a saved snapshot, a backup
exporter, a future search indexer, a viewer-only client. None of them want
to fake a sync session to retrieve keys.

So the endpoint is forced, the shape is forced, and the transport is
forced. The only real design freedom is the name and the bundle shape,
both decided in the next subsection.

```txt
Trail of forced choices:

  UX promise: login then automatic sync, no extra prompts.
       |
       v
  Trilemma: sacrifice "server cannot read."
       |
       v
  Server holds keys; client must receive them after login.
       |
       v
  Not in OAuth token response (non-standard).
  Not in ID tokens or UserInfo (OIDC, rejected upstream).
       |
       v
  Authenticated endpoint must exist.
       |
       v
  HTTP beats WebSocket-inline (keys are not sync-shaped).
       |
       v
  /workspace-identity { user, encryptionKeys }.
```

### Endpoint Decision

The question: does encryption key delivery belong in `WorkspaceIdentity` via `/me`,
a renamed workspace identity endpoint, or a per-workspace key-release endpoint?

Decision: a single workspace identity endpoint, named for its job.

```txt
GET {resource}/workspace-identity
  Authorization: Bearer <oauth access token with workspaces:open>
  ->
  WorkspaceIdentity { user, encryptionKeys }
```

Rationale:

```txt
Reject: per-workspace key-release endpoint
  Current keys derive from user.id alone:
    userKey      = HKDF(rootKey, info="user:{userId}")
    workspaceKey = HKDF(userKey, info="workspace:{workspaceId}")
  A per-workspace endpoint releases material the same bearer token already
  authorizes. Same scope, same audience, same trust boundary. It adds round
  trips on boot without adding stricter policy. It would only stop being
  ceremony under a different key model: per-workspace key wrapping,
  device-bound key release, or client-managed E2EE. None of those are in
  scope.

Reject: /me
  /me reads as a profile endpoint by REST and OIDC UserInfo convention.
  This endpoint is not a profile endpoint. AuthUser is intentionally small,
  account profile metadata lives behind a separate /account-profile
  endpoint, and the encryption key release is the load-bearing job. The
  name should match the job.

Accept: /workspace-identity
  Names the one job: release the identity required to open this user's
  local workspaces.
  Returns WorkspaceIdentity { user, encryptionKeys }, asserted with '+': 'delete'.
  Authorized by an OAuth access token with the workspaces:open scope.
  One round trip on boot; the workspace then operates offline against cached
  WorkspaceIdentity.
```

### Forward Compatibility With Future E2EE

If Epicenter ever ships an opt-in Advanced Data Protection mode (sacrificing
trilemma corner 3 instead of corner 1), the endpoint survives. Only the
payload type changes.

```txt
Today (server-trusted, default):
  GET /workspace-identity
    -> WorkspaceIdentity { user, encryptionKeys }
       (raw keys, derived server-side from user.id)

Future (opt-in E2EE, hypothetical):
  GET /workspace-identity
    -> WorkspaceIdentity { user, wrappedKeys, deviceEnrollment }
       (keys wrapped to the user's enrolled-device public key,
        unwrappable only on a device that completed enrollment)
```

Same scope, same transport, same audience, same auth, same caller surface.
Treat `/workspace-identity` as a long-lived contract, not a transitional
one. The endpoint is forward-compatible with the trust upgrade that has
been deliberately deferred.

### Scope Model

OAuth scopes are how the access token says what it is allowed to do. The
target system uses one Epicenter resource scope and one standard OAuth scope.

```txt
workspaces:open
  Epicenter custom resource scope.
  Required to call:
    GET  {resource}/workspace-identity
    GET  {resource}/workspaces/*
    POST {resource}/workspaces/*
    WS   {resource}/workspaces/*
    GET  {resource}/documents/*
  Releases encryption keys derived from user.id when used against
  /workspace-identity.
  Not an OIDC standard scope. Not Better Auth magic. It is an Epicenter
  protected-resource scope enforced by Epicenter Server.

offline_access
  Standard OAuth scope.
  Required when the client needs a refresh token (durable login).
  All first-party Epicenter clients request it.
```

Not requested by Epicenter clients:

```txt
openid
  Would activate OIDC ID-token and UserInfo behavior. Not used.
  Encryption keys never travel through ID-token claims or UserInfo.

profile
  OIDC profile claims. Not used. Account profile metadata lives behind a
  separate /account-profile endpoint when needed.

email
  OIDC email claims. Not used. The AuthUser email comes from the Better
  Auth user row inside /workspace-identity, not from token claims.
```

Cloud App routes do not need `workspaces:open`. A client requests an
audience-bound token for the specific Cloud App's host (e.g.
`billing.epicenter.so`) with `offline_access` and any Cloud-App-specific
scopes the protected resource enforces (for example `billing:read`,
`billing:admin`). Per-Cloud-App scope namespaces are owned by the companion
spec; they are listed only so the boundary stays clear: a sync token must
not work against a Cloud App, and a Cloud App token must not work against
sync, and a token for one Cloud App must not work against another.

### Hosted Versus Self-Hosted Composition

The client contract is identical across deployments. Only the issuer and
resource URLs change.

```txt
Hosted Epicenter (one composition, multiple public origins):

  accounts.epicenter.so
    served by the accounts base module
    OAuth issuer
    sign-in, consent, /oauth2/authorize, /oauth2/token, /oauth2/revoke,
    /jwks, /.well-known/openid-configuration,
    /.well-known/oauth-authorization-server

  sync.epicenter.so
    served by the sync base module
    OAuth protected resource
    /.well-known/oauth-protected-resource
    /workspace-identity
    /workspaces/*
    /documents/*

  api.epicenter.so
    served by Cloud Apps
    OAuth protected resource for hosted control plane
    /.well-known/oauth-protected-resource
    /api/*
    /dashboard/*

Self-hosted Epicenter (one origin, issuer and resource collapsed):

  server.example.com
    served by the same server composition
    OAuth issuer AND OAuth protected resource
    /.well-known/openid-configuration
    /.well-known/oauth-authorization-server
    /.well-known/oauth-protected-resource
    /oauth2/authorize, /oauth2/token, /oauth2/revoke, /jwks
    /sign-in, /consent, /device
    /workspace-identity
    /workspaces/*
    /documents/*
```

The collapse is configuration, not a different code path. `apps/server`
exposes the same Hono route modules either way; host dispatch is the only
difference.

```txt
Hosted apps/server start-up:
  createServerApp({ issuer: "accounts.epicenter.so",
                    resource: "sync.epicenter.so" })
    -> host dispatch routes accounts requests to createAccountsRoutes
    -> host dispatch routes sync requests to createSyncRoutes

Self-hosted apps/server start-up:
  createServerApp({ issuer: "server.example.com",
                    resource: "server.example.com" })
    -> single origin mounts createAccountsRoutes and createSyncRoutes
    -> /.well-known/oauth-authorization-server and
       /.well-known/oauth-protected-resource both live on the same origin
```

Clients pick issuer and resource from configuration, not at runtime:

```txt
Hosted workspace app:
  issuer   = https://accounts.epicenter.so
  resource = https://sync.epicenter.so

Self-hosted workspace app:
  issuer   = https://server.example.com
  resource = https://server.example.com
```

The `AuthClient` does not branch on hosted versus self-hosted. The OAuth
launcher follows whichever URLs the consumer passes in.

## Why This Exists

The current worktree is halfway between two models.

```txt
Old model:
  apps sometimes use Better Auth cookies
  apps sometimes use Better Auth bearer session tokens
  /auth/oauth-session bridges OAuth tokens back into Better Auth session tokens
  set-auth-token rotates session credentials
  AuthSessionResponse names Better Auth session vocabulary

New model:
  apps use OAuth access and refresh tokens
  protected routes verify OAuth access tokens as resource-server requests
  /workspace-identity returns WorkspaceIdentity only
  AuthUser is small and stripped
```

The smell is not the date normalization helper anymore. That helper was a symptom. The deeper problem is mixed credential ownership and mixed module ownership. A first-party browser app, extension, Tauri app, CLI, and daemon should not each teach the auth package a different credential family. A composed Epicenter Server running only server core should also not have to import Cloud Apps just to sync a workspace.

## Non-Negotiable Invariants

```txt
Epicenter Server validates login credentials and owns account cookies.
Epicenter Server owns raw Better Auth User and Session records.
Epicenter Server issues OAuth tokens through oauthProvider.
Epicenter Server derives encryption keys from user id.
Epicenter Server owns workspace and document sync.
Epicenter Server has no Postgres dependency.
Epicenter Server has no Drizzle Postgres bindings.
Epicenter Cloud owns hosted control-plane state that requires Postgres.
WorkspaceIdentity never contains credentials.
OAuthSession may contain OAuth credentials because it is private auth storage.
Better Auth session tokens never enter app auth storage.
set-auth-token is not an app runtime credential.
Workspace boot reads user id and encryption keys from WorkspaceIdentity.
Protected resource calls use OAuth access tokens.
WebSocket sync uses OAuth access tokens.
Refresh failure pauses network auth, not local workspace access.
```

### Key Delivery Invariants

```txt
Encryption keys leave the server only through /workspace-identity.
Encryption keys never appear in OAuth token responses.
Encryption keys never appear in OAuth access-token claims.
Encryption keys never appear in OIDC ID tokens.
Encryption keys never appear in OIDC UserInfo responses.
/workspace-identity requires an OAuth access token with the workspaces:open scope.
/workspace-identity must not accept Better Auth cookies as an app credential.
Only /workspace-identity derives encryption keys.
Workspace and document sync routes need the user principal, not encryption keys.
Workspace boot reads cached WorkspaceIdentity, not a fresh request per workspace.
There is no per-workspace key-release endpoint in the target system.
Hosted and self-hosted deployments use the same client contract; only issuer and
  resource URLs differ.
True end-to-end encryption is out of scope; this is server-trusted encryption
  with operator-controlled secrets when self-hosted.
```

## Collapsed Auth Boundary

The app-facing contract should be small enough to explain without OAuth nouns:

```txt
Auth gives the app:
  state
  startSignIn()
  signOut()
  fetch()
  openWebSocket()

The app gives workspace code:
  WorkspaceIdentity
  auth-owned transport capabilities
```

Everything else is internal plumbing:

```txt
Internal to auth:
  OAuthTransaction
  OAuthTokenGrant
  OAuthSession
  accessToken
  refreshToken
  accessTokenExpiresAt
  /workspace-identity fetch
  refresh retry
  WebSocket bearer subprotocol
```

This is the collapse:

```txt
Before:
  App code knows about tokens, bearer headers, session response shapes,
  sync bearer getters, and credential refresh.

After:
  App code knows about identity and capabilities.
```

Do not design app APIs around `OAuthSession`. It is private auth storage. The
public shape is `AuthState`.

```ts
type AuthState =
	| { status: 'signed-out' }
	| { status: 'signed-in'; identity: WorkspaceIdentity }
	| { status: 'reauth-required'; identity: WorkspaceIdentity };
```

`reauth-required` means the app still has local identity but network auth needs
user action. It does not mean the access token timestamp is in the past.

### What Better Auth Owns

Better Auth and `@better-auth/oauth-provider` should own OAuth protocol
machinery:

```txt
OAuth authorize endpoint
OAuth token endpoint
OAuth revoke endpoint
OAuth introspection when needed
OIDC and OAuth metadata
JWKS
PKCE validation
consent state
trusted clients
OAuth access-token issuing
OAuth refresh-token issuing
```

Epicenter should not create parallel abstractions for those jobs.

### What `/workspace-identity` Replaces

`/workspace-identity` is narrow. It replaces only Epicenter-specific identity
bridges that turned one credential family into another. It does not replace
any OAuth protocol endpoint.

```txt
What /workspace-identity replaces (Epicenter identity projection only):
  /auth/oauth-session
  /auth/me                         (old path-based identity projection)
  AuthSessionResponse
  BetterAuthSessionResponse
  oauthSessionFromAuthSessionResponse
  customSession identity enrichment for app runtime auth

What /workspace-identity does NOT replace (Better Auth + oauthProvider still own these):
  /oauth2/authorize
  /oauth2/token
  /oauth2/revoke
  /.well-known/oauth-authorization-server
  /.well-known/openid-configuration
  /jwks
  PKCE validation
  consent state
  trusted client registry
  access-token issuing
  refresh-token issuing

Replaced by OAuth refresh inside Better Auth:
  set-auth-token app runtime rotation

Replaced by auth.fetch and auth.openWebSocket inside the auth package:
  public bearerToken
  sync bearer-token getters
  app-written Authorization headers
  app-written WebSocket bearer protocols
```

`/workspace-identity` has one job:

```txt
OAuth access token with workspaces:open -> WorkspaceIdentity
```

It verifies the token (using Better Auth's resource client), checks the
`workspaces:open` scope, loads the user, projects `AuthUser`, derives
encryption keys from `user.id`, and returns `{ user, encryptionKeys }`. It does
not issue tokens. It does not create Better Auth sessions. It does not return
account profile metadata. It does not run for individual workspace IDs; it
returns the keying material the client needs to open any workspace it owns.

### What Else Stays Out Of `/workspace-identity` And `WorkspaceIdentity`

Beyond OAuth protocol machinery, some pieces look adjacent to identity but must
not be pulled into `/workspace-identity` or `WorkspaceIdentity`. They live where
they belong by other boundaries:

```txt
Better Auth account cookies:
  stay inside the account server, sign-in pages, and consent pages
  must not be accepted as app runtime credentials
  must not be accepted by protected-resource handlers

Account profile metadata (created_at, image, emailVerified, etc.):
  belongs to a separate AccountProfile endpoint if needed
  must not enter AuthUser or WorkspaceIdentity
  must not become a back door for session metadata

Cloud billing, assets, hosted storage registry:
  stay inside Cloud Apps
  must not enter workspace identity, /workspace-identity, or encryption key derivation
  must not be required for workspace boot

Workspace and document sync:
  stay as OAuth protected resources that verify OAuth access tokens
  must not call Better Auth getSession()
  must not derive encryption keys per request (only /workspace-identity derives keys)

Refresh-token rotation (when Better Auth supports it):
  stays inside Better Auth oauthProvider, not Epicenter code
```

The practical rule:

```txt
If it is OAuth protocol machinery, let Better Auth own it.
If it turns a valid OAuth token into local-first identity, /workspace-identity owns it.
If app code needs to call a resource, auth.fetch or auth.openWebSocket owns it.
If it is public-record or hosted-control state, it stays in an optional Cloud App.
If it is account profile UI, it lives behind a separate /account-profile endpoint.
```

## Boundary Classification

Use this table before moving any code. It keeps the app contract separate from
OAuth machinery, identity projection, and server composition.

| Boundary | Owns | Does not own |
| --- | --- | --- |
| App auth contract | `AuthClient`, `AuthState`, `WorkspaceIdentity`, `auth.fetch`, `auth.openWebSocket`, `startSignIn`, `signOut` | OAuth endpoints, raw tokens, Better Auth sessions, deployment domains |
| Better Auth OAuth provider | authorize, token, revoke, metadata, JWKS, PKCE, consent, trusted clients, token issuing | Epicenter encryption keys, workspace identity projection, app transport API |
| Epicenter identity projection | `/workspace-identity`, `AuthUser`, encryption key derivation, `WorkspaceIdentity` | OAuth token issuing, revocation, metadata, JWKS, consent |
| Server composition and domain boundary | server core, optional Cloud Apps, hosted domains, infrastructure ownership | Public app auth shape |

Current code maps to those buckets like this:

```txt
App auth contract:
  packages/auth/src/auth-contract.ts
  packages/auth/src/create-oauth-app-auth.ts
  packages/auth/src/auth-types.ts

Better Auth OAuth provider machinery:
  apps/api/src/auth/create-auth.ts
    oauthProvider()
    trusted clients
    deviceAuthorization() until replaced
    bearer() until deleted from app credential paths
  apps/api/src/app.ts
    /auth/* Better Auth handler
    /.well-known/* metadata mounting

Epicenter identity projection:
  apps/api/src/auth/app-access-token-auth.ts
    resolveRequestWorkspaceIdentity()
  apps/api/src/auth/identity-response.ts
  apps/api/src/app.ts /workspace-identity route

Server composition and product boundary:
  current apps/api mixes base server modules and cloud work
  target server host owns server core
  optional Cloud Apps own hosted control-plane and public-record work
```

### Old Credential Bridges

These are the current bridge paths to remove before splitting deployables:

```txt
Better Auth session bridge:
  /auth/oauth-session
  AuthSessionResponse
  BetterAuthSessionResponse
  oauthSessionFromAuthSessionResponse
  customSession app identity responses

Session-token rotation bridge:
  set-auth-token header exposure
  machine auth reading set-auth-token

App bearer session bridge:
  createBearerAuth
  BearerSession
  Better Auth bearer() as an app credential path
  auth.bearerToken
  sync bearer-token getters

Cookie app auth bridge:
  createCookieAuth
  app runtime calls to Better Auth getSession()
```

Delete these after callers use `AuthClient` capabilities. Keep WebSocket bearer
subprotocol parsing as transport input normalization until `auth.openWebSocket`
is the only app-facing sync entry point.

### Server Composition Boundary

Do not start the implementation by moving domains or directories. The
composition cleanup is downstream from the auth cleanup. Physical splitting is
optional topology, not the product model.

```txt
Epicenter Server core:
  Better Auth
  OAuth provider
  /workspace-identity
  workspace sync
  document sync
  no Postgres requirement in the target

Optional Cloud Apps:
  Drizzle and Postgres allowed
  billing
  hosted storage registry
  assets
  dashboard
  Cloud Apps
```

Hosted domains can still split by public protocol role:

```txt
accounts.epicenter.so
  served by the account module
  OAuth issuer and account pages

sync.epicenter.so
  served by the sync module
  OAuth protected resource for /workspace-identity, workspaces, and documents

api.epicenter.so
  served by Cloud Apps
  OAuth protected resource for hosted control APIs
```

Self-hosted deployments can use one origin:

```txt
https://server.example.com
  /.well-known/openid-configuration
  /.well-known/oauth-authorization-server
  /.well-known/oauth-protected-resource
  /oauth2/authorize
  /oauth2/token
  /oauth2/revoke
  /jwks
  /sign-in
  /consent
  /device
  /workspace-identity
  /workspaces/*
  /documents/*
```

Hosted clean-break target:

```txt
accounts.epicenter.so
  /.well-known/openid-configuration
  /.well-known/oauth-authorization-server
  /oauth2/authorize
  /oauth2/token
  /oauth2/revoke
  /jwks
  /sign-in
  /consent
  /device

sync.epicenter.so
  /.well-known/oauth-protected-resource
  /workspace-identity
  /workspaces/*
  /documents/*

api.epicenter.so
  /.well-known/oauth-protected-resource
  /api/storage/*
  /api/assets/*
  /api/billing/*
  /dashboard/*
```

Do not add `/.auth`. Do not keep `/auth/*` aliases in the clean-break target.
The current `/auth/*` paths are migration facts, not the final public contract.

## Ownership And Domain Rationale

The short rule above is enough to implement against. This section keeps the
reasoning that led to it, because the server composition is easy to flatten
back into "one API app" unless the product boundary stays visible.

```txt
+--------------------------------------------------------------+
| apps/server                                                  |
|                                                              |
| Base modules own:                                            |
|   Better Auth                                                |
|   sign-in pages                                              |
|   account cookies                                            |
|   consent and account-factor flows                           |
|   OAuth authorize, token, revoke, JWKS, metadata             |
|   /workspace-identity                                        |
|   workspace sync                                             |
|   document sync                                              |
|   self-hostable storage                                      |
|                                                              |
| Optional Cloud Apps own:                                     |
|   Postgres                                                   |
|   billing                                                    |
|   hosted storage registry                                    |
|   cloud asset management                                     |
|   public records                                             |
|   Cloud Apps                                              |
+--------------------------------------------------------------+
                         |
                         | OAuth access token
                         | aud = protected resource origin
                         v
+--------------------------------------------------------------+
| Epicenter apps                                               |
|                                                              |
| Own publicly:                                                |
|   AuthState                                                  |
|   WorkspaceIdentity                                               |
|   auth.fetch                                                 |
|   auth.openWebSocket                                         |
|   startSignIn                                                |
|   signOut                                                    |
|                                                              |
| Own privately through the auth package:                      |
|   OAuthSession storage                                       |
|   refresh-token persistence                                  |
|   token refresh and retry                                    |
|                                                              |
| Do not own:                                                  |
|   Better Auth raw Session                                    |
|   Better Auth session token                                  |
|   OAuth protocol endpoints                                   |
|   hosted credential forms                                    |
+--------------------------------------------------------------+
```

This spec stops at "the server host can compose Cloud Apps." The Cloud App
list, Cloud App shape, and per-app scope namespaces are owned by the
companion spec (`cloud-modules-and-networks.md`). Do not freeze billing,
assets, or dashboard as permanent fields of a global cloud env: they are Cloud
Apps, optional per operator.

### Boundary Correction

This spec began as a cleanup of path-based OAuth under `api.epicenter.so/auth`.
That cleanup first produced an `accounts.epicenter.so` plus `api.epicenter.so`
origin split:

```txt
accounts.epicenter.so
  OAuth issuer
  account cookies
  sign-in, consent, token, revoke, JWKS, discovery

api.epicenter.so
  OAuth protected resource
  /workspace-identity
  workspace sync
  documents
  billing
  hosted storage controls
```

That split is better than the old path-based issuer because it makes the OAuth
roles visible. It is still not the final architecture because it answers the
hostname question, not the capability-composition question.

There are two separate axes:

```txt
OAuth origin axis:
  issuer
  protected resource

Capability product axis:
  base server modules with no Postgres
  optional Cloud Apps with Drizzle and Postgres
```

Do not let the hostname axis choose the package boundary. A self-hosted install
wants a small server that can run auth and sync without Postgres. A hosted
composition can add Drizzle, Postgres, billing, registry tables, asset
management, reconciliation jobs, dashboard APIs, and Cloud Apps.

The corrected product sentence:

```txt
Epicenter Server is the composable host.
Base modules provide self-hostable auth and sync.
Cloud Apps add hosted infrastructure and product records.
Epicenter Cloud is our hosted composition.
```

### Naming Direction

Final app shape:

```txt
apps/server
  composable Hono server
  server core has no Postgres dependency
  optional Cloud Apps may use Drizzle and Postgres
  auth, OAuth, /workspace-identity, workspace sync, document sync
  billing, registry, asset management, storage controls, hosted dashboards
  Cloud Apps
```

Avoid naming the self-hostable runtime `accounts`. Account pages are only one
part of it. If sync lives there too, `accounts` becomes a lie.

Avoid naming the hosted capabilities only `api`. `api` describes a transport
shape, not the product responsibility. `Cloud App` is the better boundary name
because it explains why Postgres, billing, managed registry state, and public
records are allowed there.

### Domain Decision

Use one composition model and split hosted public domains by protocol role.

Boundary rule:

```txt
Domains split by public protocol role.
Modules split by capability boundary.
Deployables split only when infrastructure or operations demand it.
```

Apply that rule whenever a route, package, or app boundary is unclear:

```txt
Domain:
  What URL does a client talk to?
  What OAuth role does this origin play?

Module:
  What dependencies does this capability need?
  What data is allowed here?

Deployable:
  What must be built, configured, hosted, scaled, and released separately?
  Is the split worth a second operational unit?
```

```txt
accounts.epicenter.so
  served by accounts base module
  OAuth issuer and account pages

sync.epicenter.so
  served by sync base module
  OAuth protected resource for /workspace-identity, workspaces, and documents

api.epicenter.so
  served by Cloud Apps
  hosted cloud control plane
```

One composition root keeps the code boundary clean:

```txt
apps/server
  server core:
    no Postgres
    auth + sync

  optional Cloud Apps:
    Postgres allowed
    billing + assets + dashboard

  optional Cloud Apps:
    Postgres allowed
    Ark, Betcha, configured per Cloud App
```

There is no separate `apps/cloud` deployable in the target. The hosted
control plane lives as Cloud Apps inside the same composable
host. Physical splitting across processes or domains stays available as an
operational topology, but it is not a second product platform.

Three domains keep the public contract honest:

```txt
accounts.epicenter.so
  sign in here

sync.epicenter.so
  sync data here

api.epicenter.so
  manage hosted cloud services here
```

The repo boundary and the public domain boundary do not need to be identical.
One Hono app can serve multiple hostnames through host dispatch. That is not
technical debt when the dispatch follows public protocol roles and the
deployable still has one product responsibility.

Public domain tree:

```txt
epicenter.so
|-- accounts.epicenter.so
|   |-- /.well-known/openid-configuration
|   |-- /.well-known/oauth-authorization-server
|   |-- /oauth2/authorize
|   |-- /oauth2/token
|   |-- /oauth2/revoke
|   |-- /jwks
|   |-- /sign-in
|   |-- /consent
|   `-- /device
|
|-- sync.epicenter.so
|   |-- /.well-known/oauth-protected-resource
|   |-- /workspace-identity
|   |-- /workspaces/*
|   `-- /documents/*
|
`-- api.epicenter.so
    |-- /.well-known/oauth-protected-resource
    |-- /dashboard/*
    |-- /api/billing/*
    |-- /api/storage/*
    `-- /api/assets/*
```

Hosted domain to module mapping:

```txt
accounts.epicenter.so
  -> accounts base module
     -> account and OAuth routes

sync.epicenter.so
  -> sync base module
     -> identity and sync routes

api.epicenter.so
  -> Cloud Apps
     -> dashboard and hosted control APIs
```

The implementation should still use mountable Hono modules inside those
server compositions. A module boundary is useful for composition and tests. A
deployable boundary is only useful when the product, storage, scaling, or
release cadence is actually independent.

```txt
apps/server
|-- createAccountsRoutes()
|   |-- OAuth issuer metadata
|   |-- sign-in pages
|   |-- consent pages
|   |-- token, revoke, JWKS
|
|-- createSyncRoutes()
|   |-- protected-resource metadata
|   |-- /workspace-identity
|   |-- workspace sync
|   `-- document sync
|
`-- createServerApp()
    |-- mounts accounts routes for accounts.epicenter.so
    `-- mounts sync routes for sync.epicenter.so

|-- createCloudAppRoutes()
|   |-- protected-resource metadata
|   |-- billing APIs
|   |-- hosted storage APIs
|   |-- asset APIs
|   `-- dashboard SPA at /dashboard/*
|
`-- createServerApp()
    |-- mounts accounts routes for accounts.epicenter.so
    |-- mounts sync routes for sync.epicenter.so
    `-- mounts Cloud App routes for api.epicenter.so and Cloud App hosts
```

Composition happens at the app root, not inside the feature modules:

```txt
apps/server/src/app.ts
|-- createServerApp()
|   |-- createAccountsRoutes(serverEnv)
|   |-- createSyncRoutes(serverEnv)
|   |-- createCloudAppRoutes(serverEnv)
|   `-- createHostDispatch({
|       |-- accounts.epicenter.so -> accountsRoutes
|       |-- sync.epicenter.so -> syncRoutes
|       |-- api.epicenter.so -> cloudAppRoutes
|       |-- {instance-host} -> appInstanceRoutes
|       `-- self-hosted default -> accountsRoutes + syncRoutes + enabled Cloud Apps
|      })
|
`-- export default app
```

The feature modules receive dependencies from the server root. They should not
import the server root or reach sideways into other modules.

```txt
apps/server/src/app.ts
  -> creates ServerEnv
  -> passes ServerEnv to createAccountsRoutes()
  -> passes ServerEnv to createSyncRoutes()
  -> passes Cloud App env slices to enabled Cloud Apps
```

Server composition dependency tree:

```txt
ServerEnv
|-- auth
|   |-- Better Auth instance
|   |-- oauthProvider
|   `-- trusted clients
|-- identity
|   |-- user lookup
|   `-- encryption key derivation
|-- sync
|   |-- workspace store
|   |-- document store
|   `-- websocket rooms
`-- config
    |-- issuer origins
    |-- resource origins
    `-- self-hosted origin

createAccountsRoutes(ServerEnv)
  -> uses auth
  -> uses config
  -> does not use sync store

createSyncRoutes(ServerEnv)
  -> uses OAuth token verification
  -> uses identity
  -> uses sync
  -> does not issue account cookies
```

Cloud App composition dependency tree:

```txt
CloudAppEnv
|-- oauth
|   |-- issuer = accounts.epicenter.so
|   `-- cloud-host resource = api.epicenter.so
|-- db
|   |-- Drizzle
|   `-- Postgres
|-- cloudApps
|   |-- registered Cloud Apps
|   `-- registered Cloud Apps
|-- instances
|   `-- operator-configured Cloud Apps per Cloud App
`-- config
    `-- host origins

createCloudAppRoutes(CloudAppEnv)
  -> verifies OAuth access tokens against the cloud-host audience
  -> dispatches Cloud App routes (billing, assets, dashboard)
  -> does not derive encryption keys

createAppInstanceRoutes(CloudAppEnv, instance)
  -> verifies OAuth access tokens against the Cloud App audience
  -> dispatches the owning Cloud App's product routes
  -> publishes /.well-known/oauth-protected-resource for the instance host
```

The exact Cloud App list, Cloud App shape, and per-app scope namespaces
live in `cloud-modules-and-networks.md`. This spec only commits that App
Instances are OAuth protected resources distinct from the cloud-host resource.

This is the compromise that keeps the architecture honest:

```txt
Use Hono route modules for:
  code organization
  testability
  host dispatch
  optional self-hosted composition

Use separate deployables only for:
  different infrastructure requirements
  independent scaling needs
  independent operational ownership
  independent release cadence
```

Rejected alternatives:

```txt
Two domains only:
  accounts.epicenter.so + api.epicenter.so

Why rejected:
  sync has to live under accounts or cloud
  accounts-plus-sync makes the accounts name false
  cloud-plus-sync makes self-hosting depend on the hosted control plane

Three product platforms:
  apps/accounts + apps/sync + apps/cloud

Why rejected:
  auth and sync are both required for the useful self-hosted server
  splitting them creates platform overhead before there is an independent
  scaling or ownership need

Mountable modules inside one composable host:
  apps/server provides accounts, /workspace-identity, and sync (server core)
  apps/server also registers optional Cloud Apps

Why accepted:
  gives accounts, sync, cloud, and dashboard clear code boundaries
  avoids adding deployables before operations need them
  lets self-hosters run one server origin while hosted production uses
  role-specific domains
```

## Public Shapes

### AuthUser

`AuthUser` is the signed-in principal, not the account profile. The minimum keying identity: a stable id and an email for display fallback.

```ts
export const AuthUser = type({
	'+': 'delete',
	id: 'string',
	email: 'string',
});

export type AuthUser = typeof AuthUser.infer;
```

Keep out:

```txt
name                                (use email or a UI-side derived display name)
createdAt
updatedAt
emailVerified
image
raw Better Auth plugin fields
raw session fields
```

`name` is intentionally dropped. Better Auth's user table still stores it, but `AuthUser` does not project it. Every existing caller already used `user.name ?? user.email`, `{#if user.name}`, or passed it as optional to a downstream API. No site treated it as load-bearing. Keeping it would be the precedent that lets `image`, `emailVerified`, and `createdAt` creep in next. UI surfaces that want a friendlier label can derive one from `email`:

```ts
const displayName = user.email.split('@')[0];
```

That is presentation, made where presentation happens.

If apps need account/profile metadata later, add a separate endpoint and type:

```ts
export const AccountProfile = type({
	'+': 'delete',
	userId: 'string',
	email: 'string',
	emailVerified: 'boolean',
	name: 'string',
	'image?': 'string | null | undefined',
	createdAt: 'string',
	updatedAt: 'string',
});
```

That endpoint is not part of workspace boot. It must not become a back door for session metadata.

### WorkspaceIdentity

`WorkspaceIdentity` is the local-first identity needed to open a workspace.

```ts
export const WorkspaceIdentity = type({
	'+': 'delete',
	user: AuthUser,
	encryptionKeys: EncryptionKeys,
});

export type WorkspaceIdentity = typeof WorkspaceIdentity.infer;
```

The only stable public meaning is:

```txt
WorkspaceIdentity = who the local workspace belongs to + keys needed to decrypt it
```

### OAuthTokenGrant

`OAuthTokenGrant` is the parsed token result returned by the OAuth client layer after authorization-code or refresh-token exchange.

```ts
export const OAuthTokenGrant = type({
	'+': 'delete',
	accessToken: 'string',
	refreshToken: 'string',
	accessTokenExpiresAt: 'number',
});

export type OAuthTokenGrant = typeof OAuthTokenGrant.infer;
```

The parser should validate `token_type` and `expires_in`, then discard fields auth does not use.

```ts
function parseTokenGrant(response: oauth.TokenEndpointResponse): Result<OAuthTokenGrant, OAuthClientError> {
	if (response.token_type.toLowerCase() !== 'bearer') {
		return OAuthClientError.UnsupportedTokenType({ tokenType: response.token_type });
	}

	return Ok(OAuthTokenGrant.assert({
		accessToken: readString(response, 'access_token'),
		refreshToken: readString(response, 'refresh_token'),
		accessTokenExpiresAt: now() + readPositiveNumber(response, 'expires_in') * 1000,
	}));
}
```

Do not persist `scope` or `tokenType`. They are parse-time validation details.

### OAuthSession

`OAuthSession` is private app auth storage. It combines local identity and OAuth credentials because cached identity lets local-first apps boot offline.

```ts
export const OAuthSession = type({
	'...': WorkspaceIdentity,
	'+': 'delete',
	accessToken: 'string',
	refreshToken: 'string',
	accessTokenExpiresAt: 'number',
});

export type OAuthSession = typeof OAuthSession.infer;
```

Arktype's `'...'` is a single-key spread (it is a JS object literal), so two spreads in one declaration is a duplicate key. The composition is still exactly `WorkspaceIdentity` plus `OAuthTokenGrant`; the inline fields just say so directly. A `.and()`-based composition (`WorkspaceIdentity.and(OAuthTokenGrant)`) would also work but loses the `'+': 'delete'` ergonomics.

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

This is allowed to contain OAuth credentials because it is stored behind the auth package boundary. It is not a UI type and not a workspace document type.

### AuthState

```ts
type AuthState =
	| { status: 'signed-out' }
	| { status: 'signed-in'; identity: WorkspaceIdentity }
	| { status: 'reauth-required'; identity: WorkspaceIdentity };
```

`reauth-required` means:

```txt
The app still has a cached identity for local data, but network auth is paused.
```

It should not mean:

```txt
The access token expiry timestamp is in the past.
```

Expired access tokens are a transport freshness issue. Refresh failure is the state transition.

### OAuthTransaction

The PKCE transaction is temporary launcher state, not an auth session.

```ts
export const OAuthTransaction = type({
	'+': 'delete',
	state: 'string',
	codeVerifier: 'string',
	redirectUri: 'string',
	issuer: 'string',
	resource: 'string',
	clientId: 'string',
	returnTo: 'string | null',
	createdAt: 'number',
});
```

Store this in session-like temporary storage. Remove it after callback handling. Do not reuse `OAuthSessionStorage` for it.

## Server Routes

### Epicenter Server

```txt
self-hosted:
  https://server.example.com

hosted:
  https://accounts.epicenter.so
  https://sync.epicenter.so

/.well-known/openid-configuration
/.well-known/oauth-authorization-server
/.well-known/oauth-protected-resource
/oauth2/authorize
/oauth2/token
/oauth2/revoke
/jwks
/sign-in
/consent
/device
/workspace-identity
/workspaces/*
/documents/*
/*
```

The Better Auth catch-all belongs only after first-party pages, metadata routes,
identity routes, and sync routes that must be owned by Epicenter code.

Better Auth plugins in the final server app:

```txt
Keep:
  oauthProvider
  jwt
  email/password and social providers

Remove from the final app path:
  bearer
  customSession
  deviceAuthorization
```

The important Better Auth source detail: `deviceAuthorization` returns a Better Auth session token as `access_token` and does not return `refresh_token`. That token is not an oauthProvider resource access token. It must not be stored as `OAuthSession`.

### Epicenter Cloud

```txt
https://api.epicenter.so

/.well-known/oauth-protected-resource
/api/assets/*
/api/billing/*
/api/storage/*
/dashboard/*
```

Epicenter Cloud is our hosted composition. Its Cloud Apps form
an OAuth protected resource, but they are not the primary identity or sync
runtime. They verify access tokens issued by the account base module and serve
hosted-only control-plane APIs.

`/workspace-identity` exists on Epicenter Server. Do not add `/me`,
`/auth/me`, or `/auth/workspace-identity`, and do not put workspace boot
identity on Cloud.

Dashboard lives under an Cloud App:

```txt
https://api.epicenter.so/dashboard/*
  served by the dashboard Cloud App
  implemented as a reactive SvelteKit SPA
  built with adapter-static or equivalent static output
  mounted by the server host as dashboard assets and fallback routes
```

The dashboard is allowed to use `packages/ui` and normal Svelte client-side
patterns. It is not allowed to become the account authority. It signs in through
`accounts.epicenter.so`, receives an OAuth token for `api.epicenter.so`, and
calls Cloud APIs with that token.

```txt
Dashboard sign-in:

api.epicenter.so/dashboard
  -> redirects to accounts.epicenter.so/oauth2/authorize
  -> accounts uses Better Auth cookie to complete login and consent
  -> accounts redirects back with OAuth code
  -> dashboard exchanges code at accounts.epicenter.so/oauth2/token
  -> token audience is api.epicenter.so
  -> dashboard calls api.epicenter.so/api/*
```

### Browser Resource Boundaries

CORS policy follows the OAuth protected resource boundary. Do not solve browser access
by adding one global allowlist to every hosted route.

```txt
sync.epicenter.so
  resource purpose:
    workspace identity, workspace sync, document sync
  browser clients:
    first-party apps and registered OAuth apps after consent
  credential:
    OAuth access token with workspaces:open
  routes:
    /workspace-identity
    /workspaces/*
    /documents/*

api.epicenter.so
  resource purpose:
    hosted cloud control plane
  browser clients:
    dashboard and explicitly productized cloud clients
  credential:
    OAuth access token with cloud-specific scopes
  routes:
    /api/assets/*
    /api/billing/*
    /api/storage/*
    /dashboard/*
```

This means third-party browser sync clients belong at the sync resource, not at
the Cloud control plane by accident. If a third-party app needs both workspace
sync and hosted Cloud APIs, it should request separate resource grants with the
smallest scopes each resource enforces.

Cloud App resources extend this list. Each Cloud App instance
(for example `ark.epicenter.so`, `betcha.epicenter.so`, `ark.alice.com`) is
its own OAuth protected resource with its own
`/.well-known/oauth-protected-resource`, its own audience, its own scope
namespace, and its own CORS allowlist. The Cloud App resource boundary
is owned by the companion spec
(`specs/20260512T150000-cloud-modules-and-networks.md`). The rule from
this spec stays the same: tokens are audience-bound, never substitutable
across resources, never able to claim more than one Cloud App at a time.

Do not add a static WebSocket `Origin` allowlist for bearer sync. Browser
WebSocket sync is authorized by the scoped OAuth access token. Origin checks are
appropriate for cookie-authenticated browser flows, account pages, and any
future route that depends on ambient browser credentials.

Pricing and hosted subscription state belong to Cloud Apps,
not to a separate deployable:

```txt
Cloud Apps inside apps/server
|-- billing Cloud App
|   |-- dashboard pricing pages
|   |-- checkout and subscription screens
|   |-- plan and entitlement APIs
|   |-- usage and invoice surfaces
|   |-- billing provider integration
|   `-- Postgres-backed hosted account metadata
|-- dashboard Cloud App
|-- assets Cloud App
`-- hosted storage registry Cloud App
```

Base server modules may show account settings that are required for sign-in,
recovery, MFA, passkeys, consent, and self-hosted account administration. They
must not need pricing tables, billing provider SDKs, hosted plan state, or
Cloud App registry tables to boot.

Infrastructure Cloud App dependency tree:

```txt
Cloud Apps
|-- depend on:
|   |-- packages/ui
|   |-- packages/auth shared types
|   |-- OAuth access-token verification
|   |-- Drizzle
|   |-- Postgres
|   |-- billing provider SDKs
|   |-- hosted storage registry
|   `-- asset management
|
`-- must not depend on:
    |-- Better Auth raw Session as app auth
    |-- Better Auth getSession() for app access token routes
    |-- encryption key derivation
    |-- base sync module internals
    `-- /workspace-identity as workspace boot identity
```

Base module dependency tree:

```txt
base server modules
|-- depend on:
|   |-- Better Auth
|   |-- oauthProvider
|   |-- OAuth token issuing and JWKS
|   |-- self-hostable storage
|   |-- workspace sync
|   |-- document sync
|   |-- encryption key derivation
|   `-- packages/auth shared types
|
`-- must not depend on:
    |-- Drizzle Postgres bindings
    |-- billing provider SDKs
    |-- hosted storage registry
    |-- Cloud App source
    `-- Cloud App or Cloud App code
```

`/workspace-identity` flow:

```txt
1. Read Authorization: Bearer <access token>.
2. Verify token with issuer and audience for the server resource.
3. Confirm the workspaces:open scope is present.
4. Read payload.sub.
5. Load Better Auth user row by id.
6. Project AuthUser with AuthUser.assert(row).
7. Derive encryption keys from user.id.
8. Return WorkspaceIdentity.
```

Protected resource middleware (workspaces, documents, future cloud routes):

```txt
1. Verify OAuth access token.
2. Confirm the route's required scope is present.
3. Load user row by payload.sub.
4. Set c.var.user = AuthUser.assert(row).
5. Do not derive encryption keys.
6. Do not call Better Auth getSession().
```

Only `/workspace-identity` should derive encryption keys. Billing routes,
assets, storage controls, documents, and workspace sync need the user
principal, not encryption keys.

## Client Flows

### Browser Apps

```txt
App route:
  createOAuthAppAuth({ issuer, resource, clientId, launcher, sessionStorage })

Sign-in:
	auth.startSignIn({ returnTo })
	  -> launcher creates PKCE transaction
	  -> launcher requests scopes: workspaces:open offline_access
	  -> browser navigates to accounts /oauth2/authorize
	  -> accounts uses Better Auth cookie to complete login and consent
	  -> accounts redirects back with code
	  -> launcher exchanges code for OAuthTokenGrant
	  -> auth calls GET resource /workspace-identity
	  -> auth stores OAuthSession
```

Browser apps do not use Better Auth cookies as app runtime auth, even if served from `api.epicenter.so/dashboard`.

Workspace apps request a token for the sync resource, not the cloud resource:

```txt
Workspace app sign-in:

workspace app
  -> redirects to accounts.epicenter.so/oauth2/authorize
  -> includes resource = https://sync.epicenter.so
  -> includes scope = workspaces:open offline_access
  -> accounts completes sign-in and consent
  -> workspace app exchanges code at accounts.epicenter.so/oauth2/token
  -> token audience is sync.epicenter.so
  -> workspace app calls sync.epicenter.so/workspace-identity
  -> /workspace-identity returns WorkspaceIdentity with encryption keys
  -> workspace app opens sync.epicenter.so/workspaces/*
```

Workspace sync runtime:

```txt
workspace app
|-- OAuthSession
|   |-- WorkspaceIdentity
|   |   |-- AuthUser
|   |   `-- encryptionKeys
|   |-- accessToken for sync.epicenter.so
|   |-- refreshToken issued by accounts.epicenter.so
|   `-- accessTokenExpiresAt
|
|-- auth.fetch()
|   `-- adds Authorization: Bearer <sync access token>
|
`-- auth.openWebSocket()
    |-- refreshes token if needed
    |-- opens sync.epicenter.so/workspaces/*
    `-- sends OAuth access token to the sync resource
```

A workspace app that also needs hosted billing or dashboard data must request a
separate Cloud grant:

```txt
sync token:
  issuer = accounts.epicenter.so
  resource = sync.epicenter.so
  scope = workspaces:open offline_access
  used for /workspace-identity, workspaces, documents

Cloud App token (one per app, one audience each):
  issuer = the server's OAuth issuer
  resource = the Cloud App's host (e.g. billing.epicenter.so)
  scope = offline_access plus that Cloud App's own <app-id>:* scopes
  used only against the Cloud App at that host
```

Do not reuse a token across resource audiences.

### Extensions

```txt
Extension:
  browser.identity.launchWebAuthFlow
  PKCE transaction in extension session storage
  token exchange through oauth4webapi
  same OAuthTokenGrant as browser apps
  same GET /workspace-identity identity load
  same workspaces:open offline_access scopes
```

### Tauri Apps

```txt
Tauri:
  preferred: system browser + loopback callback or deep link
  same OAuth authorization-code with PKCE
  same OAuthTokenGrant
  same OAuthSession
```

Do not add Tauri-only token shapes. The launcher can differ. The persisted auth session cannot.

### CLI And Daemons

The final machine auth path must also produce OAuthTokenGrant.

Preferred first implementation:

```txt
CLI:
  open system browser
  listen on 127.0.0.1 callback port
  authorization-code with PKCE
  token exchange returns access_token, refresh_token, expires_in
  store OAuthSession in keychain
```

Deferred headless implementation:

```txt
OAuth device grant:
  accounts issues user_code and device_code
  user approves on accounts origin
  token endpoint returns OAuth access and refresh tokens
```

Do not use Better Auth `deviceAuthorization` as the final machine flow. Its current token is a Better Auth session token, which breaks the OAuth-everywhere invariant.

## Auth Client API

This is the local-first app auth client for Epicenter Server resources. It
loads `WorkspaceIdentity`, including encryption keys, from the configured resource's
`/workspace-identity` endpoint. Cloud-control surfaces that only need hosted
account and billing state should use a narrower Cloud OAuth client that stores
an OAuth grant and projects `AuthUser`, not workspace keys.

```ts
export type CreateOAuthAppAuthConfig = {
	issuer: string;
	resource: string;
	clientId: string;
	sessionStorage: OAuthSessionStorage;
	launcher: OAuthSignInLauncher;
	fetch?: typeof fetch;
	WebSocket?: typeof WebSocket;
	refreshOAuthToken?: OAuthTokenRefresher;
	revokeOAuthRefreshToken?: OAuthRefreshTokenRevoker;
	now?: () => number;
};
```

`baseURL` should split into `issuer` and `resource`.

```txt
issuer:
  OAuth authorization server
  accounts.epicenter.so

resource:
  OAuth audience and protected resource base URL
  sync.epicenter.so for workspace apps
```

One `OAuthSession` belongs to one resource audience. A client that needs both
sync and cloud APIs must request explicit grants for both resources. Do not
silently reuse a `sync.epicenter.so` token against `api.epicenter.so`, or an
`api.epicenter.so` token against `sync.epicenter.so`.

The public client stays capability-based:

```ts
type AuthClient = {
	readonly state: AuthState;
	onStateChange(fn: (state: AuthState) => void): () => void;
	startSignIn(input?: { returnTo?: string }): Promise<Result<undefined, AuthError>>;
	signOut(): Promise<Result<undefined, AuthError>>;
	fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
	openWebSocket(url: string | URL, protocols?: string[]): Promise<WebSocket>;
	[Symbol.dispose](): void;
};
```

No public fields:

```txt
bearerToken
accessToken
refreshToken
session
expiresAt
```

## Validation Boundaries

Use ArkType at durable and network boundaries:

```txt
Better Auth user row -> AuthUser.assert(row)
GET /workspace-identity response -> WorkspaceIdentity.assert(json)
token grant parser -> OAuthTokenGrant.assert(parsed)
storage load -> OAuthSession.assert(JSON.parse(raw))
storage save -> OAuthSession.assert(value)
```

Use `'+': 'delete'` on exported storage and API shapes. This keeps the contract honest even when Better Auth rows carry extra fields.

Avoid helper names that imply old ownership:

```txt
Delete:
  authUserFromBetterAuthUser
  AuthSessionResponse
  BetterAuthSessionResponse
  oauthSessionFromAuthSessionResponse
  workspaceIdentityFromAuthSessionResponse
  OAuthTokenResult            (dead alias of OAuthTokenGrant)
  identityFromSession         (three-line projection; inline at the one call site)

Keep or create:
  createWorkspaceIdentityResponse
  resolveOAuthPrincipal
  parseTokenGrant
```

`createWorkspaceIdentityResponse` belongs on the Epicenter Server side because it derives encryption keys. It should be used by `/workspace-identity`, not by Better Auth `customSession` in the final system.

## Asymmetric Refusals

### Refuse Cookie App Auth

Product sentence:

```txt
Apps authenticate with OAuth and call OAuth protected resources with OAuth access tokens.
```

Behavior refused:

```txt
Dashboard or same-site browser apps may use Better Auth cookies directly.
```

Code family deleted:

```txt
createCookieAuth
cookie platform auth modes
cookie app access token middleware branch
app credential forms
Better Auth getSession for app access token routes
```

User loss:

```txt
Browser apps store OAuth tokens in app storage. This is not as strong as HttpOnly cookie-only auth against XSS, but Epicenter apps already hold local workspace data and encryption keys in the same runtime. XSS is already a serious compromise.
```

Decision:

```txt
Refuse it. One app auth model is worth more than a cookie shortcut for first-party browser apps.
```

### Refuse Better Auth Session Tokens For Apps

Behavior refused:

```txt
Apps may exchange OAuth access tokens for Better Auth session tokens.
```

Code family deleted:

```txt
/auth/oauth-session
set-auth-token app handling
bearer plugin as app credential
Better Auth session-token storage
machine auth pretending Better Auth device tokens are OAuthSession
```

Decision:

```txt
Refuse it. Better Auth session tokens stay inside Epicenter Server. OAuth resource access tokens are the only app runtime credential.
```

### Refuse Account Profile In WorkspaceIdentity

Behavior refused:

```txt
WorkspaceIdentity includes account metadata because the user table has it.
```

Code family deleted:

```txt
date normalization
profile equality noise
storage churn on profile-only updates
confusion between account management and workspace boot
```

Decision:

```txt
Refuse it. WorkspaceIdentity is for local workspace ownership, not account profile UI.
```

### Refuse Client-Managed E2EE In The Default Path

Product sentence:

```txt
The user signs in once. Sync starts automatically on every device.
```

Behavior refused:

```txt
Default-path client-managed end-to-end encryption that requires recovery
codes, device-to-device approval, or any extra user action on multi-device
login.
```

Code family deleted by this refusal:

```txt
passphrase or recovery-code UI on first sign-up
device-pairing flows (QR scans, push approvals, code entry)
per-device key stores with cross-device sync plumbing
per-workspace wrapped-key tables in /workspaces routes
recovery-key escrow paths
"your data is locked, scan from your old device" failure modes
```

User loss:

```txt
Epicenter (when hosting) or the self-hosted operator can technically decrypt
workspace data. This is server-trusted encryption, not zero-knowledge. The
trust ceiling is named, not hidden.
```

Decision:

```txt
Refuse it in the default path. Plan an opt-in Advanced Data Protection mode
for users who accept the recovery cost. /workspace-identity is forward-
compatible with that mode (payload becomes wrapped keys instead of raw
keys; see "Forward Compatibility With Future E2EE").
```

## Clean-Break Implementation Plan

Order matters. The auth contract is the first cleanup. Better Auth ownership,
`/workspace-identity`, app access token route auth, and old bridge deletion
all happen before any move into the composable `apps/server` host with its
`cloud-apps/` subtree.

```txt
1. Collapse app code to AuthState and auth capabilities.
2. Keep OAuth protocol work in Better Auth.
3. Move Epicenter identity projection to /workspace-identity.
4. Delete old credential bridges inside current apps/api.
5. Move server core and Cloud Apps into apps/server.
   Remove apps/cloud as a separate platform.
   Physical deployable splitting stays optional after composition lands.
```

Build new surfaces directly, move callers, verify, then delete old surfaces. No
compatibility aliases in the target design.

### Wave 1: Collapse App Code To AuthState And Capabilities

- [ ] **1.1** Treat `OAuthSession`, `OAuthTokenGrant`, `OAuthTransaction`, access tokens, refresh tokens, and token expiry as private auth internals.
- [ ] **1.2** Ensure app code only uses `auth.state`, `auth.startSignIn`, `auth.signOut`, `auth.fetch`, and `auth.openWebSocket`.
- [ ] **1.3** Ensure workspace construction receives `WorkspaceIdentity`, not tokens or session response objects.
- [ ] **1.4** Ensure sync receives `auth.openWebSocket`, not a bearer-token getter.
- [ ] **1.5** Ensure HTTP consumers use `auth.fetch`, not app-written `Authorization` headers.
- [ ] **1.6** Ensure `reauth-required` means failed refresh or rejected network auth, not merely an expired access-token timestamp.

Verification:

```txt
# Apps must not reference private auth internals.
rg -n "bearerToken|accessToken|refreshToken|OAuthSession|OAuthTokenGrant|OAuthTransaction|Authorization:\s*Bearer" apps \
  --glob '!apps/**/*.test.ts' \
  --glob '!apps/**/auth/**'

# Apps must not call the old identity bridge directly.
rg -n "/auth/oauth-session|set-auth-token" apps packages \
  --glob '!**/*.test.ts' \
  --glob '!specs/**' \
  --glob '!docs/**'
```

Hits inside `packages/auth/**`, `packages/oauth-client/**`, tests, and specs are
expected. Hits in app code are not.

### Wave 2: Keep OAuth Protocol Work In Better Auth

- [ ] **2.1** Keep `oauthProvider` responsible for authorize, token, revoke, metadata, JWKS, PKCE, consent, trusted clients, and token issuing.
- [ ] **2.2** Do not add Epicenter-owned OAuth endpoint wrappers beyond route mounting and resource metadata.
- [ ] **2.3** Keep `OAuthTokenGrant` as an internal token parser result and remove persisted `scope` and `tokenType` from auth core.
- [ ] **2.4** Ensure token parsing validates `token_type`, `access_token`, `refresh_token`, and `expires_in` before discarding fields auth does not use.
- [ ] **2.5** Split client config from `baseURL` into `issuer` and `resource`.
- [ ] **2.6** Change refresh requests to call `${issuer}/oauth2/token` with `resource`.
- [ ] **2.7** Change revoke requests to call `${issuer}/oauth2/revoke`.
- [ ] **2.8** Keep one `OAuthSession` per resource audience.

Verification:

```txt
bun test packages/auth/src
bun run typecheck in packages/auth
```

### Wave 3: Move Identity Projection To /workspace-identity

- [ ] **3.1** Narrow `AuthUser` to `{ id, email }` with `'+': 'delete'`. Drop `name` from the projection. The Better Auth user row still stores `name`; `AuthUser` simply stops surfacing it.
- [ ] **3.1a** Update every UI consumer of `user.name`:
  - `packages/svelte-utils/src/account-popover/account-popover.svelte`: render `user.email` (or a derived display name).
  - `apps/dashboard/src/lib/components/UserMenu.svelte`: delete the `{#if user.name}` block; pass `user.email` to `getInitials` (drop the first arg).
  - `apps/zhongwen/src/routes/(signed-in)/+page.svelte`: render `user.email` or `user.email.split('@')[0]`.
- [ ] **3.1b** Update every server consumer:
  - `packages/cli/src/commands/auth.ts`: replace `session.user.name ?? session.user.email` with `session.user.email`.
  - `apps/api/src/app.ts:213`: same.
  - `apps/api/src/app.ts:375`, `asset-routes.ts:119`, `billing-routes.ts:48`: delete the `name: c.var.user.name ?? undefined` field passed to autumn.
  - `apps/api/src/auth/create-auth.ts:112`: drop `name` from the `customSession` projection.
  - `packages/auth/src/node/machine-auth.ts:91`: drop `name` from the machine-auth user projection.
- [ ] **3.1c** Update test fixtures: every `AuthUser.assert({ id, email, name })` becomes `AuthUser.assert({ id, email })`. Fixtures that still pass `name` are not test failures (`'+': 'delete'` strips it silently), but they are misleading. The test would suggest `name` is part of the shape when the runtime drops it. Update them for clarity.
- [ ] **3.2** Keep `WorkspaceIdentity` as `{ user, encryptionKeys }` with `'+': 'delete'`.
- [ ] **3.3** Keep `OAuthSession` as private auth storage: `WorkspaceIdentity + accessToken + refreshToken + accessTokenExpiresAt`.
- [ ] **3.4** Ensure storage load and save assert `OAuthSession`.
- [ ] **3.5** Add the `workspaces:open` resource scope to Epicenter Server's OAuth provider configuration and to the trusted-client scope lists.
- [ ] **3.6** Change identity loading to call `${resource}/workspace-identity` with the `workspaces:open` scope on the access token.
- [ ] **3.7** Update OAuth launchers to discover from `issuer`, request `resource`, and ask for `workspaces:open offline_access` for sync clients.
- [ ] **3.8** Delete `createBrowserOAuthLauncherFromApi`.
- [ ] **3.9** Keep `/workspace-identity` calls inside auth. App code should not call `/workspace-identity` directly.
- [x] **3.10** Keep `/workspace-identity` as the only workspace identity route. The current resolver lives in `apps/api/src/auth/app-access-token-auth.ts` as `resolveRequestWorkspaceIdentity`; do not add `/me`, `/auth/me`, or `/auth/workspace-identity` aliases.
- [ ] **3.11** Have `/workspace-identity` reject access tokens missing the `workspaces:open` scope with a 403 that names the missing scope.
- [ ] **3.12** Document that `/workspace-identity` replaces only Epicenter identity bridges, not Better Auth or `oauthProvider` machinery (authorize, token, revoke, metadata, JWKS, PKCE, consent, trusted clients, access-token issuing, refresh-token issuing).
- [ ] **3.13** Document that no per-workspace key-release endpoint exists; `/workspace-identity` returns all keying material the client needs to open any workspace it owns.
- [ ] **3.14** Rename the type `AuthIdentity` to `WorkspaceIdentity` in `packages/auth/src/auth-types.ts`, and update every callsite, test fixture, and assert. Field name on `AuthState` stays `identity`.
- [ ] **3.15** Delete the dead alias `export type OAuthTokenResult = OAuthTokenGrant` in `packages/auth/src/create-oauth-app-auth.ts`. Inline any imports of `OAuthTokenResult` to `OAuthTokenGrant`.
- [ ] **3.16** Inline the three-line `identityFromSession` helper at its single call site in `create-oauth-app-auth.ts`. The projection is `{ user, encryptionKeys } = session`; the helper added a name without adding meaning.

Verification:

```txt
bun test packages/oauth-client/src
bun test packages/auth/src
```

### Wave 4: Delete Old Credential Bridges In Current apps/api

Do this before any file moves into the composable `apps/server` host or its
`cloud-apps/` subtree. While `apps/api` still owns every route, the bridge
code is in one place and easy to excise. Renaming directories first only
hides the smell.

Scope reminder: this wave deletes Epicenter-side bridges only. Better Auth
plugins that still own real OAuth protocol work stay configured (`oauthProvider`,
`jwt`, email/password, social providers).

- [ ] **4.1** Replace `/auth/oauth-session` callers with OAuth token exchange plus auth-owned `/workspace-identity` identity loading.
- [ ] **4.2** Remove `AuthSessionResponse`, `BetterAuthSessionResponse`, and conversion helpers from live app paths.
- [ ] **4.3** Remove app runtime dependence on `set-auth-token`. Drop it from CORS `exposeHeaders` in `apps/api/src/app.ts`.
- [ ] **4.4** Remove `customSession` identity enrichment from `apps/api/src/auth/create-auth.ts`. `/workspace-identity` becomes the only identity projection.
- [ ] **4.5** Remove the Better Auth `bearer()` plugin from `apps/api/src/auth/create-auth.ts`. Protected resources verify oauthProvider access tokens through a principal resolver that returns `AuthUser`, not `WorkspaceIdentity`.
- [ ] **4.6** Keep WebSocket bearer subprotocol parsing as transport input normalization until `auth.openWebSocket` owns all app sync usage.
- [ ] **4.7** Remove Better Auth `deviceAuthorization` from the live plugin list. Its `access_token` is a Better Auth session token, not an OAuth resource token. Machine auth moves to loopback PKCE first.

Verification:

```txt
# Live app code must not reference removed bridges.
rg -n "AuthSessionResponse|BetterAuthSessionResponse|/auth/oauth-session|customSession|bearer\(\)|deviceAuthorization|createCookieAuth|createBearerAuth" \
  apps packages \
  --glob '!**/*.test.ts' \
  --glob '!specs/**' \
  --glob '!docs/**' \
  --glob '!**/README.md' \
  --glob '!**/SYNC_ARCHITECTURE.md'

# CORS must not expose set-auth-token.
rg -n "set-auth-token" apps/api

# auth.bearerToken must not be public.
rg -n "auth\.bearerToken|\.bearerToken\b" apps packages --glob '!**/*.test.ts'
```

Expected hits: tests, specs, historical docs. Live code should be clean.

### Wave 3 And Wave 4 Commit Plan

Wave 3 (rename, scope) and Wave 4 (bridge deletion) compose into five
reviewable commits in dependency order. Each commit verifies on its own.
Each pair of consecutive commits leaves the system in a running state, so
the chain can stop at any commit boundary and ship.

```txt
Commit 1: Keep /workspace-identity as the identity route    (landed)
Commit 2: Add the workspaces:open scope and enforce it      (load-bearing)
Commit 3: Delete customSession and set-auth-token           (small bridges)
Commit 4: Delete auth.bearerToken from the AuthClient       (cascade win)
Commit 5: Delete deviceAuthorization; add CLI loopback PKCE (substantive)
```

The order is dependency-driven, not size-driven. Each later commit assumes
the earlier ones already landed.

#### Commit 1: Keep /workspace-identity as the identity route

```txt
Route mount:
  apps/api/src/app.ts        /workspace-identity

Resolver:
  apps/api/src/auth/app-access-token-auth.ts
    resolveRequestWorkspaceIdentity()

Identifier check:
  AuthIdentity                 ->  WorkspaceIdentity
    packages/auth/src/auth-types.ts
  resolveRequestWorkspaceIdentity
    apps/api/src/auth/app-access-token-auth.ts

Implements wave items: 3.10, 3.14

Why first:
  No behavior change. Pure cohesion lock-in. Reviewable in isolation.
  Locks the names down before scope semantics arrive in the next commit.

Verification:
  rg -n "AuthIdentity|/auth/me" apps packages --glob '!specs/**'
    -> only specs and historical docs should match.
  bun test apps/api/src/auth/app-access-token-auth.test.ts
```

#### Commit 2: Add workspaces:open scope

```txt
Server side:
  apps/api/src/auth/trusted-oauth-clients.ts:5
    trustedOAuthScopes:
      ['openid', 'profile', 'email', 'offline_access']
        ->
      ['openid', 'profile', 'email', 'offline_access', 'workspaces:open']
  apps/api/src/auth/trusted-oauth-clients.ts:28
    per-client scope grants: include workspaces:open on every first-party
    client that needs sync (CLI, dashboard, fuji, honeycrisp, opensidian,
    zhongwen, tab-manager).
  apps/api/src/auth/workspace-identity.ts
    middleware adds: assert workspaces:open in token claims; 403 if missing,
    with a body that names the missing scope.

Client side:
  packages/auth/src/create-oauth-app-auth.ts
    OAuth launcher requests scope = "workspaces:open offline_access".
  packages/oauth-client/src/* (browser, extension, loopback launchers)
    pass the scope through unchanged.

Tests:
  apps/api/src/auth/app-access-token-auth.test.ts
    add cases: missing scope -> 403; present scope -> 200.

Implements wave items: 3.5, 3.6, 3.7, 3.11

Why second:
  Load-bearing behavior change. Roughly 30 lines on the server plus the
  launcher updates. Visible in the issuer metadata's scopes_supported list.
  Reviewable on its own because no callers behave differently yet:
  customSession still enriches /auth/get-session as a parallel identity
  path that Commit 3 will remove.

Verification:
  curl /.well-known/oauth-authorization-server | jq .scopes_supported
    -> includes "workspaces:open".
  curl /workspace-identity (token without scope)  -> 403.
  curl /workspace-identity (token with scope)     -> WorkspaceIdentity.
```

#### Commit 3: Delete customSession and set-auth-token

```txt
customSession:
  apps/api/src/auth/create-auth.ts:5
    remove `import { customSession } from 'better-auth/plugins'`
  apps/api/src/auth/create-auth.ts:208-214
    remove the customSessionPlugin block
  apps/api/src/auth/create-auth.ts:218
    remove customSessionPlugin from the plugins array
  packages/auth/src/node/machine-auth.ts:6
    remove customSession type import
  packages/auth/src/node/machine-auth.ts:31-32
    remove customSession typing on the machine-auth client

set-auth-token:
  apps/api/src/app.ts:129
    remove "set-auth-token" from CORS exposeHeaders
  packages/auth/src/node/machine-auth.ts:181
    remove the set-auth-token reader
  packages/auth/src/node/machine-auth.test.ts:87, 104
    remove the rotation-header tests

Implements wave items: 4.3, 4.4

Why third:
  Surgical deletes. customSession only enriches /auth/get-session; removing
  it leaves that endpoint returning the bare Better Auth session shape, and
  /workspace-identity is the only identity surface. set-auth-token removal
  forces machine-auth to load identity through /workspace-identity like
  every other client.

Verification:
  rg -n "customSession" apps/api packages/auth --glob '!**/*.test.ts'
  rg -n "set-auth-token" apps packages
    -> no live-code hits.
  bun test apps/api/src
```

#### Commit 4: Delete auth.bearerToken from the AuthClient surface

```txt
Surface delete:
  packages/auth/src/create-oauth-app-auth.ts
    remove the bearerToken getter from the AuthClient return shape
  packages/auth/src/auth-contract.ts
    remove bearerToken from the AuthClient type

Cascade (13 closure call sites; mechanical):
  apps/fuji/src/lib/session.svelte.ts:23
  apps/honeycrisp/src/lib/session.svelte.ts:23
  apps/opensidian/src/lib/session.svelte.ts:24
  apps/zhongwen/src/lib/session.svelte.ts:23
  apps/tab-manager/src/lib/session.svelte.ts:22
  apps/fuji/src/routes/(signed-in)/fuji/daemon.ts
  apps/honeycrisp/src/routes/(signed-in)/honeycrisp/daemon.ts (and script.ts)
  apps/opensidian/src/lib/opensidian/daemon.ts (and script.ts)
  apps/zhongwen/src/routes/(signed-in)/zhongwen/daemon.ts (and script.ts)
  examples/notes-cross-peer/notes.ts

Each call site change:
  before:
    workspaceConfig({ bearerToken: () => auth.bearerToken, ... })
  after:
    workspaceConfig({ fetch: auth.fetch, openWebSocket: auth.openWebSocket, ... })
  or simply drop the closure if the workspace adapter already reads
  transport from the auth client.

Test:
  packages/auth/src/contract.test.ts:57 already asserts absence; the
  assertion stops being aspirational.

Implements wave items: closes out Wave 1 collapse.

Why fourth:
  Asymmetric win. One surface delete cascades 13 mechanical call-site
  edits. After this commit, apps never materialize tokens. auth.fetch and
  auth.openWebSocket are the only credential paths.

Verification:
  rg -n "auth\.bearerToken|\.bearerToken\b" apps packages --glob '!**/*.test.ts'
    -> no hits.
  bun run typecheck across every touched app.
```

#### Commit 5: Delete deviceAuthorization, add CLI loopback PKCE

```txt
Server delete:
  apps/api/src/auth/create-auth.ts:7
    remove `import { deviceAuthorization } from 'better-auth/plugins/device-authorization'`
  apps/api/src/auth/create-auth.ts:182-187
    remove the deviceAuthorization() plugin block
  apps/api/src/app.ts (the /device page handler)
    remove or replace with a placeholder for a future real OAuth device grant

CLI side:
  packages/auth/src/node/machine-auth.ts
    replace device-flow client with loopback PKCE:
      - listen on 127.0.0.1:<random port>
      - open system browser to issuer /oauth2/authorize
      - capture authorization code on the loopback callback
      - exchange for OAuth access and refresh tokens at /oauth2/token
      - store as OAuthSession in the keychain
  packages/cli/src/commands/auth.ts
    update login UX:
      "Open this URL in your browser. The CLI will receive the code
       automatically when you finish signing in."

Implements wave items: 4.7

Why last:
  Substantive code change with user-visible CLI behavior. The
  deviceAuthorization plugin issues Better Auth session tokens, not OAuth
  resource tokens, and cannot satisfy the workspaces:open scope check
  added in Commit 2.

Grounded against Better Auth source:
  node_modules/better-auth/dist/plugins/device-authorization/routes.mjs:272-276
    -> access_token: session.token   (a Better Auth session, not an OAuth token)
    -> no refresh_token field at all
  node_modules/@better-auth/oauth-provider/dist (grep "device")
    -> zero hits. No RFC 8628 support upstream yet.

Verification:
  manual CLI smoke:
    epicenter auth login
      -> opens system browser
      -> captures code on loopback callback
      -> stores OAuthSession in keychain
    epicenter <any authenticated command>
      -> works against /workspace-identity with workspaces:open scope.
  bun test packages/auth/src/node/machine-auth.test.ts
```

#### What ships independently

```txt
Commit 1 alone:           Safe. Cosmetic rename. All callers still work.
Commits 1+2:              Safe. Scope check active on /workspace-identity;
                          first-party launchers request the scope.
Commits 1+2+3:            Safe. customSession gone; /auth/get-session
                          returns the bare Better Auth shape;
                          /workspace-identity is the sole identity surface.
Commits 1+2+3+4:          Safe. Apps stop reading bearerToken; auth.fetch
                          and auth.openWebSocket handle credentials.
Commits 1+2+3+4+5:        OAuth-everywhere is true across browser,
                          extension, Tauri, CLI. One credential family.
```

Each commit body should reference the wave items it implements (3.5, 3.6,
3.10, 3.11, 3.14, 4.3, 4.4, 4.7) so reviewers can cross-check the spec.

### Wave 5: Create The Composable Server Host

- [ ] **5.1** Create the target server host, likely `apps/server`, as a Hono app.
- [ ] **5.2** Move Better Auth construction, sign-in pages, consent pages, OAuth metadata, JWKS, `/workspace-identity`, workspace sync, and document sync into base server modules.
- [ ] **5.3** Configure Better Auth with root OAuth paths.
- [ ] **5.4** Keep `oauthProvider`, `jwt`, and configured login providers.
- [ ] **5.5** Do not include `customSession`, `bearer`, or Better Auth `deviceAuthorization` in the final server path.
- [ ] **5.6** Enforce the no-Postgres boundary for server core with package dependencies and tests.
- [ ] **5.7** Serve `accounts.epicenter.so` and `sync.epicenter.so` from these modules in hosted production.
- [ ] **5.8** Keep accounts and sync as mountable Hono route modules inside the server host.
- [ ] **5.9** Configure sync resource CORS for first-party apps and registered OAuth browser clients without adding a static WebSocket `Origin` allowlist for bearer sync.

Verification:

```txt
bun test apps/server/src
bun run typecheck in apps/server
manual smoke: accounts sign-in page renders
manual smoke: accounts OAuth discovery returns issuer accounts.epicenter.so
manual smoke: sync protected-resource discovery returns resource sync.epicenter.so
```

Cloud App composition:

- [ ] **5.10** Add a `CloudApp` registration shape to the server host, or defer to `specs/20260512T150000-cloud-modules-and-networks.md` if this wave stays auth-only.
- [ ] **5.11** Move Drizzle, Postgres schema, billing, assets, hosted storage registry, dashboard, and cloud control APIs into optional Cloud Apps.
- [ ] **5.12** Verify access tokens with issuer `accounts.epicenter.so` and audience `api.epicenter.so` for hosted Cloud Apps.
- [ ] **5.13** Add `resolveOAuthPrincipal` for Cloud App protected routes.
- [ ] **5.14** Make Cloud App middleware return `AuthUser`, not `WorkspaceIdentity`.
- [ ] **5.15** Do not derive encryption keys in Cloud Apps.
- [ ] **5.16** Do not call Better Auth `getSession()` in Cloud Apps.
- [ ] **5.17** Build the dashboard as a SvelteKit SPA owned by the dashboard Cloud App.
- [ ] **5.18** Serve the dashboard SPA from `api.epicenter.so/dashboard/*` through the dashboard Cloud App.
- [ ] **5.19** Keep Cloud App browser CORS scoped to the dashboard and explicitly productized cloud clients, not all registered sync clients.
- [ ] **5.19a** Stop at server composition. The internal shape of Cloud Apps, Cloud App registry, and per-instance OAuth resource wiring is owned by `specs/20260512T150000-cloud-modules-and-networks.md`. Do not freeze billing, assets, and dashboard as permanent fields of a global cloud env. Treat them as Cloud Apps that operators register, alongside Cloud Apps that operators also register and configure with Cloud Apps.

Verification:

```txt
bun test apps/server/src/cloud-apps
bun run typecheck in apps/server
bun run typecheck in dashboard app package if split from the host
```

First-party app move:

- [ ] **5.20** Configure dashboard with a Cloud OAuth client using `issuer = accounts.epicenter.so` and `resource = api.epicenter.so`.
- [ ] **5.21** Configure workspace SvelteKit apps with `issuer = accounts.epicenter.so` and `resource = sync.epicenter.so`.
- [ ] **5.22** Configure WXT extension launchers with `issuer = accounts.epicenter.so` and `resource = sync.epicenter.so`.
- [ ] **5.23** Remove app credential forms that duplicate hosted sign-in.
- [ ] **5.24** Replace sync bearer-token getters with `auth.openWebSocket`.
- [ ] **5.25** Replace direct fetch with `auth.fetch` for app access token routes.
- [ ] **5.26** Use `sync.epicenter.so` as the hosted sync resource for workspace and document sync.
- [ ] **5.27** Add explicit separate grants when one app needs both sync and Cloud resources.

Verification:

```txt
bun run typecheck in each touched app
app smoke: sign in, refresh page, load workspace, sync
extension smoke: sign in, refresh side panel, sync
```

Final verification after Wave 5:

```txt
# Bridges and old credential names must be gone from live code.
rg -n "@epicenter/auth/contracts|/auth/oauth-session|set-auth-token|auth\.bearerToken|createCookieAuth|createBearerAuth|AuthSessionResponse|BetterAuthSessionResponse|customSession|bearer\(\)|deviceAuthorization" \
  apps packages \
  --glob '!**/*.test.ts' \
  --glob '!specs/**' \
  --glob '!docs/**' \
  --glob '!**/README.md' \
  --glob '!**/SYNC_ARCHITECTURE.md'

# Protected resources must not call Better Auth getSession.
# (Better Auth still uses getSession internally for sign-in pages and OAuth
#  consent. Only protected resource handlers must be clean.)
rg -n "getSession" apps/server/src \
  --glob '!apps/server/src/auth/**' \
  --glob '!**/*.test.ts'

# Machine auth must not treat Better Auth device tokens as OAuthSession.
rg -n "deviceCode|deviceToken|set-auth-token|getSession" packages/auth/src/node \
  --glob '!**/*.test.ts'
```

Hits inside Better Auth pages, OAuth consent flows, tests, or specs are fine.
Protected resource handlers and app runtime code must be clean.

Verification:

```txt
bun test packages/auth/src
bun test packages/oauth-client/src
bun test apps/server/src
bun test apps/server/src/cloud-apps
bun run typecheck in packages/auth
bun run typecheck in apps/server
targeted app typechecks
```

## Current Tree Versus Target Tree

Current auth-heavy tree:

```txt
apps/api/src/
|-- app.ts
|-- auth/
|   |-- app-access-token.ts
|   |-- app-access-token-auth.ts
|   |-- create-auth.ts
|   |-- identity-response.ts
|   |-- oauth-metadata.ts
|   |-- oauth-resource.ts
|   `-- trusted-oauth-clients.ts
packages/auth/src/
|-- auth-types.ts
|-- create-oauth-app-auth.ts
|-- node/
|   `-- machine-auth.ts
packages/oauth-client/src/
`-- index.ts
```

Target composition shape:

```txt
apps/server/src/
|-- app.ts
|-- host-dispatch.ts
|-- define-server.ts
|-- base-modules/
|   |-- accounts.ts
|   |-- workspace-identity.ts
|   |-- workspace-sync.ts
|   `-- document-sync.ts
|-- auth/
|   |-- create-auth.ts
|   |-- oauth-metadata.ts
|   |-- pages.tsx
|   `-- trusted-oauth-clients.ts
|-- identity/
|   |-- workspace-identity.ts
|   `-- auth-identity.ts
|-- sync/
|   |-- workspace-routes.ts
|   |-- document-routes.ts
|   `-- rooms.ts
|-- oauth-resource.ts
|-- cloud-apps/                    (see cloud-modules-and-networks.md)
|   |-- ark/                       (Cloud App)
|   |-- betcha/                    (Cloud App)
|   |-- billing/                   (Cloud App)
|   |-- assets/                    (Cloud App)
|   `-- dashboard/                 (Cloud App)
|-- instances/
|   |-- app-instance.ts
|   |-- instance-registry.ts
|   `-- host-dispatch.ts
|-- storage/
|   `-- local-store.ts
`-- db/
    `-- schema.ts                  (re-exports enabled Cloud App schemas)

apps/dashboard/ or apps/server/src/cloud-apps/dashboard/
|-- src/
|   |-- routes/
|   |-- lib/
|   `-- app.html
|-- svelte.config.js
`-- package.json

packages/auth/src/
|-- auth-contract.ts
|-- auth-errors.ts
|-- auth-state-store.ts
|-- auth-types.ts
|-- create-oauth-app-auth.ts
|-- node/
|   |-- machine-auth.ts
|   `-- machine-session-store.ts

packages/oauth-client/src/
|-- browser.ts
|-- extension.ts
|-- loopback.ts
|-- oauth-client.ts
|-- token-grant.ts
`-- transaction.ts
```

This tree records the product boundary:

```txt
server core
  useful without Postgres

Cloud Apps
  allowed to require Postgres
  own billing, assets, and dashboard
  serves the built SPA at /dashboard/*

Cloud Apps
  own public records and Cloud App routes
```

Dependency direction:

```txt
packages/auth shared types
  ^
  |
apps/server composition root
  |-- base account and sync modules
  |-- Cloud Apps
  |   `-- dashboard SPA
  `-- Cloud Apps and Cloud Apps

Cloud Apps verify tokens through the server resource contract.
Base modules do not import Cloud Apps.
```

Path to domain ownership:

```txt
apps/server/src/modules/accounts.ts
  -> accounts.epicenter.so/*

apps/server/src/modules/sync.ts
  -> sync.epicenter.so/*

apps/server/src/cloud-apps/{billing,assets}/routes.ts
  -> api.epicenter.so/api/*
  -> api.epicenter.so/.well-known/oauth-protected-resource

apps/server/src/cloud-apps/dashboard/routes.ts
  -> api.epicenter.so/dashboard/*
  -> serves the dashboard SPA build output

apps/server/src/cloud-apps/{ark,betcha}/routes.ts
  -> {instance-host}/api/{ark,betcha}/*
  -> {instance-host}/.well-known/oauth-protected-resource
```

## Resolved Questions

1. Rename toward a composable `apps/server` host in the clean-break wave.
2. Hosted sync uses `sync.epicenter.so`, served by the sync base module.
3. Hosted account pages use `accounts.epicenter.so`, served by the accounts base module.
4. Hosted cloud control APIs use `api.epicenter.so`, served by Cloud Apps.
5. Account profile metadata that belongs to sign-in, recovery, MFA, passkeys, or self-hosted account settings lives in base account modules.
6. Hosted subscription, billing, and managed storage account metadata lives in Cloud Apps.
7. Dashboard remains under `api.epicenter.so/dashboard` because it is a cloud-control UI.
8. CLI uses loopback PKCE at launch. Headless device flow waits until it can issue real OAuth access and refresh tokens.
9. The clean-break target exposes `/workspace-identity` only. Neither `/me`, `/auth/me`, nor `/auth/workspace-identity` is kept.
10. Encryption key delivery uses a single workspace identity endpoint, not `/me` and not a per-workspace key-release endpoint. The endpoint returns `WorkspaceIdentity { user, encryptionKeys }` and requires an OAuth access token with the `workspaces:open` scope.
11. Custom OAuth resource scope is `workspaces:open`. `offline_access` is requested when refresh tokens are needed. `openid`, `profile`, and `email` are not requested; Epicenter does not use OIDC ID tokens or UserInfo.
12. Hosted and self-hosted deployments share the same client contract. Only `issuer` and `resource` URLs change.
13. The current trust model is server-trusted encryption, not zero-knowledge end-to-end encryption. Self-hosted shifts the trusted party from Epicenter-the-company to the operator, but it does not remove the trusted party.
14. Accounts, sync, cloud resources, and dashboard surfaces are Hono route modules before they are deployables.
15. The dashboard is a SvelteKit SPA owned by the dashboard Cloud App and served at `api.epicenter.so/dashboard/*`.

## Decisions Log

- Keep `WorkspaceIdentity` as a distinct type from `OAuthSession`: the distinction names the credential boundary. Revisit only if no code ever needs identity without tokens.
- Rename the type `AuthIdentity` to `WorkspaceIdentity`. The payload is workspace boot material (`user` + `encryptionKeys`), not session or profile identity. The `AuthIdentity` name kept inviting profile metadata (`image`, `emailVerified`, `createdAt`) to creep in. The new name makes any such addition look wrong on sight.
- Drop `name` from `AuthUser`. Final shape is `{ id, email }`. Every existing caller already had an email fallback or an absent-case guard, so `name` was never load-bearing; it was a display nicety. Keeping it set the precedent that would have let `image` and `emailVerified` creep in next. UI surfaces that want a friendlier label derive one from `email`. Richer profile data goes behind a separate `/account-profile` endpoint if and when a profile UI needs it.
- Name the workspace identity endpoint `/workspace-identity`, not `/me`. The endpoint is not a profile endpoint; the name should match its job. Account profile metadata, if ever exposed, lives behind a separate `/account-profile` endpoint.
- Ship Wave 3 and Wave 4 as five reviewable commits in dependency order: (1) rename `/auth/me` to `/workspace-identity`, (2) add and enforce `workspaces:open`, (3) delete `customSession` and `set-auth-token`, (4) delete `auth.bearerToken` from the `AuthClient` surface, (5) delete `deviceAuthorization` and replace CLI machine-auth with loopback PKCE. The full commit-by-commit plan with file references lives under "Wave 3 And Wave 4 Commit Plan." Reviewable in isolation; every intermediate state runs.
- Refuse a per-workspace key-release endpoint. Current keys derive from `user.id` alone, so per-workspace lookup releases the same material the user already has rights to and uses the same bearer token. It is inert ceremony until per-workspace wrapping, device-bound release, or client-managed E2EE are in scope.
- Keep `/workspace-identity` on Epicenter Server: encryption keys belong to the base sync modules of the composable host, not token claims and not Cloud Apps.
- Use `workspaces:open` as the custom OAuth resource scope for sync. It is an Epicenter protected-resource scope, not an OIDC standard scope and not Better Auth magic. `offline_access` is requested when refresh tokens are needed.
- Do not request `openid`, `profile`, or `email`. Epicenter does not use OIDC ID tokens or UserInfo. Encryption keys never travel through token claims, ID tokens, or UserInfo.
- State the trust model in the spec: this is server-trusted encryption. Self-hosted shifts the trusted party to the operator; it does not remove it. Client-managed E2EE is a future mode, not a guarantee this spec delivers.
- Keep one client contract across hosted and self-hosted. Hosted splits issuer (`accounts.epicenter.so`) from resource (`sync.epicenter.so`, `api.epicenter.so`). Self-hosted collapses them onto a single origin. The `AuthClient` does not branch.
- Use one composable server host as the architecture default. Hosted production may still split physical deployables by domain after the composition contract is stable.
- Treat host dispatch inside `apps/server` as public-role dispatch, not a package boundary.
- Use mountable Hono route modules inside the server host. Revisit physical process splits only when accounts, sync, Cloud Apps, or Cloud Apps have independent scaling, storage, ownership, or release cadence. Physical deployable splitting is operational topology, not a second product platform.
- Prefer server core inside `apps/server` for the self-hostable no-Postgres auth and sync runtime.
- Prefer Cloud Apps inside the same `apps/server` host for Drizzle and Postgres control-plane work.
- Keep hosted pricing, subscription, invoices, usage, and managed storage controls in Cloud Apps, not base sync modules.
- Serve the dashboard as a reactive SvelteKit SPA from an Cloud App so it can use the existing Svelte UI stack without making account auth depend on hosted billing or storage.
- Do not add `/.auth` as a public namespace. Use standard `/.well-known/*` discovery and root OAuth endpoints in the target shape.
- Delete `/auth/*` target paths instead of carrying aliases.
- Defer headless OAuth device flow: Better Auth's device plugin currently issues Better Auth session tokens, not OAuth refreshable resource tokens. Revisit only when CLI usage proves loopback browser login is not enough.
