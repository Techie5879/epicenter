# Second-Brain Publishing Contract (Phase 1: live-render blog)

**Date**: 2026-06-03
**Status**: Draft
**Owner**: Braden
**Builds on**:

- `specs/20260602T120000-wiki-core-collections-traits-and-curation.md` (the `publishing` type, visibility enum, `publishedAt`)
- `specs/20260602T200000-...-vault-read-only-projection.md` (markdown is a one-way projection of Yjs)
- `specs/20260602T233000-...-composable-apps...md` (per-user instance = a Durable Object holding your Yjs truth + SQLite)
- `specs/20260602T235900-the-ark-anti-slop-doctrine.md` (strategy; OWNS the Phase 0 buyer/paywall decision this spec defers to)

## One Sentence

A page that opts into the settled `publishing` type, sets visibility public, and is committed by a human-only `publishedAt`, is served as a live-rendered page at your own subdomain by your per-user Durable Object, with no static build pipeline and no way for a private note to leak.

## How to Read This Spec

```txt
Read first:        One Sentence · The Contract · Accidental-Publish Guard · Phase 1 plan
Read if building:  Architecture · The attachMarkdownExport gap · Edge Cases
Strategic (NOT here): who pays / what the paywall is  → owned by the anti-slop doctrine spec (Open Question 0)
```

## Overview

Keeping your second brain in Epicenter should give you a blog for free. This spec
defines the minimum contract that makes a page publicly viewable: opt into the
`publishing` type, commit with `publishedAt`, and your instance serves it live.
No separate CMS, no static site generator, no second editable copy to drift.

## Motivation

### Current State

A draft contract (verbal, prior conversation) proposed putting `visibility`,
`slug`, and `syndicate` on the worldview-neutral core Page, projecting all pages
where `visibility != private` into a `.published/` folder, running a static site
generator over it, and uploading to R2.

A five-agent grill checked that draft against the repo and found it wrong in
three verifiable ways:

1. **It contradicts the settled wiki spec.** `specs/20260602T120000` deliberately
   removed `stage`/`visibility`/`destinations` from core and modeled publishing as
   an opt-in `publishing` type (a Tana-style supertag), to avoid the
   `epicenter-md` status-overload failure. The draft re-introduced the exact
   mistake that spec was written to kill.
2. **It cannot be built on the shipped primitive.** `attachMarkdownExport`
   (`packages/workspace/src/document/materializer/markdown/export.ts`) exports the
   whole table; it has no `select` predicate, and its observe handler only unlinks
   on row-delete/invalid. A public to private flip would keep the file forever: a
   privacy bug, not a cosmetic one.
3. **It folds `audience:<id>` into the visibility enum.** The settled enum is only
   `private | unlisted | public`. Gated reads are an auth-on-every-read system
   built on the capability-token primitive, not a fourth dropdown value.

### Desired State

```txt
write a note  →  add the `publishing` type  →  set visibility public  →  human sets publishedAt
              →  your DO serves braden.epicenter.so/<slug>, rendered live from Yjs truth
```

No folder, no SSG, no static export, no syndication in v1. Living-docs is free:
a live-rendered page always reflects current truth.

## Research Findings

### Publishing is commodity; distribution is the gap

| Tool | Notes to site | Cost | What it lacks |
| --- | --- | --- | --- |
| Quartz / Obsidian Publish | yes | ~$0 / cheap | owned subscriber list |
| Bear Blog, mataroa | yes | ~$0 | second-brain integration |
| Notion public pages | yes | free | ownership, portability |
| Substack / Ghost | yes | paid | local-first source of truth |

**Key finding**: "notes to a public site" is a commoditized graveyard. The moats
this architecture is proud of (DO hibernation, R2 free egress, Yjs projection) are
invisible to the reader; they help margins, not adoption.

**Implication**: effortless publishing produces effortless obscurity. The
load-bearing differentiator is not the blog; it is an **owned email-list / RSS
primitive** (Phase 2) plus the **Whispering capture to publish pipeline** (the
unfair advantage). This spec ships the safe spine; it does not pretend the blog is
the wedge. See Open Question 0.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Publish vocabulary lives where | 1 evidence | The settled `publishing` type, NOT core | `20260602T120000` already decided this; keeps core worldview-neutral; projection set stays tiny (JOIN, not full scan) |
| v1 serving mechanism | 1 evidence | Live-render from the per-user DO | The DO is the single Yjs-truth holder and single writer; no folder exists in the cloud unless something pushes it; live render makes living-docs free |
| Static export / SSG / R2 | Deferred | Phase 4, only if traffic forces it | Premature; edge cache + Cache-Control covers personal-blog scale |
| Visibility tiers in v1 | 1 evidence | `public` + `unlisted` only | Settled enum; `unlisted` = unguessable slug, same model as the asset design, zero auth |
| `audience:<id>` (gated reads) | Deferred | Separate project on the capability-token primitive | Auth-on-every-read is a different system; never ship in the same release as public |
| Publish safety | 2 coherence | Two-key commit + capability wall + transclusion hard-fail | Accidental exposure of a private note is the franchise-ending failure for a second brain |
| Embedded media | 1 evidence | Reuse `/api/assets/<userId>/<assetId>`, rewrite refs at projection time | Path exists, works in cross-origin `<img>`, free egress; blog owns its media instead of hotlinking |
| Syndication / POSSE | Deferred | Phase 3 "Copy for X/LinkedIn" button first | Automated POSSE is a maintenance tax; X charges per-URL-post now |

