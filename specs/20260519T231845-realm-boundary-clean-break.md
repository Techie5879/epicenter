# Realm Boundary Clean Break

**Date**: 2026-05-19
**Status**: Draft
**Author**: AI-assisted

Superseded note, 2026-05-20: this was a useful pressure test, but it is not the active direction. `specs/20260520T001032-workspace-capsule-clean-break.md` replaced Realm and Tenant with Workspace as the portable product boundary, and `specs/20260520T114537-epicenter-sync-engine-host-composition.md` kept the first sync-engine pass inside host composition. Use this spec for the rejected Realm argument and self-hosting pressure tests, not as the implementation plan.

Second superseded note, 2026-05-20: `specs/20260520T190000-cloud-workspace-app-instance-clean-break.md` supersedes the Cloud hierarchy again. It keeps the rejection of Realm and the warning that one Durable Object per top-level boundary would bottleneck, but it makes Cloud Workspace the Better Auth backed product account container and App Namespace (`workspaceId + appId`) the lower app-data boundary. `app_instance` is deferred until installed-app lifecycle operations earn it.

Builds on `specs/20260519T155705-workspace-noun-clean-break.md` and revises its ownership center. That spec moved the durable product noun from `Subject` to `Workspace`; this spec moves the portable trust and hosting boundary above `Workspace` to `Realm`.

## One Sentence

Epicenter hosts portable realms: each realm is a trust, admin, key, and export boundary containing workspaces, and each workspace syncs replicated Yjs data through room actors.

## Overview

This spec defines `Realm` as the boundary that can live on Epicenter Cloud, a self-hosted server, or a future dedicated org deployment. It keeps Better Auth responsible for user authentication, keeps workspaces as product data containers, and keeps Durable Objects as the Cloudflare implementation of room actors rather than the canonical data model.

## Motivation

### Current State

`/api/session` still compresses auth subject and local data owner into the raw Better Auth user id:

```ts
localIdentity: {
	subject: user.id,
	keyring: await deriveSubjectKeyring(user.id),
}
```

Room Durable Object names are also scoped to that same user id:

```ts
const doName = `subject:${c.var.user.id}:rooms:${room}`;
```

The current API flow is:

```txt
request
  -> Hono middleware
  -> Better Auth user or OAuth bearer user
  -> /rooms/:room
  -> doName = subject:{user.id}:rooms:{room}
  -> Room Durable Object
```

This works for one-person hosted sync. It is not the right boundary for self-hosting, org extraction, realm export, custom domains, or key custody changes.

### Problems

1. **User id is not the portability boundary**: A user can belong to several workspaces, teams, or hosted domains. A user id does not answer "what can be exported together?"
2. **Organization is too policy-shaped**: Better Auth organizations own members, invitations, teams, and roles. They do not naturally own encrypted Yjs room histories, export manifests, hostnames, or deployment migration.
3. **Workspace is too small**: A workspace is the product data container users open. A self-hosted server or org domain usually owns many workspaces.
4. **Durable Object is too runtime-specific**: Cloudflare Durable Objects are excellent room actors, but self-hosting needs a portable actor interface.
5. **One DO per org would bottleneck**: Durable Objects should model the smallest coordination atom, such as a room, not an entire realm.

### Desired State

Use this noun stack:

```txt
Deployment
  where code runs, secrets live, and storage is hosted

Realm
  portable trust, admin, key, and export boundary

User
  human auth record

RealmMember
  user membership and coarse role inside a realm

Workspace
  product data container inside a realm

Y.Doc / sync doc
  app-owned replicated data stream inside a workspace

Room actor
  live sync runtime for one sync doc
```

The shortest rule:

```txt
Realm owns boundaries.
Workspace owns product data.
Room owns live sync.
```

## Research Findings

### Local API Shape

The current API creates the DB connection, Better Auth instance, and credential normalization as global Hono middleware before route handling. `/rooms/*` is OAuth-only and `getRoomStub()` builds a subject-scoped DO name from `c.var.user.id`.

Evidence:

