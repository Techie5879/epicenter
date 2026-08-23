# Creative OS Stack Naming and Drop Serialization

**Date**: 2026-06-01
**Status**: Draft
**Author**: Epicenter
**Related**:

- `specs/20260525T130000-creative-os-composition-map.md`
- `specs/20260518T160639-theark-marp-shortform-content-engine.md`
- `docs/articles/20260525T120000-epicenter-local-first-creative-operating-system.md`

> Revised 2026-06-01: extended with destinations taxonomy, Ship adapter architecture, slug-by-convention identity, storage index, and composing (round 2 design panel).
>
> Superseded in part 2026-06-02: the universal-core schema here (`stage`, `visibility`, and a singular `type` on every drop) is REVISED by [20260602T120000-wiki-core-collections-traits-and-curation.md](20260602T120000-wiki-core-collections-traits-and-curation.md), which shrinks the core to worldview-neutral fields plus loose `tags` and moves stage/visibility/type into opt-in `types` (Tana supertags).

## Overview

Epicenter is a local-first creative OS whose apps are named by legible action, whose public destination is The Ark, and whose unit of work is a "drop": one markdown file carrying four orthogonal metadata axes.

This spec settles two things the composition map left open: what the apps are called, and how a single piece of work serializes to disk. It takes the four-compose-apps insight from the composition map to its conclusion (one editor) and pins the on-disk shape of a drop.

```txt
One sentence:
  A drop is one markdown file. Frontmatter is its identity.
  The body is its content and its relationships. Everything
  else (folders, ledgers, projections) is derived.
```

## Motivation

### Current State

The composition map names apps by their legacy product identities, and several of them overlap.

```txt
Compose (today)
  Honeycrisp    rich-text notes
  Fuji          rich-text CMS entries
  Opensidian    rich-text vault
  Open City     rich-text public spaces

  -> four apps whose only real difference is metadata defaults
```

Problems this leaves open:

1. **Naming has no law**: some names are places (The Ark), some are actions (Polish, Whispering), some are fruit (Honeycrisp, Fuji). A reader cannot predict what a name means.
2. **Four editors, one job**: Honeycrisp, Fuji, Opensidian, and Open City are the same editor wearing different metadata costumes.
3. **The unit of work is undefined**: the map talks about transcripts, notes, entries, and artifacts as if they were different kinds of thing. On disk they are all one markdown file.
4. **No serialization ruling**: nobody has said whether metadata is flat keys, sectioned YAML, or an external sidecar, and whether folders or frontmatter is the source of truth.

### Desired State

A naming law, a named stack, one editor, and one serialized unit.

```txt
Naming law:
  PLATFORM / DESTINATION  -> place / metaphor   (Epicenter, The Ark)
  TOOLS                   -> legible action      (Whispering, Polish, Clip, Draft, Ship)

Unit of work:
  drop = one markdown file (YAML frontmatter + body)
  body IS the content; body holds relationships as [[wikilinks]]
  frontmatter holds identity across four orthogonal axes
```

## The Naming Law

Two layers, one rule each.

```txt
Layer            Naming rule            Examples
---------------  ---------------------  ----------------------------
platform /       place or metaphor      Epicenter (the OS)
destination                             The Ark   (public network)

tool             legible action verb    Whispering (voice capture)
                                        Polish     (refine)
                                        Clip       (web capture)
                                        Draft      (compose)
                                        Ship       (publish)
```

Gold standard already shipping: Whispering (voice capture) and Polish (refine). They are verbs you can act out. New tool names inherit that test: if you cannot say "I am going to X this," it is not a tool name.

## The Named Stack

Epicenter is the umbrella (private, local-first). Inside it: The Brain (the substrate), The Workshop (private tools), and a bridge to The Ark (public). Tools live under Epicenter, not under The Ark. The Ark is a destination sibling.

```txt
EPICENTER  -- ecosystem / local-first creative OS (umbrella, private side)
|
+-- THE BRAIN      a folder of markdown files on disk (the substrate)
|
+-- THE WORKSHOP   private tools that read and promote drops
|     |
|     +-- Flow        home: the stage board; the brain made visible
|     +-- Whispering  voice -> drops          (keep; gold-standard name)
|     +-- Clip        web/tabs -> drops       (replaces "Tab Manager")
|     +-- Polish      refine drops            (keep)
|     +-- Draft       THE editor              (one app; presets are saved views)
|     +-- Ship        the membrane: publish/syndicate a drop outward
|
+== bridge ==> THE ARK   public, server-authoritative network
                         Ship's native 1:1 destination
                         Ship also fans out to Substack, Medium, X, short-video
```

