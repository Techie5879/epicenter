# Workspace Noun Clean Break

**Date**: 2026-05-19
**Status**: Draft
**Author**: AI-assisted

Supersedes the product model in `specs/20260519T160000-subject-principal-surface.md`. That spec correctly found that raw `user.id` is too weak as a `subject`, but it let `subject` keep owning too much of the product model. This spec keeps the typed `Subject` cleanup as an implementation wave and moves the durable product noun to `Workspace`.

Revision note, 2026-05-20: `specs/20260520T001032-workspace-capsule-clean-break.md` and `specs/20260520T114537-epicenter-sync-engine-host-composition.md` keep the Workspace direction but narrow the immediate sync work. Current Cloud sync remains personal owner-scoped with `subject:{subject}:rooms:{room}`. Workspace-scoped room names are still the likely team-ready shape, but only after Workspace rows, access checks, and migration rules exist. Do not read the Phase 1 `Subject.toRoomName` item below as the active next step for the sync engine.

Superseded note, 2026-05-20: `specs/20260520T190000-cloud-workspace-app-instance-clean-break.md` supersedes this spec for Epicenter Cloud hierarchy. It keeps Workspace as the daily product noun, but rejects the Cloud `owner_user_id` / `owner_organization_id` direction. In the active Cloud model, Better Auth organization backs Cloud Workspace, Better Auth member backs Workspace membership, and App Namespace is `workspaceId + appId`; `app_instance` is deferred until installed-app lifecycle operations earn it.

## One Sentence

Epicenter work happens inside a workspace: a user or organization can own it, a signed-in principal can access it, every replicated `Y.Doc` syncs through a room, and subject stays a low-level auth and cryptographic label.

## Overview

This spec defines the canonical nouns for identity, tenancy, local-first storage, sync routing, and package naming. It does not implement organizations yet. It gives the next implementation wave a stable vocabulary so `subject`, `ownerId`, `workspaceId`, `ydoc.guid`, `room`, and `installationId` stop competing for the same job.

## Motivation

### Current State

`/api/session` compresses signed-in user, data owner, and cryptographic subject into the same raw string:

```ts
localIdentity: {
	subject: user.id,
	keyring: await deriveSubjectKeyring(user.id),
}
```

Room Durable Objects use the same raw user id:

```ts
const doName = `subject:${c.var.user.id}:rooms:${room}`;
```

Billing also uses the same user id as the Autumn customer:

```ts
customerId: c.var.user.id
```

The workspace package then uses `ydoc.guid` as the sync room name and as the input to several local storage and encryption paths:

```ts
const ydoc = new Y.Doc({ guid: 'blog' });
const idb = owner.attachIndexedDb(ydoc);
const collaboration = openCollaboration(ydoc, {
	url: roomWsUrl('https://api.example.com', ydoc.guid),
});
```

This creates three collisions:

1. **Subject owns too much**: auth principal, cryptographic label, local storage owner, and room namespace all look like `user.id`.
2. **Workspace is overloaded**: `@epicenter/workspace` is the package, `workspaceId` is an encryption label, and docs sometimes call a single `Y.Doc` a workspace.
3. **Room sounds durable**: `/rooms/:room` currently names one replicated `Y.Doc`, but a room is really the live sync transport for that data.

### Desired State

Use this noun stack:

```txt
Deployment
  hosting, auth issuer, secrets, backups, self-host boundary

User
  human auth record

Organization
  optional people, roles, invitations, policy, audit, billing admin

Workspace
  durable product data container

Y.Doc
  replicated CRDT unit inside a workspace

Room
  live sync transport address for one replicated Y.Doc

Installation
  stable local client identity used for presence and peer routing

Subject
  low-level auth and cryptographic label
```

The user-facing rule is simple:

```txt
Solo users get a personal workspace.
Organizations can own team workspaces later.
Every durable resource belongs to a workspace.
Every replicated Y.Doc syncs through a room.
```

## Research Findings

### Comparable Products

