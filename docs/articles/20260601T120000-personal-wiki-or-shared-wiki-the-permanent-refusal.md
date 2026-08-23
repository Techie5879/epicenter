# Personal Wiki or Shared Wiki: The Permanent Refusal

Historical note: this article records the product argument that replaced
`team` with `shared`. ADR-0075 later collapsed the implementation to
`personal | instance`: the self-hosted instance is still one flat partition, but
the old `shared({ admit })` factory and `ownerId === 'shared'` sentinel are no
longer current API.

Epicenter is a personal wiki or a shared wiki. That sentence took us longer to find than it should have, because we almost called the second mode "team."

## The Wrong Turn

"Team" lies. Not maliciously, just structurally. The word carries a promise: seats, roles, an admin panel, SSO, audit logs, per-document permissions, offboarding with revocation. A whole SaaS product worth of machinery. We looked at the code backing our multi-user mode and it was forty lines: one shared partition key, an email allowlist, one shared encryption keyring derived from the deployment's `ENCRYPTION_SECRETS`. That code cannot cash a "team" check. Calling it team was writing a product story we had no intention of building.

The rename is not just cosmetic. Names set expectations. When a user reads "team," they reach for admin controls. When a prospective enterprise customer reads "team," they ask about SSO and provisioning. When a support ticket comes in about the "team" feature, it is almost always about a thing a team product is supposed to do and a wiki flatly does not. The word trains the wrong question.

## Two Axes We Had Welded Together

The confusion had a structure. We were conflating two independent decisions:

```
Operator axis       who holds the secrets and runs the box
                    Epicenter-hosted  vs  self-hosted

Topology axis       how partitions are carved
                    per-user (one partition per identity)
                    shared   (one partition, multiple members)
```

"Personal vs team" was a diagonal line drawn across both axes at once. A self-hosted deployment with one person using it is not a team. An Epicenter-hosted deployment shared by three people is not an org. The old framing could not express those combinations without bending.

Once you name the axes separately, the factory functions write themselves. There is an ownership discriminant in `packages/server`, and call sites never type the discriminant directly:

```ts
// Personal: each identity owns their own partition
personal()

// Shared: one partition, members determined by admit()
shared({ admit })
```

The operator axis is handled by which deployable you are running (`apps/api` vs `apps/self-host`). The topology axis is handled by which factory you call. They do not bleed into each other.

The sentinel matters here too. The shared partition bakes a durable string into every R2 object key and every Durable Object name (`owners/<ownerId>/rooms/...`). Renaming `"team"` to `"shared"` in that sentinel is free before any data is written and permanent after. So we name it correctly now, while the cost is zero.

## The Reframe: It Is a Wiki

Once the axes were separated, the right words appeared. Per-user is a personal wiki. One person, their identity is the partition, nothing to administer. Shared is a shared wiki. A fixed, vetted set of people share one partition as equals. Membership is the only access control. There are no roles, no tiers, no admin users.

"Wiki" carries the flatness natively. Everyone who has ever used a wiki understands the implicit rules: you are either in or you are out, and if you are in, you can read and write everything. No one expects per-page permissions on a team wiki. No one asks the wiki for an audit log. The word sets the right expectations without a paragraph of fine print.

It also describes what the product actually is. A personal wiki is your exobrain, materialized to a folder you own. A shared wiki is that same thing, but the partition is jointly held. Both modes are wikis. The mode is just about how many people share the root.

## The Permanent Refusal

Here is the centerpiece. The flat shared wiki gets its value from what it refuses to answer.

Per-document ACLs: no. Role hierarchies: no. Admin consoles: no. Offboarding with revocation: no. Audit logs: no. SSO integration: no.

Those are not missing features on a roadmap. They are a different company. The flat wiki keeps its value precisely by saying it does not do those things. Membership is the only control, and that is the design, not a gap.

