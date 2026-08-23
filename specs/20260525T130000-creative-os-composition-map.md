# Creative OS Composition Map

**Date**: 2026-05-25
**Status**: Draft
**Author**: Epicenter

> **Update (2026-06-25, capability decomposition)**: the "Polish" / Refine app is
> a **library** in the now-settled model, not a server: a pure in-process engine
> whose only heavy step (the LLM) is a call to the shipped Connection floor
> (ADR-0059/0060). Transcription is a **service** reached over one OpenAI-compatible
> wire by a shared `transcribe(audio, connection)` client. See
> `specs/20260625T224402-capability-decomposition-star-service-library.md`.
> Direction 2 (typed IDs + `epicenter://`) and "defer the universal graph" stand.

## Overview

This spec maps Epicenter onto the `Capture -> Refine -> Compose -> Publish` vision. The current direction is integration-first: apps own their native tables and workflows, code integrations pass typed IDs and payloads, and `epicenter://` links refer to app records.

One sentence:

```txt
Epicenter should expose focused apps that integrate through explicit app-to-app contracts before extracting universal cross-app primitives.
```

## Motivation

### Current State

Whispering currently owns both capture and refine concepts.

```txt
apps/whispering
  recordings
  transcription providers
  transformation definitions
  transformation steps
  transformation runs
  clipboard transform window
  post-transcription output settings
```

The workspace schema shows recordings and transformations in the same app:

```typescript
const recordings = defineTable(...);
const transformations = defineTable(...);
const transformationSteps = defineTable(...);
const transformationRuns = defineTable(...);
const transformationStepRuns = defineTable(...);
```

Tab Manager already acts like a capture app for browser material.

```txt
apps/tab-manager
  live browser tabs
  saved tabs
  bookmarks
  AI conversations
```

Fuji and Honeycrisp are both rich-text apps, but their product jobs differ.

```txt
apps/fuji
  local-first personal CMS
  entries
  per-entry rich-text content docs

apps/honeycrisp
  local-first notes
  folders
  notes
  per-note rich-text body docs
```

This creates problems:

1. **Transformation is trapped inside Whispering**: the text-refinement system exists, but it is named and stored as a Whispering feature.
2. **Cross-app composition is undefined**: a transcript, bookmark, note, polished excerpt, and Fuji entry should be able to move through the system without one giant shared table.
3. **Generic references are tempting too early**: a universal `SourceRef` graph sounds clean, but it could turn every app into a database browser before the product workflows are clear.
4. **Publishing can sprawl into connector apps**: Substack, Medium, Markdown, social posting, CMS sync, and email share a publication lifecycle. Splitting them too early would duplicate accounts, previews, status, retries, and URLs.

### Desired State

Each app keeps a clear product identity.

```txt
Capture
  Whispering       speech, audio, transcripts
  Tab Manager      tabs, bookmarks, browser context
  Future clippers  web excerpts, selections, imported files

Refine
  Polish           cleanup, rewrite, extract, scripted text recipes

Compose
  Honeycrisp       notes, thinking, loose drafting
  Fuji             artifacts, CMS entries, finished writing
  Open City        composed public spaces, collections, or worlds
  Future builders  briefs, scripts, reports, collections

Publish
  The Ark          publications, destinations, accounts, URLs, retries
```

The apps should integrate through tailored contracts first.

```txt
Whispering -> Polish
  clean this transcript with this recipe

Tab Manager -> Polish
  summarize these tabs with this recipe

Polish -> Fuji
  create an entry from this refine run

Polish -> Honeycrisp
  save this refined text into a note

Fuji -> The Ark
  publish this entry to this destination

Honeycrisp -> The Ark
  publish this note when promoted to a publishable shape
```

Shared schemas should be extracted only when repeated integrations prove the same shape.

## Architecture Prototype

This diagram is a working model, not a final package layout.

