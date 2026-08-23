# Rebuild local model recommended defaults on the folder-backed selector

Date: 2026-06-12. Owner: Braden. Supersedes the implementation in PR #1922 (branch `feat/local-model-defaults`, closed unmerged).

## Goal

Rebuild the recommended-defaults UX from PR #1922 on top of main as it stands after PR #1923. The old branch cannot rebase: every commit except its docs commit targets APIs that #1923 deleted (absolute model paths in settings, the file picker import flow, `local-preflight.ts`). The design intent survives; this spec carries it to a fresh implementation.

## What happened

Two parallel passes rewrote the same surface. PR #1922 redesigned the local engine cards around one recommended model per engine (status hero, progressive disclosure, shared download state). PR #1923 replaced the storage model underneath: the engine's models folder under app data became the single source of truth, settings store a folder entry name instead of a path, and the manual file picker died in favor of "drop or symlink a file into the folder". #1923 merged first. #1922 was closed and its docs commit re-landed separately (the comparable-apps worked example, `.agents/skills/comparable-apps/SKILL.md`).

## The intent to preserve

The local-engine section handed the user every decision at once: every catalog model as a peer row plus bring-your-own affordances, all visible before the user made the only choice that matters (get a working model). Rebuild each engine's card around one obvious happy path:

```txt
+ Whisper Model ------------------------------------+
| Models run on this device...                      |
|                                                   |
|  [empty]   No model installed                     |
|            Download the recommended model...      |
|            [ Download Small (488 MB) ]            |
|            (progress bar while downloading)       |
|                                                   |
|  [active]  | Small          [Active]  (Change) |  |
|            |   488 MB                          |  |
|                                                   |
|  > All models (4)                  [collapsed]    |
|      catalog download cards w/ Recommended badge  |
|      custom folder entries as selectable rows     |
|      folder help box + Open Models Folder         |
+---------------------------------------------------+
```

Sizes stay on download buttons; these are 0.03 to 1.6 GB downloads, possibly on metered connections. When the recommended model is on disk but not active, the hero button reads "Activate" instead of "Download". The active summary shows the catalog name and size, or the entry name with "Your model" for a custom folder entry. The Change button expands the "All models" collapsible.

Alternatives already rejected in #1922's design pass, do not reopen: a select-like row that expands in place (hides the download CTA in the empty state, exactly where the affordance must be strongest), and a flat list showing only the recommended row plus a "show N more" tail (shows the wrong model at a glance whenever a non-recommended or custom model is active). The comparable-apps grounding (Ollama, LM Studio, Jan, superwhisper, MacWhisper, Handy, Wispr Flow) lives in the skill's worked example.

## What main looks like now

Read these before writing anything:

- `apps/whispering/src/lib/components/settings/LocalModelSelector.svelte`: one flat list backed by the engine's models folder. Catalog models render as `LocalModelDownloadCard`; every other folder entry renders as a selectable "Your model" row with activate and delete. A missing-selection notice appears when the active name is no longer in the folder. A help box explains drop-or-symlink and an Open Models Folder button opens it. `svelte:window onfocus` rescans the folder. The bindable `value` is an entry name, never a path.
- `apps/whispering/src/lib/operations/local-models.ts`: `createPrebuiltModel` exposes `activeModelName` (reactive via `deviceConfig`), `activate()`, `downloadAndActivate()`, and `delete()`. Activeness is `deviceConfig.get(settingsKey) === modelEntryName(model)`.
- `apps/whispering/src/lib/services/transcription/local-model-folder.ts`: renamed from `local-model-storage.ts`; `createModelStorage` still exists, plus `listModelEntries` and `deleteModelEntry`.
- `apps/whispering/src/lib/components/settings/LocalModelDownloadCard.svelte`: still owns a private per-component state machine with an `$effect`. Only one surface per model exists today, so the duplicate-state bug has no trigger until the hero returns.

## Decisions already made, with grounding

