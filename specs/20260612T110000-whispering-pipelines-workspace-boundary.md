# Whispering Pipelines Workspace Boundary and Selection Picker

**Date**: 2026-06-12
**Status**: Draft (future; sequenced after custom backends v1)
**Owner**: Braden
**Branch**: none yet

> **Update (2026-06-12, transformation-engine collapse)**: the engine collapse
> (formerly `20260612T210000-whispering-transformation-engine-collapse.md`) has
> since been **removed** from the tree (folded into the shipped engine; see
> `docs/spec-history.md`). Candidates live in memory; only the accepted candidate
> becomes a run (no per-candidate rows). There is no `steps` table to relocate: a
> transformation is `preReplacements[] + prompt? + postReplacements[]`, so
> "definitions = transformations + steps + backends" now reads "transformations +
> backends."
>
> **Update (2026-06-25, capability decomposition)**: the refine engine becomes a
> **library** on the shipped Connection floor (its `COMPLETION_PROVIDERS` map is
> deleted), and transcription becomes a **service** reached by a shared
> `transcribe(audio, connection)` client. The selection picker (this spec's second
> consumer) and the definitions-vs-runs split stand. See
> `specs/20260625T224402-capability-decomposition-star-service-library.md`.

## One Sentence

Transformation definitions (transformations, steps, custom backends) become a
library workspace separable from Whispering's recording data, and a
select-text-anywhere picker that fans one input through multiple
transformations and shows candidate outputs becomes the engine's second
consumer.

## How to read this spec

```txt
Read first:      One Sentence, Coupling Map, Target Boundary, Sequencing
Read if designing the picker:   Selection Picker, Comparables
Historical context:             the custom-backends spec this builds on
```

## Overview

Whispering quietly grew a general text-pipeline runner with a dictation app
attached. This spec names the boundary that makes the runner a product surface
of its own (run pipelines on any selected text, pick among candidates) and the
workspace split that makes pipeline definitions a shareable library, without
committing to either until the prerequisites land.

## Coupling Map (verified 2026-06-12)

The execution core is already decoupled. `runTransformation({ input: string,
transformation, recordingId: string | null })` takes arbitrary text;
`recordingId` is a write-only bookkeeping tag on the run row, nullable, and
already null in two of the four call paths.

Recording coupling lives in exactly four seams:

| # | Seam | File | Nature |
| --- | --- | --- | --- |
| 1 | Post-transcription hook | `operations/pipeline.ts` | Feeds transcript into `runTransformation` when the `transformation.selectedId` KV is set. The only automatic coupling. |
| 2 | Recording hydration | `rpc/transformer.ts` (`transformRecording`) | Reads `recordings.get(id).transcript` as input. |
| 3 | Row-action picker | `recordings/row-actions/TransformationPicker.svelte` | Passes a `recordingId`. |
| 4 | Delivery notice | `operations/delivery.ts` | Hardcodes a "go to recordings" action on every success notice, even clipboard runs. Small bug; fix opportunistically. |

Already recording-free: the `/transform-clipboard` Tauri window (polls
clipboard, runs `transformInput` with `recordingId: null`), the transformations
editor and its Test pane, `TransformationPickerBody`, and the global shortcuts
that open both.

## Target Boundary

The split is a workspace boundary, not an app rewrite. Definitions are a
library; runs are history.

```txt
pipelines workspace (library: small, shareable, syncs as a unit)
  transformations         title, description
  transformationSteps     prompt_transform + find_replace rows
  customBackends          id, name, endpoint   (moves WITH the steps;
                                               invariant from the backends spec)

whispering workspace (data: stays with the app that produced it)
  recordings, transcripts
  transformationRuns      recordingId already nullable bookkeeping
  transformationStepRuns
  transformation.selectedId KV   cross-boundary soft ref; dangles with the
                                 same named-error treatment as backends

deviceConfig (never syncs, regardless of boundary)
  providers.*.apiKey, providers.custom.apiKeys
```

Cross-boundary references degrade gracefully by construction: `recordingId` on
a run is nullable, `transformationId` on a run may dangle after a library-side
delete (runs are history; render "deleted transformation"), and
`transformation.selectedId` already has not-found handling that clears itself.

**Why not now**: no cloud sync is wired for any Whispering workspace yet, so
the split changes zero behavior today. Its value (sync the library, share
pipelines, mount them in other apps) arrives with sync. The custom-backends
spec was shaped so its schema is invariant under this move; the move becomes
"these three tables relocate together," not a schema migration.

## Selection Picker (the engine's second consumer)

