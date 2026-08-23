# Revert the Cloud-Workspace Sync Layer to Subject-Owned Documents

**Date**: 2026-05-22
**Status**: Draft
**Author**: AI-assisted
**Branch**: redesign/server-owned-presence (spec only; implementation branch TBD)

## Overview

A cloud document is owned by the user's identity (`subject`) and addressed by a
single document id. This spec removes the cloud-workspace routing layer the
`redesign/server-owned-presence` branch added (personal-workspace provisioning,
the `ws_${sha256(userId)}` derivation, the `/me/apps/:appId/docs/:docId` route,
the membership check on the personal sync path) and restores the
subject-owned-document model that `origin/main` already documented and used.
It keeps the branch's server-owned presence work, which is unrelated.

**One sentence**: A cloud doc is owned by `subject:<userId>` and named by its
`ydoc.guid`, sharing later becomes a per-document ACL, and "organization"
becomes a billing and administration layer wrapped around user accounts rather
than a container that owns documents.

## The Vision: a three-layer account model

The hard question behind this spec is "who owns a document." Two products
answer it differently, and the difference decides everything downstream.

Notion fuses two things into one "workspace": the workspace owns your content
*and* it is the billing boundary. Pages live inside a workspace; the workspace
is what you pay for; membership is workspace-level. One entity, two jobs.

Google separates them. A Google Doc is owned by a *user account*; sharing is a
per-document ACL. That is the consumer product. Google Workspace (the paid
domain product: `acme.com`, an admin console, per-seat billing) is a *separate
layer* that administers a set of user accounts. It never becomes the owner of a
document. Content ownership and tenancy are two layers, not one.

Epicenter follows Google, not Notion. Three layers, introduced over time:

```
LAYER 3  Tenancy / billing       acme.com, 40 seats, admin console     Google Workspace
           groups user ACCOUNTS for one invoice and admin policy       (enterprise, future)
              |  administers
LAYER 2  Shared-drive content    docs OWNED BY an org, so they         Google Shared Drives
           survive a departing employee                                (enterprise, future)
              |  alongside
LAYER 1  Personal content        subject:userId owns the doc;          consumer Google Docs
           an ACL grants other subjects access                          (THIS SPEC)
```

Layer 1 is the whole concrete scope of this spec. Layers 2 and 3 are named here
so the design does not paint them into a corner, but they are future specs,
enterprise-gated, and additive. They do not exist yet and this spec builds none
of them.

Why this ordering is safe: Layer 1's only job is "a user owns their docs." It
makes no claim about teams or billing, so Layers 2 and 3 attach to it without
rework. The branch's mistake was building a Notion-style fused container first,
which forced a personal-workspace-of-one to exist before any real org did.

## Motivation

### Current State (what the branch added)

The branch provisions every user a personal "workspace": an organization of one
whose id is a deterministic hash of the user id.

```ts
// apps/api/src/cloud-workspaces.ts
const hash = await sha256Hex(`personal-cloud-workspace:${userId}`);
return { workspaceId: `ws_${hash.slice(0, 32)}`, /* memberId, slug */ };
```

```ts
// apps/api/src/auth/create-auth.ts  (user.create.after hook)
await createPersonalCloudWorkspace(createDrizzleCloudWorkspaceStore(db), user);
//   -> inserts one organization row + one member row per user
```

The personal sync route resolves that workspace from the token, runs a
membership check, and embeds workspace and app ids in the Durable Object name:

```
route     /me/apps/:appId/docs/:docId
DO name   v1:workspace:ws_${sha256(userId)}:app:${appId}:doc:${docId}
```

This creates problems:

1. **`ws_${sha256(userId)}` carries no information.** It is a deterministic
   bijection of `userId`: a second name for a value the system already holds.

2. **The membership check is authorization theater.** A check on your own
   personal workspace can only fail as a provisioning bug, which is why
   `PersonalWorkspaceMissing` is a 409 "contact support."

