# Auth Identity And Workspace Access Discussion

**Date**: 2026-05-21
**Status**: Draft
**Author**: AI-assisted

## Overview

This note externalizes the auth concern from the Cloud Workspace cleanup. The current direction is not obviously wrong. The direction is mostly right, but it is carrying one dangerous ambiguity: auth identity, local storage ownership, and Cloud Workspace access are adjacent concepts that can easily collapse back into one overloaded `subject` or `workspace` idea.

## One Sentence

OAuth proves the caller is an Epicenter user; `localIdentity` lets that user open local data; Cloud Workspace membership decides which shared Cloud data the user may open.

## The Current Shape

The auth client persists one cell with two sections.

```ts
PersistedAuth = {
  grant: OAuthTokenGrant;
  localIdentity: LocalIdentity;
}
```

In code, the split is explicit:

```txt
packages/auth/src/auth-types.ts
  OAuthTokenGrant:
    online server-access material

  LocalIdentity:
    local-first owner label and keyring

  PersistedAuth:
    grant + localIdentity
```

`OAuthTokenGrant.accessTokenExpiresAt` is a refresh hint, not authorization truth. The comments already say the resource server is the source of truth for token validity.

```txt
packages/auth/src/auth-types.ts:23-31
```

`LocalIdentity` is the offline-capable local owner identity. Today its `subject` equals the Better Auth `user.id`, but the type comments say future servers may scope it differently.

```txt
packages/auth/src/auth-types.ts:36-61
```

The app auth boundary reinforces that split. `createOAuthAppAuth()` exposes `fetch` and `openWebSocket`, not raw tokens. Before attaching a bearer token, it refreshes the grant if needed and verifies `/api/session`.

```txt
packages/auth/src/create-oauth-app-auth.ts:79-88
packages/auth/src/create-oauth-app-auth.ts:243-328
```

The Svelte session layer then maps `localIdentity.subject` into workspace-local ownership:

```txt
packages/svelte-utils/src/session.svelte.ts:4-18
packages/svelte-utils/src/session.svelte.ts:42-52
```

The API bearer boundary is intentionally thinner. It verifies issuer, audience, signature, expiration, subject, and user existence. It does not check workspace access, asset ownership, billing state, or key release policy.

```txt
apps/api/src/auth/resource-boundary.ts:47-76
```

That matches the OAuth cleanup spec:

```txt
Bearer request
  -> token verifies against API issuer and audience
  -> token has a subject
  -> subject resolves to an existing Better Auth user
  -> c.var.user is set

Domain checks decide exact access.
```

## What Better Auth Should Own

DeepWiki grounding against `better-auth/better-auth` matched the current direction: Better Auth owns user creation, account linking, session lifecycle, OAuth token issuing, bearer/JWT verification, and organization/member records. The app should consume those primitives, not rebuild them.

The critical distinction is permission enforcement. Better Auth can say:

```txt
User X is a member of organization Y.
User X has role owner or member.
This token was issued by this auth server for this API audience.
```

Epicenter product code must still say:

```txt
User X may open Cloud Workspace Y.
User X may open App Namespace Y/Z.
User X may read, write, retain, delete, bill, export, or decrypt this resource.
```

This is why `workspaces:open` was correctly removed. It duplicated audience and did not encode actual workspace access.

## Is The Direction Wrong?

No, not in the strong sense.

The main direction is sound:

```txt
Better Auth:
  users
  sessions
  OAuth server
  organization/member rows

Epicenter auth package:
  app-side OAuth session
  offline local identity cache
  auth-owned fetch and WebSocket capabilities

Epicenter API routes:
  product authorization
  Cloud Workspace membership
  App Namespace routing
  asset, billing, key, and sync policy

Workspace package:
  local owner
  encryption
  persistence
  Yjs collaboration primitives
```

The current branch is correcting an older mistake: it stops asking OAuth scopes or `Subject` to express product access. It makes the route layer check the product boundary directly.

The direction could still be improved. The improvement is not "remove Better Auth" or "make OAuth smarter." The improvement is to keep the three identity layers visually separate enough that future code cannot mix them by accident.

## The Three Identity Layers

The current model needs three named layers.

```txt
Login identity:
  Better Auth user
  email, account, cookie session, OAuth subject

Local owner identity:
  localIdentity.subject
  keyring
  browser storage owner
  offline decrypt

Cloud access identity:
  Cloud Workspace membership
  App Namespace authorization
  future app/doc/asset/key/billing checks
```

These layers can point at the same raw string today.

```txt
Better Auth user.id
  -> /api/session localIdentity.subject
  -> createLocalOwner({ ownerId })
  -> local IndexedDB and keyring
```

That is acceptable only if the names keep the meanings apart. The moment code starts treating `subject` as the Cloud Workspace owner, or treating `workspaceId` as the local encryption owner, the model has drifted.

## Where The Current Code Is Strong

The client auth boundary is strong because server access flows through capabilities.

```txt
auth.fetch(...)
auth.openWebSocket(...)
```

Callers do not receive `accessToken` and decide how to use it. That keeps refresh, verification, and paused network auth inside auth.