| Product | Solo shape | Team shape | Lesson |
| --- | --- | --- | --- |
| Notion | Solo user works inside a one-person workspace | Workspace contains members, guests, teamspaces, billing roles | Workspace is the daily product and data boundary |
| Linear | User can join multiple workspaces | Workspace contains teams, members, roles, billing | Work happens inside workspace, even for small teams |
| Supabase | First account gets a default organization | Organization contains projects and members | Default container removes no-tenant edge cases |
| GitHub | Personal account owns resources directly | Organization also owns resources | Useful owner abstraction, but not a sync namespace |
| Vercel | Personal account or team owns projects | Team has roles and billing | Owner and project are separate nouns |
| Slack | Workspace is the ordinary boundary | Enterprise organization groups workspaces | Organization can sit above workspace |

Key finding: products that feel simple usually avoid a "no container" state. They either create a personal workspace or let a personal account own resources directly. Epicenter should choose the workspace path because local-first storage, sync, and encryption need a stable data container.

### Better Auth Organization Plugin

Better Auth keeps `user` as the auth principal and adds optional `organization`, `member`, `invitation`, optional `team`, and nullable `session.activeOrganizationId`. It does not require every user to have an organization.

Implication: do not create fake organizations for solo users just to get a tenant id. Epicenter can add organizations when team membership, invitations, roles, SSO, audit, or org billing exist.

Use Better Auth organizations for people and policy, not as the durable data root. Epicenter should treat `organization.id` as one possible owner of a workspace, not as a replacement for `workspace.id`.

```txt
Better Auth organization
  people
  members
  invitations
  roles
  optional teams
  active organization for admin surfaces

Epicenter workspace
  durable product data
  root Y.Doc
  child Y.Docs
  assets
  room authorization
  encryption policy
```

`activeOrganizationId` should not become the primary app switcher. Use `activeWorkspaceId` for product data and reserve `activeOrganizationId` for organization settings, invitations, members, SSO, audit, and billing admin.

### Cloudflare Durable Objects And Yjs

Durable Object names should identify the smallest natural coordination boundary. For a collaborative app, that is usually the workspace plus the replicated unit, not the current user or current organization.

Yjs does not carry an application namespace inside updates. The `Y.Doc` identity, provider room name, local IndexedDB name, and server update log must all agree about which replicated unit they are opening.

Implication: a room is a transport address for a replicated `Y.Doc`. It is not the product workspace itself.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Canonical product container | 2 coherence | `Workspace` | It is the thing users work in, orgs can own, and storage can attach to |
| Package name | 3 taste | Keep `@epicenter/workspace` | The package should become the workspace SDK; renaming creates import churn without deleting a mental model |
| Generic child noun | 2 coherence | Do not introduce platform-wide `Document` | The root workspace is already backed by a `Y.Doc`; `Workspace -> Document -> Y.Doc` creates a false hierarchy |
| Live sync noun | 2 coherence | `Room` | A room is the live transport for one replicated `Y.Doc` |
| Room visibility | 2 coherence | Internal infrastructure noun | Users manage workspaces and app objects, not rooms |
| Workspace to room cardinality | 2 coherence | One workspace can have many rooms | A workspace owns many replicated `Y.Doc`s; each synced `Y.Doc` has one room |
| Presence-only noun | Deferred | Defer `Lobby` | There is no concrete cross-room discovery or presence product yet |
| Auth actor noun | 2 coherence | `Principal` in authorization prose, `Subject` in crypto/OAuth code | Principal says who is acting; subject says which low-level stable label derives keys |
| Solo users | 2 coherence | Create a personal workspace | Removes the no-workspace edge case without fake organizations |
| Organizations | Deferred | Optional, not default | Better Auth supports optional orgs; team product requirements should drive enabling the plugin |
| Physical workspace owner columns | 2 coherence | `ownerUserId` and nullable future `ownerOrganizationId` | Keeps SQL foreign keys and check constraints while domain code exposes `{ type, id }` |
| Billing | 2 coherence | `BillingAccount`, not subject and not room | Billing may attach to user or org; it should not be the sync namespace |
| Self-hosting | 2 coherence | `Deployment` above workspace | The deployment owns secrets and backups; workspace still owns data |

## Canonical Glossary

### Deployment

The hosting and trust boundary. Cloud has one production deployment containing many users and workspaces. Self-hosted installations have their own deployment id, auth issuer, database, object storage, secrets, and backups.

Use `deploymentId` in local storage keys when a browser or desktop app can connect to cloud, staging, and self-hosted servers. Do not put deployment in product copy unless the user is administering a self-hosted instance.

### User

The human auth record. Better Auth owns this row and its sessions, OAuth accounts, and identity provider links.

