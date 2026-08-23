# JWKS signing-key greenfield: spec and position

Status: proposal for debate
Date: 2026-05-28
Scope: `packages/server` auth, `packages/constants` oauth, `apps/api` deploy scripts, prod `jwks` table

This spec states a position. It is meant to be attacked. Section 9 lists the
exact claims I expect to lose on, with the evidence that would flip each one.

## 1. Symptom

```
bun ../epicenter/packages/cli/src/bin.ts auth login
=> OAuth token exchange failed with status 500
```

Live probes:

```
POST https://api.epicenter.so/auth/oauth2/token  (bogus code) => clean 401 JSON   # route is up
GET  https://api.epicenter.so/auth/jwks          => { alg:"ES256", kty:"OKP", crv:"Ed25519", x:"6bnIE3...", kid:"B2Q7AbIx..." }
```

One key in prod. Its `alg` claims ES256 but its material is Ed25519/OKP. That is
not a valid key; it is a contradiction.

## 2. Root cause (verified against installed `better-auth@1.5.6`)

```
adapter.mjs:8   getLatestKey -> findMany('jwks').sort(createdAt desc)[0]      # newest row wins
sign.mjs:33-34  key = getLatestKey(); if (!key || expired) key = createJwk()  # only mints when none/expired
sign.mjs:41     alg = key.alg ?? keyPairConfig.alg ?? "EdDSA"
sign.mjs:42     importJWK(material, alg)        # Ed25519 material + "ES256" => THROW => 500
index.mjs:118   /jwks overlays alg:ES256, then spreads stored {kty:OKP,crv:Ed25519}  # the contradiction we observed
```

The Epicenter `jwks` table has no `alg` column (`db/schema/auth.ts`), so
`key.alg` is always `undefined`, so signing always falls through to the
configured `ES256`, so any non-P-256 stored key crashes `importJWK`. The row is
newest and has no `expiresAt`, so `createJwk` never fires and the table never
self-heals.

History: prod ran the jose/Better Auth default (EdDSA/Ed25519) before ES256 was
pinned. That one Ed25519 row is the entire failure.

## 3. What is NOT the bug

`HEAD`'s `packages/server/src/auth/plugins.ts` is already correct:

```ts
jwt({ jwks: { keyPairConfig: { alg: 'ES256' } } })   // no filter, no custom adapter
```

The `adapter.getJwks` filter (`isConfiguredJwtKey` + `parsePublicJwk`) was
**uncommitted WIP**, never on `HEAD`. So the code was never wrong. The bug is
100% durable prod data, and the "current patch" is a runtime mask we should
reject.

## 4. Product sentence (the invariant I want to own)

> Epicenter auth config owns JWT signing policy (`keyPairConfig.alg: ES256`).
> Better Auth owns signing mechanics. Durable `jwks` rows represent only valid
> keys for that policy. A deploy-time admin operation enforces that invariant.
> No request path repairs durable drift.

## 5. Decision

```
keep   ES256 policy in Better Auth config (request path, Worker-safe)
delete the stale Ed25519 row in prod, once
refuse a request-path filter (repair-in-read-path runs forever to mask one row)
refuse changing the signing algorithm to dodge the data fix
```

The code at `HEAD` needs no behavior change. The fix is operational: remove the
stale row; Better Auth mints a compliant ES256 key on the next sign.

## 6. Scope of the prod "greenfield" (answering "delete all of prod?")

```
table          contains                      touch?
-------------- ----------------------------- ----------------------------------
jwks           regenerable signing material  YES: truncate (1 stale row today)
oauth_client   projection of code            no: seed script upserts idempotently
user/account   real identities               no: durable user data
session        live logins                   no: wiping = mass logout, no benefit
room/workspace real user content             no
```

`jwks` is the only table implicated. Truncating it is zero user impact: access
tokens are short-lived (Better Auth default 15m), and signing is already broken,
so no live valid token depends on the current key. Wiping anything else destroys
real data to fix a key-rotation issue. Wrong blast radius.

Prod today has exactly one `jwks` row and it is the broken one, so
`DELETE FROM jwks` and "delete non-ES256 rows" are identical in effect.

## 7. The algorithm clean-break (answering "better alg greenfield?")

