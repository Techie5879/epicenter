# Epicenter Deployment Product Contract

**Date**: 2026-05-12
**Status**: Draft
**Author**: AI assisted
**Related**:

- `specs/20260511T150000-final-oauth-auth-architecture.md`
- `specs/20260511T115110-remote-storage-control-plane.md`
- `specs/20260512T114350-auth-token-capability-boundary.md`
- `specs/20260512T150000-cloud-modules-and-networks.md`

> **Server-composition vocabulary (defer to companion spec):** the canonical
> server-side composition primitive is `createEpicenterServer({ origin, apps })`,
> where each `apps[]` entry is a mounted Cloud App produced by `defineX({ host })`.
> There is no separate `instances: [...]` array, and no separate flavor for
> "infrastructure" vs "product" Cloud Apps. See
> `specs/20260512T150000-cloud-modules-and-networks.md` for the locked details.
> This spec is the *consumer-side* deployment contract: how an app picks
> between local-only, self-hosted, and Epicenter Cloud, and which resources
> that deployment exposes.

## One Sentence

Epicenter apps run against a deployment contract: local-only, self-hosted, or Epicenter Cloud, with shared infrastructure participating only when a resource server explicitly trusts the user's deployment.

## Overview

This spec names the product boundary that the auth and sync specs have been circling. An Epicenter app should not be built against Epicenter Cloud directly. It should be built against an Epicenter deployment, where that deployment may be local-only, self-hosted, or hosted by Epicenter.

The product promise:

```txt
Build or use local-first apps without giving up sync, self-hosting, or explicit participation in shared hosted infrastructure.
```

The important clean break:

```txt
Deployment is the app contract.
Cloud is one deployment.
Self-hosted is another deployment.
Local-only is the zero-server deployment.
```

## Motivation

### Current State

The recent auth and storage specs correctly push apps toward capability boundaries:

```txt
Apps call:
  auth.state
  auth.startSignIn()
  auth.signOut()
  auth.fetch()
  auth.openWebSocket()

Apps should not read:
  raw access tokens
  refresh tokens
  Better Auth sessions
  deployment-specific cookie state
```

The deployable split is less product-shaped. The OAuth architecture spec and
the cloud modules companion spec now choose a single composable host with
optional Cloud Apps:

```txt
apps/server base modules:
  auth
  OAuth
  /workspace-identity
  workspace sync
  document sync
  no Postgres requirement

apps/server cloud-apps subtree:
  optional Cloud Apps: billing, assets, dashboard, Ark, Betcha, others
  each Cloud App mounts at its own host (e.g. ark.epicenter.so)
  each Cloud App owns one pgSchema('<id>') in Postgres
  Drizzle is the canonical schema and migration tool
```

Physical splitting (separate processes, separate domains) stays available as
an operational topology choice, but `apps/server` and `apps/cloud` are not
two separate product platforms. The product question is narrower:

```txt
What exactly is the thing an app connects to?
```

If the answer is "Epicenter Cloud", self-hosting becomes secondary. If the answer is "whatever server has the sync URL", shared infrastructure becomes vague. If the answer is "accounts plus sync plus maybe Cloud", the boundary is still a bundle of implementation nouns.

### Problems

1. **Cloud and deployment are easy to confuse**: Cloud is a hosted deployment plus hosted business services. It should not define the app contract.

2. **Postgres can become a false boundary**: Some resources need a queryable relational database. Local-only sync does not. Self-hosted deployments may need one for account state, app APIs, or hosted social data, but not every app mode should inherit Postgres.

3. **Shared infrastructure needs an explicit trust rule**: A hosted social app with its own Postgres cannot safely accept writes from every self-hosted identity unless it chooses a federation rule.

4. **Accountless sync is tempting but not the main product**: Device-pairing sync can exist later, but making it the default self-hosting story creates a second auth model before the first one is locked down.

5. **API and sync are logical boundaries before hostnames**: A single self-hosted origin may serve auth, API, and sync. Hosted production may split them across domains. Apps should depend on resource metadata, not hardcoded host assumptions.

### Desired State

Every app can run in three modes:

```txt
Local-only
  no account
  no server
  no remote sync
  local data stays on the device

Self-hosted
  user-owned deployment
  user-owned accounts
  user-owned database when needed
  user-owned sync
  user-owned encryption secrets

Epicenter Cloud
  Epicenter-managed deployment
  managed accounts
  managed sync
  managed dashboard
  hosted billing and shared services
```

The app asks for a deployment:

```txt
Use Epicenter Cloud
Connect to my server
Stay local only
```

The deployment tells the app where the roles live:

```ts
type EpicenterDeployment = {
	id: string;
	name: string;
	mode: 'local' | 'self-hosted' | 'hosted';
	issuer?: string;
	resources: {
		sync?: string;
		cloud?: string;
	};
};
```

That type is illustrative. The real implementation should derive the final shape from existing constants and OAuth discovery code.

## Product Model

### Deployment Roles

```txt
Deployment
  owns:
    account authority
    OAuth issuer
    workspace identity endpoint
    sync resource
    resource APIs
    encryption secret owner
    storage lifecycle policy
    optional app databases
```

The roles may be served by one origin or many origins.

```txt
Hosted Epicenter:
  accounts.epicenter.so
    account authority and OAuth issuer

  sync.epicenter.so
    workspace identity
    workspace sync
    document sync

  api.epicenter.so
    hosted Cloud APIs
    billing
    hosted dashboard
    asset and storage control APIs

Self-hosted simple:
  epicenter.alice.com/auth
  epicenter.alice.com/sync
  epicenter.alice.com/api

Local-only:
  no issuer
  no remote resource
  local persistence only
```

### Product Surfaces

```txt
Epicenter Apps
  local-first apps built against the deployment contract

Epicenter Server
  composable host that mounts server core plus optional Cloud Apps
  server core: auth, /workspace-identity, workspace sync, document sync
  optional Cloud Apps: billing, dashboard, assets, Ark, Betcha, others
  each Cloud App mounts at its own host with its own OAuth audience

Epicenter Cloud
  Epicenter's hosted composition of the Epicenter Server with the Cloud
  Apps Epicenter chooses to run; not a separate code platform

Epicenter Directory
  optional future discovery surface for apps, deployments, and trusted shared resources
```

## Database Boundary

Postgres is not the deployment boundary. Data ownership is.

```txt
Local-only app:
  needs local persistence
  does not need Postgres

Self-hosted workspace sync:
  needs durable server state
  may use SQLite, Durable Objects, Postgres, or another configured store
  must expose the same sync and identity contract

Hosted Cloud control plane:
  can require Postgres
  needs account-visible inventory, billing state, hosted app data, and queryable admin views

Hosted social app:
  likely owns its own Postgres
  decides which identities can write posts
  may later federate with other deployments
```

The rule:

```txt
The server that owns the data decides which identities can write to it.
```

So a deployment does not automatically get to write to every shared app. A shared app must trust that deployment, or the user must create an account directly with the shared app.

## Social App Example

Assume a hosted app named Club:

```txt
club.example.com
  owns posts
  stores posts in Club Postgres
  serves public feeds
```

Ten users want to use Club:

```txt
8 users use Epicenter Cloud accounts
2 users use self-hosted deployments
```

There are three viable models.

### Model A: Club Owns Accounts

```txt
club.example.com
  issuer = club.example.com
  database = Club Postgres
  all users sign in to Club
```

This is the simplest public app model. The two self-hosted users can still use their self-hosted Epicenter deployments for private workspace data, but Club posts belong to Club.

Use this when:

```txt
Club needs moderation
Club needs global identity
Club needs one abuse policy
Club needs one Postgres feed
```

Trade-off:

```txt
Self-hosted identity does not automatically carry into Club.
```

### Model B: Club Trusts Selected External Deployments

```txt
club.example.com
  issuer allowlist:
    accounts.epicenter.so
    epicenter.alice.com
    epicenter.bob.com
  database = Club Postgres
```

The two self-hosted users sign in through their own deployments. Club accepts those tokens because it explicitly trusts those issuers.

Use this when:

```txt
Club wants one shared feed
Club can review trusted issuers
Club can map external users to local Club identities
```

Trade-off:

```txt
Club now owns federation complexity:
  issuer discovery
  issuer allowlisting
  subject mapping
  account recovery differences
  moderation across identity providers
```

### Model C: Each Deployment Hosts Its Own Club Resource

