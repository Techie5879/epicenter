# 0016. Prewarm the cold model load and refuse the rest of the latency menu

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

On desktop the felt latency between "stop speaking" and "transcript appears" is
dominated by one thing: the **cold model load, about 1 second.** The
`WHISPERING_TIMING` instrumentation on real logs (Parakeet, Apple Silicon)
splits cold from warm: a cold recording spent 1245 ms (load plus inference) on a
4 s clip, while a warm one ran inference at about 60 ms per second of audio, so
the load alone is roughly 1 s. With the default `AfterFiveMinutes` eviction,
intermittent dictation pays that load on most recordings.

Every other item in the budget is small next to it. The WAV write plus fsync
plus read-and-decode round-trip measured about 14 to 79 ms across 5 to 60 s clips
on a fast SSD, single-digit to low-tens of milliseconds in the common case.
Finalize and delivery are smaller still.

A design pass (the desktop-audio-pipeline-greenfield spec, deleted with this
record) explored a full menu: prewarm, an in-process PCM handoff with async
persistence, native VAD on the shared cpal engine, and streaming partial
transcription. [ADR-0012](0012-transcription-settings-are-read-at-use-not-mirrored-into-rust.md)
had just collapsed model lifecycle to a lazy `ModelCache` and deleted eager
preload to kill the generation-token machinery, so any new warming must not
bring that back.

## Decision

Optimize exactly one thing, the cold model load, and refuse the rest of the menu.

- **Prewarm at capture start.** Load the selected local model the instant a
  capture begins (manual record start, and VAD when listening is armed), through
  the *same* guarded lazy-load path transcribe uses. `ModelCache::prewarm` and
  `transcribe` both resolve through one `ensure_engine_loaded(spec, path)`, keyed
  on path plus disk identity, so prewarm warms exactly the model transcribe will
  use and adds **zero** generation tokens. This is prewarm on a discrete
  capture-start action, not the eager-preload-on-selection that ADR-0012's lazy
  collapse refused. A mid-recording model change just reloads at transcribe time
  (the prewarm load is wasted, never wrong). The cache mutex already serializes
  loads, so a transcribe arriving mid-load blocks on it and reuses the resident
  engine.
- **Refuse the in-process PCM handoff and async persistence.** Saving the roughly
  20 ms disk round-trip is not worth weakening the "recording is saved before
  transcription" guarantee that async persistence trades away. The transcript
  keeps reading the canonical WAV by id-handle, so audio bytes never cross the
  JS/Tauri boundary. The built implementation is parked at `dde4f86c8` (closed
  PR #2083), to be revived only if a real contended-disk fsync tail is reported.
- **Refuse streaming and chunked partial transcription.** The user controls stop;
  prewarm plus warm inference makes streaming unnecessary, and chunk-and-stitch
  carries a permanent boundary-accuracy tax.
- **Do not build native VAD speculatively.** There is no evidence the desktop VAD
  round-trip is felt, and it is the largest change with the most behavioral-parity
  risk. Revisit only if instrumentation shows it dominating.
- **Keep the `WHISPERING_TIMING` instrumentation.** It is off by default and free
  when off. It produced the number that justified this decision and stays the
  tool to reopen any of these refusals on evidence.

## Consequences

- Intermittent dictation stops paying the about-1-second cold load on most
  recordings; the load overlaps the speech instead of landing after stop.
- The desktop latency budget is closed until a *measured* regression reopens a
  specific refusal. No speculative performance work.
- Two accepted edges: a VAD session armed and then silent past the unload timeout
  reloads cold on the next speech; starting and then cancelling a capture warms a
  model that goes unused until idle eviction. Both are cheap and rare.
- The in-process handoff design is not lost: recoverable at `dde4f86c8` or closed
  PR #2083.

Supersedes and deletes the desktop-audio-pipeline-greenfield spec
(`20260617T170000`, harvested into this record; recover its body from git
history if needed). The earlier transcription-latency-optimization spec it
superseded was already removed when prewarm landed in #2088.
