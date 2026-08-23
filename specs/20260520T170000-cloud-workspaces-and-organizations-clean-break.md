# Cloud Workspaces And Organizations Clean Break

**Date**: 2026-05-20
**Status**: Draft

> **Superseded, 2026-05-22:** The cloud-workspace and organization-as-content-container model this spec designs was reverted by `specs/20260522T160000-revert-cloud-workspace-sync-layer.md`. A cloud document is now owned by `subject:${userId}` and synced through the single route `/rooms/:room`; the organization concept moves to a future tenancy and billing layer that never owns a document. Read this spec as historical context only.

Superseded note, 2026-05-20: `specs/20260520T190000-cloud-workspace-app-instance-clean-break.md` supersedes this spec for Epicenter Cloud product hierarchy, ownership, billing, and public sync routes. This spec is still useful for the reasoning that SyncEngine stays generic, roomName is host-built and opaque, read-only Yjs sync needs frame filtering, and current server-managed key custody must not be called E2E. Do not implement `workspace.owner_user_id`, `workspace.owner_organization_id`, custom `workspace_member`, or `/workspaces/:workspaceId/docs/:docId` from this spec as the active Cloud plan. The active Cloud plan is: Better Auth organization backs Cloud Workspace, Better Auth member backs Workspace membership, the App Namespace (`workspaceId + appId`) is the sync namespace with the app root Y.Doc owning app data (no `app_instance` table), and `/me/apps/:appId/docs/:docId` is the sync route, where the server resolves the default workspace from the auth token instead of the client naming a workspaceId.

## Overview

Epicenter Cloud should go all in on Workspaces as the data boundary and Organizations as the team, policy, and billing boundary. The sync engine stays generic: hosts authorize access, build opaque room names, and pass Yjs bytes to the room backend.

This spec consolidates the long-term Cloud direction from the recent project, workspace, room, subject, realm, portability, and sync-engine specs. It keeps the useful parts, refuses the split-brain parts, and gives the implementation a single sentence to optimize around.

## One Sentence

Epicenter Cloud syncs Workspace data; Workspaces grant data access; Organizations manage team membership, admin policy, and billing; Rooms are internal sync machinery.

## Gentle Mental Model

Start here. This is the model the whole system should make easy to remember.

```txt
User =
  a human account

Organization =
  a team, company, or admin/billing group

Workspace =
  the actual data container

Sync doc =
  one Yjs document inside a workspace

Room =
  the live runtime actor that syncs one sync doc

Host =
  Cloud, self-host, Tauri, or another runtime that authenticates and authorizes
```

The friendly version:

```txt
Personal user:
  "My stuff" lives in my personal workspace.

Casual team:
  "Our shared stuff" lives in a team workspace.

Cloud:
  checks who may open the workspace.

Room:
  just syncs bytes once Cloud already approved the request.
```

The maintenance-cost version:

```txt
One access path:
  workspace access check
    -> host builds roomName
    -> generic sync engine

Not three paths:
  personal sync
  org sync
  shared sync
```

## What This Supersedes Or Builds On

This spec is not replacing every previous spec. It is the Cloud product/access layer that sits above them.

```txt
Builds on:
  specs/20260519T150000-epicenter-project-as-first-class.md
    project config and local project boundary

  specs/20260520T001032-workspace-capsule-clean-break.md
    Workspace as portable data capsule

  specs/20260520T130000-workspace-portability-design-brief.md
    portability, archive, encryption, self-host pressure tests

  specs/20260520T114537-epicenter-sync-engine-host-composition.md
    host-owned authorization and roomName construction

  specs/20260519T085954-api-session-clean-break.md
    /api/session as authenticated session projection

Supersedes for Cloud ownership/access:
  specs/20260519T155705-workspace-noun-clean-break.md
    keeps the Workspace direction, but tightens Cloud access and owner modeling

  specs/20260519T231845-realm-boundary-clean-break.md
    rejects Realm as the main product layer

  specs/20260519T160000-subject-principal-surface.md
    keeps subject as auth/crypto vocabulary only, not room-name ownership

Keeps as historical context:
  specs/20260519T113632-epicenter-project-root-single-marker.md
    older project-marker direction, superseded by epicenter.config.ts
```

## Current State

The current Cloud API is still subject-scoped.

```txt
request
  -> Better Auth user
  -> /rooms/:room
  -> roomName = subject:{user.id}:rooms:{room}
  -> Room Durable Object
```

Current schema has user-owned storage facts:

```txt
durable_object_instance
  user_id
  resource_name
  do_name
  storage_bytes

asset
  id
  user_id
  content_type
  size_bytes
  original_name
```

That works for personal sync. It is not the right long-term Cloud model.

The desired Cloud model is workspace-scoped:

```txt
request
  -> authenticate user
  -> resolve workspace
  -> check workspace access
  -> build internal roomName
  -> Room Durable Object
```

## The Core Boundary

The important clean break is not just a URL. It is ownership.

```txt
Workspace owns:
  app data
  sync docs
  assets
  export identity
  encryption policy
  access grants

Organization owns:
  members
  invitations
  roles
  team settings
  billing
  admin policy

Room owns:
  WebSocket peers
  Yjs update handling
  awareness
  dispatch
  room-local persistence

Sync engine owns:
  Yjs HTTP sync response framing
  snapshot response framing
  no auth
  no Better Auth
  no organizations
  no workspace policy
```