```txt
club.epicenter.so
  posts for Epicenter Cloud users

club.alice.com
  posts for Alice's deployment

club.bob.com
  posts for Bob's deployment
```

This is true distributed hosting. It does not produce one global feed unless the app adds federation or replication.

Use this when:

```txt
data ownership matters more than one central feed
each deployment can run the app resource
cross-deployment aggregation is a later protocol
```

Trade-off:

```txt
The app needs an inter-deployment data protocol before users can see one shared feed.
```

Recommendation for v1:

```txt
Use Model A for public social apps.
Use Model B only for explicitly trusted partner deployments.
Defer Model C until there is a concrete federation protocol.
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| App contract | 2 coherence | Apps connect to deployments, not Cloud directly. | This preserves self-hosting while keeping Epicenter Cloud as the flagship deployment. |
| Product modes | 2 coherence | Local-only, self-hosted, hosted. | These modes map to real user expectations and avoid making accountless sync the default server story. |
| Self-hosted accounts | 2 coherence | Include accounts in self-hosted deployments. | Cross-device sync needs a stable account authority. Device pairing can be a later mode. |
| Database requirement | 2 coherence | Require storage capabilities by role, not Postgres everywhere. | Some resources need relational queries. Local-only and small sync deployments should not inherit hosted Cloud's database shape. |
| Shared app writes | 2 coherence | Resource owner chooses trusted issuers. | A social app's Postgres owner must control who can write to it. |
| API versus sync | 2 coherence | Keep them as logical resources, not mandatory deployables. | Hosted production may split domains. Self-hosted users should be able to run one origin. |
| Federation | Deferred | Defer open federation. | It is a real product, security, abuse, and data-model problem. Trust allowlists are enough for the first shared-infrastructure step. |

## Architecture

```txt
Epicenter App
  |
  | choose deployment
  v
Deployment contract
  |
  | local-only
  |   -> local persistence
  |
  | self-hosted
  |   -> issuer
  |   -> sync resource
  |   -> optional API resource
  |   -> deployment-owned database when needed
  |
  | Epicenter Cloud
      -> accounts.epicenter.so
      -> sync.epicenter.so
      -> api.epicenter.so
      -> hosted Postgres-backed control plane
```

Shared resource trust:

```txt
User deployment
  issuer: epicenter.alice.com
        |
        | OAuth token
        v
Shared app resource
  club.example.com
  owns Club Postgres
  verifies issuer only if allowlisted
  maps external subject to local actor
  accepts or rejects write
```

## What Changes In Prior Specs

Do not rewrite the existing specs yet. Treat this spec as the product contract they should be checked against.

Later edits should be small:

```txt
Final OAuth architecture:
  add "deployment contract" as the umbrella product model
  keep AuthClient capability boundary
  keep issuer/resource split
  clarify that hosted domains are one deployment layout, not the app contract

Remote storage control plane:
  clarify that Postgres registry is the hosted Cloud implementation
  keep the generic lifecycle rule:
    account-visible registry gates remote sync before touching bytes

Auth token capability boundary:
  no product change
  keep raw credentials private to auth
  ensure deployment metadata does not leak tokens to app code
```

## Implementation Plan

### Phase 1: Lock The Product Contract

- [ ] **1.1** Review this spec against `20260511T150000-final-oauth-auth-architecture.md`.
- [ ] **1.2** Add a short "Deployment Contract" section to the OAuth architecture spec.
- [ ] **1.3** Add supersession notes only for the deployable-product language, not for the OAuth token work.
- [ ] **1.4** Write a one-page agent prompt that asks a reviewer to attack this spec's database and federation assumptions.

### Phase 2: Describe Deployment Metadata

- [ ] **2.1** Inspect existing app URL constants and OAuth launcher configuration.
- [ ] **2.2** Propose a minimal deployment metadata shape that can express hosted and self-hosted without changing auth behavior yet.
- [ ] **2.3** Verify whether local-only mode needs the same metadata shape or a separate local workspace profile.
- [ ] **2.4** Keep the shape capability-based: issuer, sync resource, optional cloud resource.

### Phase 3: Prove One Self-Hosted Shape

- [ ] **3.1** Pick the smallest self-hosted origin shape:
  `https://epicenter.example.com/auth`, `/sync`, and `/api`.
