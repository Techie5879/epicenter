# 0013. File import is a surface, not a recording mode

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

Whispering modeled audio capture with a single `recording.mode` enum of
`manual | vad | upload`. But `manual` and `vad` are microphone *triggers* (how
the mic starts capturing), while `upload` is file import: it has no live
capture, no input device, no start/stop shortcut, and no recording overlay.
Treating it as a fourth value of the same enum forced every consumer to
special-case it (setup-readiness bypassed the shortcut check for `upload`, the
overlay union excluded it, the trigger→command map returned an inert default),
and the settings copy implied uploading a file was a way to "activate
recording."

## Decision

The microphone-trigger setting is `recording.trigger`, valued `manual | vad`
only. File import is its own surface and command (`importFiles`), reachable
regardless of the selected trigger and first-class on both web (file picker)
and desktop (picker plus drag-and-drop). Importing a file never mutates
`recording.trigger`. The delivery layer distinguishes the two origins with a
`'recording' | 'import'` source solely to pick honest success copy.

## Consequences

- The trigger enum holds only real microphone behaviors, so the per-consumer
  `=== 'upload'` special cases are deleted, not maintained.
- File import is always available; on the homepage it is a persistent drop
  zone under the recorder. Dropping audio while a recording is live starts an
  independent import pipeline without stopping the recording.
- No data migration: `field.select` reads an out-of-union stored value as the
  `defineKv` default, so an existing `upload` value cleanly becomes `manual`.
- This forecloses a single enum that lists "every way audio enters the app."
  Import lives outside the trigger model by design; a future capture source
  (e.g. system-audio) is a new surface decision, not a new enum value.

## Considered alternatives

- **Keep `upload` in the recording-mode enum.** Rejected: it is not a recording
  mode, and conflating it forces special-casing across setup, overlay, and the
  trigger→command map.
- **Name the setting `recording.micTrigger`.** Rejected: a camelCase leaf is
  inconsistent with the dotted keys around it (`recording.navigator.deviceId`).
  `recording.trigger` reads the same and fits the namespace.
- **Put import on its own `/import` route.** Rejected: it adds a navigation step
  to the most common secondary action; import belongs on the home surface
  beside the recorder.
