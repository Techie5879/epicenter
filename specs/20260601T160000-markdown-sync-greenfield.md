# Markdown <-> Yjs sync (greenfield)

> **Superseded by `specs/20260602T200000-vault-read-only-projection-agent-mutation.md`.** That spec refuses the disk to Yjs editing path entirely: materialized markdown is a one-way read-only projection and `markdown_apply` was deleted. App data mutates only through validated actions. Kept for history.

Status: greenfield design. Consolidates the whole `markdown_apply` effort into
the shape it should have had from the start. Supersedes the incremental design in
`20260601T120000-epicenter-apply-markdown-reconcile.md` (kept for history).
Date: 2026-06-01

This is a DESIGN doc for a fresh implementation, not a description of the current
code. It folds in every hard-won lesson from the first pass and fixes the smells
that pass surfaced. A new agent should build toward this shape, using the existing
PRs as reference, not as a base to patch.

## Intent (one paragraph)

Yjs is the source of truth. A markdown directory is a materialized, editable VIEW
of it. Two directions, deliberately asymmetric: materialize is CONTINUOUS (Yjs ->
disk, automatic, observe-driven); apply is EXPLICIT (disk -> Yjs, declarative,
non-destructive, on command). A coding agent or a human edits `.md` files; `apply`
reconciles those edits into Yjs, which then propagates to every device through the
existing relay. Git stays history/backup/publish only; it is never the reconcile
engine.

## Model

```
            materialize  (continuous, automatic, Yjs -> disk)
   Yjs  ───────────────────────────────────────────────▶  markdown dir
  (truth)                                                 (editable view)
        ◀───────────────────────────────────────────────
            apply  (explicit, declarative, disk -> Yjs)

  one codec per table:  toMarkdown = materialize's half
                        fromMarkdown = apply's half   (they are INVERSES)
```

The asymmetry is honest and load-bearing: a projection that is always-on is not
the same operation as a reconcile you invoke. Do NOT force them into a symmetric
"sync" API.

## Architecture (the consolidations)

### 1. One seam, named for what it is

`attachMarkdownMirror(workspace, { dir, perTable, git? })` (name is the agent's
call: mirror / editableView / vault, NOT "materializer", which implies one-way
like the sqlite projection). It owns: the output dir, the per-table codec,
continuous materialize, and the explicit actions. The sqlite materializer stays a
true one-way derived projection; markdown is different in kind because it is
editable and reconciled, and the name should say so.

### 2. Two actions, not four

The first pass shipped `push` / `pull` / `rebuild` / `apply`. Collapse to:

```
apply({ dryRun?, maxDeletes? }) -> ApplyPlan      disk -> Yjs, declarative reconcile.
                                                  Subsumes the old additive `push`
                                                  (push == apply minus deletes).
rebuild() -> { written, deleted }                 Yjs -> disk, destructive full
                                                  re-export (orphan cleanup, config
                                                  change). Subsumes the old `pull`.
materialize                                        Yjs -> disk, CONTINUOUS + automatic
                                                  (observe-driven). NOT an action.
```

`apply` is the single import path. `rebuild` is the single explicit export.
Continuous materialize needs no action. Three concepts, two of them callable.

### 3. The codec is the unit of modularity

```ts
type MarkdownCodec<TRow> = {
  toMarkdown:   (row: TRow) => MaybePromise<{ frontmatter; body? }>;
  fromMarkdown: (parsed:   { frontmatter; body? }) => MaybePromise<TRow>;  // exact inverse
  applyBody?:   (p: { row: TRow; previous: TRow | undefined; body: string }) => MaybePromise<void>;
};
type MarkdownTableConfig<TRow> = {
  dir?: string;
  filename?: (row: TRow) => string;   // default `${row.id}.md`
  codec?: MarkdownCodec<TRow>;        // omit => identity (frontmatter IS the row)
  onDelete?: (id: string) => void;    // default hard delete; fuji passes soft-delete
};
```

`toMarkdown` and `fromMarkdown` TRAVEL TOGETHER (not independent optionals), so the
round-trip invariant is a TYPE guarantee, not a runtime `RoundTripUnproven` check.
A table that customizes its markdown shape cannot ship a shape it can't parse back.

### 4. Action-first; the CLI is one thin driver

The reconcile logic lives in `defineActions` on the seam. The daemon owns the
Y.Doc; every driver invokes the action over the daemon socket and never opens its
own doc (the vault contract). `epicenter apply` is ONE such driver; it only maps
the returned plan to exit codes and formatted output. Other future drivers consume
the SAME action: a `git commit` hook (the commit is a clean "agent is done"
boundary), a filewatcher, a UI button. None of them re-implement apply.

The CLI imports `ApplyPlan` from the workspace (no re-declared type); it keeps only
a runtime wire-shape guard (the socket is untyped JSON) and exit-code mapping.

## apply algorithm