Use `user.id` for Better Auth relations, OAuth records, profile settings, and personal billing contact data. Do not use `user.id` directly as the sync namespace once typed subjects and workspaces exist.

### Principal

The authenticated actor at an authorization boundary.

Use principal in server-side authorization prose and APIs that answer "who is calling?" A principal can be a user today and a service account later.

### Subject

The low-level stable label used by auth session projection and key derivation. Today it should become `user:{user.id}` through a centralized `Subject` module.

Use subject for OAuth claims, local identity, HKDF subject info, and compatibility with existing session cells. Do not use subject as the product noun for workspace ownership.

### Organization

An optional people and policy container. It owns members, roles, invitations, SSO, audit policy, and can own billing accounts.

An organization may own many workspaces. A workspace may move from personal ownership to organization ownership without changing its workspace id.

In the Cloud API, the organization row should come from Better Auth's organization plugin when team features are real. Epicenter code should reference that organization id from workspace ownership and access checks rather than copying Better Auth membership state into a second organization model.

### Workspace

The durable product data container. A workspace is owned by a user or organization, has members or grants, has a billing attachment, and owns the namespace for storage, sync, and encryption policy.

The root workspace can be backed by a `Y.Doc` today. A future team workspace can be backed by SQLite with rooms for live collaboration. The product noun stays the same.

The point of a workspace row is not naming. The row is useful only when it owns real invariants: root `Y.Doc` identity, assets, Durable Object tracking, access checks, billing attachment, or encryption policy. Do not add a workspace row that only mirrors `user.id`.

### Y.Doc

A replicated CRDT unit. A workspace may have one root `Y.Doc` plus child content docs. Use `ydoc.guid` when speaking about raw Yjs identity.

Do not expose generic `Document` as the platform noun unless the app is literally a document editor. Prefer app nouns like transcript, note, entry content, tab graph, or asset.

### Room

The live transport address for one replicated `Y.Doc`. A room owns WebSocket sync, awareness, dispatch, and Durable Object update storage for that `Y.Doc`.

A room does not own billing, membership, or product identity.

Room is an internal infrastructure noun. Users should not see or manage rooms. Product UI opens a workspace, note, transcript, tab graph, or asset. The server opens the room needed to sync the underlying `Y.Doc`.

Room stays a good noun because the Durable Object is more than a byte log: it coordinates live WebSocket peers, awareness, dispatch, and update persistence. `Document` is worse here because it sounds like the durable product object. The exact durable replicated object is already named `Y.Doc`.

### Installation

A stable local client identity. It publishes liveness, deduplicates multiple tabs from the same install, and routes peer dispatch.

Never use `installationId` for auth, billing, ownership, or encryption.

### BillingAccount

The payer and entitlement container. Today it can map to a user. Later it can map to an organization or enterprise contract.

BillingAccount should not appear in Yjs room names, local IndexedDB keys, or encryption labels.

## Naming Rules

Use these rules when editing code, docs, specs, or API shapes:

```txt
workspaceId
  product data container
  appears in workspace rows, workspace membership, storage policy, future DO namespaces

ydoc.guid
  raw Yjs replicated unit id
  appears in Y.Doc construction, local provider names, sync room derivation

roomName
  transport address for a replicated Y.Doc
  appears in WebSocket routes, Durable Object names, sync telemetry

subject
  stable auth and crypto label
  appears in localIdentity, HKDF subject derivation, OAuth-adjacent code

principal
  actor at authorization boundary
  appears in middleware and access checks

ownerId
  local storage partition owner
  appears in IndexedDB and BroadcastChannel wipe paths only

installationId
  client install identity
  appears in awareness, peer lists, and dispatch routing
```

Ban these until a concrete feature earns them:

```txt
tenant           use deployment, organization, workspace, or billingAccount
lobby            no product feature yet
workspace doc    say root Y.Doc or child content doc
document         only use as an app/domain noun
org-scoped room  organizations own workspaces, not room namespaces
```

## Target Architecture

```txt
Deployment
  id
  auth issuer
  secrets
  database
  object storage
  backups

User
  id
  email

Organization optional
  id
  members
  roles
  invitations
  policy

Workspace
  id
  ownerUserId
  ownerOrganizationId
  billingAccountId
  rootYdocGuid
  encryptionPolicy

Y.Doc
  guid
  workspaceId

Room derived from workspaceId and ydocGuid
  workspaceId
  ydocGuid
  doName

Installation
  id
  principalId
```

