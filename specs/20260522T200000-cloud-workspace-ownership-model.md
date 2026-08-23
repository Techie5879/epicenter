# Cloud Ownership Model: Organizations Are Deployments

**Date**: 2026-05-22
**Status**: Data model Implemented; multi-deployment packaging Deferred (trigger-gated)
**Author**: AI-assisted
**Branch**: revert/cloud-workspace-sync-layer

> Earlier drafts of this file proposed a workspace-owned model (every user gets
> a Better Auth `organization`), then a three-layer model (personal / org-owned
> content / tenancy). Both are retired. This rewrite is the final form. The
> filename keeps the word "workspace" for history; the model has no workspace
> entity and no organization entity.

## Overview

A cloud document is owned by the user identity (`subject`) that names it:
`subject:<userId>:rooms:<guid>`. That is the entire data model, and it already
ships. An "organization" is not a concept inside the software. It is a second,
private deployment of the same stack. Epicenter Cloud is the public deployment;
an organization runs a private one (self-hosted, or Epicenter-managed). Same
code, different environment, no shared state.

## One-sentence thesis

> An organization is not a thing in the data model. It is a second deployment.
> The data model is one layer, subject-owned documents, and it never changes.

## Motivation

### Current State (shipped on this branch)

`apps/api/src/app.ts` resolves a room name straight from the caller's identity:

```ts
function resolveSubjectRoom(c: Context<Env>) {
	const room = c.req.param('room');
	if (room == null) {
		throw new Error('Room route is missing required room parameter');
	}
	return {
		roomName: `subject:${c.var.user.id}:rooms:${room}`,
		room,
	};
}
```

Two product nouns: User and Document. The `user` table (Better Auth core) and a
document, whose runtime form is a Durable Object named by the owning subject.
Authorization is the route's auth middleware: the caller's token resolves a
`userId`, the DO name is built from it. No membership table, no organization,
no provisioning step. Billing is per user (Autumn customer id = `user.id`).

### What this rewrite changes

It retires the three-layer framing entirely.

```
PRIOR DRAFT (retired)                  THIS REWRITE (final)
─────────────────────                  ────────────────────
Layer 1  personal documents            The data model. Unchanged. Shipped.
Layer 2  org-owned content   ───────>  Not a data concept. An organization
         (org-subject, escrow,         is a deployment of the Layer 1 stack.
          key wrapping, rotation)
Layer 3  tenancy / billing   ───────>  Per-deployment. Epicenter Cloud bills
         (Better Auth org plugin)      per user; a private deployment is a
                                       license or contract.
```

There is no Layer 2 data model, no org-subject, no key wrapping, no Better Auth
organization plugin. "Organization" stopped being a concept inside the software
and became a copy of the software.

### Desired State

```
a DEPLOYMENT = the Epicenter stack running once
               { server code, ENV, its own DB, its own Durable Objects,
                 its own user accounts, its own auth }

Epicenter Cloud      the public deployment. anyone signs up. run by Epicenter.
Acme's deployment    a private deployment. only Acme's people. run by Acme,
                     or Epicenter-managed. same code, different ENV.

INSIDE any deployment the model is identical, and is exactly what ships today:
     a user owns their documents      subject:<userId>:rooms:<guid>
     authz = "are you that subject?"
```

Epicenter Cloud is an organization where every user is a stranger doing their
own thing. Acme's deployment is an organization where every user is a colleague
doing their own thing. Structurally identical. The only differences are who has
accounts, who runs the box, and whose key is in `ENV`.

## Research Findings

### The in-app org models were built, or designed, and abandoned

| Model | Where it lived | Outcome |
| --- | --- | --- |
| Workspace-owned (`ws_${sha256(userId)}`, org plugin) | `redesign/server-owned-presence` | Built, reverted 2026-05-22 (`specs/...T160000-revert...`). |
| Three-layer (Layer 2 org-owned content) | Earlier drafts of this file | Retired by this rewrite. |
| Organization as a deployment | This spec | Final. No data-model code. |

**Key finding**: every attempt to model "organization" as an in-app entity
added a noun, a table, an invariant, or a crypto project. Modeling it as a
deployment adds none of those: it reuses the Layer 1 stack verbatim.

### Better Auth does not enforce a per-user organization

Verified against Better Auth source (DeepWiki, 2026-05-22): `activeOrganizationId`
is nullable, a user may have zero organizations, and auto-creating one is a
manual hook, not a feature. **Implication**: an in-app org model must prop up an
invariant the library refuses to hold. A deployment model needs no such
invariant, and no organization plugin at all.

### Multi-tenancy by multi-deployment is a known, proven shape

