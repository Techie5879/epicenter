# Epicenter Todos First Slice

## Intent

Build `apps/todos` as a local-first SvelteKit app backed by Epicenter workspace tables. The first slice proves the durable model, frontmatter shape, and a small usable surface. It does not schedule notifications, add sync auth, or create a project/tag taxonomy.

## Model

`todos`

- `id`: generated todo id.
- `title`: required editable label.
- `body`: required string, empty when the todo has no notes.
- `dueDate`: nullable ISO calendar date (all-day; no time or timezone in this slice).
- `contexts`: ordered array of `ContextSlug` values.
- `completedAt`: nullable UTC instant.
- `deletedAt`: nullable UTC instant.
- `createdAt`: UTC instant.

`contexts` are a fixed built-in set in this slice: code constants (`phone`, `computer`, `desk`), each with a display `name` and a distinct `color`, ordered by array position. They are not table rows. There is no contexts table, no CRUD, and no slug generation. User-created contexts are deferred (see below).

## Invariants

A todo's due date is `none` (`dueDate` is null) or `all-day` (`dueDate` is a calendar date). Timed and timezone-aware due dates are out of this slice; because due is a single self-validating field there is no cross-field parsing layer.

A todo's `contexts` is a subset of the built-in slugs. The create path rejects any other slug. The *stored* field, however, tolerates any string: a todo carrying a slug with no built-in (hand-edited file, mid-sync) stays legal and renders as a neutral chip. Neutral rendering is a resilience fallback, not a managed workflow. In-app, contexts are only ever picked from the built-in set, so orphans should not arise in normal use.

The contexts-as-constants shape (and the tolerant stored schema) is deliberate: it leaves room to layer user-created context rows back in later without changing the todo file format.

## First Slice

1. Add `apps/todos` with the same app-root workspace contract pattern used by the other apps: an isomorphic model file, a browser opener, SvelteKit app shell, and package exports.
2. Implement the branded `TodoId`, and derive `ContextSlug` from the built-in constants.
3. Ship contexts as code constants (`BUILT_IN_CONTEXTS`); the only context surface is membership validation on the todo create path.
4. Add focused unit tests for built-in slug acceptance, unknown-slug rejection, slug dedup, due-date round-trip, and the create/complete/soft-delete write path.
5. Add a UI using `packages/ui` that can create todos (with an all-day due date), tag them with built-in contexts, complete and reopen, soft-delete, and view todos by context. Use native primitives (`Empty`, `Popover`, `NaturalLanguageCalendarDateInput`).

## Non-goals

- No notification scheduler.
- No auth or cloud sync.
- No project, area, or tag taxonomy.
- No `updatedAt` until a concrete feature earns it.
- No timed/timezone-aware due dates until a feature earns them.

## Deferred

- Frontmatter serialization/parsing and a markdown materializer. The model is ready for it, but no materializer is wired (`todos.browser.ts` uses IndexedDB plus BroadcastChannel only), so serialize/parse helpers would be dead code today. Add them together with the materializer. When they land, frontmatter must quote context slugs, including slugs with no current built-in.
- **User-created contexts** (a contexts table, create/rename/delete actions, slug generation, per-context color/order). The fixed built-in set covers the first slice; custom contexts are the next increment. When they land, the design is a **slug as natural key**, deliberately over the two alternatives:
  - *Bare strings* (no contexts table): rejected because per-context color and ordering need a row to hang on.
  - *Opaque stable id + slug* (nanoid `ctx_...` as the reference): rejected. In a markdown-first app, whatever the todo embeds is what lands in the file; embedding an opaque id makes files non-self-describing and forces join-on-export, slug-uniqueness conflict handling across CRDT merges, and import resolution. That machinery only buys cheap *slug* renames, which are rare; the natural-key model gives free *label* renames with none of it. A stable id can be layered in later still, if frequent slug renames or slug-surviving cross-references become a concrete need.

## Verification

- `bun test apps/todos/todos.test.ts`
- `bun --filter @epicenter/todos typecheck`
