# Privacy is a deployment: the star you run, the services you call, and the self-host configurations

- **Status:** Draft
- **Date:** 2026-06-24
- **Branch:** wash-saddle
- **Records (durable decisions, the authoritative homes):**
  - [ADR-0068](../docs/adr/0068-privacy-is-a-deployment-not-a-product-feature.md): privacy is a deployment, not a product feature; the hosted app carries zero privacy-configuration surface.
  - [ADR-0069](../docs/adr/0069-epicenter-is-one-runnable-star-plus-services-called-by-url-and-token.md): Epicenter is one runnable program (the star) plus a la carte services addressed by `{baseUrl, token?}`.
  - [ADR-0070](../docs/adr/0070-self-host-adds-no-new-ownership-or-auth-mode.md): self-host adds no new ownership or auth mode; single-user is a preset, only the credential source varies.
- **Builds on:** [ADR-0004](../docs/adr/0004-trust-the-relay-reject-zero-knowledge.md) (trust the relay; privacy is topology), [ADR-0035](../docs/adr/0035-durable-storage-is-one-per-person-coordination-box.md) (the star roles), [ADR-0066](../docs/adr/0066-runtime-portability-is-per-concern-injection-not-a-runtime-object.md) (the Bun star binary), and the article [`docs/articles/20260615T140000-dont-encrypt-the-data-dont-hold-it.md`](../docs/articles/20260615T140000-dont-encrypt-the-data-dont-hold-it.md).

## One sentence

```
Epicenter is a program you run plus services you call. Self-host runs the
program; either deployment calls the services; privacy is only about who runs
the program. There is no privacy ladder, only that one custody fork and an
orthogonal, already-config-driven service menu.
```

## What this spec is

The durable decisions now live in ADR-0068/0069/0070 (above); the vocabulary (relay, anchor, store, worker) lives in [`docs/CONTEXT.md`](../docs/CONTEXT.md); the user-facing trust copy lives in [`docs/trust-model.md`](../docs/trust-model.md). If this spec disagrees with an ADR, the ADR wins.

What stays here is the **in-flight map**: the model as a picture, the self-host configurations with their ASCII and honest pros/cons (today and after Iroh), the ledger of what self-host does and does not protect, and the work waves. When the waves land, this spec is deleted; the ADRs persist.

## The model in one picture

```
        THE STAR  - the program you run, the ONE custody fork
   ┌──────────────────────────────────────────────┐    run by:
   │ anchor (Y.Doc) · store (S3) · sync · identity │    • Epicenter = "hosted"
   └──────────────────────────────────────────────┘    • you        = "self-host"
      ▲                │ calls out (optional · {baseUrl, token?} · point anywhere)
      │ your devices   ▼
   ┌──┴──────┐   SERVICES YOU CALL
   │ phone   │   ┌──────────────────────────────────────────────┐
   │ laptop  │   │ inference  → Epicenter gateway / your Ollama  │ stateless
   │ browser │   │ blob URLs  → `epicenter blobs add` (a star)   │ owner-scoped
   └─────────┘   │            → OR the star's own S3 endpoint    │
                 └──────────────────────────────────────────────┘
   Privacy = who runs the STAR. A service only ever sees the one payload you
   hand it (a prompt, a blob). Moving a service endpoint is not moving custody.
```

The collapse this records: the earlier "privacy rung ladder" (hosted / own-anchor-blind-relay / full self-host) was false. Its "middle rung" was a service-endpoint swap mis-modeled as a custody change. There is one custody fork (the star) and a menu of callable services, nothing in between.

## The two axes inside the star (and why "sovereign" is not a third mode)

Running the star composes from two orthogonal seams that already exist in `packages/server`. Self-host needs no new mode; it picks values on these axes (ADR-0070).