```txt
+======================================================================================+
| EPICENTER CREATIVE OS                                                                |
|                                                                                      |
| Rule: apps own workflows. Integrations pass IDs and small payloads.                  |
| Rule: epicenter:// links refer to records in notes, docs, and logs.                  |
| Rule: do not start with one universal cross-app graph.                               |
+======================================================================================+


+======================================================================================+
| CAPTURE                                                                              |
| Raw material enters Epicenter.                                                       |
+======================================================================================+

  +-------------------------------+        +-------------------------------+
  | WHISPERING                    |        | TAB MANAGER                   |
  | speech capture app            |        | browser capture app           |
  |                               |        |                               |
  | Owns native tables:           |        | Owns native tables:           |
  | - recordings                  |        | - savedTabs                   |
  | - transcript fields           |        | - bookmarks                   |
  | - audio blobs                 |        | - conversations               |
  | - transcription settings      |        | - chatMessages                |
  |                               |        |                               |
  | Should not own long-term:     |        | Should not own long-term:     |
  | - general refine recipes      |        | - article artifacts           |
  | - general refine run history  |        | - publication status          |
  |                               |        |                               |
  | Integrates with:              |        | Integrates with:              |
  | - Polish                      |        | - Polish                      |
  | - Honeycrisp                  |        | - Honeycrisp                  |
  | - Fuji                        |        | - Fuji                        |
  +---------------+---------------+        +---------------+---------------+
                  |                                        |
                  | typed integration                      | typed integration
                  v                                        v

+======================================================================================+
| REFINE                                                                               |
| Small pieces become usable.                                                          |
+======================================================================================+

  +----------------------------------------------------------------------------------+
  | POLISH                                                                           |
  | refine app                                                                       |
  |                                                                                  |
  | Owns:                                                                            |
  | - recipes                                                                        |
  | - recipe steps                                                                   |
  | - refine runs                                                                    |
  | - step runs                                                                      |
  | - before and after history                                                       |
  |                                                                                  |
  | Recipe types:                                                                    |
  | - prompt cleanup                                                                 |
  | - rewrite                                                                        |
  | - extract                                                                        |
  | - find_replace                                                                   |
  | - script                                                                         |
  |                                                                                  |
  | Integrations in:                                                                 |
  | - Whispering can call Polish for transcript cleanup                              |
  | - Tab Manager can call Polish for tab summaries or extractions                   |
  | - Honeycrisp can call Polish for note cleanup                                    |
  | - Fuji can call Polish for paragraph or section rewrites                         |
  |                                                                                  |
  | Integrations out:                                                                |
  | - create Honeycrisp note from refine output                                      |
  | - create Fuji entry from refine output                                           |
  | - return refined text to the calling app                                         |
  +--------------------------------------+-------------------------------------------+
                                         |
                                         | refined text, extracted pieces, run IDs
                                         v

+======================================================================================+
| COMPOSE                                                                              |
| Pieces become artifacts, notes, drafts, entries, collections, or worlds.             |
+======================================================================================+

  +-------------------------------+        +-------------------------------+
  | HONEYCRISP                    |        | FUJI                          |
  | thinking and notes app        |        | artifact and CMS app          |
  |                               |        |                               |
  | Owns native tables:           |        | Owns native tables:           |
  | - folders                     |        | - entries                     |
  | - notes                       |        | - entry metadata              |
  | - note body docs              |        | - entry content docs          |
  |                               |        |                               |
  | Product role:                 |        | Product role:                 |
  | - notes                       |        | - finished artifacts          |
  | - loose drafting              |        | - essays                      |
  | - thinking space              |        | - CMS pages                   |
  | - synthesis before structure  |        | - publishable entries         |
  |                               |        |                               |
  | Integrates with:              |        | Integrates with:              |
  | - Whispering imports          |        | - Whispering imports          |
  | - Tab Manager imports         |        | - Tab Manager imports         |
  | - Polish outputs              |        | - Polish outputs              |
  | - The Ark when publishable    |        | - The Ark for publishing      |
  +---------------+---------------+        +---------------+---------------+
                  |                                        |
                  | publishable adapter                    | publishable adapter
                  v                                        v

  +-------------------------------+
  | OPEN CITY                     |
  | compose app                   |
  |                               |
  | Possible product role:        |
  | - public spaces               |
  | - collections                 |
  | - worlds                      |
  | - map-like or civic artifacts |
  |                               |
  | Same rule:                    |
  | - owns native workflow        |
  | - integrates explicitly       |
  | - exports publishable shape   |
  +---------------+---------------+
                  |
                  v

+======================================================================================+
| PUBLISH                                                                              |
| Finished things go into the world.                                                   |
+======================================================================================+

  +----------------------------------------------------------------------------------+
  | THE ARK                                                                          |
  | publication manager                                                              |
  |                                                                                  |
  | Owns:                                                                            |
  | - destinations                                                                   |
  | - destination accounts                                                           |
  | - publications                                                                   |
  | - publish attempts                                                               |
  | - draft, live, scheduled, and failed status                                      |
  | - external URLs                                                                  |
  |                                                                                  |
  | Connectors:                                                                      |
  | - Markdown export                                                                |
  | - Substack                                                                       |
  | - Medium                                                                         |
  | - CMS sync                                                                       |
  | - email                                                                          |
  | - social                                                                         |
  |                                                                                  |
  | Imports from compose apps through tailored adapters first:                       |
  | - Fuji entry -> PublishableArtifact                                              |
  | - Honeycrisp note -> PublishableArtifact                                         |
  | - Open City artifact -> PublishableArtifact                                      |
  +----------------------------------------------------------------------------------+
```