You select text in any app and hit a global shortcut. A small always-on-top
window (the existing picker window pattern) fans the input through k
transformations in parallel, or one transformation sampled n times, and renders
candidate cards diffed against the original. Arrow through, hit enter, and the
existing delivery path applies it (`writeToCursor`, clipboard, optional enter
keystroke).

```txt
selection capture            NEW primitive: simulate Cmd+C, read clipboard,
                             restore prior clipboard after; the polling
                             /transform-clipboard window sidesteps this today
parallel fan-out             NEW: today's runner is strictly sequential per run
candidate cards UI           NEW: original on top, candidates diffed below,
                             candidates live in memory; the accepted candidate
                             becomes a run
picker window, shortcuts,    EXISTS
delivery, run history        EXISTS
```

### Comparables

Reference set for selection-capture, candidate-card picking, and paste-back
delivery (also recorded in the comparable-apps skill):

| App | What it proves |
| --- | --- |
| Apple Writing Tools | System-wide select-text surface invoked from any app; candidate replacements with accept/replace flow. |
| Raycast AI Commands | Global-shortcut launcher; user-defined prompt commands on selection/clipboard; the command library is user-editable, which is exactly the "definitions as library" framing. |
| Grammarly suggestion cards | Inline candidates diffed against the original, accept/dismiss per card, multiple alternatives for one span. |

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Split is workspace boundary, not new app | 2 coherence | Same engine, second consumer; definitions move, runs stay | Coupling map shows four narrow seams; the exciting product is reachable from the existing engine. |
| Definitions vs runs split | 2 coherence | Library workspace gets transformations, steps, customBackends; runs stay app-side | Library is what you sync and share; history belongs to the app that executed it. |
| Keep `find_replace` and `useRegex` | Product (Braden) | Keep, unchanged; do not grow | The only deterministic, free, offline, key-less step type. Load-bearing in dictation ("new paragraph" to newline, filler stripping) and runs after LLM steps to enforce what prompts cannot. More valuable in a shared library: the part that works with zero API keys. Revisit growth (capture-group templating, multi-pattern lists) only on user demand. |
| Defer the split until sync ships | Product (Braden) | Spec now, implement later | Zero behavior change before sync; prerequisite shaping (backends co-location, nullable refs) is already done. |
| Picker before split | 2 coherence | Build the selection picker on the current single workspace | Needs none of the boundary; needs the engine plus three new pieces. |

## Sequencing

```txt
1. Land the providers clean break        (current branch; foundation)
2. Custom backends v1                    (own spec; stacks on 1)
3. Selection picker                      (feature on the engine; fold in the
                                          delivery.ts goToRecordings fix, seam 4)
4. Pipelines workspace split             (this spec; when sync ships)
```

Each step is invariant under the later ones: backend schema survives the
boundary move; the picker is an engine consumer and moves with it.

## Open Questions

1. **Product naming**: "pipelines," "polish," or keep "transformations"?
   The library framing suggests a noun users would share. Recommendation:
   decide at picker time, when the surface gets marketing-visible.
2. **Selection capture mechanics**: simulated copy is lossy (clipboard
   managers, non-text selections, apps blocking synthetic keys). Acceptable
   v1? Recommendation: yes, with clipboard restore; macOS Accessibility API
   selection reading is a later upgrade.
3. **Candidate fan-out semantics**: k different transformations, n samples of
   one, or both? Recommendation: both, but ship k-transformations first; it
   reuses the picker's existing mental model.
4. **Separate app vs mounted workspace**: if other Epicenter apps mount the
   pipelines library, is there ever a standalone pipelines app, or is the
   library plus per-app surfaces enough? Defer until a second app wants it.

## Success Criteria

- [ ] Boundary: pipeline definitions sync/share as a unit with no recording
      data attached; runs stay app-side; a library-side delete renders as a
      named state app-side, never a crash or silent fallback.
- [ ] Picker: select text in a third-party app, invoke by global shortcut, see
      2+ candidates diffed against the original, accept one, and it replaces
      the selection; the accepted candidate becomes a run.
- [ ] Seam 4 is gone: clipboard and selection runs do not offer
      "go to recordings."

## References

- `specs/20260612T091000-whispering-custom-backend-profiles.md` - custom
  backends; its co-location invariant is this spec's prerequisite shaping
- `apps/whispering/src/lib/operations/transform.ts` - the engine
  (`runTransformation`)
- `apps/whispering/src/lib/operations/pipeline.ts` - seam 1
- `apps/whispering/src/lib/rpc/transformer.ts` - seams 2 and the recording-free
  `transformInput`
- `apps/whispering/src/lib/operations/delivery.ts` - seam 4, the hardcoded
  recordings action
- `apps/whispering/src/routes/transform-clipboard/` - the existing
  recording-free picker window the selection picker grows from
