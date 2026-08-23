# Bridge File Changes to Y.Text

**TL;DR**: Let coding agents keep using normal file edits. Bridge those file changes into `Y.Text` with a minimal text diff. The rule is simple: never replace the whole `Y.Text`; always diff the current `Y.Text` against the new file text and apply the smallest insert/delete operations we can.

One of the hardest problems in building Epicenter is deciding how human editing and agent editing should share the same workspace.

Humans want a live collaborative editor. Agents want files. They read text, write text, and leave behind a git diff. Trying to force agents to speak native CRDT operations sounds elegant, but it asks the model to do the thing models are worst at: precise structural editing.

So the compromise is the bridge.

```txt
agent edits file
  -> file changes on disk
  -> bridge reads new file text
  -> bridge diffs current Y.Text against that text
  -> bridge applies minimal insert/delete operations
  -> Yjs editors stay in sync
```

This is close to the diff-match-patch idea, but the important part is not a specific library. The important part is the shape of the operation:

```txt
current Y.Text + new file text
  -> text diff
  -> Y.Text insert/delete operations
```

The main rule:

```txt
Never replace the whole Y.Text.
Always diff current Y.Text to new file text and apply minimal insert/delete.
```

That rule only makes sense after looking at the other options.

## The Other Strategies

We could make agents write native Yjs operations.

```txt
agent output:
  insert "foo" at Yjs position X
  delete 12 characters at Yjs position Y
```

That would preserve intent best, but it asks the agent to understand live CRDT positions. Coding agents do not work that way. They read files, produce text edits, and rely on the host to apply them.

We could make agents write structured operations against an AST.

```txt
agent output:
  add import to module
  wrap function body in try/catch
  rename property access
```

That sounds better than text until the parser becomes the whole product. Every language, syntax extension, formatter, and partial file state needs support. It is powerful for focused codemods. It is too heavy as the universal edit path.

We could store each file as one row value and let last write win.

```txt
files.set({
  path: "apps/api/src/app.ts",
  content: "...entire file..."
});
```

That is simple, but the conflict unit is the whole file. If a human edits one function while an agent edits another, one full file value can win and the other can disappear.

We could build a proposal system.

```txt
agent creates proposal
human reviews proposal
proposal applies later
```

That is probably useful eventually. It is also a product surface: proposal rows, review UI, conflict states, rebasing, accept/reject actions. It is more machinery than we need for the first working bridge.

The bridge is the intermediate point.

```txt
agent keeps normal file workflow
Y.Text keeps collaborative identity
git diff stays the review surface
```

That gives us most of the value:

- simple agent compatibility
- normal filesystem tools still work
- normal git diff still works
- Yjs editors stay in sync
- non-overlapping text edits mostly survive
- no custom proposal database
- no complex accept/reject UI

The tradeoff is honest:

```txt
If an agent and a human edit the same region at the same time,
someone may lose intent.
```

But that is already true with normal coding agents. The bridge at least reduces the blast radius.

## Why Not Replace the Whole Text?

Replacing the whole `Y.Text` is the easy implementation and the wrong data model.

```ts
ytext.delete(0, ytext.length);
ytext.insert(0, fileText);
```

That makes every agent write look like the whole file was deleted and recreated. Any concurrent human edit is now competing with a document-sized replacement. Revision history gets noisy. Cursors jump. Storage grows for the wrong reason.

The bridge should preserve the identity of unchanged characters.

```ts
updateYTextFromString(ytext, fileText);
```

That function reads the current `Y.Text`, computes a character diff against the new file contents, and applies the diff inside a Yjs transaction. Unchanged spans keep their CRDT identity.

## What This Solves

The bridge gives us an intermediate architecture that matches how people already work.

```txt
Source of truth for coding workflow:
  files + git diff

Source of truth for collaborative editing:
  Y.Text

Bridge:
  file text changes become Y.Text insert/delete operations
```

Agents do not need to know about Yjs internals. Editors do not need to know about every agent tool. The bridge translates between the two worlds.

That matters because every serious coding agent already converges on text edits: read a file, search for old text, replace it with new text, then let git show the result. We should not fight that. We should make that path safe enough to coexist with Yjs.

## What This Does Not Solve

This is not native intent preservation.

If the agent reads this:

```txt
Hello World
```

and starts thinking, then a human changes it to:

```txt
Hello Earth
```

and the agent later writes:

```txt
Hello Beautiful World
```

the bridge sees:

```txt
current: Hello Earth
target:  Hello Beautiful World
```

The diff may delete `Earth` and insert `Beautiful World`. The human's overlapping edit is lost.

That is the cost of adapting a stale full-text output into CRDT operations. The bridge guesses intent from before and after text. It does not know the agent meant "insert Beautiful before the noun" unless the agent gives us that operation directly.

The important part is the blast radius:

```txt
whole-text replacement:
  overlapping unit = entire file

minimal text diff:
  overlapping unit = changed character range
```

That is the Occam version. It is not perfect, but it is much better than clearing and rebuilding the document.

## Prior Art in This Repo

This is not a brand-new idea in Epicenter.

`packages/workspace/docs/articles/ytext-diff-sync.md` already describes the same core mechanism: sync a `Y.Text` to a new string by computing character-level differences, then applying only the needed insertions and deletions. It names filesystem sync as the primary use case.

An older parser refactor spec also records the naming history:

```txt
syncYTextToDiff -> updateYTextFromString
```

That name change is right. The function is not only for sync and not only for diffs. It reconciles a `Y.Text` to a target string while preserving as much CRDT identity as the target string allows.

## The Practical Shape

The implementation wants two origins so the bridge does not echo itself forever.

```ts
const FILESYSTEM_ORIGIN = Symbol('filesystem');
const YTEXT_ORIGIN = Symbol('ytext');
```

When the file changes on disk:

```ts
ydoc.transact(() => {
	updateYTextFromString(source, fileText);
}, FILESYSTEM_ORIGIN);
```

When the `Y.Text` changes from the editor:

```ts
source.observe((_event, transaction) => {
	if (transaction.origin === FILESYSTEM_ORIGIN) return;
	writeFileAtomically(path, source.toString(), YTEXT_ORIGIN);
});
```

The real code will need debouncing, atomic writes, and loop prevention around filesystem watchers. But the model stays small.

```txt
disk changed:
  sync disk -> Y.Text

Y.Text changed:
  sync Y.Text -> disk

git diff:
  remains the review surface
```

## When to Add More

Do not start with proposal databases, semantic anchors, AST rebasing, or policy engines. Start with the bridge.

Add more only when the pain is real:

- If overlapping edits happen often, add conflict cards.
- If agents need review before writes, add proposals.
- If text anchors fail too often, add AST anchors.
- If rich documents lose structure, add constrained serialization.

Until then, the smallest useful architecture is:

```txt
plain file edits
  + Y.Text mirror
  + minimal text diff bridge
  + git diff review
```

That is the compromise: agents keep the filesystem workflow, humans keep live collaboration, and Yjs only receives the smallest text operations the bridge can infer.