## Integration Model

### Data Integrations

Code integrations should pass IDs and the minimum payload needed for the target workflow.

```typescript
type AppId =
	| 'epicenter.whispering'
	| 'epicenter.tab-manager'
	| 'epicenter.polish'
	| 'epicenter.honeycrisp'
	| 'epicenter.fuji'
	| 'epicenter.open-city'
	| 'epicenter.ark';
```

Examples:

```typescript
await polish.refineTranscript({
	recordingId,
	transcript,
	recipeId,
});

await polish.refineTabs({
	bookmarkIds,
	recipeId,
});

await fuji.createEntryFromRefineRun({
	refineRunId,
	title,
});

await honeycrisp.createNoteFromWhisperingRecording({
	recordingId,
	title,
});

await ark.createPublicationFromFujiEntry({
	entryId,
	destinationId,
});
```

This means relationships can be one-to-one, one-to-many, or many-to-many when a workflow needs it. The relationship table should live in the app that owns the workflow.

```txt
Whispering owns:
  recording.postTranscriptionRecipeId

Polish owns:
  refineRun.inputAppId
  refineRun.inputKind
  refineRun.inputId
  refineRun.outputText

Fuji owns:
  entry.importedFromRefineRunId
  entry.importedFromRecordingId

The Ark owns:
  publication.sourceAppId
  publication.sourceKind
  publication.sourceId
  publication.destinationId
```

The rule:

```txt
Integration state belongs to the app that owns the workflow.
```

### Entity Links And App Schemes

Entity links are for referring to records and embedding pointers in text. They are not the primary data integration mechanism, and they are separate from app-owned OS callback schemes.

Use one Epicenter entity-link scheme with the app or workspace ID as the URI authority:

```txt
epicenter://epicenter.whispering/recordings/rec_123
epicenter://epicenter.whispering/recordings/rec_123/transcript
epicenter://epicenter.tab-manager/bookmarks/bmk_456
epicenter://epicenter.polish/recipes/recipe_789
epicenter://epicenter.polish/runs/run_456
epicenter://epicenter.honeycrisp/notes/note_abc
epicenter://epicenter.fuji/entries/entry_def
epicenter://epicenter.ark/publications/pub_xyz
```

In Markdown:

```markdown
Cleaned transcript from [Whispering recording](epicenter://epicenter.whispering/recordings/rec_123/transcript).
```

Why this shape:

```txt
epicenter://
  one shared entity-reference scheme for Epicenter records and Markdown links

epicenter.whispering
  app/workspace authority and route owner

/recordings/rec_123/transcript
  app-specific route
```

Before implementation, verify Tauri deep-link behavior on macOS, Windows, and Linux. Tauri and the OS register handlers by scheme, not by URI authority, so `epicenter.whispering` in `epicenter://epicenter.whispering/...` does not make the OS route directly to Whispering. Treat `epicenter://` as a shared entity-reference grammar unless Epicenter ships a suite-level launcher/router that owns the `epicenter` scheme and dispatches internally.

If a desktop app needs a private OAuth callback or app-owned launch scheme, use that app's reverse-domain scheme, for example `so.epicenter.whispering://auth/callback`, instead of making marketing domains or the shared `epicenter://` entity-link scheme own OAuth callback identity.

## Integration Spectrum

There are several ways the apps could compose. The current recommendation is Direction 2.