```
option                       login fix          cost
---------------------------- ------------------ ---------------------------------
A. keep ES256, delete row    one-time DELETE    none; verifiers keep broad support
B. switch policy to EdDSA    zero data change*  sacrifices verifier breadth
C. static/secret signing key permanent          reimplements Better Auth surface
```

\* Option B is seductive: the stranded prod row IS Ed25519, so switching the
policy to EdDSA makes it valid and login works with no DB change. I reject B:
ES256 was pinned for "broadest verifier-library support across browser `jose`,
Tauri Rust crates, and mobile." EdDSA JWT verification is narrower in the wild.
Trading a real verifier-compat requirement to avoid a one-row DELETE is the tail
wagging the dog. B is only correct if every Epicenter verifier (browser, Tauri
Rust, mobile) is confirmed to handle EdDSA, in which case B is the jose/Better
Auth default and strictly simpler. **This is the single biggest open question.**

Option C eliminates the stale-row failure class permanently but fights the
library (collapse-pass: do not reimplement a library's public surface). Rejected
for a one-time incident.

## 8. Where the enforcement lives (the boundary that emerged in parallel)

> SUPERSEDED by §12 and §13. This section argues `cleanupStaleJwks` earns a home
> in `@epicenter/server/admin`. The later decision rejects that: there is no
> library cleanup surface. `jwks.ts` (`cleanupStaleJwks` + `isPolicyJwk`) was
> deleted, and the EdDSA->ES256 drift fix is a one-time SQL delete (§12, §13).
> Kept for the debate record only.

A second agent is building `@epicenter/server/admin` as a separate entry that
holds pg-importing deploy-time ops, kept out of the request-path barrel:

```
@epicenter/server          request path; NO pg/node-postgres in the module graph (Worker-safe)
@epicenter/server/admin    deploy-time ops: seedTrustedOAuthClients, cleanupStaleJwks
apps/api scripts           oauth:seed:* , jwks:cleanup:*  (infisical-wrapped for :remote)
```

I initially deleted `cleanupStaleJwks` as over-built for a one-time fix. I now
think that was wrong, for two reasons:

1. **The /admin boundary is paid for by `seedTrustedOAuthClients` regardless.**
   Seed already needs pg isolation from the Worker graph. Adding cleanup beside
   it is marginal, not a new abstraction.
2. **Self-hosted team deployments can hit the same drift independently.** A
   self-hoster who ran EdDSA before pinning ES256 gets the identical 500. A
   repeatable `jwks:cleanup` is then a real product tool, not an Epicenter-only
   one-shot. That is a concrete recurring trigger, which passes the greenfield
   earned-trigger test.

So `cleanupStaleJwks` (selective delete of non-policy rows) earns a home in
`/admin`. The prod fix is then "run the script once," and the tool stays for the
next deployment that needs it.

## 9. Claims I expect to lose on (debate targets)

```
C1  cleanupStaleJwks is still over-built. A one-time `DELETE FROM jwks` plus a
    note is enough; self-hoster drift is hypothetical until one reports it.
    Flip if: no self-hoster path realistically predates ES256, and the team
    deployable defaults to ES256 from first boot.

C2  Option B (EdDSA) is actually correct and I am over-weighting verifier
    breadth. Flip if: all verifiers (browser jose, Tauri Rust crate, mobile)
    are confirmed to verify EdDSA. Then B is zero-cost and simplest.

C3  isPolicyJwk encodes the invariant by curve (EC/P-256) not algorithm. If the
    policy ever moves to ES384/P-384 or RSA, the predicate silently mis-deletes.
    A future-proof predicate should derive valid curves from keyPairConfig, not
    hardcode P-256. Flip if: ES256 is permanent, in which case hardcoding is
    honest.

C4  Truncating jwks vs deleting-only-non-policy-rows. If prod might gain a valid
    ES256 row before cleanup runs, a blind truncate throws away a good key.
    Selective delete is safer. (I lean selective; truncate is fine only because
    prod has one bad row right now.)

C5  The whole admin entry is unnecessary if the Worker never imports the barrel
    transitively. Flip if: the Worker's import of `@epicenter/server` provably
    tree-shakes pg out, making /admin pure ceremony. (I doubt bundlers drop a
    top-level `export ... from './auth/jwks.js'` that imports pg, but this is
    checkable.)

C6  Regression coverage. The in-memory "clean table mints ES256" test never
    reproduces the stale-row crash. Should there be an integration test that
    inserts an Ed25519 row and asserts cleanup + successful sign? (Needs pg.)
```

## 10. Residual risk until live retry

```
- Not self-healing: until cleanup runs against prod, login stays broken (same as now).
- isPolicyJwk is destructive: a false negative deletes a valid key. Unit-tested,
  not yet run against the real row; recommend a read-only SELECT before the first
  remote run.
- End-to-end is proven only in-memory; the real check is `epicenter auth login`
  against api.epicenter.so after cleanup.
```

## 12. Update: post override-experiment (settles several claims)

### Override experiment (Option B in the deploy-helper spec): DEAD

```
root package.json + "overrides": { "@better-auth/core": "1.5.6" } + bun install
=> "no changes"; find node_modules/.bun -name '@better-auth+core@*' STILL returns 2 dirs
   (+4b1fb26a, +6e2c8aa4).  @epicenter/server still fails the dup typecheck.
```

`overrides` pins a *version*; these copies are the *same version* differentiated
by *peer hash* (better-auth's optional peers: pg/drizzle vs svelte). A
version-level lever cannot collapse a peer-level split. Reverted; root is clean.
Both my run and the parallel agent's run agree.

### The dup is caused by pg/drizzle entering @epicenter/server's program

The parallel agent's State A/B/C table shows the failing copy flips with the tsc
program shape. The mechanism: when pg/drizzle-bound deploy helpers
(`seedTrustedOAuthClients`, `cleanupStaleJwks`) live in `@epicenter/server`, that
package's program mixes the better-auth type graph with the pg/drizzle graph and
TS canonicalizes the wrong `@better-auth/core` copy. So this is not only a
principle question; **removing pg/drizzle from `@epicenter/server`'s program is
the likely actual fix** for the server typecheck.

### My recommendation: Option D, split by operation

```
operation   shape                                  dups touched
----------- -------------------------------------- ------------------------------
cleanup     raw SQL in an apps/api script (or one  NONE. No drizzle table object,
            -time manual run); no library surface  no schema import, no better-auth.
seed        app-owned; needs structured upsert     drizzle only (no better-auth).
            -> hardest case; may need raw SQL or a  Lives in apps/api, so it never
            drizzle dedupe                          mixes pg into the server program.
```

Cleanup is a single conditional DELETE; it does not need drizzle's query
builder, the `schema.jwks` object, or better-auth. As raw SQL it dodges BOTH
duplicate-package landmines:

```sql
DELETE FROM jwks
WHERE (public_key::jsonb->>'kty') IS DISTINCT FROM 'EC'
   OR (public_key::jsonb->>'crv') IS DISTINCT FROM 'P-256';
```

This also resolves C1: cleanup is no longer a library function whose existence
needs justifying against packaging cost. It is a deployment operation, matching
the repo thesis ("deployments own deploy-time concerns"). `jwks.ts` (the library
`cleanupStaleJwks` + `isPolicyJwk`) should then be deleted.

### Claims now settled

```
B  (version override)  DEAD. Confirmed by two independent runs.
C2 (alg)               KEEP ES256. A scoped one-row DELETE is cheaper than
                       re-verifying EdDSA across browser/Tauri-Rust/mobile and
                       re-migrating keys. Revisit only on verifier evidence.
C3 (alg one-owner)     FIXED, then narrowed. Superseded by §13: with isPolicyJwk
                       deleted, { kty, crv } had no live consumer, so the constant
                       is now JWT_SIGNING_ALG = 'ES256' (algorithm only). Better
                       Auth derives the EC / P-256 key shape from that alg; the
                       one-time cleanup SQL hardcodes kty=EC / crv=P-256 on its
                       own. The constant stays a better-auth-free leaf module.
C1 (cleanup earned?)   Resolved toward NO library surface: raw-SQL deployment op.
```

### Resolved by the Option D experiment (this commit)

SEED placement: Option D landed, with one correction. The experiment confirmed
the spec's hypothesis: removing the pg/drizzle-bound deploy helpers from
`@epicenter/server`'s program makes the server typecheck green. But a naive
Option D (seed script imports the `@epicenter/server` request-path barrel for
`projectTrustedOAuthClientToRow`) just relocates the better-auth dup: the barrel
transitively pulls `plugins.ts` / `create-auth.ts` / `routes/auth.ts` into the
script's resolution, which re-rolls which `@better-auth/core` copy TypeScript
canonicalizes and flips `apps/api` from pass to fail (the whack-a-mole of
`20260528T120000-deploy-helper-duplicate-package-typecheck.md` §2.2).

The landing shape that clears BOTH typechecks:

```
packages/server/src/auth/jwks.ts          DELETED (cleanupStaleJwks + isPolicyJwk gone)
packages/server/src/admin.ts              DELETED (no library deploy-time admin surface)
packages/server/package.json              -"./admin"; +"./oauth-clients"
packages/server/src/auth/trusted-oauth-clients.ts
                                          seedTrustedOAuthClients removed; only the pure
                                          projectTrustedOAuthClientToRow remains; schema
                                          import is now `import type` (no runtime pg/drizzle)
apps/api/scripts/seed-oauth-clients.ts    owns pg + a raw parameterized upsert; reuses the
                                          projection via @epicenter/server/oauth-clients
apps/api/scripts/cleanup-stale-jwks.ts    DELETED (cleanup is the one-time SQL below)
```

Two pieces make this work together:

1. The seed runs as **raw parameterized SQL**, not a drizzle query, so it never
   compares `apps/api`'s `drizzle-orm` copy against the server-schema table
   object (that comparison is the drizzle dup Option D §4 warned about).
2. The projection is reused through a narrow `@epicenter/server/oauth-clients`
   entry that carries no better-auth, `pg`, or runtime `drizzle`. Importing it
   keeps the request-path auth graph out of the script's program, so the
   better-auth copy canonicalization does not flip `apps/api`.

Net: server typecheck green; `apps/api` has zero non-billing typecheck errors.
The library exposes no pg-bound admin surface, matching the repo thesis.

Cleanup tooling: DELETED, not kept as a turnkey script. The one-time fix and the
self-hoster recovery for the same EdDSA->ES256 drift is a single SQL statement,
run against the deployment's database (prod via `infisical run --env=prod
--path=/ops -- ...`):

```sql
DELETE FROM jwks
WHERE (public_key::jsonb->>'kty') IS DISTINCT FROM 'EC'
   OR (public_key::jsonb->>'crv') IS DISTINCT FROM 'P-256';
```

Better Auth mints a compliant ES256/P-256 key on the next sign. `IS DISTINCT
FROM` also removes rows with malformed or null key material, not just Ed25519.

## 11. Invariants that must not change

```
ES256 signing (id_token_signing_alg_values_supported), unless C2 resolves to EdDSA
audience https://api.epicenter.so
CLI client id epicenter-cli
routes /auth/cli-callback, /auth/oauth2/authorize, /auth/oauth2/token
```

## 13. Final constant shape (landed)

Once `jwks.ts` (`cleanupStaleJwks` + `isPolicyJwk`) was deleted, the only live
reader of the signing constant was `plugins.ts`, and it reads `alg` alone. So the
constant collapsed from a three-field policy object to a single algorithm:

```
before  JWT_SIGNING = { alg: 'ES256', kty: 'EC', crv: 'P-256' }   // kty/crv dead
after   JWT_SIGNING_ALG = 'ES256'                                  // alg only
```

Grounded in installed `better-auth@1.5.6`:

```
gen-Crf1mz_x.mjs:29-36   alg 'ES256' -> generateKeyPair('ES256', { extractable })
                         crv is destructured out and never passed for ES256
utils.mjs:10,24          sign/import read keyPairConfig.alg || 'EdDSA'; alg only
types (JWKOptions)       ES256 member is { alg: 'ES256'; crv?: never }
```

So `{ kty: 'EC', crv: 'P-256' }` on the published JWK is `jose`'s output for an
ES256 key, not config Epicenter supplies. `plugins.test.ts` proves a clean table
publishes that shape. The one-time cleanup SQL hardcodes `kty=EC` / `crv=P-256`
independently (it is a different concern: identifying durable non-policy rows),
so removing them from the constant does not weaken cleanup.

ES256 is retained over EdDSA (C2): EdDSA is cryptographically fine and now in
FIPS 186-5, but ES256 stays the broader-compatibility default across browser
`jose`, Tauri Rust, and mobile until a real cross-verifier audit says otherwise.