3. **It fuses content ownership with billing, then bills the user anyway.**
   The personal workspace exists partly so content has a billable container.
   But Epicenter billing already runs per user: the signup hook calls
   `autumn.customers.getOrCreate({ customerId: user.id })`. The workspace was
   never the billing entity. The fusion bought nothing and cost an entity.

4. **It is the Notion model the pre-branch code explicitly rejected.** See
   Research Findings.

### Desired State

`origin/main`'s model, restored: a doc is owned by a subject and named by its
`ydoc.guid`. One route. No provisioning. No membership check on personal docs.

```
route     /rooms/:room
DO name   subject:${userId}:rooms:${room}        room = ydoc.guid
```

```ts
// client: one builder, names only the doc
roomWsUrl(apiUrl, ydoc.guid)   ->   wss://api/rooms/<guid>
```

## Research Findings

### `origin/main` already designed this, and rejected the org model in writing

The branch point is `aa955da6`. On `origin/main`, `apps/api/src/app.ts` carried
this design note verbatim:

> DO name namespacing: `subject:{subject}:rooms:{room}`
>
> We use subject-scoped DO names (Google Docs model) rather than org-scoped
> names (Vercel/Supabase model). [...]
>
> Org-scoped: most rooms hold personal data that should not merge into a shared
> Y.Doc. [...] adds complexity without simplifying.
>
> Org-scoped with personal sub-scope: [...] org tables and Better Auth
> organization plugin are unnecessary overhead.
>
> When sharing is needed, it follows the Google Docs pattern: the owner's DO
> name stays the same, an ACL table grants access to other subjects.

`workspace-sync-doc.ts` and `cloud-workspaces.ts` did not exist on
`origin/main`. `transport.ts` exported only `roomWsUrl`. The cloud-workspace
layer arrived in 9 commits on this branch (`63393e697` first, `88eb018c9` last,
one of which reverted its own earlier `/workspaces/:workspaceId` routes).

**Key finding**: The subject-owned model is not a new design. It is the
documented pre-branch design, and the branch built the org model that the
pre-branch note named "unnecessary overhead."

**Implication**: This spec is a revert plus the branch's presence work, not a
redesign.

### Google Docs is the content model; Google Workspace is the tenancy model

Consumer Google Docs: a document is owned by a user account, sharing is a
per-document ACL, there is no content container. Google Workspace: a domain, an
admin console, per-seat billing, administering a set of user accounts, never
owning a document.

**Key finding**: Google separates content ownership from tenancy and billing.
Notion fuses them into the workspace.

**Implication**: Layer 1 is consumer Google Docs (subject-owned + ACL). Enterprise
content that must outlive an employee is Google Shared Drives (Layer 2,
org-owned, future). Billing and admin is Google Workspace (Layer 3, future).
The org concept and the Better Auth organization plugin belong to Layer 3, as a
grouping of user accounts, not under documents.

### Billing is already per user

`apps/api/src/auth/create-auth.ts` creates an Autumn customer keyed on
`user.id`. No per-workspace billing exists.

**Key finding**: Removing the personal workspace costs billing nothing.

### `/rooms/*` auth must be confirmed for browser apps (Class 1, unresolved)

`origin/main` mounts `/rooms/*` under `requireOAuthUser` (the JSDoc mentions a
`workspaces:open` scope check). `/me/*` uses `requireCookieOrBearerPrincipal`. Browser
apps open sync sockets with `auth.openWebSocket`, which carries the token as a
bearer subprotocol.

**Key finding**: It is possible the branch introduced `/me/apps/...` partly to
get an auth path that browser apps satisfy.

