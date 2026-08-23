# Wiki Core, Collections, Types, and Curation

**Date**: 2026-06-02
**Status**: Draft
**Author**: Epicenter
**Related**:

- [20260601T120000-creative-os-stack-naming-and-drop-serialization.md](20260601T120000-creative-os-stack-naming-and-drop-serialization.md): the four-axis drop model this spec revises; a drop becomes a Wiki Page, and `stage` / `visibility` / `destinations` / singular `type` leave the universal core and become an opt-in `type`.
- [20260525T130000-creative-os-composition-map.md](20260525T130000-creative-os-composition-map.md): the capture / refine / compose / publish map, typed integrations, and `epicenter://` links; the capture-to-curation bridge here REALIZES that typed-integration direction.
- [20260220T195900-clean-markdown-yaml-frontmatter-export.md](20260220T195900-clean-markdown-yaml-frontmatter-export.md): the markdown vault, frontmatter-is-the-row, disk-to-Yjs reconcile this spec's storage model builds on.
- [20260518T160639-theark-marp-shortform-content-engine.md](20260518T160639-theark-marp-shortform-content-engine.md): The Ark, the public render target a `publishing` type ships a Page toward.
- [packages/workspace/src/document/column/sugar.ts](../packages/workspace/src/document/column/sugar.ts): the `column.*` DSL; each helper returns a vanilla TypeBox `TSchema` that is at once JSON Schema, validator input, and static-type carrier.
- [packages/workspace/src/document/define-table.ts](../packages/workspace/src/document/define-table.ts): `defineTable`, the `FlatJsonTSchema` SQLite-safe constraint, and the positional `_v` + `.migrate()` versioning a type schema reuses.
- [packages/workspace/src/document/table.ts](../packages/workspace/src/document/table.ts): the `YKeyValueLww` storage primitive (whole-row last-write-wins) and `Value.Check` row validation the concurrency rulings rest on.
- [packages/workspace/src/links.ts](../packages/workspace/src/links.ts): `EpicenterLink` and the `epicenter://{workspace}/{table}/{id}` scheme the curation bridge resolves through.

## Overview

The Epicenter Wiki is a curated, local-first peer namespace whose unit is a Page with a minimal worldview-neutral core, loose `tags`, and any number of opt-in schema-bearing `types` (Tana supertags), with publishing modeled as a type and user-defined type schemas authored in the `column.*` DSL.