This is the main rule:

```txt
Clients request workspace resources.
Hosts authorize workspace resources.
Hosts build room names.
Rooms sync bytes.
```

## Why Go All In On Workspaces

Workspace is the one noun that can serve solo users, casual teams, self-hosting, and export/import without changing shape.

```txt
Personal:
  workspace owner = user

Casual team:
  workspace owner = organization

Self-host:
  workspace owner = local user, local org, or imported owner

Enterprise:
  workspace owner = organization or external policy group
```

The sync path stays the same:

```txt
/workspaces/:workspaceId/docs/:docId
  -> check access
  -> build roomName
  -> sync
```

Only the policy check changes.

```txt
Personal workspace:
  user has workspace_member row

Organization workspace:
  user has workspace_member row
  organization role may allow admin actions

Self-host workspace:
  host maps its own auth/IAM into workspace_member or local policy
```

That is the asymmetric win.

```txt
Refuse:
  separate personal, org, shared, and self-host sync paths

Keep:
  one workspace access resolver
  one roomName construction point
  one generic sync engine
```

## Workspaces Versus Organizations

This is the easiest place to drift, so say it plainly.

```txt
Workspace =
  where data lives

Organization =
  who manages people and billing
```

Bad mental model:

```txt
Organization owns sync rooms.
User owns personal sync rooms.
Workspace owns some other data.
Room owns runtime data.
```

That creates four ownership stories.

Good mental model:

```txt
Workspace owns data.
Organization may own a Workspace.
User may own a Workspace.
Room syncs one doc inside a Workspace.
```

The difference is small in prose and huge in maintenance cost.

## Should Every User Be A Fake Organization?

This is the tempting option because it makes SQL look simple.

```txt
workspace
  owner_organization_id not null
```

Every solo user would get a hidden personal organization. Then team and personal ownership share one foreign key.

This deletes one SQL shape, but it creates a product and auth shape:

```txt
Every user must have an organization.
Better Auth organization plugin becomes required for personal use.
activeOrganizationId starts looking like the app data switcher.
Personal accounts inherit team concepts like members and invitations.
Self-host single-user mode has to create a team-shaped row.
```

That is probably not the right first clean break.

The better Cloud shape is:

```txt
Users can own Workspaces.
Organizations can own Workspaces.
Workspace access always resolves through workspace_member.
Organizations are real when team features are real.
```

So the product goes all in on Workspaces and Organizations without making solo users pretend to be organizations.

## SQL Owner Shape

There are four realistic choices.

### Option A: Polymorphic Owner Columns

```txt
workspace
  id
  owner_type = 'user' | 'organization'
  owner_id
```

Good:

```txt
TypeScript shape is simple.
Only one owner id field.
```

Bad:

```txt
Postgres cannot enforce owner_id references both user.id and organization.id.
Deletes and migrations need custom cleanup.
Bad rows are possible unless every write path is perfect.
```

Verdict:

```txt
Reject.
```

This is too soft for the core data boundary.

### Option B: Every User Has A Personal Organization

```txt
workspace
  owner_organization_id references organization(id)
```

Good:

```txt
One owner FK.
One organization membership model.
Common SaaS pattern.
```

Bad:

```txt
Creates fake organizations for solo users.
Makes Better Auth organization plugin mandatory.
Conflates personal account state with team admin state.
Pushes activeOrganizationId toward becoming activeWorkspaceId.
Makes self-host single-user mode team-shaped for no product reason.
```

Verdict:

```txt
Reject for the first clean break.
```

This may be defensible for a purely team-first SaaS. Epicenter is not that. It is local-first, personal-friendly, team-capable, and self-hostable.

### Option C: First-Class Owner Account Table

```txt
workspace_owner
  id
  kind = 'user' | 'organization'
  user_id nullable references user(id)
  organization_id nullable references organization(id)

workspace
  owner_id references workspace_owner(id)
```

Good:

```txt
One workspace owner FK.
Can add billing and custody metadata near owner.
Avoids fake Better Auth organizations.
```

Bad:

```txt
Adds a new noun.
Can become "Realm" under another name.
Duplicates concepts already present in user, organization, billing, and workspace.
Implementers now ask whether owner, organization, billing account, or workspace owns a policy.
```

Verdict:

```txt
Defer.
```

Add this only if owner-level billing/custody grows enough to earn its own table. Do not create it just to avoid two nullable columns.

### Option D: Two Nullable Owner FKs With One Check Constraint

```txt
workspace
  id
  owner_user_id nullable references user(id)
  owner_organization_id nullable references organization(id)
  check exactly one owner column is non-null
```

Domain code exposes:

```ts
type WorkspaceOwner =
  | { type: 'user'; id: string }
  | { type: 'organization'; id: string };
```

Good:

```txt
Postgres enforces real owners.
No fake organization rows.
Better Auth organization plugin can stay optional until team features exist.
TypeScript still gets a clean discriminated union.
Self-host can support personal workspaces without team scaffolding.
```

Bad:

```txt
Some admin queries need coalesce or two joins.
Ownership transfer from user to organization updates two columns.
```

Verdict:

```txt
Choose this.
```

The tiny SQL awkwardness buys real referential integrity and avoids a fake organization layer.

## Access Policy Shape

The cleanest maintenance move is to make `workspace_member` the sync access source of truth.