```
  AXIS 1 · PARTITION  (OwnershipRule)        "whose data is it"
     personal  → owners/<userId>/            per-user partition
     shared    → owners/shared/  + admit()   one co-owned partition, allowlisted
        └─ exactly two. complete. a key is derived-per-identity OR pinned-to-a
           -constant; there is no third shape.

  AXIS 2 · AUTH  (resolveUser)               "how a request becomes an identity"
     OAuth │ local bearer token │ reverse-proxy header │ fixed-owner (dev only)
        └─ one TOTAL gate (every route resolves a user; no no-auth fork).
           only the CREDENTIAL SOURCE varies per deployment.

  "single-user / sovereign self-host" = a PRESET over these two
        ( shared(admit:always) OR personal-with-one-account )
        + ( resolveUser = local bearer token )
     NOT a new OwnershipRule.kind. single-owner is an emergent count, a
     consequence of admitting one identity, never a topology.
```

The decisive probe: `personal` with one user yields one partition; `shared` with one user yields one partition. Both already collapse to single-owner, so "sovereign" has no distinct partition behavior to add. It is a named preset at most, never a third kind.

## The configurations today (relay and anchor fused; the choice is binary)

```
  A · SOLO HOMELAB, always-on box                  flagship (after 2 fixes)
  ┌─────────┐         your box · one Bun binary
  │ laptop  │       ┌────────────────────────────────┐
  │ phone   │══TLS═▶│ star: anchor·store·sync·identity│ partition: personal
  │ desktop │       │ (desktop IS the anchor)         │ auth: local bearer token*
  └─────────┘       └────────────────────────────────┘ services: own or rented
   + your data never leaves the box   - needs the 2 gaps (* token source, client URL)
   + truest local-first               - you babysit Postgres + S3 + uptime

  B · SOLO, no always-on box                        does NOT work as self-host
  ┌─────────┐
  │ laptop  │   there is no durable holder. a sleeping laptop + a phone cannot
  │ phone   │   host the anchor. honest answer: use HOSTED (still private if you
  └─────────┘   trust the operator). this is a feature of "privacy is topology",
                not a gap to apologize for.

  C · FAMILY / TEAM, each owns their data           flagship (after 2 fixes)
  ┌─────────┐       your box · one Bun binary
  │ members │══════▶│ star, partition: personal (owners/<each-userId>/)        │
  └─────────┘       │ auth: reverse-proxy header in front of your own IdP      │
   + clean per-member isolation on one machine   - everyone needs an identity
   + one box to maintain                          - you are the ops team of one

  D · FAMILY / TEAM, self-hosted instance           supported NOW (only built one)
  ┌─────────┐       Cloudflare Worker (apps/self-host)
  │ members │══════▶│ star, partition: instance (owners/instance/)             │
  └─────────┘       │ auth: operator bearer                                    │
   + the one config with a real deployable + tests  - it is a CF WORKER (needs a
   + co-ownership matches a wiki's model              CF account, not your metal)

  E · SELF-HOST the star, RENT Epicenter services   useful, but a footgun
  ┌─────────┐  your box (star, docs local)    Epicenter (services)
  │ devices │═▶│ anchor + sync (yours)  │──{baseUrl,token}──▶ inference / blobs
  └─────────┘  └────────────────────────┘
   + offload GPU/models, keep the Y.Doc local   - RENTED BLOBS land in Epicenter's
   + inference sees only the prompt you send       R2, readable by Epicenter (your
                                                   media leaves the box). keep media
                                                   private => point the store at YOUR S3.

  F · AIR-GAPPED / SOVEREIGN                        advanced (after non-OAuth auth)
  ┌─────────┐  your box, zero Epicenter contact
  │ devices │═▶│ star + own Ollama (inference) + own S3 (store)                │
  └─────────┘  └──────────────────────────────────────────────────────────────┘
   + maximal sovereignty, no Epicenter bearer ever leaves   - blocked TODAY: the
   + inference (custom baseUrl) + S3 already supported         only built login is
                                                              Google OAuth (* the gap)
```

There is intentionally **no "partial self-host" config** distinct from the above. "Own your data but use Epicenter's relay" is not a row, because today the relay and anchor are fused in one Durable Object (ADR-0035), so it would still hand Epicenter your plaintext. It becomes honest only after Iroh.

## The same configurations after Iroh (the relay splits off, blind)