```txt
apps/api/src/app.ts
  per-request pg.Client and Drizzle db
  per-request Better Auth instance
  /rooms/* requireOAuthUser
  getRoomStub() -> subject:{user.id}:rooms:{room}

apps/api/src/room.ts
  Room Durable Object trusts the Worker auth boundary
  Room owns WebSockets, Yjs sync, awareness, dispatch, and SQLite update storage

apps/api/src/db/schema.ts
  durable_object_instance tracks doName, userId, resourceName, and storage bytes
```

Implication: Realm is a real boundary change. It must be resolved before room lookup, included in DO names, stored in DO tracking rows, and used in access checks.

### Cloudflare Durable Objects

DeepWiki on `cloudflare/cloudflare-docs` confirmed the useful platform shape:

```txt
Durable Object
  named, globally unique instance
  single-threaded coordination
  persistent storage
  WebSocket hibernation
  SQLite-backed storage for new classes
```

Key finding: the Durable Object should model the atom of coordination. For Epicenter, that atom is one room actor for one replicated Yjs stream, not one whole realm.

Implication: use realm-prefixed DO names, but do not store the realm control plane inside one Realm DO.

### Better Auth Organizations

DeepWiki and official Better Auth organization docs agree that the organization plugin owns:

```txt
organizations
members
invitations
teams
roles and permissions
session.activeOrganizationId
```

Organizations are optional. `activeOrganizationId` can be null.

Implication: skip Better Auth organizations until org admin surfaces need them. If they become useful, link them to a Realm rather than making them the data boundary:

```txt
realm_auth_link
  realm_id
  provider: better_auth_organization
  external_id: org_acme
```

### Hono Routing

DeepWiki on `honojs/hono` pointed at two useful realm-resolution patterns:

```txt
1. Middleware
   resolve realm from route or host
   set c.var.realm before auth and room dispatch

2. getPath / host-aware routing
   rewrite routing path from hostname before route matching
```

Implication: first implementation should resolve `realmId` from the route. Hostname resolution can be an attachment later.

### Yjs And Providers

DeepWiki on `yjs/yjs`, `yjs/y-protocols`, and `yjs/y-indexeddb` reinforced that these identities should stay separate:

```txt
Y.Doc guid
  replicated document identity

provider room name
  transport selection string

IndexedDB name
  local persistence name

Awareness clientID
  ephemeral peer identity
```

Implication: do not make a `sync_doc` table in the first realm migration unless the server must list or authorize docs independently. Use stable `ydoc.guid` values and derive room actor names from `{ realmId, workspaceId, ydocGuid }`.

### Key Management

Current docs say Epicenter uses server-managed encryption, not user-held end-to-end encryption. The server derives per-subject keys from `ENCRYPTION_SECRETS`; the client derives per-workspace keys locally with `workspace:{workspaceId}` HKDF info.

Signal and Bitwarden patterns point toward layered key hierarchy and versioned rotation rather than one universal key.

Implication: keep `key_mode` as the only key-policy field now:

```txt
server_managed
  current hosted behavior

user_held
  future E2E mode where the server cannot derive workspace keys

realm_managed
  future self-host mode where the realm operator holds server-side keys
```

Do not add a full `realm_key_policy` table until there are multiple concrete key modes.

### Drizzle And Turso

DeepWiki on Drizzle supports using SQL schemas, foreign keys, generated migrations, and check constraints as the control plane. DeepWiki on Turso/libSQL suggests embedded databases and syncable local files can be useful for self-host and local-first SQL surfaces.