`workspace_member` is a materialized access grant, not a live view over Better Auth organization membership. This matters. The hot sync path should not join against Better Auth `member` rows or interpret `activeOrganizationId`.

```txt
workspace_member
  workspace_id
  user_id
  role = owner | admin | editor | viewer
  source = owner | direct | organization | import
```

`source` is provenance.

```txt
source = organization
  means an org policy or org workflow created this workspace_member row
  does not mean sync access is derived from org membership at read time
```

Every user who can open a workspace has a row.

```txt
Personal workspace:
  workspace.owner_user_id = Braden
  workspace_member(Braden, owner)

Team workspace:
  workspace.owner_organization_id = Acme
  workspace_member(Braden, owner)
  workspace_member(Alice, editor)
  workspace_member(Sam, viewer)
```

Then the hot sync check is boring:

```txt
Can user sync workspace?
  SELECT role
  FROM workspace_member
  WHERE workspace_id = ?
    AND user_id = ?
```

That is the maintenance win.

Organization membership is still useful, but it is not the hot sync check.

```txt
Better Auth organization membership answers:
  can this user administer the organization?
  can this user invite members?
  can this user create workspaces under the org?
  can this user manage billing?

workspace_member answers:
  can this user open this workspace data?
  what can this user do inside the workspace?
```

Why not derive sync access directly from organization membership?

```txt
Because not every org member should necessarily access every workspace.
Because workspace sharing and future guests need the same access path.
Because removing a user from one workspace should not require changing org membership.
Because self-host IAM can map into workspace_member without copying Better Auth org semantics.
```

Organization membership can still seed workspace members.

```txt
create org workspace
  -> creator gets workspace owner role

invite user to org
  -> optional product flow asks which workspaces they should join

org admin creates default workspace
  -> product may add all current org members as workspace_member rows
```

But the invariant stays:

```txt
Sync opens only through workspace_member.
```

Organization membership changes must update workspace_member rows in the same product operation or enqueue a reconciliation job before access is considered revoked. Otherwise the system says one thing in the org UI while the sync route enforces another.

## Routes

The long-term Cloud route should be workspace-first.

```txt
GET    /workspaces/:workspaceId/docs/:docId
POST   /workspaces/:workspaceId/docs/:docId
WS     /workspaces/:workspaceId/docs/:docId
POST   /workspaces/:workspaceId/docs/:docId/dispatch
GET    /workspaces/:workspaceId/assets/:assetId
PUT    /workspaces/:workspaceId/assets/:assetId
DELETE /workspaces/:workspaceId/assets/:assetId
GET    /workspaces/:workspaceId/members
POST   /workspaces/:workspaceId/members
PATCH  /workspaces/:workspaceId/members/:userId
DELETE /workspaces/:workspaceId/members/:userId
```

Why does `docs` exist?

Because a workspace will have more than syncable Yjs docs.

```txt
/workspaces/:workspaceId/docs/:docId
/workspaces/:workspaceId/docs/:docId/dispatch
/workspaces/:workspaceId/assets/:assetId
/workspaces/:workspaceId/members
/workspaces/:workspaceId/invites
/workspaces/:workspaceId/exports
/workspaces/:workspaceId/checkpoints
```

Without `docs`, this gets cramped:

```txt
/workspaces/:workspaceId/:thingId
```

Now `thingId` might be a doc, asset, export, member, or action. That is cheap on day one and expensive later.

`docs` is a route namespace, not necessarily user-facing copy. In product UI, an app can call the thing a transcript, note, recording, table, tab graph, or project. The Cloud route uses `docs` for the syncable Yjs unit.

Concrete route contract:

```txt
/workspaces/:workspaceId/docs/:docId
  GET returns a snapshot/bootstrap response for authorized readers.
  POST accepts HTTP sync updates for authorized editors.
  WS upgrades to live sync for authorized editors.

/workspaces/:workspaceId/docs/:docId/dispatch
  POST sends collaboration RPC or live-device commands for authorized members.
  It uses the same workspace/doc authorization and roomName builder as sync.

/workspaces/:workspaceId/assets/:assetId
  GET downloads or reads metadata for authorized readers.
  PUT uploads or replaces content for authorized editors.
  DELETE removes content for workspace admins or owners.

/workspaces/:workspaceId/members
  GET lists explicit workspace grants.
  POST/PATCH/DELETE mutates explicit workspace grants.
```

Organization routes stay separate because they are admin surfaces.

```txt
/organizations/:organizationId/members
  manages organization membership

/workspaces/:workspaceId/members
  manages workspace data access
```

An organization admin page may link to a workspace members page, and an org workflow may create `workspace_member` rows. The route still mutates workspace access rows, not live sync access through org membership.

## docId Versus roomName

These are not the same concept.

```txt
docId =
  app or platform id for one syncable Yjs document inside a workspace

roomName =
  internal host-built sync address for the runtime room
```

They may contain the same visible token, but they must not share ownership.

Good:

```txt
client asks:
  /workspaces/ws_123/docs/transcript_456

host checks:
  user can sync ws_123

host builds:
  roomName = v1:workspace:ws_123:doc:transcript_456

sync engine receives:
  roomName
  bytes
```

Bad:

```txt
client sends:
  roomName = workspace:ws_123:docs:transcript_456

sync engine decides:
  this looks valid
```

The roomName is an internal address after authorization. It is not a public credential and not a user-owned string.

Do not construct room names by pasting raw route params into a delimiter string. Use one host-owned builder and encode each part.