| Product | Public instance | Private instance |
| --- | --- | --- |
| GitLab | `gitlab.com` | self-hosted GitLab |
| WordPress | `wordpress.com` | self-hosted WordPress |
| Google | consumer `gmail.com` | Google Workspace for one domain |
| Discourse | hosted Discourse | self-hosted Discourse |

**Key finding**: mature products serve organizations by running the same
software more than once, not by partitioning one running instance. Inside a
Workspace domain, each employee still has their own Drive: "every user does
their own thing." That is precisely this model.

**Implication**: Epicenter is local-first; the user physically owns their data.
A deployment the organization controls (its server, its key, its database) is
the natural fit. In-app multi-tenancy would contradict local-first and add a
threat model Epicenter does not want.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| The data model | 2 coherence | One layer: `subject:<userId>:rooms:<guid>` | Ownership is identity. Shipped and correct. |
| What an "organization" is | 2 coherence | A second deployment of the stack | A copy of the software, not a concept inside it. |
| `org:` prefix / a second owner kind | 1 evidence | None, ever | Never existed in shipped code; the revert removed it. |
| Better Auth organization plugin | 1 evidence | Never enabled | No in-app multi-tenancy; nothing for it to back. |
| In-app shared / collaborative documents | 2 coherence | Refused | Every document is `subject:<userId>`. Collaboration is out of scope. |
| `subject:` key prefix | 3 taste | Keep | It is the encryption-derivation label. It discriminates nothing now, but renaming a crypto-contract string is disproportionate risk. |
| Identity across deployments | 2 coherence | Each deployment has its own accounts and auth | Self-containment: a deployment never calls another. |
| Offboarding-survival | 2 coherence | The org owns the substrate (server, key, DB), not the document | No crypto. Recovery is admin tooling on the org's own deployment. |
| Billing | 2 coherence | Per deployment | Epicenter Cloud bills per user (Autumn). A private deployment is a license or contract. |
| Migration | 1 evidence | None | No production Durable Objects exist; clean greenfield. |
| Executing org-as-deployment | Deferred | Deferred | A packaging effort. Trigger: a customer wants a private deployment. |

## Architecture

### The model

```
        ┌──────────────────────────────────────────────────────────┐
        │  A DEPLOYMENT                                              │
        │   identical source code, configured by ENV                │
        │   ├── its own database                                     │
        │   ├── its own Durable Objects                              │
        │   ├── its own user accounts + auth                         │
        │   └── ENV: deployment key, deployment id, identity config  │
        │                                                            │
        │   inside it, the only model:                               │
        │     ┌──────┐  owns 1..N  ┌──────────────────────────────┐  │
        │     │ User │ ───────────>│ Document                     │  │
        │     │      │             │ subject:<userId>:rooms:<guid>│  │
        │     └──────┘             └──────────────────────────────┘  │
        │   authz = "are you that subject?"                          │
        └──────────────────────────────────────────────────────────┘

   instantiated as:

   Epicenter Cloud          a deployment. public. run by Epicenter.
   Acme's deployment        a deployment. private. run by Acme (or managed).
   ...                      every organization = one more deployment.
```

### The self-containment invariant

This is the load-bearing rule. A deployment must be able to run correctly even
if every other deployment, including Epicenter Cloud, is offline.

```
A deployment shares NOTHING with another deployment except the source code.

  ✓ own database          no shared rows, no shared connection
  ✓ own Durable Objects   no shared DO namespace
  ✓ own user accounts     own auth; never calls another deployment for identity
  ✓ own ENV               the key, the deployment id, identity/billing config
  ✓ identical code        a deployment differs ONLY by ENV
  ✓ client selects by URL apiUrl is the deployment selector; one client build
                          points at any deployment
```

If any box above is violated, the deployment is not self-contained and the
model is broken. There is no federated identity, no shared control plane, no
cross-deployment call. Acme's deployment is an island that happens to run the
same code as the mainland.

### Offboarding-survival without crypto

```
Alice (an Acme employee) leaves.
  Her content is  subject:alice:rooms:...  in Acme's database,
  encrypted with Acme's ENV key, on Acme's server.
  Acme controls the database, the key, and the server.
  -> Acme's admin recovers or reassigns it with server-side admin tooling.

The organization does not own the document. It owns the SUBSTRATE.
That is strictly simpler and needs no key wrapping, no escrow, no rotation.
```

## Implementation Plan

### The data model (IMPLEMENTED)

Landed by `specs/20260522T160000-revert-cloud-workspace-sync-layer.md`. This
spec changes none of it.