Iroh seals device-to-device transit (QUIC) and turns the relay into a blind forwarder of frames it cannot read. The custody question does not change (the anchor still decrypts and stores), so this is **better plumbing on the same configs**, plus one genuinely new option (G).

```
  A/C/F upgraded · sealed transit, same custody
  ┌─────────┐  Iroh sealed QUIC   ┌──────────────┐   ┌──────────────────────┐
  │ devices │═══════════════════▶ │ relay (blind) │─▶ │ your star (anchor...) │
  └─────────┘                     └──────────────┘   └──────────────────────┘
   the wire got sealed; the anchor did not move. still you-run. still private.

  HOSTED upgraded · sealed transit to Epicenter's anchor   (Leo: laptop+phone)
  ┌─────────┐  Iroh sealed QUIC   ┌──────────────┐   ┌──────────────────────┐
  │ devices │═══════════════════▶ │ relay (blind) │─▶ │ Epicenter star (reads)│
  └─────────┘                     └──────────────┘   └──────────────────────┘
   sealed wire, but Epicenter is still the anchor and reads at rest. NOT a new
   privacy rung: it is hosted (config B's answer) with better transport.

  G · NEW · own a lightweight anchor, borrow Epicenter's BLIND relay
  ┌─────────┐  Iroh   ┌──────────────┐  Iroh   ┌────────────────────┐
  │ phone   │═sealed═▶│ relay (blind) │═sealed═▶│ your anchor + store │ only YOU
  │ laptop  │  QUIC   │ Epicenter-run │  QUIC   │ (your data at rest) │ read it
  └─────────┘         │ + maybe login │         └────────────────────┘
                      └──────────────┘
   own your data WITHOUT standing up a public ingress: no port-forwarding, no
   OAuth issuer to run. honest ONLY because the relay is now genuinely blind.
   this is config A/C with the "reachability" burden handed to a blind helper.
```

So Iroh's one genuinely new configuration is **G**: own the anchor, rent only blind reachability. Everything else is an existing config with sealed transit.

## Encryption overlays (they ride on any configuration)

Epicenter encrypts no content today (not docs, not blobs); see [`docs/trust-model.md`](../docs/trust-model.md). Two narrow encryption returns are deferred, and both reuse one envelope, not three subsystems:

- **Secret confidentiality.** Default is "do not hold it": keep a secret device-local (OS keychain) and store only a reference in the doc, resolved at use. The **vault** (an explicitly encrypted, shared workspace, Argon2-derived key) is only for the residual case of a secret that must *both* sync *and* stay blind. Most secrets, including BYOK API keys (ADR-0054), never touch it.
- **Backup recovery.** Only earns its keep for a self-hosted star backing up to untrusted storage (the hosted user already trusts the operator with the live doc, so an encrypted backup buys them nothing). Minimal build: ship a snapshot `export`; let the user seal it with their own tool. A built-in `seal()` is a later convenience reusing the vault's one envelope.

## The honest ledger: is self-host "private enough"?

**Genuinely private today (confirmed against the code):**

- Epicenter never holds or sees self-hosted workspace data. The blob store is a portable S3 client (`s3-blob-store.ts`), so bytes live in your bucket, not R2.
- Auth is local to the deployment: your own Better Auth, Postgres, `BETTER_AUTH_SECRET`, OAuth client. No callback through Epicenter.
- No vendor-CDN remote code execution; the server emits no telemetry, billing, or update beacons.

**The honest caveats:**

1. **Gating gap: prebuilt clients cannot point at a self-host origin without a rebuild.** Node/CLI honor `EPICENTER_API_URL`; the browser apps bake `https://api.epicenter.so` and the OAuth client id at build time (`packages/constants/src/apps.ts`). Privacy-via-topology is meaningless if the client cannot choose the topology. **The most important fix.**
2. **The shipped self-host artifact is a Cloudflare Worker** (`apps/self-host`), which needs a Cloudflare account plus Hyperdrive. The "one Bun binary plus Postgres plus any S3" path exists (`apps/api/server.ts`) but is not packaged as the self-host artifact, has no migration docs, and ships no compiled binary.
3. **Login depends on Google OAuth** (email/password disabled in `base-config.ts`), so a self-hoster must register a Google app to log into their own box. ADR-0070's local credential source removes this.
4. **The relay sees metadata** (user id, node id, per-room co-presence, dispatched action names, timing, sizes, client IP). Yours when you run it; a who-talks-to-whom graph when you use Epicenter's. Even the future blind relay sees this; it only stops seeing content. Document, do not paper over.