```ts
function buildWorkspaceRoomName(input: {
  workspaceId: string;
  docId: string;
}): string {
  return [
    'v1',
    'workspace',
    encodeRoomNamePart(input.workspaceId),
    'doc',
    encodeRoomNamePart(input.docId),
  ].join(':');
}
```

`roomName` is never parsed for auth. The encoding exists to prevent accidental collisions and to make future migration explicit.

## docId Versus Y.Doc guid

`docId` is the public document key inside a workspace. The host must also define the canonical local Yjs document identity used by clients.

Canonical rule:

```txt
syncDocIdentity =
  workspaceId + "/" + docId

Y.Doc.guid =
  syncDocIdentity, or a documented legacy guid mapped to it

IndexedDB and BroadcastChannel names =
  owner-scoped syncDocIdentity

roomName =
  host-built internal address derived from syncDocIdentity after authorization
```

Use the same `syncDocIdentity` for every local name that identifies this sync document. Do not let each package invent a separate local identity.

```txt
Good:
  workspaceId = ws_123
  docId = transcript_456
  syncDocIdentity = ws_123/transcript_456
  Y.Doc.guid = ws_123/transcript_456
  IndexedDB = epicenter:yjs:ws_123/transcript_456
  BroadcastChannel = epicenter:yjs:ws_123/transcript_456
  roomName = buildWorkspaceRoomName(ws_123, transcript_456)

Bad:
  docId = transcript_456
  Y.Doc.guid = random uuid
  IndexedDB = transcript_456
  BroadcastChannel = subject:user_123:rooms:transcript_456
  roomName = transcript_456
```

The sync protocol does not carry `workspaceId`, `docId`, or `Y.Doc.guid` as an authorization boundary. If a client sends updates to the wrong URL, the selected room will apply those bytes. Correctness depends on the host-built URL and roomName being derived from the same canonical sync doc identity.

## Public API Shape

The Cloud product API should look like this over time:

```txt
/api/session
  current account and local identity projection

/workspaces
  list workspaces visible to current user
  create personal or org-owned workspace

/workspaces/:workspaceId
  read and update workspace metadata

/workspaces/:workspaceId/docs/:docId
  GET snapshot bootstrap or WebSocket upgrade
  POST HTTP sync

/workspaces/:workspaceId/docs/:docId/dispatch
  POST live-device dispatch when the doc uses collaboration RPC

/workspaces/:workspaceId/assets/:assetId
  upload, download, metadata, delete

/workspaces/:workspaceId/members
  explicit workspace access rows

/organizations
  list organizations the user can administer or belong to

/organizations/:organizationId
  team settings

/organizations/:organizationId/members
  org membership and roles

/organizations/:organizationId/billing
  billing and entitlements

/organizations/:organizationId/workspaces
  workspaces owned by this organization
```

This gives users a simple story.

```txt
Open a workspace to do work.
Open an organization to manage the team.
```

## Cloud Request Flow

Sync flow:

```txt
request
  -> authenticate user or OAuth bearer
  -> parse workspaceId and docId
  -> resolve workspace
  -> check workspace_member
  -> build roomName
  -> call rooms.handleWebSocket or sync.handleHttpSync
  -> record storageBytes against workspace/doc
```

Snapshot flow:

```txt
GET /workspaces/:workspaceId/docs/:docId
  -> authenticate user or OAuth bearer
  -> parse workspaceId and docId
  -> requireWorkspaceAccess(action = snapshot)
  -> build roomName from workspaceId and docId
  -> call sync.handleSnapshot(request, { roomName })
  -> upsert workspace_sync_doc telemetry after successful read
```

HTTP sync flow:

```txt
POST /workspaces/:workspaceId/docs/:docId
  -> authenticate user or OAuth bearer
  -> parse workspaceId and docId
  -> requireWorkspaceAccess(action = sync)
  -> build roomName from workspaceId and docId
  -> call sync.handleHttpSync(request, { roomName })
  -> update workspace_sync_doc telemetry
```

WebSocket sync flow:

```txt
WS /workspaces/:workspaceId/docs/:docId
  -> authenticate upgrade request
  -> parse workspaceId and docId
  -> requireWorkspaceAccess(action = sync)
  -> build roomName from workspaceId and docId
  -> call rooms.handleWebSocket(roomName, request)
  -> room backend handles peers, awareness, and Yjs updates
```

Dispatch flow:

```txt
POST /workspaces/:workspaceId/docs/:docId/dispatch
  -> authenticate user or OAuth bearer
  -> parse workspaceId and docId
  -> requireWorkspaceAccess(action = dispatch)
  -> build roomName from workspaceId and docId
  -> call rooms.dispatch(roomName, payload)
```

Asset access flow:

```txt
GET /workspaces/:workspaceId/assets/:assetId
  -> authenticate user or OAuth bearer
  -> requireWorkspaceAccess(action = readAsset)
  -> load workspace_asset by workspace_id and asset_id
  -> return metadata or object storage response

PUT /workspaces/:workspaceId/assets/:assetId
  -> authenticate user or OAuth bearer
  -> requireWorkspaceAccess(action = writeAsset)
  -> upsert workspace_asset by workspace_id and asset_id
  -> store bytes under a workspace-scoped object key

DELETE /workspaces/:workspaceId/assets/:assetId
  -> authenticate user or OAuth bearer
  -> requireWorkspaceAccess(action = deleteAsset)
  -> delete workspace_asset row and object bytes
```