Ship is the only tool that touches both the private side and the public side, which is exactly why it is its own named tool: it is the membrane.

### Apps That Die

The collapse is the point. Differences between the old compose apps were metadata defaults, not different programs.

```txt
Honeycrisp ---+
Fuji ---------+--> Draft   (one editor; old apps become saved facet/stage views)
Opensidian ---+
Open City ----+

Tab Manager -----> Clip
```

The four-compose-apps observation from the composition map is taken to its conclusion: one editor named Draft. A "Fuji view" or "Honeycrisp view" is now a saved view inside Draft (a stage filter plus a type default), not a separate application.

## The Drop: Four Orthogonal Axes

A drop is one markdown file: YAML frontmatter plus body. The body IS the content. The frontmatter carries exactly four metadata axes. Each axis answers a different question, and none constrains the others. This is a coordinate system, not a backbone.

| Axis | Field(s) | Question | Cardinality |
| --- | --- | --- | --- |
| classification | `type` (one) + `tags` (many) | what is this / what is it about | 1 + many |
| lifecycle | `stage` | where is it in its life | one |
| provenance | `source` | where did it come from | one, nullable |
| release | `destinations` | where has it been released | many |

Rulings:

- **"facets" is deleted, not renamed.** `type` is load-bearing because it is singular (what a thing is). `tags` is load-bearing because it is open and plural (what it is about). They answer different questions; do not collapse them back into one "facets" bag.
- **`source` is a provenance list (ids or URLs), never a navigation graph.** It is a bill of materials (what this drop was made from), not a hyperlink map: directional, acyclic, set-valued, closed at promote (see the Composing section). Associative links live in the body as `[[wikilinks]]`. Frontmatter is the drop's identity; the body is its relationships.
- **Serialization is flat top-level keys.** Sectioned YAML is rejected as premature namespace engineering. A minimal-core-with-external-sidecar is rejected because it breaks portability and self-containment, which is the whole point of markdown-as-truth.

### Canonical Frontmatter

```yaml
---
# identity
id: 01J8X7K9P2QW                              # ULID; content identity survives rename
slug: offset-market-runs-on-vibes            # human handle, unique, the Ship slug and the
                                             #   vocabulary-resolution key; stable, never re-derived from title
title: The Offset Market Runs on Vibes
description: Why carbon credits run on confidence, not proof.
# classification
type: essay                                  # singular; resolves (optionally) to drops/types/essay.md
tags: [climate, pricing]                     # opaque slugs; each resolves (optionally) to drops/tags/<slug>.md
# lifecycle
stage: compose            # capture | refine | compose | done
# provenance (bill of materials, array of upstream parents; not a graph)
source:
  - 01J8-walk-memo
# release (intent; receipts live in Ship's ledger, not here)
destinations: [ark, substack]                # opaque slugs; each resolves (optionally) to drops/destinations/<slug>.md
# daemon-maintained, never hand-edited
created: 2026-06-01T09:14:00Z
updated: 2026-06-03T11:00:00Z
---
Every carbon credit rests on a promise no one checks...
```

## Folders Are a Derived Projection

The canonical store is flat by id (`drops/<id>.md`). That is what the CRDT syncs, and it is fully portable. The daemon materializes read-only projections (`by-stage/`, `by-type/`) as symlinks so a human can browse them in Finder.

```txt
You author by frontmatter.
You browse by projection.

A Finder move means nothing.
Stage changes only by editing  stage: .
```

On disk:

```txt
vault/
  .epicenter/ship.json                       # Ship's ledger (receipts)
  drops/                                      # canonical truth: flat, id-named
    01J8X7K9P2QW.md
  by-stage/  capture/ refine/ compose/ done/  # derived projection (symlinks)
  by-type/   essays/ notes/ transcripts/      # derived projection (symlinks)
```