- [ ] **3.2** Map server core and the `cloud-apps/` subtree onto that origin inside `apps/server`. There is no separate `apps/cloud` deployable to map; every Cloud App is a colocated compile-time module mounted at its own host.
- [ ] **3.3** Identify which state needs a database for self-hosted accounts.
- [ ] **3.4** Identify which hosted Cloud features require Postgres and must stay out of the minimal server.

### Phase 4: Shared Infrastructure Review

- [ ] **4.1** Write the Club example as an executable scenario.
- [ ] **4.2** Decide whether v1 supports only Club-owned accounts or issuer allowlists.
- [ ] **4.3** If issuer allowlists are in v1, define subject mapping and revocation.
- [ ] **4.4** If issuer allowlists are out of scope, write the refusal explicitly.

## Grill Prompt

Give this prompt to another coding agent:

```txt
You are reviewing specs/20260512T135159-epicenter-deployment-product-contract.md.

Your job is to attack the design until the deployment boundary is concrete.
Do not rewrite the whole spec. Produce findings, open questions, and recommended edits.

Questions to answer:

1. Is "deployment" a real product boundary, or is it hiding incompatible modes?
2. Can local-only, self-hosted, and Epicenter Cloud share one app contract?
3. Which exact state does a minimal self-hosted server need to persist?
4. Can that persistence avoid Postgres, or does Better Auth/account sync force a relational database?
5. Which current files hardcode Epicenter Cloud rather than a deployment contract?
6. Does separating sync and API as logical resources actually help, or does it add ceremony?
7. In the Club social app example, should v1 support external issuer allowlists or force Club-owned accounts?
8. If a shared app trusts a self-hosted issuer, how are users mapped, revoked, and moderated?
9. What would break if a self-hosted deployment uses one origin for auth, sync, and API?
10. What would break if hosted production uses separate domains?

Use code search before answering any question that can be checked locally.
Lead with concrete blockers and exact file references.
```

## Open Questions

1. **Does minimal self-hosting require Postgres?**
   - Options: (a) no, use SQLite or another embedded store for account state, (b) yes, require Postgres for all self-hosted accounts, (c) support a database adapter contract.
   - **Recommendation**: prefer a database adapter contract if Better Auth and the server package already make it cheap. Refuse Postgres as a universal self-hosting requirement unless account storage proves it is unavoidable.

2. **Should shared apps accept external deployment identities in v1?**
   - Options: (a) no, each shared app owns accounts, (b) trusted issuer allowlists only, (c) open federation.
   - **Recommendation**: use app-owned accounts for public social apps in v1. Add issuer allowlists only for controlled partner scenarios. Defer open federation.

3. **Is local-only a deployment or a separate app mode?**
   - Options: (a) model it as a deployment with no issuer/resources, (b) keep it as a separate workspace profile mode.
   - **Recommendation**: model it separately in implementation if that keeps auth code simpler, but keep it in the product matrix because users experience it as one of the three ways an app runs.

4. **Does Cloud need to be a resource in every app?**
   - Options: (a) no, workspace apps only need sync, (b) yes, every app should also know Cloud for billing and account UI.
   - **Recommendation**: no. Apps request only the resources they need. Dashboard and hosted control UI need Cloud. Workspace apps need sync.

## Success Criteria

- [ ] A reviewer can explain the difference between deployment, server, and Cloud in one sentence each.
- [ ] The spec identifies exactly when Postgres is required and when it is an implementation option.
- [ ] The Club example resolves whether self-hosted users can post to a centralized social app.
- [ ] Prior specs can reference this product contract without re-opening the OAuth credential boundary.
- [ ] No app-facing API requires raw tokens or Better Auth cookies.

## References

- `specs/20260511T150000-final-oauth-auth-architecture.md`: active OAuth and deployable split spec.
- `specs/20260511T115110-remote-storage-control-plane.md`: hosted storage registry and remote sync lifecycle design.
- `specs/20260512T114350-auth-token-capability-boundary.md`: private-token auth capability boundary.
- `packages/constants/src/*`: likely home for hosted URL constants to audit before introducing deployment metadata.
- `packages/auth/src/*`: auth client contract and token storage boundary.
- `packages/oauth-client/src/*`: OAuth discovery and launcher configuration.