Membership mutation flow:

```txt
POST/PATCH/DELETE /workspaces/:workspaceId/members
  -> authenticate user
  -> requireWorkspaceAccess(action = manageMembers)
  -> if workspace is org-owned, check any extra org admin policy
  -> mutate workspace_member rows
  -> update key grants or enqueue key reconciliation if encryption needs it
```

Org admin flow:

```txt
/organizations/:organizationId/*
  -> authenticate user
  -> check Better Auth organization member and role
  -> manage org members, invitations, roles, billing, and admin settings
```

Org admin may create or reconcile `workspace_member` rows as a product operation. The sync route still reads `workspace_member`; it does not join Better Auth `member` on the hot path.

Route middleware:

```txt
/workspaces/* must authenticate before route handlers.
WebSocket upgrades must still skip generic response-header middleware.
Dispatch, snapshot, HTTP sync, and WebSocket upgrade all use the same workspace access resolver and roomName builder.
```

Action split:

```txt
sync:
  check workspace_member only

org admin action:
  check Better Auth member/role for organization

workspace membership mutation:
  check workspace owner/admin
  if org-owned, optionally check Better Auth org admin policy too before mutating workspace_member
```

In code shape:

```ts
const access = await requireWorkspaceAccess(c, {
  workspaceId: c.req.param('workspaceId'),
  action: 'sync',
});

const roomName = buildWorkspaceRoomName({
  workspaceId: access.workspace.id,
  docId: c.req.param('docId'),
});

return rooms.handleWebSocket(roomName, c.req.raw);
```

The sync engine still sees only:

```ts
sync.handleHttpSync(request, { roomName });
```

## Self-Hosting Shape

Self-hosting should use the same concepts with different adapters.

```txt
Epicenter Cloud:
  Better Auth
  Postgres
  Cloudflare Durable Objects
  R2 assets
  Stripe or Autumn billing

Solo self-host:
  local account or passphrase
  SQLite or Postgres
  local room backend
  filesystem assets
  no billing

Enterprise self-host:
  SSO or IAM
  Postgres
  local or hosted room backend
  object storage
  internal billing or no billing
```

Same product model:

```txt
Workspace
  docs
  assets
  members
  keys
```

Different host policies:

```txt
Cloud host:
  checks Better Auth user and workspace_member

Solo host:
  maps local owner to workspace_member

Enterprise host:
  maps IAM group or SSO user to workspace_member
```

The generic sync package does not care.

## Schema Sketch

This is intentionally a sketch. Implementation should use Drizzle conventions and generated Better Auth schema as needed.

`owner_organization_id` can only ship when the `organization` table exists. That makes the first migration choice real. Pick one wave and keep the code honest about it.

### Migration Wave A: Personal-First

Choose this if Cloud needs the workspace boundary before team product surfaces are ready.

```txt
Wave A1, schema:
  add workspace with owner_user_id not null
  do not add owner_organization_id yet
  add workspace_member
  add workspace_sync_doc telemetry
  add workspace_asset or keep asset migration planned but not switched

Wave A2, bootstrap:
  create one personal workspace for each existing user or lazily at first session
  create workspace_member(user, owner, source = owner)
  map existing subject-scoped rooms to that personal workspace
  map existing user-owned assets to that personal workspace when asset migration runs

Wave A3, routes:
  add /workspaces/:workspaceId/docs/:docId
  keep /rooms/:room as a legacy personal route during migration
  make new clients use workspace routes
  write telemetry against workspace_id and doc_id

Wave A4, team upgrade later:
  enable Better Auth organization plugin
  generate organization/member/invitation/session.activeOrganizationId schema
  add nullable owner_organization_id
  relax owner_user_id from required to nullable
  add exact-one-owner check
  add org-owned workspace creation
```

Personal-first SQL shape:

```sql
create table workspace (
  id text primary key,
  name text not null,
  owner_user_id text not null references "user"(id) on delete cascade,
  created_by_user_id text null references "user"(id) on delete set null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
```

### Migration Wave B: Team-Ready

Choose this only if org creation, invitations, member management, and billing are in the same product wave.

```txt
Wave B1, Better Auth:
  enable Better Auth organization plugin
  generate organization/member/invitation/session.activeOrganizationId schema
  keep activeOrganizationId scoped to org admin surfaces

Wave B2, workspace schema:
  add workspace.owner_user_id nullable
  add workspace.owner_organization_id nullable
  add exact-one-owner check
  add workspace_member
  add workspace_sync_doc telemetry
  add workspace_asset or keep asset migration planned but not switched

Wave B3, bootstrap:
  create personal workspaces with owner_user_id
  create org workspaces with owner_organization_id only through team UI
  never create hidden personal organizations
  create workspace_member rows for every user who can open workspace data

Wave B4, routes:
  add workspace routes once, not separate personal and org routes
  make sync, snapshot, dispatch, and assets use the same workspace access resolver
```

Do not add a foreign key to `organization(id)` before the organization plugin schema exists.

Do not create a nullable `owner_organization_id` column that cannot be referenced yet. A dangling future column invites half-implemented checks, fake IDs, and migration conditionals.

Team-ready SQL shape:

```sql
create table workspace (
  id text primary key,
  name text not null,
  owner_user_id text null references "user"(id) on delete cascade,
  owner_organization_id text null references organization(id) on delete cascade,
  created_by_user_id text null references "user"(id) on delete set null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  check (
    (owner_user_id is not null and owner_organization_id is null)
    or
    (owner_user_id is null and owner_organization_id is not null)
  )
);

create index workspace_owner_user_id_idx on workspace(owner_user_id);
create index workspace_owner_organization_id_idx on workspace(owner_organization_id);

create table workspace_member (
  workspace_id text not null references workspace(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  role text not null,
  source text not null,
  created_at timestamp not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_member_user_id_idx on workspace_member(user_id);

create table workspace_sync_doc (
  workspace_id text not null references workspace(id) on delete cascade,
  doc_id text not null,
  app_id text null,
  created_at timestamp not null default now(),
  last_accessed_at timestamp null,
  storage_bytes bigint null,
  primary key (workspace_id, doc_id)
);

create index workspace_sync_doc_last_accessed_idx on workspace_sync_doc(last_accessed_at);

create table workspace_asset (
  id text primary key,
  workspace_id text not null references workspace(id) on delete cascade,
  content_type text not null,
  size_bytes bigint not null,
  original_name text not null,
  uploaded_by_user_id text null references "user"(id),
  uploaded_at timestamp not null default now()
);
```

Drizzle implementation note:

```ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';

export const workspace = pgTable(
  'workspace',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    ownerOrganizationId: text('owner_organization_id').references(
      () => organization.id,
      { onDelete: 'cascade' },
    ),
  },
  (table) => [
    check(
      'workspace_exactly_one_owner',
      sql`(${table.ownerUserId} is not null and ${table.ownerOrganizationId} is null)
          or (${table.ownerUserId} is null and ${table.ownerOrganizationId} is not null)`,
    ),
    index('workspace_owner_user_id_idx').on(table.ownerUserId),
    index('workspace_owner_organization_id_idx').on(table.ownerOrganizationId),
  ],
);
```

Drizzle relations will not understand the exact-one-owner invariant by themselves. Domain code should expose a discriminated `WorkspaceOwner` and validate transitions at the service boundary.

Room tracking moves from user-owned to workspace-owned.

```txt
current:
  durable_object_instance.user_id
  durable_object_instance.resource_name
  durable_object_instance.do_name

future:
  workspace_sync_doc.workspace_id
  workspace_sync_doc.doc_id
  workspace_sync_doc.storage_bytes
  roomName remains internal
```

`workspace_sync_doc` is observed inventory and telemetry, not a mandatory registry. Offline app code can create child docs before Cloud has seen them. Cloud learns about a doc when the host opens it, imports it, or an app export adapter enumerates it.

If `durable_object_instance` stays, it should become host telemetry:

```txt
durable_object_instance
  do_name primary key
  workspace_id
  doc_id
  storage_bytes
  last_accessed_at
```

It should not be the product registry.

## Role Model

Start small.

```txt
owner =
  can delete workspace
  can transfer ownership
  can manage members
  can sync and edit

admin =
  can manage members
  can sync and edit

editor =
  can sync and edit

viewer =
  can read snapshots and assets where read-only is supported
  WebSocket write-sync may be deferred
```

Read-only sync is not phase 1 unless the room backend filters mutation messages. A viewer may receive snapshots. Letting a viewer open a normal Yjs WebSocket is write access unless the protocol boundary rejects update frames.

Phase 1 can support only:

```txt
owner
editor
```

Do not add a large permission engine until a real UI needs it.

## Workspace Key Custody

Workspace owns encryption policy, but not raw key material.

Current Cloud mode:

```txt
server_managed
deployment root keyring can derive or unwrap workspace keys
not user-held end-to-end encryption
```

Future stricter mode:

```txt
user_held
server stores only wrapped workspace keys
members and devices receive key grants
server cannot derive plaintext workspace keys
```

Minimum team invariant:

```txt
A team workspace has one workspace data key or keyring.
Each authorized member/device gets a wrapped grant.
Removing access stops new sync access immediately.
Whether old ciphertext is rekeyed is an explicit policy, not implied by membership deletion.
```

Do not call this end-to-end encrypted until key custody changes. A workspace access row is not a key grant, and deleting membership does not rewrite old ciphertext.

## Billing Shape

Billing should not become a workspace ownership model.

```txt
Personal billing:
  user is billing customer

Team billing:
  organization is billing customer

Workspace usage:
  workspace may be a billing entity for metering, quota, or attribution
  workspace is not the payer by default
```

Rule:

```txt
Check entitlements or ability flags, not raw plan names.
```

## Organization Policy

Better Auth organizations are useful once Cloud has team surfaces.

They own:

```txt
organization rows
members
invitations
roles
optional teams
activeOrganizationId for org admin surfaces
```

They do not own:

```txt
workspace data identity
roomName construction
sync engine policy
workspace export completeness
workspace encryption keys
```

Organization role can grant admin powers over org-owned workspaces.

```txt
org owner/admin:
  can create workspaces under org
  can manage org billing
  may manage workspace membership depending on product policy

workspace member:
  can open workspace data according to role
```

This gives casual teams a normal SaaS flow without making sync depend on orgs.

## Refusals

These refusals are the point. Each one deletes a code family.

