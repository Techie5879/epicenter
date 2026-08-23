# Whispering Custom Backends

**Date**: 2026-06-12 (decisions resolved 2026-06-12)
**Status**: Draft
**Owner**: Braden
**Branch**: (future; builds on the providers clean break)

> **Update (2026-06-12, transformation-engine collapse)**: the engine collapse
> (formerly `20260612T210000-whispering-transformation-engine-collapse.md`) has
> since been **removed** from the tree (see `docs/spec-history.md`). The arbitrary
> `transformationSteps` table is gone: a transformation is a fixed
> `preReplacements[] + prompt? + postReplacements[]`. Everywhere this spec says a
> "step" targets a backend and owns the model, read "the transformation's single
> `prompt`." Named step errors become named prompt errors.
>
> **Update (2026-06-25, Connection floor tension)**: this spec predates the shipped
> Connection floor (ADR-0059/0060), which makes an inference connection
> **device-local** (`{baseUrl, apiKey?}`). That conflicts with this spec's core
> decision to put `customBackends` in the **workspace** so they sync. ADR-0059/0060
> very likely **supersede** this design; confirm before building on it. See
> `specs/20260625T224402-capability-decomposition-star-service-library.md`.

## One Sentence

Users define named OpenAI-compatible backends in a `customBackends` workspace
table (name + endpoint), authenticate them per device through a
`providers.custom.apiKeys` map, and a transformation's prompt targets a backend by
id instead of the single global Custom slot.

## Overview

Replaces the single `providers.custom.*` device-config slot with as many named
backends as the user wants. Backend identity lives in the workspace next to the
steps that reference it; API keys stay device-bound. Two steps in one
transformation can hit two different local servers.

## Motivation

The product promise is "use OpenAI, and bring as many OpenAI-compatible backends
as you want." Today the app supports exactly one custom backend globally
(`providers.custom.endpoint`). The per-step `customBaseUrl` deleted by the
endpoint consolidation was, awkwardly, the only multi-backend support the app
ever had: a user running Ollama and LM Studio side by side could point different
steps at different servers. Named backends are the deliberate version of that
accident.

## Design Decisions