Implication: keep the first Realm control plane in Postgres for hosted Cloudflare. Self-hosting may use Postgres or SQLite/libSQL later behind an adapter, but Realm metadata should remain relational, not hidden in room actors.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Portable boundary | 2 coherence | `Realm` | It answers trust, admin, key, export, and custom-hosting questions better than user, org, workspace, or room |
| Product data boundary | 2 coherence | `Workspace` | Users open workspaces; workspaces belong to realms |
| Live sync boundary | 1 evidence | Room actor per replicated stream | Cloudflare DO guidance favors one actor per coordination atom; local `Room` already owns this runtime |
| Control plane storage | 2 coherence | SQL | Realm, membership, workspace, and room registry need queries, joins, admin screens, export lists, and migration history |
| Data plane storage | 1 evidence | Room actors | Existing DOs already own Yjs update logs and WebSockets |
| Better Auth organizations | Deferred | Do not enable yet | Realm membership covers the 80 percent path; Better Auth orgs can attach later as policy providers |
| Realm kind | 2 coherence | No `kind` column | Personal vs team is member count and role shape, not a durable category |
| Realm role model | 3 taste | `owner | member` only | Enough to administer or use a realm without creating a permission engine |
| Hostnames | Deferred | Route `realmId` first | Custom domains can attach later; they should not shape first migration |
| Key policy | 3 taste | `key_mode` column only | Key custody matters enough to name, but not enough yet for a separate table |
| Billing | Deferred | Keep user billing for now | Realm billing is likely, but not required for the first boundary change |
| Sync doc table | Deferred | No first-wave table | Let apps choose `ydoc.guid`; add SQL only when server-side listing or authorization needs it |
| Room table | 2 coherence | No first-class room table | Room names are derived runtime addresses; telemetry belongs in `durable_object_instance` |

## Architecture

### Minimal Cardinality

```txt
Deployment 1 --- * Realm

User 1 --- * RealmMember * --- 1 Realm

Realm 1 --- * Workspace

Workspace 1 --- * Y.Doc

Y.Doc 1 --- 1 RoomActor
```

### Control Plane And Data Plane

```txt
Control plane: SQL
  realm
  realm_member
  workspace
  durable_object_instance

Data plane: room actors
  WebSocket sessions
  Yjs sync
  awareness
  dispatch
  update log

Blob plane: object storage
  realm/{realmId}/workspace/{workspaceId}/assets/{assetId}
```

Hosted Cloudflare:

```txt
Worker / Hono
  -> Postgres control plane
  -> Room Durable Objects
  -> R2 assets
```

Self-hosted:

```txt
Bun or Node server
  -> Postgres or SQLite/libSQL control plane
  -> portable room actor adapter
  -> filesystem or S3-compatible assets
```

### Minimal Schema

```txt
realm
  id text primary key
  name text not null
  key_mode text not null default 'server_managed'
  created_by_user_id text not null references user(id)
  created_at timestamp not null
  updated_at timestamp not null

realm_member
  realm_id text not null references realm(id)
  user_id text not null references user(id)
  role text not null
  created_at timestamp not null
  primary key (realm_id, user_id)

workspace
  id text primary key
  realm_id text not null references realm(id)
  name text not null
  created_at timestamp not null
  updated_at timestamp not null

durable_object_instance
  realm_id text not null references realm(id)
  workspace_id text null references workspace(id)
  ydoc_guid text null
  do_name text primary key
  storage_bytes bigint null
  created_at timestamp not null
  last_accessed_at timestamp not null
  storage_measured_at timestamp null
```

Role values:

```txt
owner
  manage realm members
  create and delete workspaces
  export realm
  change key mode later
  manage billing later

member
  enter realm
  open workspaces
  sync data
```

First wave workspace access rule:

```txt
if principal has realm_member row:
  allow workspace access
```

Later workspace-specific grants can attach below workspace if needed:

```txt
workspace_grant
  workspace_id
  user_id or realm_member_id
  role: editor | viewer
```

### Route And DO Names

First route shape:

```txt
/realms/:realmId/workspaces/:workspaceId/rooms/:ydocGuid
```

Room actor name:

```txt
realm:{realmId}:workspaces:{workspaceId}:ydocs:{ydocGuid}
```

Request flow:

```txt
request
  -> resolve principal
  -> load realm
  -> check realm_member
  -> load workspace by { realmId, workspaceId }
  -> build room actor name from { realmId, workspaceId, ydocGuid }
  -> dispatch to room actor
```

### Hosting Shapes

One cloud deployment hosting many realms:

```txt
Epicenter Cloud deployment
  ├─ realm_braden
  │    └─ workspaces...
  ├─ realm_acme
  │    └─ workspaces...
  └─ realm_beta
       └─ workspaces...
```

Self-host deployment hosting several small realms:

```txt
Acme self-host deployment
  ├─ realm_acme_main
  ├─ realm_acme_lab
  └─ realm_acme_archive
```

Extracted realm:

```txt
Before:
  Epicenter Cloud
    └─ realm_acme

After:
  Acme deployment
    └─ realm_acme

Move:
  SQL control rows
  room actor snapshots or update logs
  assets
  key material or user-held keys
  hostname routing
```

## Grill Notes

### Should Each Realm Be A Separate Server?

Recommended answer: no.

```txt
Default:
  one deployment hosts many realms

When needed:
  one realm can be exported into its own deployment
```

Separate server per realm gives strong isolation, but it raises setup cost, ops burden, idle cost, monitoring surface, and upgrade complexity for small teams. The asymmetric win is to make Realm exportable without forcing every realm to be physically isolated.

### Should A Realm Be Stored Inside One Durable Object?

Recommended answer: no.

One Realm DO would serialize admin, dashboard, export, membership, and room listing through one actor. It would also make self-hosting depend on emulating a Cloudflare-specific hierarchy.

Use SQL for the realm control plane. Use room actors for live sync.

### Should A Realm Hub DO Exist?

Recommended answer: defer.

A Realm Hub actor may later coordinate export jobs, key rotation, traffic limits, or cached metadata. It should not be canonical storage in the first implementation.

### Should Better Auth Organizations Be Required?

Recommended answer: no.

Realm membership gives Epicenter the minimal access model. Better Auth organizations can attach later when built-in invitations, org roles, teams, or `activeOrganizationId` become valuable enough to pay for the extra noun.

### Should `key_mode` Exist Now?

Recommended answer: yes, but only as a column.

Key custody changes behavior at the deepest trust boundary. A realm with server-managed keys is not the same product promise as a realm with user-held keys. Do not build every mode now, but leave a named place for the distinction.

### Should We Keep "Root Y.Doc" In The Architecture?

Recommended answer: no.

Do not make root and child Y.Docs product nouns. Say:

```txt
Workspace state may live in one Y.Doc.
Large or isolated product objects may use their own Y.Docs.
Every synced Y.Doc has a room actor.
```

## Implementation Plan

### Phase 1: Realm Control Plane

- [ ] **1.1** Add `realm`, `realm_member`, and `workspace` tables.
- [ ] **1.2** Add `realm_id`, `workspace_id`, and `ydoc_guid` to `durable_object_instance`.
- [ ] **1.3** Create a personal realm for a user at signup or first session bootstrap.
- [ ] **1.4** Create a default workspace inside the personal realm.
- [ ] **1.5** Return default realm/workspace metadata from `/api/session` or a new realm endpoint.

### Phase 2: Realm-Scoped Room Routes

- [ ] **2.1** Add `/realms/:realmId/workspaces/:workspaceId/rooms/:ydocGuid`.
- [ ] **2.2** Authorize the principal through `realm_member`.
- [ ] **2.3** Verify `workspace.realm_id == realm.id`.
- [ ] **2.4** Build DO names as `realm:{realmId}:workspaces:{workspaceId}:ydocs:{ydocGuid}`.
- [ ] **2.5** Update DO tracking rows with realm and workspace identity.

### Phase 3: Client Session And URL Wiring

- [ ] **3.1** Teach clients to receive or choose an active realm and workspace.
- [ ] **3.2** Add realm/workspace-aware room URL construction.
- [ ] **3.3** Keep old `/rooms/:room` route available during migration.
- [ ] **3.4** Add exact-string tests for route URLs and DO names.

### Phase 4: Migration From Subject-Scoped Rooms

- [ ] **4.1** Decide whether to migrate old DO storage or intentionally discard remote history.
- [ ] **4.2** If migrating, map old `subject:{userId}:rooms:{room}` to default realm/workspace room names.
- [ ] **4.3** If discarding, rely on local IndexedDB clients to re-upload current state.
- [ ] **4.4** Remove old `/rooms/:room` only after new route smoke tests pass.

### Phase 5: Self-Host Adapter Alignment

- [ ] **5.1** Define a portable room actor interface above Cloudflare Durable Objects.
- [ ] **5.2** Implement Cloudflare adapter using Room DOs.
- [ ] **5.3** Implement self-host adapter using local process actors and SQLite files.
- [ ] **5.4** Add realm export/import format for control rows, room snapshots, assets, and key metadata.