```txt
Refuse org-scoped rooms.
  Deletes: separate org sync namespace, org-room migration, org room docs.

Refuse client-built room names.
  Deletes: parser-as-auth, client namespace bugs, roomName privilege confusion.

Refuse separate personal and team sync routes.
  Deletes: duplicated route handlers, duplicated auth tests, duplicated docs.

Refuse fake personal organizations for phase 1.
  Deletes: mandatory org setup for solo users, activeOrganizationId-as-app-context, hidden team rows.

Refuse polymorphic owner_id without foreign keys.
  Deletes: orphan owner ids and cleanup code.

Refuse Better Auth imports in the sync engine.
  Deletes: host-specific auth coupling from reusable sync package.

Refuse sync authorization derived from live organization membership.
  Deletes: Better Auth member joins on the sync hot path, org-role drift bugs, guest-access special cases.

Refuse activeOrganizationId as app data context.
  Deletes: confusing organization switchers, accidental workspace switching, hidden personal org pressure.

Refuse docId as roomName.
  Deletes: public identifiers becoming privileged runtime addresses.

Refuse workspace_sync_doc as a required registry.
  Deletes: broken offline-created child docs, false export completeness, pre-registration flows.

Refuse dangling owner_organization_id before org tables exist.
  Deletes: fake foreign keys, nullable future columns, migration branches that cannot be enforced.

Refuse calling current Cloud encryption end-to-end.
  Deletes: misleading security claims while Cloud can still derive or unwrap workspace keys.

Refuse "complete export" unless enumeration is proven.
  Deletes: false confidence and support burden from incomplete backups.
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Cloud data boundary | 2 coherence | Workspace | It is the only noun that works for personal, team, self-host, assets, export, and sync. |
| Cloud team boundary | 2 coherence | Organization | Organizations manage people, invitations, roles, billing, and admin policy. |
| Sync engine boundary | 2 coherence | Generic roomName input | The host owns policy and naming. The engine owns sync response mechanics. |
| Workspace owner SQL | 2 coherence | Two nullable FKs with exact-one check | Keeps Postgres referential integrity without fake organization rows. |
| Hot sync access | 2 coherence | workspace_member row | One access query works for personal, team, direct sharing, and self-host mapping. |
| Better Auth orgs | 1 evidence | Optional team layer | Better Auth organization plugin has optional organizations and nullable activeOrganizationId. It owns org/member/invitation/role concepts, not app data. |
| Public sync route | 3 taste | `/workspaces/:workspaceId/docs/:docId` | Resource-first route leaves room for assets, members, exports, and checkpoints. |
| Dispatch route | 2 coherence | `/workspaces/:workspaceId/docs/:docId/dispatch` | Dispatch targets the same authorized sync doc as HTTP and WebSocket sync. |
| Asset route | 2 coherence | `/workspaces/:workspaceId/assets/:assetId` | Asset access uses workspace authorization and workspace-owned storage facts. |
| Membership route | 2 coherence | `/workspaces/:workspaceId/members` | Data access grants live under the workspace, even when an org workflow created them. |
| Room name | 2 coherence | Host-built opaque string | Prevents clients and packages from owning a privileged sync address. |
| Sync doc identity | 2 coherence | `workspaceId + "/" + docId` | Y.Doc guid, IndexedDB names, BroadcastChannel names, and roomName derivation need one canonical source. |
| Fake personal orgs | 2 coherence | Reject for phase 1 | They simplify one FK but make solo users and self-hosting team-shaped. |
| Owner account table | Deferred | Defer | It may become useful for billing/custody, but it adds a new noun before the need is real. |
| Read-only sync | Deferred | Defer | Viewer role can exist before WebSocket read-only sync is implemented. |

## Implementation Plan

### Phase 0: Spec Cleanup And Naming

- [ ] Mark `20260519T155705-workspace-noun-clean-break.md` as superseded for Cloud access by this spec.
- [ ] Mark `20260519T231845-realm-boundary-clean-break.md` as rejected for active Cloud direction.
- [ ] Keep `20260520T114537-epicenter-sync-engine-host-composition.md` as the lower-level sync engine contract.
- [ ] Keep `20260520T001032-workspace-capsule-clean-break.md` as the portability and archive boundary.

### Phase 1A: Personal-First Workspace Schema

- [ ] Add `workspace` table with required `owner_user_id`.
- [ ] Do not add `owner_organization_id` until Better Auth organization tables exist.
- [ ] Add `workspace_member` table with user role and source.
- [ ] Add `workspace_sync_doc` or equivalent telemetry table for workspace/doc storage facts.
- [ ] Move asset planning toward `workspace_asset`, but do not migrate asset URLs until a migration plan exists.
- [ ] Create a personal workspace and owner membership for each new user at first session bootstrap.

### Phase 1B: Team-Ready Workspace Schema

- [ ] Enable Better Auth organization plugin in the same wave as org-owned workspaces.
- [ ] Generate organization, member, invitation, and `activeOrganizationId` schema.
- [ ] Add nullable `workspace.owner_user_id` and nullable `workspace.owner_organization_id`.
- [ ] Add the exact-one-owner check constraint in the same migration.
- [ ] Add `workspace_member`, `workspace_sync_doc`, and workspace-owned asset planning.
- [ ] Create personal workspaces with `owner_user_id`, not fake personal organizations.
- [ ] Create org-owned workspaces only through team product flows.

Choose either Phase 1A or Phase 1B for the first implementation. Do not merge both shapes into one partial schema.

### Phase 2: Access Resolver

- [ ] Add `requireWorkspaceAccess({ workspaceId, action })`.
- [ ] Make sync authorization depend on `workspace_member`, not direct user ownership.
- [ ] Keep Better Auth organization membership out of sync access. Org workflows must materialize or reconcile `workspace_member` rows.
- [ ] Return a typed access result: `{ user, workspace, role }`.

### Phase 3: Workspace Sync Route

- [ ] Add `/workspaces/:workspaceId/docs/:docId` for snapshot, HTTP sync, and WebSocket sync.
- [ ] Add `/workspaces/:workspaceId/docs/:docId/dispatch` for collaboration RPC or live-device dispatch.
- [ ] Build room names only after `requireWorkspaceAccess` succeeds.
- [ ] Keep `/rooms/:room` during migration if needed, but mark it as legacy personal-room route.
- [ ] Record room storage usage by workspace and doc id.
- [ ] Make doc routes derive roomName from the same canonical `syncDocIdentity`.

### Phase 4: Organizations

- [ ] Enable Better Auth organization plugin only when org creation, invitations, and member management are real product surfaces.
- [ ] Allow organization-owned workspace creation.
- [ ] Create workspace_member rows for users who can access the workspace.
- [ ] Keep `activeOrganizationId` for org admin surfaces, not workspace sync routing.
- [ ] Make org membership changes reconcile `workspace_member` rows before presenting access as revoked.

### Phase 5: Assets And Export

- [ ] Move assets from user-owned rows to workspace-owned rows.
- [ ] Store assets under workspace-scoped object keys.
- [ ] Add `/workspaces/:workspaceId/assets/:assetId` for read, write, metadata, and delete.
- [ ] Define export completeness with app adapters or observed inventory.
- [ ] Do not call a workspace export complete unless doc and asset enumeration is proven.

### Phase 6: Membership And Admin

- [ ] Add `/workspaces/:workspaceId/members` for explicit workspace access grants.
- [ ] Make membership mutation require workspace owner/admin.
- [ ] For org-owned workspaces, apply any extra org admin policy before mutating `workspace_member`.
- [ ] Keep org routes focused on org members, invitations, roles, billing, and settings.

### Phase 7: Migration

- [ ] Map existing subject-scoped rooms to personal workspaces.
- [ ] Preserve room data by migration or compatibility bridge.
- [ ] Move current `asset.user_id` data into personal workspace asset rows.
- [ ] Delete the legacy `/rooms/:room` route only after workspace route migration is proven.

## Open Questions

1. Which product operations seed or reconcile `workspace_member.source = organization` rows?
2. Should org admins automatically administer all org-owned workspace membership, or should a workspace owner be able to restrict that?
3. Should personal workspace creation happen at signup, first `/api/session`, or first app open?
4. Should `docId` be app-provided, platform-derived, or both?
5. Should the public route say `docs`, `sync-docs`, or `ydocs`? Current recommendation is `docs`, but this is Class 3 taste.
6. Should workspace owner transfer preserve workspace id when moving from user to organization? Current recommendation: yes.
7. Should a personal workspace be transferable into an organization, or should the product fork it by default?
8. Should enterprise self-hosts materialize external IAM into workspace_member rows, or may they inject an adapter that returns the same `{ user, workspace, role }` access result without rows?

## Success Criteria

- [ ] Cloud has one workspace-first sync path for personal and team data.
- [ ] Sync engine has no Better Auth, organization, or workspace imports.
- [ ] No client can construct a privileged roomName.
- [ ] Personal users do not need fake organizations.
- [ ] Organization-owned workspaces use the same sync route as personal workspaces.
- [ ] Workspace access can be explained as one query against `workspace_member`.
- [ ] Assets and sync docs can be attributed to a workspace, not only a user.
- [ ] Self-host can map local auth into the same workspace access model.
- [ ] Export/import talks about workspaces, not rooms or organizations.

## Final Working Rule

Use this when evaluating future changes:

```txt
If it is data, put it under Workspace.
If it is people, roles, invitations, or billing, put it under Organization.
If it is live Yjs coordination, keep it inside Room.
If it is auth or access policy, keep it in the Host.
If it is reusable sync mechanics, keep it out of Cloud policy.
```

## Tab Manager Local Runtime And Cloud Attachment

Candidate:
  Tab Manager could expose a local-only collaboration object when Cloud sync is
  unavailable, keeping every caller on `tabManager.collaboration`.

Refusal:
  Refuse local-only collaboration. Tab Manager local runtime owns install
  identity, Y.Doc, encrypted tables, IndexedDB, local actions, and AI tools.
  Cloud collaboration is absent until a workspace sync URL exists. When present,
  it owns WebSocket sync, device liveness, reconnect, and remote dispatch.

User loss:
  When Cloud sync is unavailable, the UI has no sync status, remote devices,
  reconnect control, or remote dispatch. Local tabs, saved tabs, bookmarks,
  device registration, and AI tools still work because they use local runtime
  actions directly.

Decision:
  `openTabManagerBrowser()` returns local runtime fields and actions. A separate
  Cloud attachment opens `openCollaboration()` only for
  `/workspaces/:workspaceId/apps/:appInstanceId/docs/:docId`. Do not restore
  `/rooms/:room` fallback, local-only collaboration shims, fake devices, fake
  dispatch, or never-resolving connection promises.

Trigger to revisit:
  Revisit only when remote dispatch from another live device becomes a
  load-bearing Tab Manager workflow while Cloud workspace sync is unavailable.