## Architecture

```txt
YOUR SECOND BRAIN (Yjs truth in your per-user Durable Object)
  page (private by default: no publishing type at all)
        │  human opts in: add `publishing` type
        │  set visibility = public | unlisted
        │  human sets publishedAt   ← the commit key (see guard)
        ▼
PROJECTION (server-side, in the DO; single writer)
  query: pages carrying the publishing type WHERE visibility != private AND publishedAt set
        ▼
SERVE (the same DO's Hono app gains two UNAUTHENTICATED GET routes)
  GET /         → reverse-chron index of the projection set
  GET /:slug    → one row + body → markdown/HTML → one default theme
                  Cache-Control so the edge cache absorbs traffic
        ▼
  braden.epicenter.so/<slug>   (works while the DO hibernates between requests)
```

What is explicitly NOT here in v1: a `.published/` folder, a static site
generator, an R2 static export, `audience:<id>`, Marp/Remotion syndication.

## The publish surface (catalog)

```txt
publishing type (settled, from 20260602T120000):
  visibility   private | unlisted | public        // v1 ships unlisted + public
  publishedAt  human-only commit timestamp         // ARMS vs COMMIT, see guard
  slug         assigned once on first publish, uniqueness-checked, never re-derived from title
  (deferred)   destinations / syndicate, audience
```

### Rejected / deferred additions

| Candidate | Why not in v1 |
| --- | --- |
| `visibility: audience:<id>` | Auth-on-every-read; a separate capability-token project |
| `.published/<slug>.md` folder | Premature; the DO renders live. Becomes a portability EXPORT in Phase 4 |
| `syndicate: [...]` automation | Phase 3 starts as a clipboard button; automation is a maintenance tax |

## The `attachMarkdownExport` gap (Phase 4, not Phase 1)

The static-export path (Phase 4) needs a change to the shipped primitive. Recorded
now so it is not rediscovered later.

**Today** (`packages/workspace/src/document/materializer/markdown/export.ts`):
exports the whole registered table; the observe handler unlinks only on
row-delete/invalid.

**Phase 4 change**: add an optional `select: (row) => boolean` to
`ExportTableConfig`, applied in both the flush/observe loop and rebuild. Critically,
**"row no longer passes `select`" must be treated identically to "row deleted"**
(unlink + `fileState.delete`), or a public to private flip leaves the file on
disk. The R2 upload must then be a reconciling sync (list, diff, PUT, DELETE; R2
deletes are free) so an unpublished post actually disappears.

Phase 1 does not touch this primitive at all, because the DO renders live from
SQLite instead of from a file.

## Accidental-Publish Guard

Exposing a private note publicly is the one failure that kills a second-brain
product. Five layers, most already in the settled schema:

```txt
1. TWO-KEY COMMIT       visibility=public ARMS; a human-only publishedAt COMMITS.
                        publishedAt is never agent-settable and never CRDT-mergeable
                        to a truthy default. Kills fat-finger, bad-AI-edit, merge-publish.
2. DENY BY CONSTRUCTION publishing is an opt-in TYPE; a new note has no type, so the
                        projection (a JOIN on the type table) cannot reach it. Strictly
                        safer than scanning all pages for "!= private".
3. CAPABILITY WALL      AI "Polish" and any `epicenter run` agent are STRUCTURALLY barred
                        from writing publish fields. Polish rewrites prose; it can never
                        make prose public. Enforced at the action-invoke choke point.
4. TRANSCLUSION HARD-FAIL a public page that transcludes/links a non-public page REFUSES
                        to publish (silent inline = leak; silent omit = broken hole).
5. HONEST UNPUBLISH     one "Published" screen is both the publish surface and the full
                        live public footprint, with per-row unpublish. Warn once that CDN
                        cache / search index / syndicated copies may persist. Default noindex
                        until the user explicitly opts into search listing.
```

## Implementation Plan

### Phase 0 (decide before code; owned by the doctrine spec)