Rejected: folders-as-type and folders-as-stage. A file move would silently mutate a CRDT field, and hierarchy is single-parent so it cannot represent four orthogonal axes at once. The projection is one-way: frontmatter writes the tree; the tree never writes frontmatter.

## Evergreen: Visibility Is Orthogonal to Stage

`done` means released or finished, not public. Where a drop went lives in `destinations`, not in `stage`. There is no fifth "kept" or "lake" lane.

```txt
stage axis        capture -> refine -> compose -> done
                                                   ^
                                                   |  done = finished,
                                                   |  not public

visibility axis   destinations: [library]   private / evergreen lake
                  destinations: [ark, ...]   public
```

Evergreen reference material (contacts, API keys, notes you reread) is `stage: done, destinations: [library]`: released privately to your own library. Born finished is allowed; you can enter directly at `done`.

The terminal stage is named `done`, not `publish`, on purpose. "Publish" stays a pure destination action and never reads as "make public". `destinations: [library]` is the private evergreen lake; `[ark, substack]` is public release.

## Ship: One Publishable, Two Kinds of Adapter

Every destination projects from one canonical content shape. `description` is the universal subtitle, kicker, or hook.

```ts
type Publishable = {
  id: string;
  slug: string;
  title: string;
  description: string;   // Ark subtitle | Substack subtitle | Medium kicker | video hook caption
  body: string;          // markdown, canonical content
  cover?: Asset;
  tags: string[];
  canonical?: string;
};
```

Key insight: text destinations are projections (lossy, synchronous); short-video is a render (async, asset-producing). That asymmetry is honest, so Ship has two adapter kinds rather than one forced interface.

```ts
type TextAdapter<P> = (drop: Publishable, ctx: ShipContext) => {
  payload: P;
  warnings: string[];
};

type RenderAdapter<In, Out> = (drop: Publishable, ctx: ShipContext) => Promise<{
  input: In;
  output: Out;
  warnings: string[];
}>;

const toArk: TextAdapter<ArkPayload>;
const toSubstack: TextAdapter<SubstackPayload>;
const toMedium: TextAdapter<MediumPayload>;
const toTwitterThread: TextAdapter<TwitterThreadPayload>;

const toShortVideo: RenderAdapter<ShortVideoRenderInput, ShortVideoRenderOutput>;
```

### Destination Mapping

One Publishable, projected per destination. The same fields land in different slots.

| Publishable field | The Ark | Substack | Medium | X (thread) | Short-video |
| --- | --- | --- | --- | --- | --- |
| `title` | post title | post title | post title | first-tweet lead | title card text |
| `description` | subtitle | subtitle | kicker | hook tweet | hook caption (slide 0) |
| `body` | post body | post body | post body | split into tweets | one idea per slide |
| `cover` | hero image | header image | featured image | first-tweet media | poster + title card |
| `tags` | tags | tags | tags | trailing hashtags | metadata only |

### Short-Video Render Plan

This ties to the existing short-form content engine spec. The render adapter input is concrete.

```ts
type ShortVideoRenderInput = {
  renderer: 'marp' | 'remotion';
  aspect: '9:16';
  hook: string;                              // from Publishable.description
  hookClip: { src: string; durationSec: 2 }; // the 2-second face/pull intro
  voiceover: { src: string; transcript: Segment[] };
  slides: VideoSlide[];                      // body -> one idea per slide
  captions: ForcedAlignmentCaption[];        // force-aligned, burned in
  render: { fps: 30; width: 1080; height: 1920 };
};

type ShortVideoRenderOutput = {
  video: Asset;
  poster: Asset;
  captionsVtt: string; // captions.vtt
};
```

### Receipts vs Intent

The split is deliberate. Intent travels with the drop; operational state does not.

```txt
intent      destinations: [ark, substack]   -> lives in the drop's frontmatter
                                                portable, durable, hand-editable

receipts    urls, timestamps, hashes,       -> live in Ship's ledger
            retries, status                     .epicenter/ship.json, keyed by drop id
                                                operational, not durable markdown
```

The `.epicenter/ship.json` ledger:

```yaml
01J8X7K9P2QW:
  ark:
    status: live
    url: https://theark.so/p/offset-market-vibes
    contentHash: sha256-9f2c...
    publishedAt: 2026-06-03T11:04:00Z
    retries: 0
  substack:
    status: failed
    error: rate_limited
    retries: 2
    lastAttemptAt: 2026-06-03T11:06:30Z
```