Today the route can still be built from subject and `ydoc.guid` while the model is prepared:

```txt
subject:user:{userId}:rooms:{ydocGuid}
```

The long-term team-ready room name should be workspace-scoped:

```txt
workspace:{workspaceId}:rooms:{ydocGuid}
```

Do not jump to the long-term room name until `workspaceId` exists as a real row with membership and access checks. Otherwise the migration creates a second namespace without the product invariant that justifies it.

Current sync-host composition makes that caution stronger: the host owns room-name construction, and the sync engine receives an opaque `roomName`. A centralized room-name helper can still be useful inside the host, but it should not become a package-level sync engine dependency until a second route shape proves it.

## Database Model

Use a clean domain shape and a stricter physical database shape.

Domain code can expose this:

```ts
type WorkspaceOwner =
	| { type: 'user'; id: string }
	| { type: 'organization'; id: string };
```

The database should prefer nullable foreign keys with an exactly-one-owner check:

```txt
workspace
  id text primary key
  name text not null
  root_ydoc_guid text not null
  owner_user_id text null references user(id)
  owner_organization_id text null references organization(id)
  billing_account_id text null
  encryption_policy jsonb null
  created_by_user_id text not null references user(id)
  created_at timestamp not null
  updated_at timestamp not null

constraint workspace_exactly_one_owner:
  owner_user_id is null != owner_organization_id is null
```

`ownerType` and `ownerId` are a clean API shape, but they are not the cleanest SQL shape. A polymorphic `ownerId` cannot have normal foreign keys. Nullable owner columns let Postgres enforce that a workspace is owned by a real user or a real organization while TypeScript still sees a discriminated owner.

Do not create a `room` table in the first workspace migration. A room is derived from `{ workspaceId, ydocGuid }`, and the Durable Object name is the durable runtime address:

```txt
workspace:{workspaceId}:rooms:{ydocGuid}
```

If room telemetry is needed, adapt the existing Durable Object tracking table around workspace identity:

```txt
durable_object_instance
  workspace_id
  ydoc_guid
  do_name
  storage_bytes
  created_at
  last_accessed_at
  storage_measured_at
```

The workspace row becomes valuable when it owns at least one current resource:

```txt
workspace.rootYdocGuid
asset.workspaceId
durableObjectInstance.workspaceId
workspaceGrant or workspaceMembership
billingAccount.workspaceId or billingAccount.ownerOrganizationId
encryptionPolicy.workspaceId
```

### Access Checks

Workspace-scoped rooms require workspace-scoped authorization.

```txt
open /workspaces/:workspaceId/rooms/:ydocGuid
  load workspace
  if workspace.ownerUserId == principal.userId: allow
  if workspace.ownerOrganizationId is set:
    check Better Auth organization membership
    check workspace grant or role if the product needs finer access
  otherwise: reject
  open DO name workspace:{workspaceId}:rooms:{ydocGuid}
```

Better Auth should answer organization membership and role questions. Epicenter should answer workspace ownership, workspace grants, room derivation, storage namespace, and encryption policy.

## Clean-Break Pass

### Product Sentence

Epicenter opens a workspace, then syncs the workspace's replicated units through rooms.

### Current Path

Keep adding meaning to `subject`, keep treating `ydoc.guid` as both workspace id and room id, and maybe rename `@epicenter/workspace` because the noun feels overloaded.

### Friction

The package name is not the main problem. The problem is that the code does not distinguish root product container, raw Yjs identity, and live transport address. Renaming the package to `documents` or `sync` would hide the larger issue and make the future product noun harder to use.

### Radical Option

Keep `@epicenter/workspace` and make it honest: the package is the workspace SDK. It defines workspace data primitives and opens persistence, encryption, collaboration, materialization, and daemon runtimes around caller-owned `Y.Doc`s.

### Deletion Prize

This deletes the need for:

```txt
ProductWorkspace as a second package
generic Document below every workspace
org-scoped room fallbacks
tenant as an app-level bucket
lobby as a speculative presence noun
package rename churn across every import
```

### User Loss

We lose the short-term satisfaction of renaming everything now. We also refuse a generic `Document` abstraction, so apps must name child data with app nouns.