| Direction | Shape | Pros | Cons | When to choose |
| --- | --- | --- | --- | --- |
| 1. Manual only | Each app imports another app's actions directly and passes IDs or payloads. | Fastest to build. Very clear product ownership. No abstract model before workflows exist. | Can duplicate handoff shapes. Harder to inspect all cross-app relationships. Can become tangled if imports are not disciplined. | Good for the first one or two integrations, especially Whispering to Polish. |
| 2. Typed integrations plus entity links | Apps expose explicit integration functions. Data flows through IDs and small payloads. `epicenter://` links refer to records. | Keeps product workflows clear. Links are human-readable. IDs are practical for code. Shared schemas emerge from repeated contracts. | Requires careful naming and route conventions. Relationship state is distributed across app tables. Needs an integration registry later if many apps participate. | Best current default. |
| 3. Shared handoff tables | Add shared tables such as `RefineRun`, `Import`, `Export`, or `PublicationSource` that store app ID, kind, and entity ID. | Easier to query cross-app history. Useful when multiple apps need the same timeline or audit trail. | Can become a half-built universal graph. Requires migration and ownership rules. Risks making simple integrations heavy. | Choose after the same handoff appears in at least three places. |
| 4. Universal source graph | Every app entity can point to every other entity through a generic reference table. | Powerful provenance. Strong search and traceability. Could support backlinks, history, and graph UI. | High abstraction cost. Easy to overbuild. Users may feel like they are managing links instead of doing work. Hard ownership questions. | Defer until real product workflows demand graph-level provenance. |
| 5. Event bus | Apps emit events such as `recording.transcribed`, `recipe.completed`, `entry.created`, and other apps subscribe. | Decouples producers and consumers. Good for automation and background workflows. | Debugging is harder. Ordering and retry semantics matter. Easy to hide product behavior in invisible automation. | Good later for automations, not the first app-to-app workflow. |

Recommendation:

```txt
Start with Direction 2.
Use Direction 1 for the first internal spike if needed.
Promote repeated shapes into Direction 3 only after the repetition is obvious.
Avoid Direction 4 until the product needs backlinks, provenance views, or global search across origins.
Use Direction 5 for automation after the user-facing workflows are understandable.
```

## Stage Map

### Capture

Capture apps create durable native records. They should not become full workflow managers.

```txt
Capture apps
  Whispering
    source: microphone / audio file
    native records: recordings, transcripts, audio blobs
    likely integrations: Polish, Honeycrisp, Fuji

  Tab Manager
    source: browser tabs / bookmarks / pages
    native records: savedTabs, bookmarks, conversations
    likely integrations: Polish, Honeycrisp, Fuji

  Future Clipper
    source: selected browser text / page region
    native records: excerpts, captures, page snapshots
    likely integrations: Polish, Honeycrisp, Fuji
```

Honeycrisp should not be counted as a Capture app in the main map. It can receive captured material, but its product job is composition through notes and thinking.

### Refine

Polish should be the refine app. Recipe types should not become separate top-level apps yet.

```txt
Polish
  recipe types:
    prompt
    script
    find_replace
    extract

  integrations in:
    Whispering transcript
    Tab Manager browser context
    Honeycrisp note selection
    Fuji entry selection

  integrations out:
    refined text
    refine run ID
    create note
    create entry
```

The user model stays simple:

```txt
Open Polish when you want to refine text.
Choose a recipe when you care how it runs.
```

### Compose

Compose apps turn material into larger things.

```txt
Compose apps
  Honeycrisp
    notes
    thinking
    loose drafting
    synthesis before structure

  Fuji
    articles
    essays
    CMS entries
    finished publishable artifacts

  Open City
    public spaces
    collections
    worlds
    map-like or civic artifacts

  Future builders
    briefs
    scripts
    reports
    collections
```

Fuji and Honeycrisp should not be merged just because both use rich text. Their workflows differ.

```txt
Honeycrisp
  many loose notes
  low ceremony
  thinking space

Fuji
  fewer structured entries
  artifact assembly
  CMS-style metadata
  publish readiness
```

### Publish

The Ark should be the publication manager. Destinations are connectors, not apps.

```txt
The Ark
  destinations:
    Markdown
    Substack
    Medium
    Ghost
    Webflow
    email
    social

  owns:
    accounts
    previews
    draft/live state
    scheduled state
    external URLs
    retries
    updates
```

The Ark should consume tailored adapters from compose apps first.

