# Auth Spec Stack Clean-Break Map

**Date**: 2026-05-12
**Status**: Draft
**Author**: AI assisted
**Branch**: `codex/auth-bearer-omit-cookies`

## One Sentence

Epicenter clients use one OAuth `AuthClient` for identity, HTTP, and sync; app session state owns local workspace lifetime, and Cloud Apps compose into the server host behind resource-scoped OAuth boundaries.

## Verdict

The current specs are cohesive if they are read as a stack, not as peers.

The clean break is not to merge them into one giant plan. The clean break is to make one architecture sentence true, then assign each spec one job.

```txt
North star:
  OAuth AuthClient everywhere

Runtime correctness:
  scoped resources
  same-user reauth keeps local workspace mounted
  dead routes and dead auth endpoints are removed

Long-term cleanup:
  tokens stay private to auth
  persisted session names match the identity/network split

Server composition:
  one composable server host first
  physical splitting only after the contract is stable
```

## Current Stack

| Order | Spec | Job | Status in stack |
| --- | --- | --- | --- |
| 0 | `specs/20260504T233223-sign-out-preserves-local-data.md` | Defines account exit: sign-out destroys live workspace memory while owner-scoped local data survives. | Runtime policy |
| 1 | `specs/20260511T150000-final-oauth-auth-architecture.md` | Defines the architecture: `AuthClient`, Better Auth server machinery, `/workspace-identity`, OAuth resource scopes, and server composition boundaries. | North star |
| 2 | `specs/20260512T100428-app-side-oauth-migration.md` | Moves consumer apps onto the `AuthClient` surface. | Migration track |
| 3 | `specs/20260512T111335-post-oauth-audit-remediation.md` | Fixes correctness gaps left after migration. Phase 3 (local workspace lifetime during reauth) is **superseded** by order 3.5; the rest still applies. | Immediate obligation |
| 3.5 | `specs/20260512T220000-session-two-axis-cohesive-reshape.md` | Reshapes `Session<T>` to `SessionPayload<T> \| null`, renames `requireSignedIn` to `requireIdentity` and per-app `getSignedInSession` to `requireWorkspace`, and delivers the same-user `reauth-required` invariant. **Landed.** | Runtime cohesion fix |
| 4 | `specs/20260512T114350-auth-token-capability-boundary.md` | Cleans up token ownership, persisted session shape, and storage vocabulary. | Long-term boundary cleanup |
| 5 | `specs/20260512T150000-cloud-modules-and-networks.md` | Moves pieces out of `apps/api` into one composable `apps/server` host. Cloud Apps live under that host, not in `apps/cloud`. | Composition cleanup |

Rejected, do not execute: `specs/20260512T161042-async-storage-and-build-unification.md`
collapsed sync and async session construction into one async builder. A second
pass rejected the proposal; tab-manager's async readiness story stays open but
will not be solved by that spec. The handoff prompt
`specs/20260512T220000-session-two-axis-cohesive-reshape.handoff.prompt.md` is
historical and not executable; the reshape has already landed.

## Product Stack (parallel to the auth stack)

The auth stack above defines credentials, identity, and protected-resource
boundaries. It does not define which Cloud Apps are installed into the server
host. That is the product stack:

| Order | Spec | Job | Status |
| --- | --- | --- | --- |
| 0 | `specs/20260512T150000-cloud-modules-and-networks.md` | Defines the product shape for the composable server host: server core, optional Cloud Apps merged into one `apps[]` array, per-app `pgSchema` isolation, islands by design. | Product-layer north star |
| 1 | `specs/20260413T120000-server-authoritative-apps-wager-social.md` | Historical research for Betcha and Ark. Phases 4 through 7 are blocked on the product north star. | Historical, partially superseded |

The auth stack and the product stack are co-authoritative. Auth owns identity,
scopes, audiences, and protected-resource behavior. Product owns Cloud Apps,
their mounts, public-record schemas, migrations, route surfaces, and per-app
scope names. Process topology is deliberately secondary. They must not
contradict; cross-references go through this map.

## Source Of Truth By Question

| Question | Source of truth |
| --- | --- |
| What is the public app auth API? | `specs/20260511T150000-final-oauth-auth-architecture.md` |
| How do apps migrate to that API? | `specs/20260512T100428-app-side-oauth-migration.md` |
| What must be fixed before the migration is trustworthy? | `specs/20260512T111335-post-oauth-audit-remediation.md` (Phase 3 superseded by the reshape spec) |
| What shape does the app-side session projection take? | `specs/20260512T220000-session-two-axis-cohesive-reshape.md` (`SessionPayload<T> \| null`, `requireWorkspace()`, `requireIdentity()`) |
| Who owns access tokens and refresh tokens? | `specs/20260512T114350-auth-token-capability-boundary.md` |
| What does sign-out do to local workspace memory and persistence? | `specs/20260504T233223-sign-out-preserves-local-data.md` |
| Where do new product surfaces (Ark, Betcha, billing, dashboard) live and what scopes do they need? | `specs/20260512T150000-cloud-modules-and-networks.md` |
| What is the resource boundary for a public app island? | `specs/20260512T150000-cloud-modules-and-networks.md` (each mounted Cloud App is its own OAuth protected resource at its own host) |
| When should physical deployable splitting happen? | After orders 1 through 4 are true in code and tests, and only if the single-host composition needs an operational split. |