### Decision

Take the smaller clean break now:

```txt
1. Keep the package name.
2. Fix the nouns and docs.
3. Type `Subject`.
4. Add workspace rows only when they own real resources.
5. Add workspace-scoped rooms only when access checks can be real.
```

## Implementation Plan

### Phase 1: Typed Subject And Parser Cleanup

- [ ] Create a centralized `Subject` module in `@epicenter/auth`.
- [ ] Format user subjects as `user:{user.id}`.
- [ ] Add `Subject.toRoomName(subject, ydocGuid)` and `Subject.fromRoomName(name)`.
- [ ] Fix `Room` parsing so colons inside subjects are safe.
- [ ] Change `/api/session` to return typed subject values.
- [ ] Keep Autumn customer ids as raw `user.id`.
- [ ] Add exact-string tests for session, HKDF subject info, DO names, and local owner keys.

Status after the sync-host composition pass: keep typed subject cleanup as an auth and encryption concern, but defer `Subject.toRoomName`. Room-name construction currently belongs in the host route because the host has the policy context. Adding a package-level helper now would make subject scope look more permanent than it is.

### Phase 2: Vocabulary Cleanup In `@epicenter/workspace`

- [ ] Rewrite package docs so `@epicenter/workspace` means workspace SDK, not generic Yjs wrapper.
- [ ] Rename prose uses of "workspace document" to "root Y.Doc" or "child content doc".
- [ ] Keep public exports such as `attachTable`, `attachKv`, `openCollaboration`, and `roomWsUrl`.
- [ ] Do not rename the package.
- [ ] Do not introduce a generic platform `Document` abstraction.

### Phase 3: Product Workspace Records

- [ ] Add `workspace` table with `ownerUserId`, future `ownerOrganizationId`, `billingAccountId`, and `rootYdocGuid`.
- [ ] Add an exactly-one-owner check for `ownerUserId` and `ownerOrganizationId`.
- [ ] Create a personal workspace when a user signs up.
- [ ] Return active/default workspace metadata from the session or a workspace endpoint.
- [ ] Move at least one real durable resource under `workspaceId` in the same wave: assets, DO tracking, root Y.Doc metadata, grants, billing attachment, or encryption policy.
- [ ] Add workspace membership or grants before any workspace-scoped room names ship.
- [ ] Keep organization optional until team features need Better Auth's organization plugin.

### Phase 4: Workspace-Scoped Rooms

- [ ] Add explicit room construction from `{ workspaceId, ydocGuid }`.
- [ ] Route `/workspaces/:workspaceId/rooms/:ydocGuid` or equivalent.
- [ ] Authorize the principal against workspace membership before opening the room.
- [ ] Change DO names to `workspace:{workspaceId}:rooms:{ydocGuid}`.
- [ ] Migrate or intentionally discard old subject-scoped DO storage, depending on production data.

### Phase 5: Organization And Billing

- [ ] Enable Better Auth organizations only when org membership, invitations, and roles are product surfaces.
- [ ] Reference Better Auth `organization.id` from `workspace.ownerOrganizationId`.
- [ ] Keep `activeWorkspaceId` separate from Better Auth `activeOrganizationId`.
- [ ] Add `BillingAccount` so payer identity is not the same concept as user, subject, or workspace.
- [ ] Let organizations own workspaces.
- [ ] Let billing accounts pay for one or many workspaces.

## Edge Cases

### Solo User With No Organization

1. User signs up.
2. The system creates `Braden Personal` as a workspace.
3. No organization row is created.
4. Data still has a workspace id.

### Personal Workspace Moves Into An Organization

1. Workspace starts with `ownerUserId = user.id`.
2. User creates or joins an organization.
3. Workspace changes to `ownerUserId = null` and `ownerOrganizationId = organization.id`.
4. `workspace.id` stays the same.
5. Room names stay the same if they are already workspace-scoped.

### Workspace With Multiple Rooms

1. Workspace `ws_notes` has root `Y.Doc` `ws_notes.root`.
2. The root doc syncs through `workspace:ws_notes:rooms:ws_notes.root`.
3. Note body `note_123` has child `Y.Doc` `ws_notes.notes.note_123.body`.
4. The note body syncs through `workspace:ws_notes:rooms:ws_notes.notes.note_123.body`.
5. Both rooms are authorized through workspace `ws_notes`.