The offline path is also strong. Refresh failure pauses network auth but preserves `localIdentity`, so local data can still open. That is the right local-first behavior.

The API resource boundary is strong because it refuses fake OAuth policy. It verifies the bearer token and returns `AuthUser`; route code performs product checks later.

The Cloud Workspace adapter is strong because it wraps Better Auth organization tables with workspace language instead of leaking `organization` into the public product API.

## Where The Current Code Is Still Confusing

The exported type is now `LocalIdentity`, which removes the worst public `Subject` noun. The remaining question is the persisted field:

Persisted field:

```txt
localIdentity.subject
```

It is accurate from the auth server perspective, but it is not what workspace code means. Workspace code receives the same string as `ownerId`, which is clearer locally.

Candidate future clean break:

```ts
type LocalIdentity = {
  ownerId: string;
  keyring: SubjectKeyring;
};
```

That would make `/api/session` speak in the language of the thing the client actually needs: local owner identity. The downside is that `subject` is a useful security word at the auth boundary, and changing persisted auth shape needs an explicit migration or greenfield reset.

This is not urgent if no code is currently misusing `subject` as a Cloud noun. It becomes urgent if another spec, API route, or helper starts building Cloud product state from `localIdentity.subject`.

## The Important Refusal

Do not make Cloud Workspace selection part of the OAuth grant.

Bad direction:

```txt
OAuth token says:
  subject = user_123
  scope = workspaces:open
  activeWorkspaceId = ws_abc
```

That would move product state into auth transport. It forces scope tables, route-to-scope policy, token refresh whenever the user switches workspaces, and confusing stale-token behavior.

Better direction:

```txt
OAuth token says:
  this caller is user_123 for the Epicenter API

/api/workspaces says:
  user_123 may open these Cloud Workspaces

/workspaces/:workspaceId/apps/:appId/docs/:docId says:
  user_123 is a member of workspaceId
```

This keeps auth stable while product access can evolve.

## The Real Risk

The real risk is under-modeling Cloud Workspace access, not over-modeling auth.

Today the Workspace Sync Doc route checks Workspace membership and validates route ids. That is enough only while phase 1 means:

```txt
any Workspace member can open any valid first-party app namespace
doc ids are app-owned
no app-level privacy
no doc inventory
no app billing
no customer-managed keys
```

If those assumptions stop being true, the next step is not "add OAuth scopes." The next step is a product table or product policy at the Cloud route boundary:

```txt
app_instance
app_instance_member
app_sync_doc
app_key_grant
workspace_profile
billing_cache
```

Those tables are still correctly deferred. They should be added only when a product operation earns them: list, rename, delete, disable, duplicate, retain, meter, inspect, export, or permission separately.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Auth server | 1 evidence | Keep Better Auth | Better Auth owns users, sessions, OAuth issuing, bearer verification, and organization/member records. Rebuilding that would add security surface without simplifying product code. |
| OAuth boundary | 2 coherence | OAuth proves API user only | Audience plus issuer identifies the API. Workspace, app, asset, billing, and key access are product checks. |
| App auth client | 2 coherence | Expose capabilities, not tokens | `auth.fetch` and `auth.openWebSocket` keep refresh and verification inside auth. |
| Offline local identity | 2 coherence | Keep `localIdentity` separate from grant | Local workspace boot and decrypt must survive temporary network auth failure. |
| `LocalIdentity` name | 2 coherence | Keep | The type now names local owner material instead of making `Subject` a public product noun. |
| `localIdentity.subject` field | Deferred | Consider rename | The meaning is local owner identity, but the field is persisted auth shape and `/api/session` contract. |
| Cloud Workspace in OAuth | 2 coherence | Refuse | Workspace selection is product state. Putting it in OAuth grants would create stale-token and route-policy coupling. |
| App/doc access | Deferred | Keep route-level product checks | Add app/doc tables only when product operations earn them. |

## Recommendation

Keep the branch direction. Do not reverse it.

The best improvement is a small auth vocabulary cleanup, not a new auth architecture:

1. Keep Better Auth as the auth server.
2. Keep OAuth as transport identity for app clients.
3. Keep `localIdentity` as offline local owner material.
4. Keep Cloud Workspace membership checks in product routes.
5. Consider renaming `localIdentity.subject` only with an explicit persisted auth and `/api/session` migration rule.

The test for future changes is simple:

```txt
Does this change make auth decide product access?
  Reject it.

Does this change make product routes verify identity themselves?
  Reject it.

Does this change let local data open while network auth is paused?
  Keep that property.

Does this change make Subject, Realm, Tenant, Room, Durable Object, or OAuth scope a product noun?
  Reject it.
```

## Follow-Up Questions

1. Should `/api/session` return `localIdentity.ownerId` instead of `localIdentity.subject`, or is the persisted shape already durable enough to keep?
2. Should `createSession()` own a stronger subject-switch invariant test for every auth implementation, not just OAuth app auth?
3. Should `auth.fetch('/api/workspaces')` remain a prepared app concern, or should auth expose a tiny "workspace bootstrap" helper? The default should be no helper unless more apps duplicate the same code.
4. When app-level privacy arrives, what product operation earns `app_instance_member` first?