So: self-host gives real **content** confidentiality against Epicenter today; the **reachability** of your own instance is the unfinished half (caveats 1 and 2), and the **no-cloud-login** half is caveat 3.

## Storage: versitygw for local/dev, Garage for self-host (not MinIO)

The blob store is endpoint-agnostic (`BLOBS_S3_ENDPOINT` is config), so any S3-compatible store works. We standardize on **versitygw** (`apps/api/compose.yaml`, an S3 API over a plain folder) for dev and the smallest self-host, and **Garage** (single-binary, S3-compatible) as the self-host default when you want a real object store. **MinIO is retired** from our docs and examples. The blob code never changes; the endpoint is configuration.

## The work (waves)

The work is making the deployment choice real and removing the self-host friction, which is concentrated in two seam-ready gaps plus one honest constraint. None of waves 1 to 3 need Iroh.

| Wave | Scope | Makes true |
|---|---|---|
| 1 | **Package the Bun star binary.** Built on `apps/api/server.ts`, a `compose.yaml` bundling Postgres + Garage/versitygw + the binary, a documented migration step, a `bun build --compile` artifact. | configs A/C/F: "a homelabber runs it in an afternoon" |
| 2 | **Client instance-URL setting** (browser + desktop), so a self-hosted origin is reachable from prebuilt apps without a rebuild, OAuth issuer/audience included. | caveat 1; privacy-via-topology actually deliverable |
| 3 | **Local credential source for self-host** (ADR-0070): a single-user bearer token printed at first boot as the default; reverse-proxy header and opt-in email/password as escape hatches; the fixed-owner resolver stays quarantined to dev. Optionally a `sovereign()`/preset factory beside `personal()`/`shared()` if ergonomics warrant. | caveat 3: no Google app to reach your own box |
| 4 | **Document the trust model honestly:** relay metadata, the IdP dependency, the rented-blob-locality footgun (config E), the "we can read your data on hosted, not self-host" line. | the honesty bar |
| 5 (later) | **The Iroh relay/anchor split:** a blind relay separated from the anchor, unlocking configuration G (own anchor + blind relay) and sealed transit on every config. | config G; sealed transit |
| 6 (later) | **The one encryption envelope:** the vault for must-sync-and-stay-blind secrets, and a turnkey `seal()` for backup, both reusing one primitive. | secret confidentiality + backup recovery |

## Non-goals and deferred

- **Privacy tiers / custody / seal as product features.** Rejected (ADR-0068). The hosted app has zero privacy surface.
- **A third "sovereign" ownership mode.** Rejected (ADR-0070). Single-user is a preset over `personal`/`shared` plus a local credential source.
- **A no-auth code path.** Rejected as a mode (ADR-0070). The same effect is the quarantined fixed-owner `resolveUser` provider behind a localhost guard.
- **A "partial self-host" privacy rung before Iroh.** Refused: false privacy claim while the relay and anchor are fused. Becomes configuration G after wave 5.
- **An encrypted hosted mode for the boxless-privacy user.** Deferred, additive-later per ADR-0004. Trigger: that user becomes a real, asked-for segment.

## ADRs recorded

[ADR-0068](../docs/adr/0068-privacy-is-a-deployment-not-a-product-feature.md), [ADR-0069](../docs/adr/0069-epicenter-is-one-runnable-star-plus-services-called-by-url-and-token.md), and [ADR-0070](../docs/adr/0070-self-host-adds-no-new-ownership-or-auth-mode.md), all Accepted 2026-06-24. The decisions are locked even though waves 1 to 3 are in flight, because the refusals (no privacy surface, no extra modes, no no-auth fork) are in force now; the waves are their consequences.