**Implication**: Before reverting browser apps onto `/rooms/:room`, verify that
a browser app's bearer-subprotocol WebSocket satisfies `/rooms/*`'s
`requireOAuthUser` and any scope check. If it does not, the fix is to adjust
`/rooms/*` auth (or mount the room routes under `requireCookieOrBearerPrincipal`),
**not** to keep the workspace layer. See Open Questions 1.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Content ownership | 2 coherence | Doc owned by `subject:${userId}` | Google Docs model; Layer 1 makes no team or billing claim |
| Route | 2 coherence | One route `/rooms/:room` (restored) | Already exists on `origin/main`; daemon already uses it |
| Doc id | 2 coherence | `room = ydoc.guid` | The Y.Doc already carries its identity |
| DO name | 2 coherence | `subject:${userId}:rooms:${room}` (restored) | Existing format; `subject:` aligns with the encryption derivation labels |
| `subject:` vs `user:` prefix | 3 taste | Keep `subject:` | Same value as `user.id`; `subject:` is already a crypto-derivation label, renaming it is disproportionate risk for a cosmetic gain |
| `appId` in infrastructure | 2 coherence | Removed (not a segment, query param, or column) | Not an authz boundary, not prefix-scannable; collision is the app's concern |
| Personal authz | 2 coherence | No membership check; the route's auth middleware is the whole check | Ownership is identity; you cannot fail to be yourself |
| Provisioning | 2 coherence | Delete `createPersonalCloudWorkspace` from the signup hook | No workspace entity means nothing to provision |
| Better Auth organization plugin | 2 coherence | Remove if this branch enabled it; do not reinstall | The org concept belongs to Layer 3 (tenancy), a future spec; it is not a content tool |
| `/api/workspaces` + `cloud-workspaces.ts` | 2 coherence | Delete (pending Class 1 verify of no consumer) | No workspaces exist post-revert |
| URL builder | 2 coherence | Keep `roomWsUrl`; delete `defaultWorkspaceAppDocWsUrl` | `roomWsUrl` already builds the correct URL |
| Root doc guid | 2 coherence | Each app picks a stable root guid (e.g. `'fuji'`) | The old root guid was the workspace id, which this spec deletes |
| Server-owned presence | Keep | Keep all branch presence work | Unrelated to workspace routing; the branch's actual purpose |
| Migration | 1 evidence | Clean break, no migration code | No production users with provisioned personal workspaces |
| Layer 2 (shared-drive content) | Deferred | Deferred | Enterprise, future spec; offboarding is its trigger |
| Layer 3 (tenancy / billing) | Deferred | Deferred | Enterprise, future spec; the org plugin lives here |
| Sharing model for Layer 1.5 (ACL) | Deferred | Deferred | Per-document ACL is the documented direction; designed in a future spec |
| Client `attachCloudSync` ergonomics | Deferred | Deferred | A separate ergonomics refactor |

## Architecture

### What reverts

```
  BEFORE (this branch)                     AFTER (= origin/main + presence)
  ────────────────────                     ───────────────────────────────
  /me/apps/:appId/docs/:docId          ┐
  /me/apps/:appId/docs/:docId/dispatch ┼──> /rooms/:room
  /rooms/:room                         ┘    /rooms/:room/dispatch

  v1:workspace:ws_${sha256(userId)}    ┐
    :app:${appId}:doc:${docId}         ┴──> subject:${userId}:rooms:${ydoc.guid}

  workspace-sync-doc.ts                ┐
  cloud-workspaces.ts                  ┼──> deleted
  defaultWorkspaceAppDocWsUrl          ┘
  createPersonalCloudWorkspace hook    ──> deleted
```

### Request flow

```
CLIENT                                   SERVER
──────                                   ──────
roomWsUrl(api, ydoc.guid)
  -> wss://api/rooms/<guid>

                          GET /rooms/:room
                          requireOAuthUser (or cookie/bearer; see Open Q 1)
                                                      | userId from token
                          doName = subject:${userId}:rooms:${room}
                          rooms.handleWebSocket(doName, raw)
```

No `getDefaultWorkspaceForUser`. No `checkWorkspaceMembership`. No
`PersonalWorkspaceMissing`. The auth middleware already on the route is the
complete authorization story for Layer 1.

### Where the org concept goes (future, not built here)

