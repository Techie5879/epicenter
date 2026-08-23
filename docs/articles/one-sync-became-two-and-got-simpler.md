# One Sync Became Two and Got Simpler

> **Editor's note (later):** the two primitives this article ends on, the editable `attachMarkdownVault` and the read-only `attachMarkdownExport`, were eventually collapsed back into one. The vault was deleted: materialized markdown is now a one-way read-only projection of Yjs, mutated only through validated actions, never by editing the files. The split described here was the right call at the time and the reasoning still holds; the follow-on lesson is that once you separate two jobs you can also discover one of them should not exist. See `specs/20260602T200000-vault-read-only-projection-agent-mutation.md`.

**TL;DR**: When one abstraction is serving two jobs with opposite constraints, splitting it removes more complexity than it adds. A single markdown materializer that tried to handle every direction became two focused primitives, and each one got simpler in the process.

I was looking at a single `attachMarkdownMaterializer` that had four actions, two independent codec halves, a slug-plus-id filename scheme, and a runtime guard called `RoundTripUnproven`. That last one should have been the tell. A runtime guard compensating for a contract the design could not express is almost always a sign that the abstraction is doing two jobs that do not belong together.

## The Single Seam and Where It Strained

The original materializer tried to be everything at once. It had four actions:

- `push`: disk to Yjs, additive
- `pull`: Yjs to disk, additive
- `rebuild`: Yjs to disk, destructive
- `apply`: disk to Yjs, declarative reconcile

Two directions, four modes, and per-table configuration that let you opt into either direction independently:

```typescript
// Per-table config had two OPTIONAL, SEPARATE halves
{
  toMarkdown: (row) => ({ frontmatter, body }),   // optional
  fromMarkdown: (parsed) => row,                  // also optional
}
```

Here is the problem: these were independent optionals. A table could ship a `toMarkdown` that serialized a body field with no `fromMarkdown` to read it back. The type system had no way to enforce that they were inverses. So the implementation added a runtime guard: if you tried to call `apply` on a table that had `toMarkdown` but no `fromMarkdown`, it refused with `RoundTripUnproven` to avoid silently dropping data.

The filenames made things worse. To support the import direction, the filename had to encode the row id so the importer could recover it on read-back:

```
entries/hello-world-abc123.md   // human-readable slug + id embedded
```

That slug-with-id scheme exists entirely because one thing was doing both jobs. The id has to be in the name so the importer can key by it. If you are only exporting, you do not need the id in the filename at all.

### The Smell

`RoundTripUnproven` is not a feature. It is a warning light on the dashboard that says "the abstraction cannot express this constraint, so we check it at runtime instead." That is almost always a sign to look for a split.

## The Split: Two Primitives

The solution was to stop pretending these were two modes of the same thing. They are two different products.

```
attachMarkdownVault    editable, two-way, STRICT
attachMarkdownExport   read-only, one-directional, FREE
```

### The Vault: Strict and Safe

`attachMarkdownVault` is the editable seam. You point it at a directory, a human or coding agent edits the `.md` files, and `apply` reconciles those edits back into Yjs. Because reconcile is the only import path, the convention can be completely rigid:

- Every table maps to `<dir>/<table>/`
- Every row is `<id>.md`
- The frontmatter IS the row. No custom codec.

```typescript
const vault = attachMarkdownVault(workspace, {
  dir: './vault',
  tables: {
    entries: { readBody: (e) => readBody(e), onDelete: (id) => softDelete(id) },
    tags: {},  // frontmatter-only: pass an empty config
  },
});
```

Because frontmatter is always the row and filename is always the id, the round trip is identity. It cannot lose data. The `RoundTripUnproven` guard is gone, not replaced by something else. There is nothing to guard because the contract is expressed in the structure itself.

The vault exposes two actions: `apply` (disk to Yjs, declarative reconcile, keyed by id, guarded by `maxDeletes`, one atomic Yjs transaction) and `rebuild` (destructive re-export). The continuous materialize runs automatically in the background, with a dirty guard so it never overwrites an in-progress edit before `apply` runs.