- [x] One route `/rooms/:room` serves browser apps and the daemon.
- [x] DO name is `subject:${userId}:rooms:${room}`.
- [x] No `organization` / `member` / `invitation` tables; org plugin not enabled.
- [x] Billing per user (`autumn.customers.getOrCreate({ customerId: user.id })`).

### Organization as a deployment (DEFERRED, trigger-gated)

**Trigger**: a real customer wants a private deployment. Not before. This is a
packaging effort, not a data-model change.

- [ ] **P1** Make `apps/api` a clean deployable artifact: `wrangler deploy`
  driven entirely by an `ENV` file. No build-time coupling to Epicenter Cloud.
- [ ] **P2** Define and document the `ENV` schema: deployment key, deployment
  id, identity/auth config, billing mode. One file fully describes a deployment.
- [ ] **P3** Confirm `apiUrl` is fully client-configurable so one client build
  targets any deployment. (`roomWsUrl(apiUrl, guid)` already takes `apiUrl`.)
- [ ] **P4** Verify the self-containment invariant: stand up a second
  deployment, take Epicenter Cloud offline, confirm the second deployment still
  serves its users.
- [ ] **P5** Write the deployment guide (self-hosted) and the managed-deployment
  runbook (Epicenter-operated).

## Edge Cases

### A user on two deployments

1. An Acme employee has a personal Epicenter Cloud account and an Acme-deployment
   account.
2. These are two separate accounts on two self-contained deployments, like a
   personal Gmail and a work Gmail.
3. The client selects which by `apiUrl`. Expected, not a defect.

### Managed private deployment

1. A small team wants a private deployment but does not want to run a server.
2. Epicenter operates the deployment for them; Epicenter holds that `ENV`.
3. Managed means Epicenter can read that deployment's data (standard SaaS
   trust). Self-hosted means it cannot (vendor-blind). Both run identical code;
   the only variable is who holds `ENV`.

### Version skew

1. A self-hosted deployment runs server `vN`; a client ships `vN+k`.
2. Self-hosting always implies a compatibility matrix. This is the real,
   accepted cost of the model.
3. Mitigation belongs in the deployment-guide and upgrade-story work (P5).

## Open Questions

1. **Managed-deployment isolation.** When Epicenter operates several private
   deployments, are they separate Workers/databases per deployment, or one
   Worker keyed by deployment id.
   - **Recommendation**: separate per deployment, to keep the self-containment
     invariant literally true rather than logically true. Decide during P1.

2. **Billing for private deployments.** A license, per-seat, or flat contract.
   - **Recommendation**: out of scope here; a sales decision, not an
     architecture one. The model does not depend on the answer.

## Decisions Log

- Keep `subject:` (not `user:`) as the DO name prefix: it is the encryption
  key-derivation label for this boundary. It now discriminates nothing, since
  there is one owner kind, and that is acceptable.
  Revisit when: the encryption derivation labels are reworked; rename together.

- Refuse in-app organizations and in-app shared documents: the product sentence
  ("a user owns their documents and syncs them to a deployment") is fully intact
  without them, and the refusal deletes a code family (org plugin, three tables,
  org-subject, key wrapping, escrow, rotation, in-app multi-tenancy).
  Revisit when: Epicenter deliberately becomes a team-collaboration product with
  co-authored documents. That is a different product and a different spec.

## Success Criteria

- [x] A signed-in user syncs a cloud doc with no `organization` and no `member`
  row; the data model is one layer.
- [x] No `org:` prefix and no organization plugin exist.
- [ ] `apps/api` deploys from an `ENV` file with no coupling to Epicenter Cloud.
- [ ] A second deployment serves its users with Epicenter Cloud offline (the
  self-containment invariant, verified).
- [ ] The deployment guide exists; one `ENV` file fully describes a deployment.

## References

- `specs/20260522T160000-revert-cloud-workspace-sync-layer.md` - the revert that
  shipped the data model.
- `apps/api/src/app.ts` - `resolveSubjectRoom`, the `/rooms/:room` route.
- `apps/api/src/auth/plugins.ts` - enabled plugins (`jwt`, `oauthProvider`); no
  organization plugin.
- `apps/api/src/auth/create-auth.ts` - the `user.create.after` hook; Autumn
  customer keyed on `user.id`.
- `apps/api/src/auth/encryption.ts` - `deriveSubjectKeyring`; the `subject:`
  derivation label.
- `packages/workspace/src/document/transport.ts` - `roomWsUrl(apiUrl, guid)`;
  `apiUrl` is the deployment selector.
- `docs/articles/20260522T210000-an-organization-is-a-deployment.md` - the
  narrative companion to this spec.