We target small, high-trust groups: a founding team, a research duo, a household, a small practice. Those groups do not need roles. They need a shared place that works. The flat wiki is that place. The moment you add levels of admin, you have left the wiki and built a bad half-org. And you have inherited something worse: the migration. Every user who joined expecting flat access now lives in a permission model they did not sign up for. There is no honest middle position. Pick flat-forever-by-design, or do not ship shared at all.

This is a permanent refusal, not a v1 you grow admin tiers onto later.

## Why This Aligns with How Yjs Actually Works

There is an engineering reason this refusal is the right call, and it goes deeper than product discipline.

A Yjs workspace syncs as a whole. When you authenticate, you get the entire shared document set. The protocol has no notion of partial visibility. You cannot say "sync only the documents Bob is allowed to see," because Yjs does not want to do that. The unit of access is binary: can you connect to this workspace, or not.

```
Per-document ACLs would require:
  shard the CRDT per document
  filter the sync stream per member per document
  rotate encryption keys per document per membership change

Flat shared wiki requires:
  one membership check at the door
  one shared keyring from /api/session { user, ownerId, keyring }
  the whole workspace syncs
```

The flat wiki aligns with how Yjs already works. The refusal is not fighting the grain of the engine. It is following it. We established in the Jazz comparison article that refusing partial replication is what lets us stand on Yjs and open standards instead of rolling a custom sync engine. The same logic applies here. Refusing per-document ACLs means we never have to shard the CRDT, never have to build a filtered sync layer, never have to own key-per-document rotation. The engine gives us the design for free, and we take it.

## The Honest Boundary

Membership removal is forward-only. When someone leaves the allowlist, their next request gets blocked. But they already synced the shared workspace to their device. Local-first means the data lives on their machine. And they hold the keyring from their last session, derived via HKDF from the deployment's `ENCRYPTION_SECRETS`. The server cannot claw that back.

A "team" product is expected to truly revoke: key rotation, re-encryption of every document, scrubbing the old member's access from the keyring. A shared wiki honestly cannot deliver that, because one shared keyring plus local-first sync means every member already holds the keys.

This is not a bug. It is the defining boundary, and it is only honest if you call it a wiki. The premise of a wiki is mutual trust. You invite people you trust. If that trust breaks, the wiki was the wrong tool. Calling it a team implies we can revoke you properly, and we cannot. Calling it a wiki tells you upfront: we trust each other here, and that trust is load-bearing.

## The Support-Burden Payoff

Refusing the team feature set removes a long tail of B2B support. Permission confusion disappears because there are no permissions. Offboarding incidents disappear because offboarding is removing an email from a list. Compliance questions about audit logs and SSO go to a product that actually builds those things.

Combined with community-supported self-hosting, where deployers hold their own `ENCRYPTION_SECRETS` and run their own box, so we are not on call for their infrastructure, this removes most of the operational burden a team product would carry. "Most" is doing real work in that sentence. I want to be honest that it is not a measured number. The burden that stays: Yjs sync edge cases at scale, the cost of syncing the whole workspace on first auth for large deployments, keyring confusion when someone rotates secrets without re-deriving correctly, OAuth callback setup, and the forward-only-removal conversation that happens when someone leaves a shared wiki and expects a hard revoke. Those are real. We own them. But they are a much shorter list than what a team product owns.

## The One Sentence That Encodes All of It

Epicenter is a personal wiki or a shared wiki.

That sentence is load-bearing. It tells you the two modes. It tells you both modes are wikis, so both modes are flat. It tells you there is no third mode: no team, no org, no enterprise tier that adds the controls the wiki refuses. It tells you that knowing what you refuse to build is the architecture.

The asymmetric win article said: refuse ten to twenty percent of the functionality to delete eighty to ninety percent of the complexity. The "organization is a deployment" article said: the org boundary is a server, not a feature. This is the same move applied to the topology question. Refuse roles, refuse ACLs, refuse the admin console, and what is left is a product that actually works for the people it is built for.

Know what you refuse. The refusal is the architecture.