### The Export: Free and Focused

`attachMarkdownExport` is the read-only projection. It watches Yjs and writes files continuously. Because nothing is ever read back, it has zero round-trip obligation:

```typescript
const blog = attachMarkdownExport(workspace, {
  dir: './site/posts',
  tables: {
    entries: {
      filename: (row) => `${row.slug}.md`,           // no id needed
      toMarkdown: (row) => ({
        frontmatter: { title: row.title, date: row.publishedAt },
        body: renderBody(row),                        // reshape freely
      }),
    },
  },
});
```

No `apply`. No `fromMarkdown`. No id in the filename. No max-deletes guard. Point it at a blog, a published site, a static folder, whatever. The only action it exposes is `rebuild` for a destructive re-export after a filename or layout change.

### What Each One Lost

```
                    Vault           Export
Custom filename     no              yes
Custom codec        no              yes
apply (import)      yes             no
Round-trip guard    gone            N/A
Id in filename      required        not needed
Config surface      small           open-ended
```

The strict one dropped all the configuration knobs. The free one dropped all the safety machinery. Both got simpler.

## The Liveblocks Validation

This apply shape, "rewrite the whole file, then reconcile against current state," has good external validation.

Liveblocks built an AI copilot inside a collaborative Tiptap editor. Their first attempt asked the model to emit a stream of edit operations referencing node ids. It broke: they found language models are far more comfortable producing text than tree structures, so the operations approach lost track of structure, broke references, and produced malformed operations. So they changed the model: have the AI emit the entire edited document as restricted markup that mirrors their schema, then diff that against the original and apply the difference deterministically.

That is exactly the vault's apply shape. An agent (or a human) rewrites the whole `.md` file. `apply` diffs the on-disk desired state against the current rows and reconciles. The model producing output never needs to know about ids, current state, or delta encoding. The deterministic reconcile handles all of that. A leading collaboration infrastructure company converged on this same shape independently, which is reasonable evidence the model is sound.

## Honest Trade-offs

Two primitives means two things to learn instead of one. The payoff is that each one has one obvious use case and one obvious call shape. The vault is what you use when humans or agents edit files and you want those edits to land in Yjs. The export is what you use when you want a publish folder or a static site kept in sync with no import path.

The vault cannot hide row fields. If a field is in the row schema, it will appear in the frontmatter. That is by design: hiding a field would break the identity round trip. If you want to omit or reshape fields, that is the export's job. The vault is not configurable in that direction because being configurable there would bring back the guard.

Bodies are the one place where the vault still has a constraint worth calling out. A fuji entry has a rich-text body that lives in a separate Yjs content doc, not in a row column. The vault materializes it read-only today: Yjs to disk as a prosemirror-to-markdown serialization. Editing a body back (import direction) is gated behind a faithful round-trip codec, because a naive plaintext round trip would flatten headings and lists the moment an agent makes a one-word edit. The body import path is v2, after a faithful prosemirror-markdown codec lands. The frontmatter apply path ships and is proven now, and that is the right staging: prove the safe core first, then extend to the harder case.

## The Takeaway

The original seam was not poorly designed. It was doing a real job. But it was doing two jobs with opposite constraints: the editable reconcile needs strict conventions to guarantee safety, and the publish export needs freedom to shape output for any consumer. Those constraints fight each other inside one abstraction. Every configuration knob added to make the export free made the import less safe, and every guard added to make the import safe made the export more constrained.

Once you name the split honestly, the complexity just leaves. The guard is gone. The id-in-the-slug is gone. The independent codec halves are gone. Four actions become two (plus one continuous background process). Each primitive has one job, one obvious shape, and no runtime checks compensating for things the type system could not say.

> **The Golden Rule**: When a runtime guard is compensating for a contract your abstraction cannot express, look for the split. The guard will go away because the design will not need it anymore.