Operational state (urls, hashes, retry counts, failure reasons) does not belong in the durable markdown. The drop declares where it should go; the ledger records what actually happened.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Naming law, two layers | 3 taste | Places/metaphors for platform and destination; action verbs for tools | A reader can predict what a name means; Whispering and Polish already prove the verb test. |
| Tools under Epicenter, not The Ark | 2 coherence | Tools live in The Workshop under Epicenter; The Ark is a destination sibling | Tools are private and local-first; The Ark is public and server-authoritative. Different ownership, different home. |
| Ship as the membrane | 2 coherence | One named tool spans private and public | Only Ship touches both sides, so it earns its own name and its own ledger. |
| Collapse four compose apps into Draft | 2 coherence | One editor; old apps become saved views | Honeycrisp, Fuji, Opensidian, and Open City differed only by metadata defaults. |
| Four orthogonal axes | 2 coherence | classification, lifecycle, provenance, release as independent fields | Each answers a different question; none constrains the others. A coordinate system, not a backbone. |
| Delete "facets" | 2 coherence | Split into `type` (one) + `tags` (many); do not keep "facets" | Singular identity and open description are different questions and need different cardinality. |
| `source` is lineage, not a graph | 2 coherence | One nullable pointer in frontmatter; associative links in body `[[wikilinks]]` | Frontmatter is identity; the body is relationships. A graph in frontmatter is the wrong layer. |
| Flat serialization | 3 taste | Flat top-level YAML keys | Sectioned YAML is premature namespace engineering; an external sidecar breaks portability. |
| Folders as derived projection | 2 coherence | Canonical flat `drops/<id>.md`; `by-stage/` and `by-type/` are read-only symlinks | A file move must never mutate a CRDT field; hierarchy is single-parent and cannot hold four axes. |
| Terminal stage named "done" | 3 taste | `done`, not `publish` | Keeps "publish" a pure destination action so it never reads as "make public". |
| Visibility orthogonal to stage | 2 coherence | Where it went lives in `destinations`; no fifth "kept" lane | `done` means finished; `[library]` vs `[ark]` decides private vs public. |
| One Publishable, two adapter kinds | 2 coherence | `TextAdapter` (sync projection) + `RenderAdapter` (async render) | Text destinations are lossy projections; short-video is an asset-producing render. The asymmetry is real. |
| Receipts in Ship ledger, not frontmatter | 2 coherence | `destinations:` intent in the drop; urls/hashes/retries in `.epicenter/ship.json` | Operational state is not durable markdown; intent is portable, receipts are not. |
| `type` cardinality | 2 coherence | Singular | `destinations` already owns one-to-many outputs; a type array double-counts the need it already holds. |
| Identity model | 2 coherence | Slug-by-convention with two-tier identity | Content identity is a ULID (survives rename); vocabulary identity is a slug (the name is the meaning). |
| `source` cardinality | 2 coherence | Array | A composed drop genuinely has N parents; `source[]` is a provenance bill of materials, not a navigation graph. |
| No `related:` field | 2 coherence | Deliberate non-addition | Avoids a hand-authored truth-layer graph that drifts, cycles, and grows without bound. Associations stay `[[wikilinks]]` in the body. |
| User `publish()` | 2 coherence | Refused | A user-authored `publish()` is SSRF-with-a-vault. The escape hatch is a PR or self-host, not a credential-bearing user verb. |
| Storage | 2 coherence | Reuse existing SQLite materializer; add derived edge tables; no graph store | The derived-index pipeline already ships; edges are triggers over existing primitives, not a parallel index with its own rebuild. |

## Destination Taxonomy

Memo 1 proposed seven kinds. Three of them (`forum`, `chat-message`, `issue`) are the same animal wearing different collars: host markdown, optionally footer a canonical. Collapse them. Five kinds, not seven.