- Recommended is catalog data, not a user preference: `recommended?: true` on `BaseModelConfig`, exactly one per engine (whisper-small, parakeet-tdt-0.6b-v3, moonshine-base-en). Commit `d9d7ea9fc` on the old branch re-applies nearly clean; the only conflict is textual (#1923 added `modelEntryName` at the end of `constants/local-models.ts`, keep both).
- Shared download state lives in a `$lib/state` module keyed by model id, factory-plus-getter shape like `local-model.svelte.ts`. The state accessor must be a plain getter, not `$derived`: handles are created lazily by whichever component touches them first and outlive it, and a derived created inside a component's effect context goes inert when that component is destroyed (Svelte's `derived_inert`; verified against sveltejs/svelte via DeepWiki). Components alias the getter with their own `$derived` for union narrowing.
- The "All models" expansion is a component-local `$state` boolean with `bind:open`; this is the controlled-collapsible pattern shadcn-svelte itself uses (`CodeCollapsibleWrapper`; verified via DeepWiki).

## Port notes for the state module

The old branch's `apps/whispering/src/lib/state/local-model-downloads.svelte.ts` (commit `c21131c16` on `feat/local-model-defaults`) is the right shape but needs three changes:

1. Import `createModelStorage` from `local-model-folder.ts`, not the deleted `local-model-storage.ts`.
2. Activeness check becomes name equality: `activeModelName === modelEntryName(model)`, not `activeModelPath === installedPath`.
3. Its disk-caching decision is now wrong in direction, not just detail. The old module checked disk once per handle and let download/delete maintain it, accepting staleness if files changed outside the app. #1923 made the folder user-editable truth and rescans on window focus precisely to catch external edits. The handle must refresh its installed state on the same signal (expose a `refresh()` the selector calls from its existing `onfocus` rescan, or subscribe in the module).

Then collapse `LocalModelDownloadCard` onto the shared handle and delete its `$effect`, which is what makes a download started in the hero show progress in the catalog row and vice versa.

## Plan

1. Branch off main. Cherry-pick `d9d7ea9fc` (recommended flags), resolve the constants conflict.
2. Port the state module per the notes above.
3. Rebuild the hero inside main's `LocalModelSelector.svelte`. The hero renders when nothing is active and the folder holds no custom entries (`!value && customEntries.length === 0`): an Empty block whose button derives from the recommended model's handle state (Download with size, progress bar while downloading, Activate when on disk). When custom entries exist but nothing is active, skip the hero and default "All models" open; that user already brought their own model, and a "Download Small (488 MB)" pitch would ignore it. When a model is active, show the summary row (catalog name and size, or entry name with "Your model") with the Change button. Everything else (catalog cards, custom entry rows, folder help box) collapses behind "All models (N)" where N counts catalog plus custom entries. Keep the missing-model notice always visible, not inside the collapsible; it is an error state.
4. Typecheck: `bun run --cwd apps/whispering typecheck` (0 errors; 5 warnings were pre-existing at time of writing).
5. Visual pass in a running Tauri build: empty, downloading, ready, and active on all three engines, plus a custom dropped-in entry and the missing-model notice. Neither #1922 nor #1923 was runtime-verified; this is the first change that should be.

## Scoping decisions (resolved 2026-06-12, do not reopen)

- No deactivate affordance. Deactivating leaves the engine selected with no model, a broken configuration that fails preflight until something is picked. Not wanting this model means activating another; not wanting local transcription means switching provider above the card. The old X-to-clear was an artifact of the path input, and #1923 deleted the input.
- The active-summary-plus-collapse half stays. The summary row is what answers "what is running" at a glance, which was the reason the flat-list alternative was rejected, and that reason did not shrink with the surface. Custom entries collapse along with the catalog; the hero-skip rule above covers the one case where hiding them would mislead.
- This work stacks on the `whispering/local-model-defaults-handoff` branch (PR #1926) rather than waiting for a docs merge. Retitle and rewrite the PR description when the implementation lands. The two docs commits are standalone; if the rebuild stalls, split them out and merge them alone.

## Constraints

Repo rules that bit this work before: bun only, no em or en dashes anywhere, `writing-voice` skill for UI strings, stage specific files, no AI attribution in commits, `post-implementation-review` before handoff.