Older auth specs are historical unless this map or one of the current stack specs explicitly references them.

## Ownership Model

```txt
Better Auth
  account login
  account cookies
  OAuth authorize/token/revoke
  JWKS

Epicenter API resource boundary
  /workspace-identity
  workspaces:open enforcement
  workspace sync
  document sync

@epicenter/auth
  private OAuthSession
  token refresh
  auth.state
  auth.fetch()
  auth.openWebSocket()

App session state
  local workspace construction
  same-user reauth repair
  sign-out teardown
  different-user refusal or reload

@epicenter/workspace
  Yjs documents
  IndexedDB persistence
  sync attachment
  no token ownership
```

## Conflict Audit

### Sign-out versus reauth-required

No conflict.

```txt
sign-out
  account exit
  destroy live workspace memory
  preserve owner-scoped local persistence

reauth-required
  same-user network repair
  keep live local workspace mounted
  retry or repair network credentials
```

If a future spec says signed-out workspace data should stay live in memory, reject it unless it also changes the encryption teardown model.

### Flat OAuthSession versus identity/network OAuthSession

This is a sequencing difference, not a product conflict.

The remediation spec can land against the current flat session because it is fixing broken runtime invariants. The token capability spec should then cleanly split persisted auth into:

```txt
OAuthSession
|-- identity
|   |-- user
|   `-- encryptionKeys
`-- network
    |-- accessToken
    |-- refreshToken
    `-- accessTokenExpiresAt
```

Do not keep both flat and nested shapes as public app-facing concepts. If migration support is needed, keep it at the storage boundary.

### Device auth versus loopback PKCE

There is a real decision here.

The final architecture already points toward replacing stale device auth with loopback PKCE. The remediation spec phrases it as "pick one path" because implementation should verify whether device login has shipped.

Clean-break default:

```txt
Use loopback PKCE for machine auth.
Use /workspace-identity for machine identity loading.
Use /auth/oauth2/revoke for logout.
Do not use /auth/get-session as a workspace identity bridge.
```

Restore Better Auth device authorization only if product evidence says the device flow is already shipped and must keep working.

### WebSocket bearer subprotocol versus tickets

No current conflict.

The current clean direction is:

```txt
First pass:
  auth.openWebSocket adds bearer access-token subprotocol internally
  API normalizes it to Authorization
  app, sync, and workspace code never read raw tokens

Possible later pass:
  auth.openWebSocket swaps bearer token for one-use WebSocket ticket
  callers do not change
```

Do not add a ticket endpoint until there is a concrete threat model or logging risk that pays for the extra protocol.

### Server composition versus auth contract

No conflict, but order matters.

Do not split `apps/server` and `apps/cloud` into separate conceptual platforms. The first target is one composable host. Physical splitting can come later as boring host dispatch or deployment packaging over the same modules.

## Clean Break Rules

Keep these rules as the guardrail for future auth specs:

1. Do not reintroduce cookie-first app runtime auth.
2. Do not expose raw token getters from `AuthClient`.
3. Do not let workspace, sync, chat, or UI construct `Authorization` headers.
4. Do not keep `/auth/get-session`, `/auth/me`, or `/me` as workspace identity bridges.
5. Do not keep both `sessionStorage` and `sessionStore` as public config names long term.
6. Do not add `/docs/*` aliases for document sync. Fix the clients to call `/documents/*`.
7. Do not create a permanent `apps/cloud` platform. Cloud Apps compose into `apps/server`; deployment topology comes after module boundaries are stable.
8. Do not put public-record state (Ark posts, Betcha challenges, follows) in server core. Public records live in Cloud Apps mounted at their own hosts.
9. Do not design federation. Mounted Cloud Apps are islands by default. If federation ever happens, it gets its own architecture spec, not an extension of the Cloud Apps spec.

## Recommended Work Order

```txt
1. Finish app-side OAuth migration if any app still imports old auth factories.
2. Land post-OAuth remediation (Phases 1, 2, 4, 5, 6).
3. Land the session two-axis reshape (covers remediation Phase 3). DONE.
4. Run the token capability clean break.
5. Update docs and skills to the new vocabulary.
6. Move server core and Cloud Apps into `apps/server`. Remove `apps/cloud` once no code needs it as a migration inbox.
```

## Success Criteria

- [ ] Every current auth spec links back to this stack map or is explicitly marked historical.
- [ ] The app runtime contract is still `state`, `startSignIn`, `signOut`, `fetch`, and `openWebSocket`.
- [ ] Protected resources reject under-scoped OAuth tokens.
- [ ] Same-user `reauth-required` keeps local workspace state mounted.
- [ ] Real sign-out destroys live workspace memory.
- [ ] App code cannot read access tokens or refresh tokens through `AuthClient`.
- [ ] Server composition work starts only after the auth boundary is stable.
- [ ] Physical deployable split work is treated as optional topology, not the product model.