| Kind | Hosts body? | Needs canonical first? | Brands |
| --- | --- | --- | --- |
| hosted-article | yes (full) | no (it mints it) | own blog, Epicenter blog, Medium, Substack |
| hosted-post | yes (subset) | no (optional footer) | Reddit self-post, Discord, GitHub Issue |
| link-submission | no | YES (hard gate) | HN, Reddit-link, Product Hunt, Bookface |
| microblog-thread | yes (chunked) | no (links back) | X/Twitter |
| vertical-video | yes (MP4) | no (independent) | TikTok, IG Reels, YT Shorts |

The collapse: `forum`, `chat-message`, and `issue` all have the identical adapter contract, take `title` plus a lossy `body` subset plus an optional `canonical` footer, post it, get a `Receipt`. The only difference is a config field (`subreddit` / `channelId` / `repo+labels`). That is a connection-row config value, not a kind. Three kinds that differ only by a config string are one kind: "host a markdown post with optional canonical attribution." One sentence, one kind.

`microblog-thread` and `vertical-video` stay separate because they genuinely differ in operation shape: a thread is a chunking projection (split at 280, sequence matters), and video is an async render, not a synchronous projection. Different verbs, different shapes. Honest asymmetry.

### Ship's two-wave ordering

```txt
WAVE 1  canonical-hosting (mints the URL)
  hosted-article (ONE designated primary) --> sets Publishable.canonical
  + other hosted-article / hosted-post set canonicalUrl --> primary (SEO rel)

        | canonical now resolved
        v
WAVE 2  link-submission  (HARD precondition: canonical != null)
  HN . Reddit-link . Product Hunt . Bookface
  + microblog-thread (links back to canonical)

INDEPENDENT (no canonical edge, runs parallel to Wave 1)
  vertical-video   (async render, self-hosting asset)
```

Four ordering rules, enforced by the Ship engine, not by convention:

1. Exactly one Wave-1 destination is `primary`; its returned `url` becomes `Publishable.canonical`. Every other hosted destination sets `canonicalUrl -> primary`.
2. Ship REFUSES to dispatch any `link-submission` while `canonical == null`. Hard precondition, surfaced as an error, never a silent skip.
3. Selecting only `link-submission` destinations with no host is an invalid plan. Error: "no canonical host selected." Never fabricate a URL.
4. `vertical-video` schedules in parallel with Wave 1 (no canonical dependency).

`link-submission` is not a special adapter type. It is a `hosted=false` adapter with `requiresCanonical: true`. The ordering gate lives in the Ship engine reading that flag, not in a parallel interface hierarchy.

## Ship Adapter Architecture (three layers)

The verdict first: a user-authored `publish()` is SSRF-as-a-service with a credential vault attached. Do not build it. Ship the safe layers, refuse the dangerous verb.

```txt
                    +-------------------------------------+
 Drop --Publishable-->|           SHIP ENGINE             |
                    |  (first-party; OWNS vault + fetch)  |
                    +--------------+----------------------+
                                   | resolves
      +----------------------------+----------------------------+
      v (3) DATA ROW                v (1) BUILT-IN        (2) USER v
 connection table              first-party TS         pure project() only
 id, kind, label,              substack/reddit/ark    no creds, no network,
 vaultRef (token id),          full PublishContext    runs in no-I/O isolate
 config(JSON)                  (real authed fetch)    paired w/ HTTP recipe
```

Layer 1, built-in adapters (first-party TS). The only code that touches the vault and the network. Two shapes, not one with a `mode` discriminator: text is a synchronous `project`, video is an async `render`.

```ts
export type Publishable = {
  id: string; slug: string; title: string; description: string;
  body: string; cover?: { url: string; alt: string };
  tags: string[]; canonical?: string;
};

export type TextAdapter<Payload> = {
  kind: DestinationKind;
  requiresCanonical?: boolean;                 // the ordering gate (link-submission = true)
  project(input: Publishable): Payload;         // PURE. no creds, no network, no clock.
  publish(p: Payload, creds: Credentials, ctx: PublishContext): Promise<Receipt>;
};

export type RenderAdapter<Payload> = {
  kind: DestinationKind;                         // vertical-video only
  render(input: Publishable, ctx: RenderContext): Promise<Payload>; // async artifact
  publish(p: Payload, creds: Credentials, ctx: PublishContext): Promise<Receipt>;
};
```

`PublishContext` is the only capability surface the effectful half gets: a host-allowlisted `fetch`, a structured `log`, and an `idempotencyKey` derived from `(drop id, kind, content hash)`.

