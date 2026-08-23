# 0058. Push-to-talk owns the recording it starts, keyed by the recording's id, not a general lifecycle layer

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

Push-to-talk starts recording on a `Pressed` edge and stops on `Released`, and for a while the edge *was* the whole state machine: nothing owned "this recording is the one push-to-talk started." Several layers can silently drop the `Released` (a keyboard-tap restart, a binding re-sync, a capture switch, an OS-eaten key-up, or a release that lands before startup has even reached `RECORDING`), and any dropped release left the microphone recording forever. Fixing it meant scoping the stop to the exact recording a press started, including the case where the release arrives before that recording exists.

A recording already has an identity: the manual recorder mints a `recordingId` (the nanoid that names its artifact and is the foreign key on its row) at the start of every capture. It was being discarded immediately after being passed to the platform recorder.

## Decision

A push-to-talk press owns a session `{ id, recordingId, stopRequested }`. `startManualRecording()` returns the id of the recording it started, or `null` when it started nothing it owns (startup failed, or a recording was already live so the call no-op'd). The press remembers that `recordingId`, and every stop input for a held recording, the real release, the Rust synthetic release, the 5-minute cap, and the capability-loss reconcile, routes through `stopManualRecordingById(recordingId)`, which stops only when that id names the live recording, and which a release during startup satisfies by setting `stopRequested` (honored the moment the recording exists).

We deliberately do not build a general recording-lifecycle layer, and we do not invent a separate "source" or "owner" concept: the recorder already mints the recording's identity, so exposing `manualRecorder.currentRecordingId` and returning it from `startManualRecording()` were the only missing pieces. The recorder stays caller-agnostic, it never names `pushToTalk`. A backend reconcile hook must call the owned stop (via `pushToTalk.stop()`), never the generic `stopManualRecording`.

## Consequences

- A stray or duplicated release never stops a toggle or record-button recording: an id mismatch is a no-op, and a press that collided with an already-live recording learns at start time (`null`) that it owns nothing, so it never arms a cap or a stop at all.
- A release that lands before startup finishes is latched and honored, closing the lost-edge stuck-on the bare model had.
- `stopManualRecording` becomes idempotent and gains the `stopManualRecordingById(recordingId)` sibling; the toggle and button paths stop the live recording directly and unconditionally.
- The recorder owns the recording's identity in one place (`currentRecordingId`, the same nanoid it already generated); `RecordingSource` is deleted. Push-to-talk is encapsulated in a `createPushToTalk()` factory, matching `createManualRecorder` / `createVadRecorder`.
- Defense is two layers: the Rust matcher synthesizes a `Released` for an abandoned active gesture (restart, re-sync, capture), and the frontend scoped stop handles the startup race and, via the cap, the OS-eaten key-up.
- The 5-minute cap is a safety fuse for the one path with no signal at all (an OS-eaten key-up while the tap stays alive), not the primary stop.
- Cost: the recorder must retain and expose the recording id it already minted, and the standing discipline that every backend reconcile hook calls `pushToTalk.stop()`. This forecloses a generic backend `stopManualRecording()` call, which would cut a legitimate toggle or button recording.

## Considered alternatives

- **A general "recording lifecycle" layer.** Heavier than the code earns; the recorder already owns `_current` / `_starting` / the recording id, so a new abstraction would re-home state that already has a home.
- **A `source: 'manual' | 'pushToTalk'` tag on the recorder.** The first shape that landed (see the spec). It works, but it makes the low-level recorder enumerate its high-level callers by name, and it is a coarser identity than the recording's own id (it cannot tell two same-source recordings apart). Collapsed into `currentRecordingId`: the recording already has an identity, so a parallel category was redundant.
- **Check `manualRecorder.state` on `Released`.** Insufficient: a release can arrive while the recording is still starting (`state !== 'RECORDING'` yet), so a state check alone misses the nastiest race.
- **Focus-regain reconcile.** Rejected: global push-to-talk fires while another app is focused, so window focus is the wrong signal for "the hold ended."

## Reference

- Implemented in `apps/whispering/src/lib/operations/push-to-talk.ts`, `.../operations/recording.ts`, and `.../state/manual-recorder.svelte.ts`; the keyboard backend half lives in `apps/whispering/src-tauri/src/keyboard/`. PR #2175. The design spec was retired on acceptance (recoverable in git history); the remaining hands-on desktop smoke is tracked on the PR.