All four open questions from the original draft are resolved. The load-bearing
one was storage domain: transformation steps live in the workspace (the thing
that syncs when sync ships), so a step field referencing backends stored in
deviceConfig would be a foreign key from the synced domain into the unsynced
domain. Every synced transformation would arrive on other devices with dangling
nanoid references the user cannot recreate. And "split later" means a data
migration later, which this branch just refused forever.

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Single custom slot survives? | Product (Braden) | Replace entirely; delete `providers.custom.{apiKey,endpoint}` | Two shapes for one concept is the smell the clean break removed. |
| Storage domain for backend identity | 2 coherence | Workspace table `customBackends` (id, name, endpoint), same workspace as `transformationSteps` | Reference and referent share a fate. Costs nothing today (no cloud sync is wired; workspace behaves device-local) and avoids a future migration, which the project has sworn off. |
| API keys | Product (Braden) | Device-bound map `providers.custom.apiKeys: Record<backendId, string>` in deviceConfig | "API keys are secrets and never sync" stays a clean rule. Workspace encryption is server-trusted, not end to end; third-party credentials should not be operator-readable in principle. Empty key is valid for local servers, so synced backends work immediately on new devices in the common case. |
| First-run seed | 2 coherence | No seed; empty state with an add dialog prefilled with Ollama defaults (`http://localhost:11434/v1`, empty key) | Per-device seeding of a synced table duplicates on merge (two devices each seed "Default", workspace unions them). Empty state is honest and costs one click. |
| Who owns the model | 2 coherence | The step; `customModel` stays per-step, unchanged | Symmetry with every other provider's per-step model column. Two steps on the same backend with different models is a real case (llama3 for cleanup, qwen for summarization, one Ollama). |
| `defaultModel` on the backend | 3 taste | Drop it | Pure prefill sugar that cannot be load-bearing, and it forecloses transcription reuse (a backend's chat model and transcription model differ). Adding an optional field later is additive. Revisit when: users report friction re-typing model names when adding steps. |
| Table naming | 2 coherence | `customBackends`, not anything completion-flavored | A backend is "an OpenAI-compatible server this workspace knows how to reach." Completions are its first consumer, transcription a plausible second. |
| Transcription targeting backends | Product (Braden) | Out of scope for v1; do not foreclose | Speaches is already an OpenAI-compatible server with its own special-case keys (`providers.speaches.*`) that could fold into backends in v2 via a `transcription.customBackendId` KV. Neutral naming and no completion-only fields keep that additive. |

## Architecture

```txt
workspace (syncs when sync ships; co-located with the steps that reference it)
  customBackends table
    id        nanoid
    name      'LM Studio'
    endpoint  'http://localhost:1234/v1'

deviceConfig (secrets never sync)
  providers.custom.apiKeys    Record<backendId, string>, one JSON entry
                              (createPersistedMap supports arbitrary arktype
                              schemas per key)

transformations.prompt (the single prompt phase)
  customBackendId   references customBackends.id
  model             the prompt owns the model

editor
  Provider select grows a "Custom backends" group listing backends by name.
  Empty state shows "Add a custom backend..." opening the prefilled dialog.
  Managing backends (add/edit/delete) lives on the api-keys settings page;
  the key field per backend writes the device map, not the table.

transform.ts
  Custom entry resolves endpoint from the table row and apiKey from the device
  map. A prompt pointing at a missing backend, or an authed backend with no key
  on this device, fails with a named prompt error.
```

**Invariant**: `customBackends` lives in the same workspace as
`transformations`, wherever that workspace ends up. If transformation
definitions move to a library workspace later (see the pipelines boundary
spec), the backends table moves with them. The schema above is unchanged under
that move.

## Edge Cases

### Synced backend arrives on a device with no key

1. Backend row syncs; `providers.custom.apiKeys` on the new device has no entry.
2. Local servers (Ollama, LM Studio) accept empty keys: works immediately.
3. Authed backends fail the step with "backend X has no API key on this
   device", a one-field fix on the api-keys page.

### Deleting a backend that steps reference

1. Delete UI counts referencing steps ("2 steps use this backend") since the
   check is a cheap same-workspace query.
2. If deleted anyway, referencing steps fail with a named error, never a
   silent fallback.

### Duplicate names after a future sync merge

Two devices independently create "Ollama"; the workspace unions them into two
rows. Acceptable; the user deletes one. Ids stay distinct so no step dangles.

## Open Questions

1. **Provider select presentation**: inline group of backends in the existing
   select, or a submenu? Recommendation: inline group while backend counts are
   small; revisit past ~5.
2. **Orphaned key map entries**: when a backend row is deleted, its key map
   entry lingers in deviceConfig. Harmless. Sweep on delete, or leave?
   Recommendation: delete the entry in the same mutation when the delete
   happens on this device; accept lingering entries from remote deletes.

## Success Criteria (v1)

- [ ] Two backends pointing at different local servers can be used by two steps
      of the same transformation.
- [ ] Deleting a referenced backend produces a clear step error, not a silent
      fallback; the delete UI warns with a referencing-step count.
- [ ] No second "single custom slot" shape survives:
      `providers.custom.apiKey` and `providers.custom.endpoint` are gone.
- [ ] API keys never appear in the workspace document (grep the Yjs/IndexedDB
      write path; keys exist only under `whispering.device.` localStorage).
- [ ] Fresh profile: selecting Custom with zero backends lands in the add
      dialog with Ollama defaults prefilled.

## References

- `specs/20260612T090000-whispering-providers-clean-break.md` - the namespace
  this builds on
- `specs/20260612T110000-whispering-pipelines-workspace-boundary.md` - the
  future boundary this design stays invariant under
- `apps/whispering/src/lib/workspace/definition.ts` - tables and KV; where
  `customBackends` and `customBackendId` land
- `apps/whispering/src/lib/state/device-config.svelte.ts` - where the key map
  lands and the single custom slot dies
- `apps/whispering/src/lib/operations/transform.ts` - COMPLETION_PROVIDERS map
- `apps/whispering/src/lib/components/settings/ProviderConfigFields.svelte` -
  where backend management UI would live