```
per registered table:
  1. desired = read every .md under <dir> (RECURSIVE), parse frontmatter, run the
     codec's fromMarkdown, Value.Clean to strip unknown keys, validate against the
     latest schema. Key by frontmatter id. A file with no id / parse fail /
     validation fail goes to skipped|errors and is NEVER partially applied.
  2. current = table.getAllValid(), keyed by id.
  3. diff:  creates = desired - current
            updates = (both) where !Value.Equal(current, desired)
            deletes = current - desired      (only if the dir is PRESENT)
  4. guard BEFORE any write:
       any error (parse / validation / duplicate id) -> refuse, apply nothing
       deletes > (maxDeletes ?? 10)                  -> refuse, apply nothing
       a MISSING dir contributes no deletes (absent != "delete everything";
       an EMPTY present dir does, under the guard)
  5. dryRun -> return the plan, write nothing
  6. apply: body writes FIRST (codec.applyBody, outside the row txn, so a row never
     records a body state that failed to land); then ALL row writes + deletes in
     ONE ydoc.transact (peers see one atomic update, never a half-applied state).
```

`ApplyPlan = { refused, reason?, creates[], updates[], deletes[], skipped[], errors[] }`.

## Invariants (hard requirements)

1. No silent delete: deletes are counted, guarded by `maxDeletes`, shown in
   `--dry-run`, and routed through `onDelete` (fuji = soft-delete tombstone).
2. Atomic: one `ydoc.transact` per apply; a guard trip or any error applies nothing.
3. Explicit import: `apply` is invoked, never a watcher (v1).
4. Deterministic, canonical round trip: `materialize(apply(canonical(files))) ==
   canonical(files)`. Byte-stable on the mirror's OWN output; a hand-authored file
   converges to canonical form on first apply (YAML re-serialization, link
   normalization, CRLF -> LF, empty-body -> absent), then is stable.
5. Yjs is truth; the relay propagates. No git in this path.
6. Equality is `Value.Equal`, never a stringify hack (so numbers / nullables /
   json arrays / datetimes do not churn).

## Phasing

- v1 (PROVEN; shipped as PR #1878, frontmatter-only): `apply` reconciles
  frontmatter ROWS for any registered table. Bodies are read-only materialized
  output. This is the safe core (tab-manager is frontmatter-only and round-trips).
- v2 (GATED on the faithful codec): body import.

## Bodies (v2, gated on the faithful codec)

A fuji entry is a frontmatter ROW + a BODY in a separate rich-text content doc. The
mirror observes only the ROW, so a body edit is invisible unless the row changes.

```
bodyHash       a derived row column = a fingerprint of the RAW body text. Makes a
               body edit show up in the cheap Value.Equal row diff WITHOUT opening
               every content doc. Sync, isomorphic hash (no node:crypto) so the
               browser (DOM) and daemon (Node) agree byte-for-byte. Maintained
               wherever a body is touched (browser onLocalUpdate, daemon
               toMarkdown/applyBody). Orthogonal to link rendering.
codec.applyBody  writes the body half of a create/update into the content doc; the
               skip is a pure row comparison `previous?.bodyHash === row.bodyHash`
               (fromMarkdown already stamped it; no re-hash).
links          internal refs are epicenter:// in the doc and render on disk as a
               LOSSLESS `[text](<id>.md)` relative link (filename IS the id; flat
               folder, `<id>.md` so a title change never renames the file). The
               hash never sees a link.
```

THE GATE: body import is UNSAFE until a faithful markdown codec exists. Today's
plaintext round-trip flattens headings/lists/marks the moment an agent edits a
structured body (a one-word typo fix nukes the whole body's formatting). v2 swaps
BOTH the body read and write to a fuji-schema-aware `prosemirror-markdown`
serializer/parser (extending the default schema with fuji's underline/strikethrough
marks) so structure survives, THEN turns on body import. The bodyHash + codec
design above is validated and staged on `feat/markdown-apply-reconcile` (commit
`cd6596eb5`); reuse it, do not redesign it.

## What NOT to build (YAGNI / over-engineering avoided)

- A `toMarkdown` body-read cache keyed by bodyHash: premature optimization. No
  measured bottleneck. Add only if a benchmark or the live runbook proves
  content-doc opens hurt.
- Tombstone-on-disk policy, per-entry body-write isolation: defer until real use
  asks for them.
- A shared `EntryBodyStore` unifying the daemon's transient cloud content-doc I/O
  with the browser's long-lived cached docs: fake symmetry. The shared seam is the
  pure body codec only; the doc lifecycles are honestly different.
- A symmetric "sync" API hiding the materialize/apply asymmetry behind a mode flag.

## Validation that still matters

The whole design is unproven across machines until the two-vault live runbook (T3
in the old spec) runs with real cloud auth: edit `vaultA/.../x.md`, `epicenter
apply`, then `diff vaultA/.../x.md vaultB/.../x.md` must be empty. Frontmatter is
enough to prove the `apply -> relay -> materialize` loop; bodies are not required
to validate the architecture. Run this before expanding scope.

## Prior art (reference, not base)

- PR #1878 `feat/markdown-apply`: frontmatter-only apply, proven, off main.
- `feat/markdown-apply-reconcile` @ `cd6596eb5`: the body + codec recut (paired
  codec, `entry-body` module, lossless id-links, browser bodyHash maintenance).
  Correct and tested, but ahead of the faithful codec; mine it for the v2 design.
- The old spec `20260601T120000-...`: the full incremental history and every
  grilled decision.