```txt
Fuji entry -> PublishableArtifact
Honeycrisp note -> PublishableArtifact
Open City artifact -> PublishableArtifact
```

`PublishableArtifact` is allowed to be lower fidelity than the source app. Publishing needs enough to preview, format, send, retry, and record where the artifact went. It should not import every native app shape.

## Proposed Shapes

These names are directional. The implementation should verify existing workspace conventions before adding packages or tables.

### App Deep Link

```typescript
type EpicenterAppId =
	| 'epicenter.whispering'
	| 'epicenter.tab-manager'
	| 'epicenter.polish'
	| 'epicenter.honeycrisp'
	| 'epicenter.fuji'
	| 'epicenter.open-city'
	| 'epicenter.ark';

type EpicenterDeepLink = `epicenter://${EpicenterAppId}/${string}`;
```

### Integration Target

This is not a universal graph. It is a small address shape for integration records when an app needs to remember where something came from.

```typescript
type IntegrationTarget = {
	appId: EpicenterAppId;
	kind: string;
	id: string;
	field?: string;
};
```

Example:

```typescript
const input = {
	appId: 'epicenter.whispering',
	kind: 'recording',
	id: recordingId,
	field: 'transcript',
} satisfies IntegrationTarget;
```

### Refine Recipe

```typescript
type RefineRecipe = {
	id: string;
	title: string;
	description: string;
	type: 'prompt' | 'script' | 'find_replace' | 'extract';
	createdAt: string;
	updatedAt: string;
};
```

### Refine Run

```typescript
type RefineRun = {
	id: string;
	recipeId: string;
	input?: IntegrationTarget;
	inputText: string;
	outputText?: string;
	status: 'running' | 'completed' | 'failed';
	startedAt: string;
	completedAt?: string;
};
```

### Publishable Artifact

```typescript
type PublishableArtifact = {
	title: string;
	body: string;
	summary?: string;
	assets: Array<{
		id: string;
		mimeType: string;
		source?: IntegrationTarget;
	}>;
	metadata: Record<string, unknown>;
	source: IntegrationTarget;
};
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Stage vocabulary | 2 coherence | Use `Capture -> Refine -> Compose -> Publish` | `Transform` is too broad and `Deliver` is too small for the creative OS vision. |
| Honeycrisp stage | 2 coherence | Treat Honeycrisp as Compose, not Capture | Honeycrisp can receive captured material, but its product job is notes, thinking, and loose drafting. |
| Refine app count | 3 taste | Start with one Polish app and multiple recipe types | Multiple top-level refine apps would fatigue users before the workflows diverge. |
| Whispering migration | 2 coherence | Extract transformations into a refine core, keep Whispering as a capture-heavy app | Whispering should embed transcript cleanup, but not own the general refine domain. |
| Integration strategy | 2 coherence | Start with typed integrations plus entity links | App-owned workflows stay clear, while links give users and Markdown a common way to refer to records. |
| Generic reference graph | Deferred | Do not build a universal graph yet | The first product workflows need tailored integrations more than global provenance. |
| Publish integrations | 2 coherence | Build The Ark as one publish app with connector destinations | Destination connectors share account, preview, status, retry, and external URL lifecycle. |
| Publish interface | 2 coherence | Map compose-native data into a lower-fidelity `PublishableArtifact` | Publish needs a stable contract without importing every app's internal shape. |
| Social boundary | Deferred | Keep social as a connector family inside The Ark for now | A social-only app can split later if scheduling, variants, analytics, and engagement become their own workflow. |

## Implementation Plan

### Phase 1: Inventory Real Integration Surfaces

- [ ] **1.1** Inventory Whispering transformation tables, state modules, RPC methods, routes, settings, and UI components.
- [ ] **1.2** Inventory Whispering recording IDs and transcript access patterns.
- [ ] **1.3** Inventory Tab Manager saved tab, bookmark, and conversation IDs.
- [ ] **1.4** Inventory Honeycrisp note IDs and body document GUIDs.
- [ ] **1.5** Inventory Fuji entry IDs and content document GUIDs.
- [ ] **1.6** Document current routes that could map to future `epicenter://` entity links.

### Phase 2: Extract Refine Runtime Without Product Split

