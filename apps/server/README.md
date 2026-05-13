# Epicenter Server

Epicenter Server is the composable host for auth, sync, and Cloud Apps.

It owns the built-in private workspace core:

```txt
accounts
  Better Auth cookies
  hosted sign-in and consent
  OAuth issuer metadata
  authorize, token, revoke, JWKS

app access token routes
  protected resource metadata
  /workspace-identity
  workspace sync
  document sync

public
  landing and health routes
  public Cloud App reads when an app exposes them
```

Cloud Apps are mounted into the same host. Billing, assets, dashboard, Ark,
Betcha, and future hosted modules should live under the server composition, not
in a separate `apps/cloud` platform.

```txt
apps/server/src/
|-- app.ts
|-- auth/
|-- modules/
|   |-- accounts/
|   |-- app-access-token/
|   `-- sync/
`-- cloud-apps/
    |-- billing/
    |-- assets/
    |-- dashboard/
    |-- ark/
    `-- betcha/
```

The same code can run on one origin or several public hosts. Host dispatch is a
routing choice, not a package boundary.

```txt
hosted production:
  accounts.epicenter.so -> accounts routes
  sync.epicenter.so     -> app access token routes
  api.epicenter.so      -> hosted Cloud Apps
  ark.epicenter.so      -> Ark Cloud App

self-hosted:
  server.example.com    -> accounts + app access token routes + enabled Cloud Apps
```

Route groups choose their credential model at the mount point:

```txt
hosted auth routes
  /sign-in
  /consent
  /auth/*
  discovery
  -> Better Auth cookie session

app access token routes
  /workspace-identity
  /ai/*
  /workspaces/*
  /documents/*
  /api/billing/*
  /api/assets/* writes
  -> normalizeAppAccessToken
  -> requireAppAccessToken

public routes
  /
  /api/assets/* reads
  /dashboard SPA
  redirects
  -> no auth middleware
```

Allowed dependencies:

```txt
server core
|-- Better Auth
|-- OAuth token issuing and JWKS
|-- OAuth access-token verification
|-- workspace identity and key derivation
|-- self-hostable storage
`-- workspace and document sync

cloud-apps
|-- packages/ui
|-- packages/auth shared types
|-- OAuth access-token verification
|-- Drizzle and Postgres when the app needs hosted state
|-- billing provider SDKs
|-- hosted storage registry
`-- asset management
```

Forbidden dependencies:

```txt
server core
|-- Cloud App schemas
|-- billing provider SDKs
|-- hosted storage registry
`-- dashboard implementation details

cloud-apps
|-- Better Auth raw Session as app auth
|-- Better Auth getSession() for app access token routes
|-- encryption key derivation
`-- sync room internals
```

Move code here by module. Build the new mount, move callers, prove it with
tests, then remove the old path. Do not keep parallel `apps/server` and
`apps/cloud` stories alive as a long-term compatibility layer.