- [ ] **0.1** Name the precise first paying user (Whispering voice-capturer vs prolific PKM creator).
- [ ] **0.2** Name the paywall. The blog is free-to-serve, so it CANNOT be the paywall (owned email sending? custom domain? AI Polish? syndication?).

### Phase 1: the safe live-render spine

- [ ] **1.1** Wire the `publishing` type into the workspace schema per `20260602T120000` (visibility, slug, publishedAt).
- [ ] **1.2** Enforce two-key commit: `publishedAt` is human-only, non-agent-settable, non-mergeable.
- [ ] **1.3** Capability wall: bar agents/AI from writing publish fields at the action-invoke choke point.
- [ ] **1.4** Confirm/add an unauthenticated public GET path on the per-user DO (today everything may be session-gated).
- [ ] **1.5** `GET /:slug`: fetch row + body, render body (child Y.Doc/rich-text) to HTML, one default theme, Cache-Control.
- [ ] **1.6** `GET /`: reverse-chron index of the projection set.
- [ ] **1.7** Transclusion hard-fail on publish.
- [ ] **1.8** "Published" audit screen = publish surface + full footprint + per-row unpublish; default noindex.
- [ ] **1.9** Media: rewrite body image refs to `/api/assets/<userId>/<assetId>` at projection time; resolve the free-tier upload gate.
- [ ] **1.10** Ship `public` + `unlisted` only.

### Phase 2: close the read/revenue gap (decides the company)

- [ ] **2.1** Owned email-list / RSS-to-inbox primitive in the DO; marking a page public can deliver it to subscribers; the list is portable data.

### Phase 3: cheap distribution

- [ ] **3.1** "Copy for X / LinkedIn" clipboard button with post text + canonical link.

### Phase 4: deferred, separate projects

- [ ] **4.1** `.published/` standard-markdown export for external SSGs (add the `select` predicate then).
- [ ] **4.2** R2 static export as a per-route optimization, only if live render melts.
- [ ] **4.3** `audience:<id>` gated reads on the capability-token primitive.
- [ ] **4.4** Marp carousel / Remotion video syndication.

## Edge Cases

### Unpublish must mean gone
1. User flips a published page back to private (or clears `publishedAt`).
2. The projection JOIN no longer returns it; the live route 404s immediately.
3. (Live render makes this trivial; the Phase 4 static path is where the orphan/reconcile work lives.)

### Slug change
1. User edits a slug on a published page.
2. New slug serves; old slug 404s. Offer an optional 301 map, or accept dead links. (Slug assigned once by default to avoid this.)

### Public page transcludes a private note
1. Publish-time check finds a non-public transclusion/link target.
2. Refuse to publish with a clear message naming the offending reference. (Never inline, never silently omit.)

## Open Questions

0. **THE BLOCKER (owned by the doctrine spec, not this one): who is the first paying user, and what is the paywall?** The blog is free-to-serve, so it cannot be the paywall. Until this is answered, build Phase 1 (safe, strategy-independent) but do not invest past it. **Recommendation**: lead with the Whispering capture to publish pipeline; make the paywall owned-email-sending or custom domains, not the blog itself.
1. **Where does the rich-text body (child Y.Doc) become HTML at serve time?** This is the one real piece of new work; its cost sets the true cost of live render. **Recommendation**: scope this first in Phase 1.
2. **Does the per-user DO already serve unauthenticated GETs, or is everything session-gated?** A public blog needs an explicitly unauthenticated read path on the same DO that otherwise gates everything.
3. **Custom domains (`braden.com`) in scope?** Adds a Cloudflare-for-SaaS hostname layer. **Recommendation**: subdomain only in v1; custom domains are a candidate paywall feature.

## Success Criteria

- [ ] A note with the `publishing` type + `public` + a human `publishedAt` is viewable at `braden.epicenter.so/<slug>`, rendered live, while the DO hibernates between requests.
- [ ] A note WITHOUT the type is structurally unreachable by the projection (verified, not asserted).
- [ ] Flipping a page private 404s its URL immediately.
- [ ] No agent/AI path can set a publish field (verified at the choke point).
- [ ] Publishing a public page that transcludes a private note is refused.
- [ ] Embedded images serve from the user's own asset origin, not hotlinked.

## References

- `specs/20260602T120000-wiki-core-collections-traits-and-curation.md` - the `publishing` type, visibility enum, `publishedAt` (do not redefine)
- `packages/workspace/src/document/materializer/markdown/export.ts` - `attachMarkdownExport`; the `select`-predicate gap for Phase 4
- `specs/20260602T235900-the-ark-anti-slop-doctrine.md` - strategy; owns Phase 0
- `specs/20260602T200000-...-vault-read-only-projection.md` - one-way projection; `.published/` is desktop-local and gitignored
- `specs/20260522T240000-cloud-asset-access-model.md` - `/api/assets/<userId>/<assetId>`, unguessable-id read path