### Better Auth Organization Owns Workspaces

1. Better Auth organization `org_acme` has members, roles, and invitations.
2. Epicenter workspace `ws_design` has `ownerOrganizationId = org_acme`.
3. User opens `/workspaces/ws_design/rooms/ws_design.root`.
4. API checks that the user belongs to `org_acme`.
5. API checks any workspace-level grant required by the product.
6. API opens `workspace:ws_design:rooms:ws_design.root`.

### Self-Hosted Solo Deployment

1. User runs Epicenter on a home server.
2. Deployment owns secrets, database, backups, and auth issuer.
3. User has a personal workspace.
4. No organization exists unless the user creates one.

### Enterprise Self-Hosted Deployment

1. Acme runs a self-hosted Epicenter deployment.
2. Deployment and organization often line up in practice.
3. Keep them separate anyway: deployment is where it runs; organization is who administers it; workspace is where data lives.

### SQLite-Backed Team Workspace

1. Workspace uses SQLite as canonical truth.
2. Rooms provide live Yjs collaboration for active surfaces.
3. The product noun stays `Workspace`.
4. Do not rename the package to `database` or `documents`.

## Open Questions

1. **Should Phase 3 land before any team product exists?**
   - Options: add workspace rows now, or wait until a concrete app needs them.
   - Recommendation: add the row only after Phase 1 and Phase 2, and only when the row owns a real resource. A workspace row that only mirrors `user.id` is ceremony.

2. **Should room routes change from `/rooms/:room` to `/workspaces/:workspaceId/rooms/:ydocGuid`?**
   - Recommendation: yes, when workspace membership exists. Until then, route shape cannot enforce the product model.

3. **Should child Y.Doc ids include `workspaceId`?**
   - Options: keep dotted `docGuid({ workspaceId, collection, rowId, field })`, or move to opaque ids with DB lookup.
   - Recommendation: keep the helper for now. It already centralizes the convention.

4. **Should `Document` ever be a platform noun?**
   - Recommendation: no. Use it only in apps whose domain object is literally a document.

5. **Should the API call the sync route `rooms` or `ydocs/:guid/sync`?**
   - Recommendation: keep `Room` internally. `/workspaces/:workspaceId/rooms/:ydocGuid` is acceptable because room is an infrastructure route, not a product noun. If public API consumers find `room` confusing, route shape can become `/workspaces/:workspaceId/ydocs/:ydocGuid/sync` while the Durable Object class stays `Room`.

## Success Criteria

- [ ] `@epicenter/workspace` docs define workspace as the product data container and explain root `Y.Doc`, child content docs, and rooms separately.
- [ ] No production code formats `subject:{...}:rooms:{...}` outside a centralized helper.
- [ ] Room parsing supports typed subjects with colons.
- [ ] Billing continues to use user or billing account ids, not subject.
- [ ] No fake organization is created for solo users.
- [ ] Workspace owner is enforceable in SQL through nullable foreign keys and an exactly-one-owner check.
- [ ] `activeWorkspaceId` and Better Auth `activeOrganizationId` remain separate concepts.
- [ ] Any future workspace-scoped DO name is backed by a real workspace row and authorization check.

## References

- `apps/api/src/app.ts` - session projection, billing middleware, and room DO naming.
- `apps/api/src/room.ts` - room DO subject parsing and sync storage.
- `apps/api/src/db/schema.ts` - current user, asset, and DO tracking tables.
- `apps/api/src/billing-routes.ts` - current Autumn customer id usage.
- `apps/api/src/auth/create-auth.ts` - user creation hook for Autumn customer creation.
- `packages/encryption/src/derivation.ts` - subject and workspace HKDF labels.
- `packages/workspace/package.json` - current package name and exports.
- `packages/workspace/src/index.ts` - workspace package public surface.
- `packages/workspace/src/document/README.md` - current workspace document prose.
- `packages/workspace/src/document/doc-guid.ts` - child content doc id convention.
- `packages/workspace/src/document/local-yjs-key.ts` - local owner storage naming.
- Notion workspace docs - solo and team work happen inside a workspace.
- Better Auth organization docs - organizations are optional and membership is explicit.
- Cloudflare Durable Objects docs - named object ids route stable coordination boundaries.
- Yjs and y-indexeddb docs - replicated document identity and provider names must agree.