This spec supersedes the trait-based draft that preceded it. The earlier draft split "what kind of thing is this" into a single-value Collection and "what else is this" into many Traits. That split was one concept too many. This rewrite collapses both into one idea, the `type` (Tana's supertag): a Page can carry several types, and each type contributes its own typed properties. A Collection is no longer a second kind of thing; it is just the table VIEW of every Page that shares a type.

```txt
One sentence:
  A Wiki Page has a tiny worldview-neutral core (id, title,
  description?, tags[], source[], timestamps) plus a body. It
  opts into any number of TYPES, each a named identity that
  contributes typed properties. The VIEW of all Pages sharing a
  type is a COLLECTION. Publishing is just one of those types.
```

## Motivation

### Current State

The owner's real store lives at `~/Code/epicenter-md` (outside this repo; cited as evidence, not as a repo file): roughly fifteen thousand markdown files under a single forced nullable schema in `epicenter.config.md.ts`. One `pages` table, one shape, applied to everything. The shape failed in five concrete ways.

```txt
FAILURE 1  type[] became folksonomy
  `type` was a free multiSelect. It exploded into 770 directory
  combinations; 558 of them hold a single file. A schema that
  collapses into 558 one-off folders is not a schema, it is tag soup.

FAILURE 2  status meant four unrelated things at once
  workflow    Needs Scaffolding   x4433
  provenance  Imported from Todoist   x449
  audience    Family   x238
  junk        miscellaneous garbage values
  One column, four orthogonal meanings, zero of them clean.

FAILURE 3  visibility leaked foreign vocabulary
  values like `Mild`, `Commune` (not a visibility at all)

FAILURE 4  optional fields were mostly empty
  resonance   blank x1513
  url         present on only 461 of ~15,000

FAILURE 5  body lived in two places
  some kinds put text in `content`, others in `content_draft` (x863)

PLUS one telling misfile
  a note ABOUT a campus talk was filed as `Recipe`.
```

The `status` overload (workflow plus provenance plus audience plus junk in one column) is the cautionary tale this spec keeps pointing back to: an ordered workflow state and a loose label do not belong in the same field.

The store ALREADY discovered the alternative. The owner's own `clippings/` folder is not one forced schema; it is clean per-type collections:

```txt
clippings/articles      domain, word_count, quality
clippings/recipes       servings, prep, cook
clippings/github_repos  owner/repo, stars, language
clippings/essays        resonance
```

And `Needs Scaffolding x4433` literally means "captured, not yet curated." The capture-versus-curation split was staring back from the data the whole time.

### Desired State

Stop forcing one schema onto BOTH raw capture and curated knowledge. That is the root error. The fix is a core that imposes no worldview, plus a single opt-in mechanism that is multi-valued and schema-bearing: the `type`.

```txt
CORE (every Page, worldview-neutral)
  id, title, description?, tags[], source[], created, updated   + body

TYPES (0..many, opt-in, schema-bearing)
  named identities a Page has; each contributes typed properties
  (Tana supertag / a Notion database treated as a Page identity)

the VIEW of all Pages sharing a type
  is a COLLECTION (the table view). "Collection" names the VIEW,
  "type" names the page-level IDENTITY.
```

The earlier creative-OS core (see [20260601T120000](20260601T120000-creative-os-stack-naming-and-drop-serialization.md)) tried to put singular `type`, `stage`, `visibility`, and `destinations` on every drop. This spec already removed those from the universal core under greenfield scrutiny, and the rename here is consistent with that removal: a `type` is opt-in, multi, and schema-bearing, NOT a forced singular core label. CORE is the minimum that lets a user EXPRESS any methodology (PARA, Zettelkasten, GTD, CRM) without IMPOSING one. `tags` is the single worldview-neutral facet; `id`, `title`, and timestamps are mechanical; `source[]` is method-neutral provenance; `description` is an optional universal summary, never required.

## The Model: Three Layers

Read it top to bottom: worldview-neutral core, then any number of opt-in typed identities, then the table view that each type induces.

```txt
                 +-------------------------------------------------+
  CORE           | id  title  description?  tags[]  source[]        |   every Page
  (worldview-    | created  updated                       + body   |   has exactly this
   neutral)      +-------------------------------------------------+
                              |
                 +------------+-------------------------------------+
  TYPES          | 0..N opt-in schema-bearing identities            |   "what is this,
  (Tana          |   youtube_video { url, duration }                |    what else is it"
   supertag)     |   gift_idea     { recipient, budget, priority }  |   multi-value
                 +------------+-------------------------------------+
                              |
                 +------------+-------------------------------------+
  COLLECTION     | the table VIEW of every Page sharing a type      |   "type" = identity
  (the view)     |   the youtube_video collection = all such Pages  |   "collection" = view
                 +-------------------------------------------------+
```

Naming rulings: the page-level identity is a `type` (a Page can have several); the table view of all Pages of a type is a `collection`. Loose `tags` stay separate as zero-ceremony labels. "Supertag" is acceptable UI copy for `type`.

## Two Tables (defineTable)

There are exactly two first-party tables: a registry of user-defined types, and the Pages table. Both are ordinary [`defineTable`](../packages/workspace/src/document/define-table.ts) schemas.

```ts
// the TYPES REGISTRY: a system table (fixed first-party schema). Each row is one
// user-defined type; its schema is DATA (an array of ColumnSpec), materialized to
// types/<id>.md so it is editable in VSCode.
const types = defineTable({
  id:        column.string(),                 // "youtube_video" (stable slug; the key)
  name:      column.string(),                 // "YouTube Video" (display; rename is free)
  icon:      column.nullable(column.string()),
  columns:   column.json(/* schema for ColumnSpec[] */),  // the user schema, stored as JSON
  createdAt: column.dateTime(),
  updatedAt: column.dateTime(),
});

// PAGES: core columns + ONE json column `types` holding membership + values,
// nested by type id.
const pages = defineTable({
  id:          column.string(),
  title:       column.string(),
  description: column.nullable(column.string()),  // optional summary
  tags:        column.json(/* string[] */),        // loose labels; default []
  source:      column.json(/* string[] */),        // provenance (paths | urls | epicenter:// links); default []
  createdAt:   column.dateTime(),
  updatedAt:   column.dateTime(),
  types:       column.json(/* Record<typeId, Record<propName, unknown>> */),  // { youtube_video: { url, duration } }
});
// body = the per-row content doc (markdown), not a frontmatter column
// (per the existing fuji entryBody pattern).
```

Membership IS key presence: a Page belongs to the `youtube_video` type iff `types` contains the `youtube_video` key. There is no separate membership flag.

IMPLEMENTATION NOTE (slice): `apps/wiki` stores `body` as a plain `column.string()` on the page row, and the markdown codec routes it to the file's body section (never into frontmatter). It shares the row's whole-row LWW (the same trade the `types` cell already accepts) and round-trips through `<id>.md`. The per-row content `Y.Doc` (fuji's entry-body pattern, for independently-syncing/collaborative bodies) is the documented promotion path, deferred until collaborative body editing is real.

## ColumnSpec and column.* (verified against the codebase)

Every `column.*` helper RETURNS a TypeBox `TSchema`. The [sugar.ts](../packages/workspace/src/document/column/sugar.ts) header states it precisely: "`column.X(opts)` returns a vanilla TypeBox `TSchema`; each schema IS the JSON Schema, the validator input, and the static-type carrier." [`defineTable`](../packages/workspace/src/document/define-table.ts) takes a `Record<name, TSchema>` with each column constrained by `FlatJsonTSchema`, which rejects any TypeBox kind that cannot map 1:1 to a SQLite column. So a user type schema is built out of the same vocabulary as a first-party table.

```ts
type ColumnSpec = {
  id: string;        // stable column id; rename touches `name`, never this -> rename is metadata-only
  name: string;      // display name
  schema: TSchema;   // the column.* result itself: column.url() | column.nullable(column.number())
                     //   | column.enum([...]). A TSchema IS JSON Schema, so it is stored verbatim.
};

// a type's `columns` is ColumnSpec[], stored as JSON. A TSchema's static type is
// not seen as JsonValue, so the registry cell stores `schema` as a JSON object
// and a single typed boundary (`typeColumns`) reads it back as a TSchema.
//
// runtime validation of a Page's `types.<id>` values uses TypeBox Value.Check
// against the STORED schema directly. NO eval, NO codegen, NO interpreter.
//
// schema versioning reuses defineTable's positional `_v` + `.migrate()`; user
// edits emit declarative ops (rename / add / remove / widen).
```

IMPLEMENTATION RESOLUTION (see Open Question 2). The slice in `apps/wiki` stores
each column's schema as the `TSchema` the `column.*` call returns, NOT as a
`column.*` string. The two principled choices are "store the call" or "store the
output"; an intermediary `{ kind }` object is rejected as a third form. "Store the
output" wins because (a) defining a type IN CODE uses the real `column.*` builder
with full autocomplete and type-checking, (b) a `TSchema` is already JSON, so the
`decode()` boundary collapses to identity (no parser, no injection surface, ~320
fewer lines than the abandoned restricted reader), and (c) it was verified that
this repo's TypeBox validates on PLAIN JSON Schema (no `[Kind]` symbols), so a
schema that round-trips through the Yjs/JSON boundary still validates identically
with `Value.Check`. The trade given up is pretty `types/<id>.md` files: a column
schema renders as `{type: string, format: uri}`, not `column.url()`. Acceptable
because type definitions are few and usually authored via the API, not hand-typed
in the vault.

## Nullability Rulings

- `description`: nullable (`column.nullable(column.string())`), an optional summary.
- `icon` (types): nullable; genuinely absent for most types.
- `tags`, `source`, `types` (on pages) and `columns` (on types): NOT nullable; default to EMPTY (`[]` / `{}`).
- `body`: the page content; an empty body is the empty string, never null. In practice body is the per-row content doc, not a column.

Rule: prefer EMPTY over NULL for collections so there is no null-check on the common path; reserve `nullable` for genuinely-absent scalars (`description`, `icon`).

## Storage and Concurrency (grounded in the real primitives)

A [`defineTable`](../packages/workspace/src/document/define-table.ts) row is stored in a `YKeyValueLww` (see [table.ts](../packages/workspace/src/document/table.ts)): a `Y.Array` of `{ key, val, ts }` entries where the WHOLE row is one plain-object `val`, reconciled by whole-row last-write-wins on a timestamp. `column.*` create NO Yjs nodes; there is no per-column merge; `update()` is a read-modify-write of the entire row.

```txt
YKeyValueLww  Y.Array of { key, val, ts }
   key = page id
   val = the WHOLE row (core columns + the nested `types` json cell)
   ts  = the LWW timestamp; the higher ts wins the whole val
```

Therefore the nested `types` json column is a single LWW cell. Two devices editing different properties on the SAME Page concurrently while offline reconcile to one whole row; the other device's edit is dropped.

Rulings:

1. This is the EXISTING contract for every Page already, not new behavior introduced here.
2. It is acceptable for a personal wiki (the offline-concurrent-same-page danger window is narrow).
3. The recovery net is `attachGitAutosave` git history on the vault: a dropped edit is a previous commit, not a lost edit.
4. Add conflict VISIBILITY before going collaborative.
5. Finer-grained merge, if ever needed, is NEW work, ranked: (a) a real nested-`Y.Map` column type; then (b) an EAV truth table `(pageId, typeId, propId) -> value` (the one place EAV is justified, TRUTH only, with SQLite staying the typed projection); then (c) per-type physical columns (a bad fit because types are runtime-defined).

## Schema-on-Read (a type schema is a LENS, not a gate)

Changing a type's schema does NOT migrate Page data. At read time the schema is applied per type:

```txt
match     in data AND in schema             show normally
excess    in data, NOT in current schema    survives while membership exists; offer to remove
missing   in schema, NOT in data            show empty / a red "fill me" prompt
```

The TYPED SQLite index is RE-PROJECTED from the current schema (disposable, rebuildable); the durable markdown/Yjs data is never migrated. A type change is a display mismatch plus an optional bulk-fix, never a forced destructive migration. Removing a type key from a Page deletes that type's nested values: membership and type-scoped values are coupled, so dropping the identity drops its properties.

## Capture vs Curation: Peer Namespaces and the Bridge

The Wiki is NOT the universal substrate. It is a PEER top-level namespace alongside `apps/whispering` (voice capture) and `apps/tab-manager` (web / reddit-save capture), which own their raw native data in their own Yjs workspaces and docs. Raw capture does NOT auto-materialize into the Wiki; an item enters only through deliberate curation. This realizes the typed-integration direction of the [composition map](20260525T130000-creative-os-composition-map.md): tools integrate through explicit `epicenter://` references, not a shared substrate every tool writes into.

```txt
                 CAPTURE (own raw native data, own Yjs workspace/docs)
   +-------------------+   +-------------------+
   | apps/whispering   |   | apps/tab-manager  |
   | recordings,       |   | saved tabs,       |
   | transcripts       |   | reddit/tweet saves|
   +---------+---------+   +---------+---------+
             |  curateToWiki(...)     |  curateToWiki(...)
             |  (deliberate, manual)  |  (deliberate, manual)
             v                        v
        +-------------------------------------------+
        | THE WIKI  (curation / compose namespace)  |
        |  Pages: core + types (0..N)               |
        |  raw capture does NOT auto-materialize    |
        +----------------------+--------------------+
                               |  Ship (publishing type)
                               v
                          THE ARK (public)
```

The bridge is one explicit call:

```ts
curateToWiki({
  from: "epicenter://whispering/recordings/rec_123",
  create: {
    types: ["note"],
    bodyMode: "copy",     // default: a durable artifact, not a live pinned view
  },
});
```

The resulting Page's `source[]` retains the `epicenter://` provenance link; the capture item is NOT deleted. The default `bodyMode` is `copy`: curation produces a durable artifact decoupled from the capture item's future edits, because a curated Page is meant to outlive and diverge from its raw source. Transclusion (a live, block-level embed) is an explicit option, not the default.

Cross-namespace `epicenter://` resolves through the existing [links.ts](../packages/workspace/src/links.ts), which ships `epicenter://{workspace}/{table}/{id}` and parses it into a structured `EpicenterLink`. The bridge uses the `{workspace}` segment as the namespace authority (Open Question: is a capture app a "workspace" for this addressing).

## Publishing Is a Type, Not Core, Not a Per-Type Field

`publishing` is a type that carries `stage`, `visibility`, and `destinations`. It is not in the core (most Pages are never published) and it is not redefined per type (then every type would re-declare `stage` and the publishing board would fracture). Modeling publishing as a type is the direct consequence of the rename: anything that is "an identity some Pages also have" is a type.

```ts
// publishing as a user-defined type (one ColumnSpec[] in the types registry)
{
  id: "publishing",
  name: "Publishing",
  columns: [
    { id: "stage",        name: "Stage",        schema: column.enum(["inbox","drafting","editing","scheduled","published","archived"]) },
    { id: "visibility",   name: "Visibility",   schema: column.enum(["private","unlisted","public"]) },
    { id: "destinations", name: "Destinations", schema: column.json(/* string[] */) },
    { id: "publishAt",    name: "Publish at",   schema: column.nullable(column.dateTime()) },
    { id: "publishedAt",  name: "Published at", schema: column.nullable(column.dateTime()) },
  ],
}
```

The Flow board is then "every Page carrying the `publishing` type, across all collections," shipping toward [The Ark](20260518T160639-theark-marp-shortform-content-engine.md). One type, one board, one definition of `stage`.

```sql
-- Flow board: every publishing Page, any collection, not yet archived
SELECT p.id, p.title, pub.c_stage, pub.c_visibility, pub.c_publish_at
FROM wiki_type_publishing pub
JOIN wiki_pages p ON p.id = pub.page_id
WHERE pub.c_stage != 'archived'
ORDER BY pub.c_stage, p.updated DESC;
```

`stage` is NOT a tag. A tag is an open, unordered, worldview-neutral label; `stage` is an ordered workflow state with board semantics (column order, transitions, a terminal `archived`). The `epicenter-md` `status` overload is exactly what happens when an ordered state and a loose label share a field. Keep them apart.

## SQLite Projection (per type)

Each type materializes a 1:1 side table with stable physical ids, a join table projects membership, and core columns live on `wiki_pages`. The display name is metadata, so a rename never issues DDL.

```sql
wiki_pages(id PK, title, description, tags, source, created, updated)  -- core columns
wiki_page_types(page_id, type_id)                                      -- membership edge
wiki_type_<stableId>(page_id PK, c_<colId> ...)                        -- one per type; props as columns
```

DDL is generated from the current `columns` schema and re-projected on schema change. Because physical column ids are stable, a display rename is metadata-only (no `ALTER`).

```sql
-- a Page with the youtube_video type carrying the gift_idea type:
-- its values live in two side tables, joined to the core by id.
SELECT p.id, p.title, yv.c_url, yv.c_duration, gi.c_recipient, gi.c_budget
FROM wiki_pages p
LEFT JOIN wiki_type_youtube_video yv ON yv.page_id = p.id
LEFT JOIN wiki_type_gift_idea     gi ON gi.page_id = p.id
WHERE p.id = ?;
```

## Storage and Truth

Truth and projections carry forward from the [markdown vault model](20260220T195900-clean-markdown-yaml-frontmatter-export.md) (frontmatter-is-the-row).

```txt
Yjs Y.Doc            TRUTH (browser + desktop), CRDT-synced via YKeyValueLww
   |
   |  bidirectional desktop projection (disk-to-Yjs reconcile, "markdown_apply")
   v
markdown vault       <id>.md, frontmatter IS the core row; types/<id>.md IS each type schema
   |
   |  derived, disposable query index (re-projected from current schemas)
   v
SQLite               wiki_pages + wiki_page_types + wiki_type_<id> side tables
```

- Yjs is truth in the browser and on desktop.
- The markdown vault is a bidirectional desktop projection: `<id>.md` (frontmatter is the row), and `types/<id>.md` (each user type schema as editable data).
- SQLite is a derived query index: one side table per type plus the membership join and the core table. It is disposable and rebuildable, never the source of truth.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Minimal worldview-neutral core | 2 coherence | id, title, description?, tags[], source[], created, updated, body | The smallest set that lets any methodology be EXPRESSED without one being IMPOSED. |
| Types replace the Collection/Trait split | 3 taste | One concept: a multi, opt-in, schema-bearing `type` (Tana supertag) | The earlier draft's single-Collection plus many-Traits was one concept too many; a type covers both. |
| "type" names the identity, "collection" names the view | 2 coherence | A Page HAS types; the table of all Pages of a type IS a collection | Two words for two things (page-level identity vs the view), no overlap. |
| Loose tags kept separate | 3 taste | `tags` stays a zero-ceremony loose facet, not folded into types | Matches Obsidian's single default property; everything more opinionated is opt-in. |
| ColumnSpec = { id, name, schema: TSchema } | 2 coherence | Schema authored via `column.*` (returns `TSchema`), stored as JSON, validated via `Value.Check` | `column.*` IS the DSL, its `TSchema` output IS the stored data; no eval, no separate parser. |
| Two tables | 2 coherence | A types registry + a pages table | The registry holds schemas as DATA; pages hold core columns plus the nested `types` cell. |
| Types as ONE nested json column | 2 coherence | `types: Record<typeId, Record<prop, unknown>>`; membership = key presence | One cell, no per-type physical column on pages; membership and values stay coupled. |
| Whole-row LWW accepted | 1 evidence | `YKeyValueLww` whole-row last-write-wins, recovered by git autosave | This is the EXISTING contract; the danger window is narrow for a personal wiki. |
| Schema-on-read lens | 2 coherence | match / excess / missing at read time; never a destructive migration | The typed SQLite index is re-projected; durable data is never migrated. |
| SQLite re-projected with stable physical ids | 2 coherence | `wiki_type_<id>(page_id, c_<colId>)` + a membership join | Display rename is metadata-only (no DDL); the index is disposable. |
| description / icon nullable, collections default-empty | 2 coherence | `nullable` for absent scalars; `[]` / `{}` for collections | No null-check on the common path; null reserved for genuinely-absent scalars. |
| Publishing is a type | 2 coherence | `publishing` carries stage / visibility / destinations | One type keeps `stage` defined once and the Flow board whole across collections. |
| Wiki as a curated peer namespace | 3 taste | A peer of whispering / tab-manager, not the universal substrate | Forcing one schema on raw capture AND curated knowledge is the root error; separate the spaces. |
| curateToWiki bridge with epicenter:// provenance | 2 coherence | Explicit call, copy-by-default, `source: [epicenter://...]`, original retained | Curation is a deliberate durable artifact, not an auto-materialized live mirror. |
| Trait arrival timing | Deferred | (now moot: types are the single concept; ship core + first types) | See Open Questions for which types ship first. |
| epicenter:// namespace authority | Deferred | Reconcile a capture-app authority with the shipped `{workspace}` segment | The addressing for a capture app is unsettled (see Open Questions). |

## Open Questions

1. **Is a capture app a "workspace" for `epicenter://` addressing?** [links.ts](../packages/workspace/src/links.ts) uses `{workspace}/{table}/{id}`. The bridge needs the `{workspace}` segment to name a capture app like `whispering`; confirm a capture app registers as a resolvable workspace authority.

2. **Store `columns` as raw `TSchema` JSON, or a compact `{ kind }` ColumnSpec?** RESOLVED (slice): raw `TSchema` (the output of calling `column.*`). The compact `{ kind }` middle form is rejected; the only principled choices were "store the call (string)" or "store the output (TSchema)", and the output wins on code-authoring ergonomics (real builder = autocomplete), zero interpreter/injection surface, and a verified-safe Yjs/JSON round-trip (this TypeBox validates on plain JSON Schema). See the ColumnSpec section above. The earlier author-string codec was built and then deleted. Remaining sub-question: a richer `types/<id>.md` editing experience (the stored form is JSON Schema, which is verbose to hand-edit) is a product-polish concern, not a storage decision.

3. **Finer-grained per-property merge.** Build a nested-`Y.Map` column type (real per-property CRDT merge), or accept whole-row LWW plus git recovery indefinitely? The trigger is going collaborative; for a personal wiki, whole-row LWW stands.

4. **Unify loose `tags` into `types` later (full Tana), or keep them separate?** Current ruling: separate. Revisit only if the loose/typed boundary proves to be friction in practice.

5. **Which types ship first?** Real data suggests `note`, `clipped-web`, `saved-social`, `recipe`, `essay`. Pick the one or two that prove the core-plus-types shape before scaling the registry.

## References

- [20260601T120000-creative-os-stack-naming-and-drop-serialization.md](20260601T120000-creative-os-stack-naming-and-drop-serialization.md): the four-axis drop model this spec revises; a drop becomes a Wiki Page, and stage / visibility / destinations / singular type leave the core and become the `publishing` type.
- [20260525T130000-creative-os-composition-map.md](20260525T130000-creative-os-composition-map.md): the capture / refine / compose / publish map, typed integrations, and `epicenter://` links that the curation bridge realizes.
- [20260220T195900-clean-markdown-yaml-frontmatter-export.md](20260220T195900-clean-markdown-yaml-frontmatter-export.md): the markdown vault and frontmatter-is-the-row projection this spec's storage model builds on.
- [20260518T160639-theark-marp-shortform-content-engine.md](20260518T160639-theark-marp-shortform-content-engine.md): The Ark, the public render target the `publishing` type ships a Page toward.
- [packages/workspace/src/document/column/sugar.ts](../packages/workspace/src/document/column/sugar.ts): the `column.*` DSL; each helper returns a vanilla TypeBox `TSchema` that is JSON Schema, validator input, and static-type carrier at once.
- [packages/workspace/src/document/define-table.ts](../packages/workspace/src/document/define-table.ts): `defineTable`, the `FlatJsonTSchema` SQLite-safe constraint, and the positional `_v` + `.migrate()` versioning a type schema reuses.
- [packages/workspace/src/document/table.ts](../packages/workspace/src/document/table.ts): the `YKeyValueLww` whole-row last-write-wins storage primitive and `Value.Check` row validation the concurrency and validation rulings rest on.
- [packages/workspace/src/links.ts](../packages/workspace/src/links.ts): `EpicenterLink` and the `epicenter://{workspace}/{table}/{id}` scheme the curation bridge resolves through.
- `~/Code/epicenter-md/epicenter.config.md.ts`: empirical evidence (outside this repo): the single forced nullable `pages` schema whose failure motivates the three-layer model.
- `~/Code/epicenter-md/clippings/`: empirical evidence (outside this repo): the clean per-type collections (articles, recipes, github_repos, essays) the owner already discovered.