## Edge Cases

### Personal Realm Becomes Team Realm

1. Realm starts with one owner member.
2. Owner invites another user through a future invite flow.
3. `realm_member` gains another row.
4. No realm kind changes.
5. Workspace ids and room names stay stable.

### Realm Moves To Self-Host

1. User exports realm metadata, room snapshots, assets, and key material or key requirements.
2. Self-host deployment imports the realm.
3. New deployment serves the same realm id.
4. Clients switch base URL or hostname.
5. Workspace ids and room names can stay stable if the target preserves realm id.

### Many Realms In One Self-Host

1. A self-hosted deployment has one control database.
2. It hosts several realms.
3. Each room actor name includes the realm id.
4. Export can target one realm without moving the whole deployment.

### User-Held E2E Realm

1. Realm key mode is `user_held`.
2. Server can authenticate and relay.
3. Server cannot derive workspace keys.
4. Export can move ciphertext without secret export, but users must retain keys.

### Billing Before Realm Billing Exists

1. User belongs to a realm.
2. Hosted AI usage still bills the user through current Autumn customer ids.
3. Realm billing is added later with a billing attachment.
4. Room names and workspace ids do not include billing ids.

## Open Questions

1. **Should `key_mode` be in the first migration?**
   - Options: add `key_mode`, hardcode server-managed behavior, or defer key modeling entirely.
   - Recommendation: add `key_mode` with one supported value. It records the trust boundary without building all modes.

2. **Should `/api/session` return active realm and workspace?**
   - Options: include defaults in session, add `/api/realms`, or make clients call a workspace endpoint after sign-in.
   - Recommendation: add a small realm endpoint if session projection starts growing too much.

3. **Should `ydocGuid` be validated against SQL?**
   - Options: trust route ids after workspace access, add `sync_doc`, or store a manifest in workspace state.
   - Recommendation: trust route ids first. Add `sync_doc` only when server-side listing, quotas, delete, or export needs exact docs.

4. **Should self-host v1 use Postgres or SQLite/libSQL for the control plane?**
   - Options: Postgres only, SQLite/libSQL only, or adapter.
   - Recommendation: keep hosted Postgres first; align self-host with the existing self-host spec when implementation starts.

5. **Should realm ids survive export/import?**
   - Options: preserve ids, remap ids, or allow either.
   - Recommendation: preserve ids by default. Remap only for conflict import.

## Success Criteria

- [ ] The spec can be summarized as: Realm owns boundaries, Workspace owns product data, Room owns live sync.
- [ ] No first-wave table has `owner_user_id` or `owner_organization_id`.
- [ ] No first-wave table uses `realm.kind`.
- [ ] Room actor names include `realmId`, `workspaceId`, and `ydocGuid`.
- [ ] SQL can list every room actor needed to export one realm.
- [ ] Better Auth organizations are not required for personal realms or first-wave team realms.
- [ ] Self-hosting can host multiple realms in one deployment.
- [ ] One realm can be exported without exporting the whole deployment.

## References

- `specs/20260519T155705-workspace-noun-clean-break.md` for the previous Workspace-centered model.
- `specs/20260514T220000-self-host-first-class.md` for the same-source self-host direction.
- `apps/api/src/app.ts` for current subject-scoped `/rooms/:room` routing and DO lookup.
- `apps/api/src/room.ts` for current Room Durable Object responsibilities.
- `apps/api/src/db/schema.ts` for current `durable_object_instance` shape.
- `docs/encryption.md` for current server-managed key hierarchy.
- DeepWiki: `cloudflare/cloudflare-docs` on Durable Objects as named stateful actors with WebSocket hibernation and SQLite storage.
- DeepWiki: `better-auth/better-auth` on optional organizations, members, invitations, roles, teams, and `activeOrganizationId`.
- DeepWiki: `honojs/hono` on middleware and host-aware routing.
- DeepWiki: `yjs/yjs`, `yjs/y-protocols`, and `yjs/y-indexeddb` on Y.Doc identity, provider room names, awareness, and persistence names.
- DeepWiki: `drizzle-team/drizzle-orm` and `tursodatabase/turso` on relational schema, migrations, and portable local database boundaries.