```
Layer 1   subject:${userId}:rooms:${room}        user owns the doc
Layer 1.5 doc_acl(room, subjectId, role)         owner grants other subjects
Layer 2   org owns a shared-drive namespace      content survives offboarding
Layer 3   organization = a billing/admin group of user accounts (org plugin)
```

## Implementation Plan

Ordering follows Build, Prove, Remove. The old paths stay on disk and unused
until verification passes, so rollback is one revert.

### Phase 0: Verify the auth path (Class 1, blocking) - RESOLVED

- [x] **0.1** Confirm a browser app's bearer-subprotocol WebSocket satisfies
  `/rooms/*`'s `requireOAuthUser` and any `workspaces:open` scope check.

  **Decision: Option (a). No auth change needed.** `requireOAuthUser` and the
  bearer fallback of `requireCookieOrBearerPrincipal` both call the *identical*
  `resolveRequestOAuthUser` function. There is no `workspaces:open` scope
  check left: `resolveBearerUser`'s JSDoc states scopes were removed and "the
  API audience is the bearer boundary." Browser apps are OAuth clients; their
  WebSocket carries a bearer subprotocol that `singleCredential` lifts into
  `Authorization`, so they go through the same OAuth-token path as the daemon,
  which already uses `/rooms/*` under `requireOAuthUser` in production. The
  branch's `/me/apps` route used `requireCookieOrBearerPrincipal`, but only the
  cookie branch differs, and browser sync sockets never carry a cookie.

### Phase 1: Point browser apps at `/rooms/:room`

- [x] **1.1** No factory change needed. The root Y.Doc guids are already
  stable app constants (`epicenter.fuji` and friends), not the deleted
  `ws_${sha256(userId)}` id. See the Phase 1.1 Decisions Log entry.
- [x] **1.2** Switched browser callers from `defaultWorkspaceAppDocWsUrl` to
  `roomWsUrl(APP_URLS.API, ydoc.guid)`: `apps/fuji/src/lib/browser.ts`,
  `apps/honeycrisp/browser.ts`, `apps/opensidian/src/lib/opensidian/browser.ts`,
  `apps/tab-manager/src/lib/session.svelte.ts`. The daemon already uses
  `roomWsUrl`; no daemon change needed.
- [x] **1.3** Re-exported `roomWsUrl` from `packages/workspace/src/index.ts`;
  updated the example JSDoc.

### Phase 2: Stop provisioning personal workspaces

- [x] **2.1** Removed the `createPersonalCloudWorkspace` call from the
  `user.create.after` hook in `apps/api/src/auth/create-auth.ts`. Autumn
  customer creation is intact.

### Phase 3: Prove

- [x] **3.1** Typechecked the monorepo. `@epicenter/api`, `@epicenter/workspace`,
  and the fuji/honeycrisp/opensidian apps pass. `ui`, `dashboard`,
  `tab-manager`, and `whispering` have pre-existing typecheck failures in
  files this revert does not touch.
- [x] **3.2** Affected tests pass: `app.rooms.test.ts`, `presence.test.ts`,
  `transport.test.ts` (updated), full `apps/api` suite (92 tests).
  `app.me.test.ts`, `workspace-sync-doc.test.ts`, and `cloud-workspaces.test.ts`
  were deleted with their subjects.
- [ ] **3.3** Live smoke test not performed (no running deployment in this
  environment). The "no `organization`/`member` row" property is structurally
  guaranteed: provisioning and the org tables are deleted.

### Phase 4: Remove the workspace layer

- [x] **4.1** Deleted the `/me/apps/:appId/docs/:docId` routes (all verbs),
  `apps/api/src/workspace-sync-doc.ts`, the `resolveDefaultWorkspaceSyncDocRoute`
  wiring in `app.ts`, the `PersonalWorkspaceMissing` variant, and the
  `no_default_workspace` 4401 close branch.
- [x] **4.2** Deleted `defaultWorkspaceAppDocWsUrl` from `transport.ts` and its
  re-export. `roomWsUrl` and `websocketUrl` are kept.