Layer 2, user scripting. Open the door exactly this far and no further. A user authors a pure `project(Publishable) -> Payload` only: it runs in a V8 isolate with ZERO host bindings (no `fetch`, no creds, no env, CPU-capped, output size-capped), paired with a first-party declarative `HttpRecipe` for the authed POST. A user-authored `publish()` is REFUSED. The escape hatch is one of: open a PR to a first-party adapter, point an `HttpRecipe` at your own server, or (self-hoster) cross the trust boundary in your own Worker.

Layer 3, connection rows (data). Plain workspace data on the existing `defineTable`/`column` primitive. The token is NEVER in the row; the row holds a `vaultRef`. This is non-negotiable: row values sync as plaintext through the relay (the body-encryption-gap finding), so a raw token in a column leaks.

```ts
export const connectionsTable = defineTable({
  id:        column.string<ConnectionId>(),
  kind:      column.string(),                  // 'hosted-article' | 'link-submission' | ...
  brand:     column.string(),                  // 'substack' | 'reddit' | 'hackernews'
  label:     column.string(),                  // "My newsletter", "r/selfhosted"
  vaultRef:  column.nullable(column.string()), // pointer into the vault, NOT the secret
  config:    column.json(),                    // { subreddit } | { repo, labels } | { publicationUrl }
  createdAt: column.number(),
});
```

## Identity: Slug-by-Convention

Two-tier identity is law. Content drops use a ULID (identity survives rename). Vocabulary (type, tag, destination) uses a human slug (the name is the meaning). A frontmatter `slug` stores a plain string that OPTIONALLY resolves, by path convention, to a vocabulary drop carrying its metadata.

```txt
drops/types/essay.md          template + default destinations + description
drops/tags/climate.md         tag page + backlinks + aliases
drops/destinations/substack.md  adapter / connection config

PRESENT  -> behavior
ABSENT   -> plain label, always valid
```

Three laws make it a system, not a vibe:

1. Two-tier identity. Content is a ULID; vocabulary is a slug. You never hand-type a ULID into `tags:`, and you never let a slug's meaning drift silently.
2. Resolution is opt-in and lazy. A slug with no page is a label, not a dangling pointer. Absence is always valid.
3. Rename and merge via an `aliases:` list on the vocabulary drop, folded by the indexer at read time. Content drops are never rewritten to rename a tag.

| Property | Opaque | Slug-by-convention | Full-reference |
| --- | --- | --- | --- |
| markdown portability | perfect | near-perfect | BROKEN (cat useless) |
| grep-as-query | yes | yes | no |
| attach metadata | impossible | yes (term is a drop) | yes |
| rename / merge | manual | lazy aliases, no rewrite | clean but needs DB |
| manage a graph | immune | opt-in edges only | maximal |

Full-reference is disqualified: storing `tags: [01J8TAG-CLIMATE]` means you cannot `cat` or `grep` a drop without a database, which violates markdown-as-truth. Slug-by-convention keeps every opaque win (content drops stay byte-identical) and adds every full-reference win (metadata, lazy rename) without the portability catastrophe.

This collapses view, template, and type-page into one mechanism: a Draft view (`type: view`), a template (`type: template`), and the `essay` type page (`type: type`) are the same thing. Vocabulary is just drops keyed by slug.

## Storage and Query Index

SQLite (recursive CTEs plus FTS5) is sufficient; a graph or triple store is not warranted. The entire derived-index pipeline already exists and ships in three apps. The recommendation is to configure existing primitives in `packages/workspace`, not build infrastructure.

```txt
Yjs Y.Doc (TRUTH)
  |- attachBunSqliteMaterializer --> SQLite mirror (DERIVED, disposable)
  |     observe() debounced UPSERT . sqlite_rebuild . FTS5 triggers
  |- attachMarkdownMaterializer --> {slug}-{id}.md  (markdown_push/pull/rebuild)
  +- openSqliteReader --> read-only WAL handle for peers/scripts
```

Key reconciliation: SQLite is NEVER rebuilt from markdown directly. Both markdown and SQLite are siblings derived from the Yjs Y.Doc (the truth).

