# 0028. Both shortcut tiers share one physical KeyBinding model

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

Whispering has two shortcut tiers: in-app (browser keydown, focused-window,
synced workspace KV) and system-global (native rdev/plugin, per-device
device-config). They had drifted into two unrelated representations. The in-app
tier spoke logical keys (`e.key`, lowercased, with a macOS Option-character hack
to undo Option+A producing "å") stored as `"ctrl+shift+a"` strings; the global
tier already spoke a structured physical `KeyBinding { modifiers, keys }` over
`e.code`. Every downstream duplication descended from that one fork: two key
vocabularies, two label renderers, two capture paths, two recorders, and the
Option hack that existed only because the in-app matcher read logical `e.key`.

## Decision

The structured physical `KeyBinding` is the single runtime representation for
both tiers. `key-binding.ts` is the one shortcut core: `parseManualBinding` and
its lossless inverse `keyBindingToString` are the one readable grammar (handling
Fn and modifier-only holds), `keyBindingToLabel` is the one renderer, and
`e.code → domCodeToKey` plus `eventModifiers(e)` is the one capture path. The
in-app browser matcher matches on `KeyBinding` set-equality against the live
held set, reading modifiers from the event's boolean flags rather than tracking
modifier keyups. At rest, the in-app tier stores the readable grammar string in
its existing `field.string()` KV cell (no schema migration); a value that fails
`parseManualBinding` reads as unset.

## Consequences

- The macOS Option-character problem is **deleted, not relocated**: physical
  `.code` capture never had it, so `normalizeOptionKeyCharacter`, the dead-key
  warning, and the entire logical-key vocabulary (`KeyboardEventSupportedKey`
  and friends, `constants/keyboard/**`) are gone.
- One capture primitive (`createChordRecorder`) serves both recorders; the
  logical `createPressedKeys` / `createLocalKeyRecorder` path is removed.
- Reading modifiers from live event flags removes the stuck-modifier class of
  bug the old keyup-tracking dance guarded against.
- In-app bindings now follow physical key position, so on a non-US layout the
  label can differ from the printed character. This ends an inconsistency (the
  global tier was already physical) rather than introducing a new quirk; QWERTY
  and single-letter defaults are unaffected. The in-app tier cannot bind Fn
  (the browser cannot observe it), which it never needed.
- Two things stay two, by principle, not drift: the **matcher runtime** (browser
  keydown vs native rdev/plugin; the web build has no native hook) and the
  **storage home** (synced KV vs per-device device-config, the deliberate sync
  policy of [ADR-0007](0007-local-shortcuts-sync-global-shortcuts-stay-per-device.md)).
  The global tier keeps its structured at-rest JSON; converting it to the same
  readable string was considered and deferred as separable, since the runtime
  shape is already unified.

## Considered alternatives

- **Keep logical in-app, physical global.** The status quo this record removes;
  the inconsistency was the source of every duplication.
- **Unify down to a string at runtime.** Loses the Fn / modifier-only
  expressiveness the global tier needs; the structured shape is the superset.
- **One matcher for both tiers.** Impossible: the web build has no native hook,
  and global-while-unfocused needs an OS-level one.
- **Reuse `keyBindingToAccelerator` as the at-rest serializer.** Lossy: it
  returns `null` for Fn and modifier-only bindings, which is why
  `keyBindingToString` exists alongside it.