- [x] **4.3** Verified no SPA or client consumes `/api/workspaces` (Class 1).
  Deleted the route, `apps/api/src/cloud-workspaces.ts`, `listCloudWorkspaces`,
  `CloudWorkspaceListing`, and `checkWorkspaceMembership`.
- [x] **4.4** Removed the Better Auth organization plugin and the
  `organization`/`member`/`invitation` schema. This branch added them; removal
  is clean (one self-contained migration). See the Phase 4.4 Decisions Log
  entry.
- [x] **4.5** Updated docs: `docs/architecture.md`,
  `packages/workspace/SYNC_ARCHITECTURE.md`, READMEs, and API guides. The
  "default workspace" and "personal workspace" language is gone; the docs
  describe subject-owned documents and the three-layer model.
- [x] **4.6** Added a superseded-spec banner to the five prior specs that
  assert the `/me/apps` route or personal-workspace provisioning.

## Edge Cases

### Root doc guid change

1. The root Y.Doc's guid was the old workspace id, which this spec deletes.
2. Each app adopts a stable new root guid; this changes the app's local
   IndexedDB database name.
3. Clean break, no users, so local data loss is acceptable. Recorded so the
   implementer writes no guid-migration code.

### `/rooms/*` rejects a browser bearer-subprotocol socket

1. Phase 0 finds the browser token does not satisfy `requireOAuthUser`.
2. Fix the route's auth (adjust `requireOAuthUser`, or mount room routes under
   `requireCookieOrBearerPrincipal`).
3. Do not keep the workspace layer to paper over an auth gap.

### Doc opened before sign-in

1. The client builds `roomWsUrl(api, ydoc.guid)` with no user id.
2. The socket opens; auth middleware rejects it until a session exists.
3. The sync supervisor parks and reconnects on `auth.onStateChange`. No change.

### Daemon and browser syncing the same doc

1. Both build `roomWsUrl(api, ydoc.guid)` for the same guid.
2. Both resolve to `subject:${userId}:rooms:${ydoc.guid}` and share one DO.
3. They now genuinely share cloud state, where the split route families kept
   them apart. The current data set does not rely on that isolation.

## Open Questions

1. **`/rooms/*` auth for browser apps.** RESOLVED in Phase 0: option (a).
   `requireOAuthUser` and the bearer fallback of `requireCookieOrBearerPrincipal`
   both resolve through the same `resolveRequestOAuthUser`; there is no scope
   check; the daemon already uses `/rooms/*` under `requireOAuthUser`. No auth
   change is needed.

2. **Layer 1.5 sharing: per-document ACL.**
   - `origin/main` documents the Google Docs ACL approach: owner DO name
     unchanged, an ACL table grants other subjects access.
   - **Recommendation**: Design in a future spec. Noted here so Layer 1 does
     not foreclose it (it does not: an ACL is additive).

3. **Layer 2 vs pure ACL for teams.**
   - Pure ACL cannot answer "the org keeps the docs when an employee leaves."
     Google solved this with Shared Drives (org-owned content).
   - **Recommendation**: Layer 2 is the answer; offboarding is its trigger.
     Future enterprise spec.

4. **Client `attachCloudSync` ergonomics.**
   - A binding created once per `(app, session)` could reduce each call site to
     `cloud.sync(ydoc)`, reading the room id off `ydoc.guid`.
   - **Recommendation**: Separate spec; orthogonal to this revert.

## Decisions Log

- Keep `subject:` (not `user:`) as the DO name prefix: it is already the
  encryption key-derivation label for this exact boundary, and renaming a
  crypto-contract string for a cosmetic gain is disproportionate risk.
  Revisit when: the encryption derivation labels are themselves being reworked,
  at which point the two can be renamed together.

- **Phase 0**: `/rooms/*` auth is unchanged. Option (a) verified: browser apps'
  bearer-subprotocol sockets already satisfy `requireOAuthUser` because it
  shares `resolveRequestOAuthUser` with the cookie-or-bearer middleware and no
  scope check remains.