```txt
disk .md --markdown_push--> Yjs rows --observe()--> SQLite mirror (auto UPSERT + FTS)
  (truth)    parse+validate    (truth)    debounced
```

What is missing today: edges. The materializer mirrors rows 1:1; `source` is a scalar and `tags`/`destinations` are JSON arrays (queryable, not joinable). The fix stays in the grain of the existing system: derived edge tables populated by triggers, modeled on `fts.ts`'s `setupForBulkLoad` precedent. No new public primitive.

```sql
drop_provenance(child_id, parent_id)    -- explode source[]; recursive CTE for lineage
drop_tags(drop_id, tag)                 -- explode tags[]
drop_destinations(drop_id, destination) -- explode destinations[]
drop_links(from_id, to_id)              -- [[wikilink]] extraction; reverse lookup = backlinks
```

Provenance lineage and backlinks are recursive CTEs over indexed edge tables: textbook SQLite at personal-brain scale, not graph-DB territory. Verdict: no graph or triple store. It would be a parallel index with its own rebuild, its own Yjs reconciliation, and no FTS integration: pure cost.

## Composing

`source` is an ARRAY: `SourceRef[]` where `SourceRef = DropId | URL`. Empty means born original; one element is the refine case; N means composed. It stays provenance, never navigation, because of four constraints:

```txt
DIRECTIONAL  always upstream (made-from)         not bidirectional "see also"
ACYCLIC      can't be made from your descendant  no cycles
SET          order-free, dedup, no edge metadata not weighted/typed edges
CLOSED       written once at promote             not an open editing surface
```

Three relationships live in three layers; do not conflate them.

| Relationship | Where | Syntax | Semantics | Renders? |
| --- | --- | --- | --- | --- |
| PROVENANCE | frontmatter | `source: [id]` | made from (lineage) | no (metadata) |
| TRANSCLUSION | body | `![[id]]` | embed X's content | yes, inline live |
| REFERENCE | body | `[[id]]` | mention / jump to X | yes, as a link |

Two rules keep `source[]` from rotting into a hairball:

```txt
RULE A  source[] grows ONLY when you PULL material into the body.
        A mere [[mention]] does NOT add to source[]. Made-from requires taking.
RULE B  source[] is CLOSED at promote. New associations go in the body as
        [[wikilinks]], never back into frontmatter.
```

NO `related:` field. A `related:` array is open, bidirectional, grows forever, and begs for edge types: the graph-DB-in-YAML hairball. Provenance is recorded as a byproduct of authoring: Draft unions the dragged-from id into `source[]` when you pull a passage. You never type an id into `source:`. `type` carries an optional template (a `type: template, for: essay` skeleton drop Draft clones on "New essay").

## Open Questions

1. **Does Whispering stay a standalone named app or fold into a generic capture inbox?**
   - Recommendation: stays standalone. It is shipping brand equity, and "voice -> drop" is a legible action worth its own name.

2. **How far does the adapter-power door open?**
   - The fork is a declarative `HttpRecipe` (no user code in the egress path) versus a sandboxed imperative user `publish()` with host-injected opaque creds. The pure-`project()` isolate plus `HttpRecipe` is the safe near-term answer; whether to ever cross into sandboxed imperative egress is undecided.

3. **What does the `type` narrowing migration look like in practice?**
   - Narrowing `apps/fuji/src/lib/workspace/index.ts` `type` from a JSON array to `column.string()` is a sync-wire-contract change. It requires a real migration, not a silent edit. The migration shape is open.

4. **Does `library` (the private destination) need sync to The Ark servers, or stay purely local?**
   - Staying local keeps evergreen reference material private by construction. Syncing would enable cross-device private access but reintroduces a server dependency for non-public drops. Undecided.

5. **Which Ship destination ships first?**
   - Recommendation: Markdown export or The Ark native, before fragile third-party APIs. Both avoid OAuth and rate-limit failure modes while proving the Publishable contract.

## References

- `specs/20260525T130000-creative-os-composition-map.md` - the Capture/Refine/Compose/Publish map this spec refines into named tools and one editor.
- `specs/20260518T160639-theark-marp-shortform-content-engine.md` - the short-video render pipeline that `toShortVideo` targets.
- `docs/articles/20260525T120000-epicenter-local-first-creative-operating-system.md` - vision article for the local-first creative OS.
