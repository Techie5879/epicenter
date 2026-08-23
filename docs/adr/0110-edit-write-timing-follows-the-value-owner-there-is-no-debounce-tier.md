# 0110. Edit write timing follows the value owner; there is no debounce tier

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

Epicenter apps now carry five kinds of editable surface: CRDT-bound rich bodies
(Honeycrisp's ProseMirror over a `Y.XmlFragment`, Opensidian's CodeMirror over a
`Y.Text`), plain workspace fields (titles, folder names, term notes), search and
filter inputs, local form drafts, and device-local settings. The sync path under
them is deliberately immediate end to end: a Yjs transaction synchronously
reaches y-indexeddb, sibling tabs over BroadcastChannel, and an open WebSocket,
and the server appends and fans out in the same listener. The only debounce
anywhere in the stack is the server's 300ms presence rebroadcast grace and
y-indexeddb's internal compaction timer; neither is a save mechanism. Without a
written standard, apps drifted: one app installed the commit-on-blur safety net
in its layout while five apps with blur-committed fields did not, one app writes
derived row metadata on every keystroke, and individual inputs choose `oninput`
or `onblur` ad hoc.

## Decision

Write timing is a property of the value's owner, and there are exactly three
timings. No surface gets a debounce.

| Owner of the value | Write timing | Why |
|---|---|---|
| `Y.Text` / `Y.XmlFragment` behind an editor binding (y-prosemirror, y-codemirror.next) | Every editor transaction, immediately | Character-level CRDT merge is the product behavior; the binding is the document |
| Workspace table row field or KV entry edited through a text input | Commit at a semantic boundary: blur, Enter, or explicit submit, with a compare-then-write guard | One typing session becomes one row write instead of N; the boundary is user intent, not a timer |
| Discrete controls (selects, toggles, checkboxes, pickers) writing to any store | Immediately on change | Already one event per intent |
| Local UI state (search, filter, in-flight form drafts) | Never persisted; local `$state` or URL params only | Transient by definition |
| Device-local persisted settings (`createPersistedState` over localStorage) | Either timing is acceptable; per-input writes are fine | localStorage is synchronous and local; there is no transaction, sync message, or tombstone to amortize |

Two enforcement mechanisms make the middle tier real:

1. **The page-hide blur net is owned by `@epicenter/svelte`** as a
   `FlushEditsOnHide` component, rendered once in the root `+layout.svelte`
   of every app with blur-committed durable fields (six today; Todos has no
   such field and renders nothing). It force-blurs
   `document.activeElement` on `visibilitychange`-to-hidden and `pagehide`, so
   every commit-on-blur handler runs synchronously before teardown. Per-app
   copies of the six-line handler are deleted; the copy-paste standard
   demonstrably did not propagate (one app in six had it).
2. **A no-op `table.update()` emits nothing.** When the merged row is
   value-equal to the stored row, the write is skipped: no Yjs transaction, no
   IndexedDB append, no sync frame, no LWW timestamp refresh. Derived-metadata
   writers (Honeycrisp's title/preview/wordCount extraction on every editor
   transaction) then cost nothing on the keystrokes that change nothing, while
   keystrokes that do change the note list update it live, which is the named
   product behavior.

## Consequences

- Rich editors stay per-keystroke everywhere. Moving them to blur or a debounce
  would defeat character-level merge; a debounced CRDT write would also require
  forking the editor bindings, whose model is that the shared type *is* the
  document.
- A debounced middle tier is refused. Debounce has every failure mode of blur
  (still needs the hide net) plus timers, flush-on-unmount bookkeeping, and
  writes that land mid-typing. Blur is strictly simpler and maps to intent.
- The net is only as synchronous as the blur handler. `.blur()` dispatches the
  blur event synchronously, but a handler that defers its write
  (`requestAnimationFrame`, `setTimeout`, an `await` before the write) escapes
  the guarantee: rAF callbacks do not run while the document is hidden, and
  teardown outruns timers. Blur handlers on durable fields write synchronously;
  a handler that needs a deferred path for a visible-page focus dance (the tree
  rename inputs wait one frame so a closing context menu does not cancel the
  edit) branches on `document.visibilityState === 'hidden'` and commits
  immediately there.
- Skipped no-op updates mean a caller can no longer "touch" a row to refresh
  its LWW timestamp by rewriting equal values. No current caller does this
  deliberately; if one ever needs touch semantics, that is an explicit new
  method, not a side effect of `update()`.
- The DOM net is a browser guarantee only. Tauri window close is not guaranteed
  to fire page-lifecycle events; if a Tauri app grows workspace-backed
  commit-on-blur fields whose loss is observed, the seam is a `CloseRequested`
  handler that blurs before allowing close. Deferred until a real loss shows up.
- Transport-level batching of Yjs updates (merging updates within a frame
  before the WebSocket send) stays unbuilt. It is an infrastructure seam in the
  sync supervisor, not an app pattern, and nothing has measured a need for it.

## Considered alternatives

- **`WorkspaceGate` owns the net.** Lost: only three of the six workspace-backed
  apps render it, and a readiness gate acquiring document-global listeners as a
  side effect is the wrong owner even where it is rendered.
- **`@epicenter/app-shell` owns the net.** Lost: it is the branded, full-stack
  chrome package; apps like Skills and Todos need the net without wanting that
  dependency edge.
- **Per-app six-line copies (status quo ante).** Lost empirically: documented in
  the svelte skill, installed in one app out of six.
- **A shared commit-on-blur input component.** Lost for now: the handler is
  three lines and the sites are heterogeneous (rename inputs with Enter/Escape,
  settings fields, textareas). Revisit if the defensive local-buffer-plus-focus-
  flag variant appears a third time.