- [ ] **2.1** Rename the conceptual layer from transformation to refine in new code only.
- [ ] **2.2** Move recipe and run execution behind an app-neutral refine service.
- [ ] **2.3** Keep Whispering routes working by calling the refine service.
- [ ] **2.4** Keep old Whispering table names until data migration is deliberately scheduled.
- [ ] **2.5** Store enough input identity on refine runs to identify the source app and source row when available.

### Phase 3: Add The First Tailored Integration

- [ ] **3.1** Implement `Whispering -> Polish` as transcript cleanup.
- [ ] **3.2** The integration should pass `recordingId`, `transcript`, and `recipeId`.
- [ ] **3.3** Polish should store a refine run with input identity for the recording.
- [ ] **3.4** Whispering should keep its current user flow working.
- [ ] **3.5** Do not add a generic import/export registry in this phase.

### Phase 4: Define Entity Link Convention

- [ ] **4.1** Define the canonical `epicenter://{appId}/{appRoute}` grammar.
- [ ] **4.2** Add parser and formatter helpers.
- [ ] **4.3** Map existing app entities to link routes.
- [ ] **4.4** Verify Tauri deep-link setup across target platforms before registering schemes.
- [ ] **4.5** Use links in UI, Markdown, logs, and run history, not as the main data integration API.

### Phase 5: Add Compose Integrations

- [ ] **5.1** Add `Polish -> Honeycrisp` for creating a note from refine output.
- [ ] **5.2** Add `Polish -> Fuji` for creating an entry from refine output.
- [ ] **5.3** Add `Whispering -> Honeycrisp` for saving a transcript as a note if the workflow proves useful.
- [ ] **5.4** Add `Tab Manager -> Honeycrisp` or `Tab Manager -> Fuji` only after the first browser-context workflow is clear.

### Phase 6: Define Compose-to-Publish Contract

- [ ] **6.1** Define `PublishableArtifact` as the lower-fidelity handoff shape.
- [ ] **6.2** Add a Fuji entry adapter.
- [ ] **6.3** Add a Honeycrisp note adapter only for notes promoted to publishable output.
- [ ] **6.4** Keep app-native metadata in the source app, not in The Ark.
- [ ] **6.5** Let The Ark store publication state against source app ID, source kind, and source ID.

### Phase 7: Build The Ark As Publication Manager

- [ ] **7.1** Model destinations, destination accounts, publications, attempts, and external URLs.
- [ ] **7.2** Start with Markdown export or one low-risk destination before network publishing.
- [ ] **7.3** Add destination connectors behind one lifecycle.
- [ ] **7.4** Decide later whether social needs a sibling app.

## Open Questions

1. **Should Polish be a separate app immediately or a shared refine runtime used by Whispering first?**
   - Recommendation: extract the shared runtime first. Keep the first UI embedded in Whispering until the selected-text workflow is ready.

2. **Should app integrations be direct imports, RPC actions, or workspace actions?**
   - Recommendation: start with the repo's existing action patterns. Decide package boundaries after inventorying current app exports.

3. **Should `IntegrationTarget` become a shared type immediately?**
   - Recommendation: yes, if at least two integrations need to remember app ID, kind, and row ID. No, if the first integration can stay local to Polish.

4. **Should entity links use `epicenter://epicenter.whispering/...` or app-specific reverse-domain schemes like `so.epicenter.whispering://...`?**
   - Recommendation: keep `epicenter://{appOrWorkspace}/{route}` for Epicenter entity references only. Use app-specific reverse-domain schemes for app-owned OS callback surfaces such as desktop OAuth, for example `so.epicenter.whispering://auth/callback`. `so.epicenter.whispering` is a valid URI scheme; `epicenter.whispering` as an `epicenter://` authority is not an OS routing boundary.

5. **What is the first publish destination?**
   - Recommendation: Markdown export first. It proves publication lifecycle without account auth or API fragility.

6. **When does a generic graph become worth it?**
   - Recommendation: only after users need backlinks, provenance views, global search by origin, or multi-hop lineage across several apps.

## Agent Prompt

Use this prompt to continue the architecture work with another coding agent:

```txt
We are designing Epicenter as a local-first creative operating system.

Current thesis:

  Capture -> Refine -> Compose -> Publish

Product map:

  Capture:
    Whispering       speech, audio, transcripts
    Tab Manager      tabs, bookmarks, browser context
    Future clippers  web excerpts, selections, imported files

  Refine:
    Polish           cleanup, rewrite, extract, scripted text recipes

  Compose:
    Honeycrisp       notes, thinking, loose drafting
    Fuji             artifacts, CMS entries, finished writing
    Open City        public spaces, collections, worlds
    Future builders  briefs, scripts, reports, collections

  Publish:
    The Ark          publications, destinations, accounts, URLs, retries

Important direction:

  Do not start with a universal SourceRef graph.
  Start with explicit app-to-app integrations.
  Code integrations pass typed IDs and small payloads.
  epicenter:// links are for referring, Markdown, logs, and history.
  Shared schemas should be extracted after repeated integrations prove the shape.

Relevant files:

  docs/articles/20260525T120000-epicenter-local-first-creative-operating-system.md
  specs/20260525T130000-creative-os-composition-map.md
  apps/whispering/src/lib/workspace/definition.ts
  apps/whispering/src/lib/query/actions.ts
  apps/whispering/src/lib/query/transformer.ts
  apps/whispering/src/routes/transform-clipboard/+page.svelte
  apps/tab-manager/src/lib/workspace/definition.ts
  apps/fuji/src/lib/workspace.ts
  apps/honeycrisp/workspace.ts

Task:

  Turn the composition-map spec into a cohesive integration architecture proposal.

  Explore multiple directions for how integrations and composition could work:

    1. Manual direct integrations only.
    2. Typed app integrations plus epicenter:// entity links.
    3. Shared handoff tables for repeated integration shapes.
    4. Universal source/provenance graph.
    5. Event bus or automation-driven composition.

  For each direction, be thorough about:

    - How the code would work.
    - What tables or schemas would exist.
    - Where relationship state would live.
    - How one-to-one, one-to-many, and many-to-many relationships would be represented.
    - How entity links would be formatted.
    - How the user would experience the flow.
    - What app owns each workflow.
    - What gets simpler.
    - What gets harder.
    - What should be refused for now.
    - What migration path keeps Whispering working.

  Ground the proposal in the current repo. Start by reading the files listed above.

  Pay special attention to Whispering:

    - Transformations currently live in Whispering.
    - The likely target is a shared Refine runtime and eventually Polish as the refine app.
    - Do not rename tables or migrate data in the first implementation step unless the inventory proves it is necessary.

  Also verify external behavior where relevant:

    - Tauri deep-link support and platform constraints.
    - SvelteKit routing implications.
    - Yjs/local-first storage implications.
    - Any relevant patterns from Hono, WXT, Drizzle, Better Auth, Cloudflare, Yjs, or Tauri docs and repos.

  Output:

    1. A concise thesis.
    2. A large ASCII architecture diagram.
    3. A comparison table of the integration directions.
    4. A recommended direction with clear refusal points.
    5. The smallest next implementation spec for Refine extraction.
    6. Open questions that genuinely affect implementation.

  Tone:

    Be direct and critical.
    Prefer clean ownership over compatibility clutter.
    Avoid inventing abstractions before the app workflows prove them.
```

## Success Criteria

- [ ] The current app map is grounded in real repo paths.
- [ ] The spec treats Honeycrisp as Compose, not Capture.
- [ ] The spec recommends one Polish app with multiple recipe types instead of many top-level refine apps.
- [ ] The spec defines app integrations as typed ID and payload handoffs before generic graph infrastructure.
- [ ] The spec defines `epicenter://` links as opening and reference links, not primary data integration.
- [ ] The spec defines The Ark as a publication manager with connector destinations.
- [ ] The spec gives another coding agent a self-contained prompt for deeper architecture exploration.

## References

- `docs/articles/20260525T120000-epicenter-local-first-creative-operating-system.md` - Vision article for the four-stage model.
- `apps/whispering/src/lib/workspace/definition.ts` - Current recordings and transformation tables.
- `apps/whispering/src/lib/query/actions.ts` - Current recording, transcription, transformation, and output workflow.
- `apps/whispering/src/lib/query/transformer.ts` - Current transformation runner.
- `apps/whispering/src/routes/transform-clipboard/+page.svelte` - Current standalone-ish transformation-on-clipboard surface.
- `apps/tab-manager/src/lib/workspace/definition.ts` - Current saved tab, bookmark, and browser-context data model.
- `apps/fuji/src/lib/workspace.ts` - Current CMS entry and rich-text content model.
- `apps/honeycrisp/workspace.ts` - Current notes, folders, and note body document model.