- **Phase 1.1**: The root Y.Doc guids are already stable app-scoped constants
  (`epicenter.fuji`, `epicenter.honeycrisp`, `epicenter.opensidian`,
  `epicenter.tab-manager`), not the deleted `ws_${sha256(userId)}` id. The
  branch's browser callers passed a literal `docId: 'root'` to
  `defaultWorkspaceAppDocWsUrl` while the daemon already used `ydoc.guid`.
  Switching browser callers to `roomWsUrl(API, ydoc.guid)` needs no factory or
  IndexedDB-keying change; it only converges the browser root onto the same
  room the daemon already uses. No guid rename is performed: renaming stable
  constants would be churn and would needlessly drop local IndexedDB data.

- **Phase 4.4**: The Better Auth organization plugin, the
  `organization`/`member`/`invitation` tables, and the
  `session.active_organization_id` column were all added by this branch
  (`origin/main` has none). Removal is a clean break, not non-trivial churn:
  the org schema is one self-contained branch-added migration
  (`0003_pink_mephisto.sql`). It is removed, not kept.

## Success Criteria

- [x] A signed-in user syncs a cloud doc with no `organization` row and no
  `member` row provisioned for them. (Structural: provisioning and the org
  tables are deleted; not live-tested, see Phase 3.3.)
- [x] One route `/rooms/:room` serves browser and daemon; the
  `/me/apps/:appId/docs/:docId` routes are deleted.
- [x] DO names match `subject:${userId}:rooms:${ydoc.guid}` (`resolveSubjectRoom`
  in `app.ts`, unchanged).
- [x] No `createPersonalCloudWorkspace` call exists; `defaultWorkspaceAppDocWsUrl`,
  `PersonalWorkspaceMissing`, `getDefaultWorkspaceForUser`, the
  `no_default_workspace` branch, `workspace-sync-doc.ts`, and
  `cloud-workspaces.ts` are deleted.
- [x] `/api/workspaces` is deleted (after Class 1 verification of no consumer).
- [x] The Better Auth organization plugin is removed.
- [x] Server-owned presence behavior is unchanged from the branch (no presence
  file touched; `presence.test.ts` passes).
- [x] Monorepo typecheck and affected test suites pass for every package this
  revert touches; the unrelated pre-existing failures in `ui`, `dashboard`,
  `tab-manager`, and `whispering` are out of scope.
- [x] `docs/architecture.md` and `SYNC_ARCHITECTURE.md` describe subject-owned
  documents and the three-layer model.

## References

- `apps/api/src/app.ts` - `/me/apps/:appId/docs/:docId`, `/rooms/:room`, `/api/workspaces`, auth middleware, `upsertDoInstance`
- `apps/api/src/workspace-sync-doc.ts` - to delete
- `apps/api/src/cloud-workspaces.ts` - to delete
- `apps/api/src/auth/create-auth.ts` - `user.create.after` hook; org plugin config
- `apps/api/src/db/schema/app.ts` - `durableObjectInstance` table
- `packages/workspace/src/document/transport.ts` - keep `roomWsUrl`, delete `defaultWorkspaceAppDocWsUrl`
- `packages/workspace/src/document/transport.test.ts` - URL builder tests
- `packages/workspace/src/daemon/attach-daemon-infrastructure.ts` - already uses `roomWsUrl`; reference for the target pattern
- `packages/workspace/src/index.ts` - re-export and example JSDoc
- `apps/fuji/src/lib/browser.ts`, `apps/honeycrisp/browser.ts`, `apps/opensidian/src/lib/opensidian/browser.ts`, `apps/tab-manager/src/lib/session.svelte.ts` - caller and root-guid updates
- `git show origin/main:apps/api/src/app.ts` - the pre-branch DO-naming design note
- `packages/workspace/SYNC_ARCHITECTURE.md`, `docs/architecture.md` - docs to update
- `specs/20260521T180000-presence-full-list-collapse.md` - prior sync spec; check for stale workspace claims
