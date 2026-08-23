# Source Installed App Runtime Vision

**Date**: 2026-05-12
**Status**: Vision split for implementation
**Author**: AI-assisted

## Overview

Epicenter should let users install readable source apps, review or edit their UI, and run those apps inside the Epicenter desktop shell. The first runtime should be simple: a trusted source-installed SPA runs in a Tauri webview and calls a typed Epicenter bridge backed by Rust commands.

Actions, scripts, peer invocation, Bun, and WASM still matter, but they should come after the SPA bridge proves the product shape. Phase 1 should not require `actions.ts`, a handler context object, or a Bun action runtime.

## One Sentence

```txt
Epicenter apps are source-installed SPAs that run in a trusted Tauri webview and call typed Epicenter commands.
```

## Execution Note

Current status: this document is still live as a product vision, but it is not directly executable as one implementation wave. The current code already settled one adjacent foundation that this vision must respect: workspace actions are flat `defineActions({...})` registries keyed by snake_case strings. Generic peer dispatch is no longer a collaboration surface; any later script, peer, or action lane needs its own current design.

Implemented now: this pass creates a smaller follow-up spec for the next concrete slice, `specs/20260514T013918-source-app-manifest-bridge-slice.md`. That slice defines the source app manifest and typed invoke bridge contract only. It does not load apps, add a marketplace, introduce a Bun action runtime, or rewrite existing apps.

Out of scope now: no broad public packaging work across all apps, no Tauri webview loader, no Rust command implementation, no action runtime, no handler context object, no peer or worker invocation, and no changes to `defineActions` behavior.

## Execution Checklist

- [x] Read the full vision and confirmed it is not directly executable as one implementation wave.
- [x] Inspected current actions, RPC, package layout, and Whispering Tauri invoke usage.
- [x] Preserved current `defineActions` snake_case behavior as source of truth.
- [x] Created the next concrete implementation slice in `specs/20260514T013918-source-app-manifest-bridge-slice.md`.
- [x] Deferred app loading, Rust commands, permission UI, Bun actions, handler contexts, peer invocation, and marketplace work.

## Current State

Epicenter already has the pieces for this direction:

```txt
apps/whispering
  Svelte UI
  Tauri invoke calls
  Rust native commands
  CPAL audio recording
  transcription providers

packages/workspace
  local-first workspace data
  Yjs documents
  action discovery
  daemon action dispatch
  sync RPC

packages/cli
  loads epicenter.config.ts
  invokes registered actions through /run
```

Whispering is the clearest prototype:

```txt
Svelte UI
  -> Tauri invoke
  -> Rust command
  -> CPAL recorder
  -> audio asset
  -> transcription
```

That model is already understandable. The app UI lives in the webview. Native effects live in Rust. The bridge between them is Tauri IPC.

## Desired State

Installed apps should start as source bundles:

```txt
app/
  app.json
  ui/
```

Optional future additions:

```txt
app/
  actions.ts  later, when reusable invocation is needed
  wasm/       later, for sandboxed computation
```

The installed SPA can call Epicenter through a typed bridge:

```ts
import { epicenter } from "@epicenter/app";

const recording = await epicenter.audio.record({
	deviceId,
});

const transcript = await epicenter.transcription.run({
	audioAssetId: recording.assetId,
});

await epicenter.documents.append({
	documentId,
	text: transcript.text,
});
```

Under the hood, the bridge can be a thin wrapper around Tauri `invoke`:

```ts
import { invoke } from "@tauri-apps/api/core";

export const epicenter = {
	audio: {
		record(input: AudioRecordInput) {
			return invoke<AudioRecordResult>("audio_record", input);
		},
	},
	documents: {
		append(input: DocumentAppendInput) {
			return invoke<DocumentAppendResult>("documents_append", input);
		},
	},
};
```

The app can also call `invoke` directly where that is clearer:

```ts
await invoke("window_set_title", { title: "Whispering" });
```

The best-practice default is the typed bridge. Direct `invoke` is acceptable for one-off local UI behavior, but the bridge is better for commands that apps will call repeatedly.

## Requirements

### Product Requirements

| Requirement | Meaning |
| --- | --- |
| Source install | Users receive readable app source, not an opaque binary or package only. |
| SPA first | The first installable app shape is a single page app copied into Epicenter. |
| Trusted desktop shell | The SPA runs inside an Epicenter-owned Tauri webview. |
| Typed command bridge | Apps call Epicenter through typed TypeScript functions backed by Tauri commands. |
| Native effects in Rust | Audio, windows, dialogs, tray, filesystem grants, and native lifecycle stay in Rust/Tauri. |
| User review | Installing or enabling an app is an explicit user decision. |
| Scripts separate | Scripts are user-authored or agent-authored workflows that call available commands or future actions. |
| Actions later | Reusable actions are extracted when scripts, agents, peers, or cloud execution need them. |
| Personal apps first | The first trust model is local and personal, not a public marketplace. |

### Technical Requirements

| Requirement | Meaning |
| --- | --- |
| App manifest | `app.json` names the app, entry point, and requested command families. |
| Tauri bridge | The SPA can call Tauri commands through `@tauri-apps/api/core` or a typed wrapper. |
| Typed client package | A small TypeScript package exposes `epicenter.audio.record`, `epicenter.documents.append`, and similar methods. |
| Rust command ownership | Rust owns command implementation, native permissions, and OS integration. |
| Serializable IPC | Inputs and outputs should stay serializable across Tauri IPC. |
| Shared schemas | Command inputs and outputs should be typed from the owning command contract where practical. |
| No Bun required | Phase 1 does not need Bun to load app actions. |
| No handler context required | Phase 1 does not pass a special context object into app code. |

## App Bundle Shape

### Manifest

```json
{
	"id": "whispering",
	"name": "Whispering",
	"entry": "./ui/index.html",
	"permissions": [
		"workspace:read",
		"documents:write",
		"assets:write",
		"audio:record",
		"window:manage"
	]
}
```

### UI Source

```txt
ui/
  index.html
  src/
    App.svelte
    lib/
      recorder.ts
      documents.ts
```

The SPA can import the bridge from a stable Epicenter package:

```ts
import { epicenter } from "@epicenter/app";
```

or, for command-specific cases:

```ts
import { invoke } from "@tauri-apps/api/core";
```

## Bridge Design

The bridge should be boring. It should name the product operation and hide command string details.

```ts
export function createEpicenterBridge({ invoke }: EpicenterBridgeOptions) {
	return {
		audio: {
			record(input: AudioRecordInput) {
				return invoke<AudioRecordResult>("audio_record", input);
			},
		},
		transcription: {
			run(input: TranscriptionRunInput) {
				return invoke<TranscriptionRunResult>("transcription_run", input);
			},
		},
		documents: {
			append(input: DocumentAppendInput) {
				return invoke<DocumentAppendResult>("documents_append", input);
			},
		},
		window: {
			resize(input: WindowResizeInput) {
				return invoke<void>("window_resize", input);
			},
		},
	};
}
```

The public app code stays simple:

```ts
const recording = await epicenter.audio.record({ deviceId });
const transcript = await epicenter.transcription.run({
	audioAssetId: recording.assetId,
});
await epicenter.documents.append({
	documentId,
	text: transcript.text,
});
```

The bridge gives us the good parts of direct `invoke` without spreading raw command names through every installed app.

## Best-Practice Rules

```txt
Use the typed bridge for repeated product operations.
Use direct invoke for small, local, UI-native behavior when a wrapper adds no clarity.
Keep command inputs and outputs serializable.
Keep Rust command names stable and boring.
Keep native effects in Rust/Tauri.
Do not introduce Bun, handler context objects, or actions until a caller outside the SPA needs the operation.
```

Good direct `invoke` candidates:

```txt
set current window title
resize this window
open a native dialog
toggle always-on-top
subscribe to a local native event
```

Good bridge candidates:

```txt
record audio
write an asset
append to a document
run transcription
read workspace state
export a project
```

Good future action candidates:

```txt
operations a script should call
operations an agent should call
operations another device should call
operations that should run in a daemon, worker, or synced peer
```

## Future Actions

Actions are still useful, but they are no longer the first runtime primitive.

The extraction rule is:

```txt
Start with SPA plus typed bridge.
When an operation needs to be called outside the SPA, promote it into an action.
```

Future action shape:

```ts
export const actions = {
	recordAndAppend: defineMutation({
		input: RecordAndAppendInput,
		handler: async (input) => {
			const recording = await epicenter.audio.record({
				deviceId: input.deviceId,
			});

			const transcript = await epicenter.transcription.run({
				audioAssetId: recording.assetId,
			});

			return epicenter.documents.append({
				documentId: input.documentId,
				text: transcript.text,
			});
		},
	}),
};
```

If this action later needs to run outside the SPA, the runtime can inject or import an equivalent bridge for that environment. The action should depend on the same product operations, not raw platform details.

## Runtime Lanes

```txt
Lane 1: Source-installed SPA
  Current default.
  Svelte or other frontend source copied into Epicenter.
  Runs in Tauri webview.
  Calls typed bridge or direct invoke.

Lane 2: User or agent scripts
  Dynamic workflows written after install.
  Can call the typed bridge locally.
  Can call future actions when action discovery exists.

Lane 3: Reusable actions
  Extracted when behavior must be callable by scripts, agents, CLI, peers, or workers.
  Uses defineQuery / defineMutation if that remains the best local primitive.

Lane 4: WASM extensions
  Later sandbox lane for parsers, transforms, importers, exporters, and policy checks.

Lane 5: Peer or worker invocation
  Later distributed lane.
  Uses serializable actions, not direct Tauri commands.
```

## Security Position

Readable source plus review is useful. It is not sandboxing.

The honest model for phase 1 is:

```txt
If the SPA runs in the trusted Epicenter webview, the user is trusting that source.
If the SPA calls a Tauri command, the Rust command owns the native effect.
If the SPA uses direct invoke, the command surface must still be reviewed.
```

That is acceptable for personal apps. A public marketplace would need stronger review, signing, provenance, update diffs, and permission UX.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| First runtime primitive | 2 coherence | Source-installed SPA | This matches the actual desktop product shape and Whispering precedent. |
| Native invocation | 2 coherence | Tauri commands | The SPA already runs in a Tauri webview, and Rust owns native effects. |
| App author API | 3 taste | Typed bridge over raw invoke by default | It keeps app code readable and command names centralized. |
| Direct invoke | 3 taste | Allowed for local UI behavior | Trusted source apps should not be forced through ceremony for tiny native calls. |
| Bun action runtime | Deferred | Not in phase 1 | It adds a second execution environment before the SPA bridge proves the model. |
| Handler context object | 2 coherence | Not needed in phase 1 | The SPA can import or receive a bridge directly. |
| Reusable actions | Deferred | Extract later | They become useful when behavior needs scripts, agents, peers, CLI, or workers. |
| WASM | Deferred | Later sandbox lane | WASM is good for computation, not the first desktop SPA bridge. |
| Marketplace | Deferred | Personal apps first | Marketplace trust needs signing, provenance, review, and stronger permission UX. |

## Radical Options Considered

### Option A: Start With Bun Actions

```txt
App ships actions.ts.
Bun loads action handlers.
SPA calls those actions.
Actions call native capabilities.
```

Why not:

```txt
It adds another runtime before we need one.
The first app already lives in a Tauri webview.
The SPA can call Rust directly today.
```

Verdict:

```txt
Do not start here.
Promote operations into actions only when non-SPA callers need them.
```

### Option B: Force Every Native Call Through A Wrapper

```txt
SPA cannot call invoke directly.
Every native behavior needs a typed bridge method first.
```

Why not:

```txt
Some UI-native calls are too small to justify a wrapper.
Trusted audited source does not need fake safety ceremony.
```

Verdict:

```txt
Prefer the bridge, but allow direct invoke where it is clearer.
```

### Option C: Raw Invoke Everywhere

```txt
SPA imports invoke and calls Rust command names directly everywhere.
```

Why not:

```txt
Command strings spread through app source.
Repeated operations lose a stable typed product name.
Future actions and scripts have less obvious operations to reuse.
```

Verdict:

```txt
Use raw invoke as an escape hatch.
Use the typed bridge for repeated product operations.
```

### Option D: App Backend Servers

```txt
Every installed app runs its own local backend server.
```

Why not:

```txt
Ports, lifecycle, auth, permissions, logs, crashes, and upgrades multiply per app.
The product becomes hard to explain.
```

Verdict:

```txt
Do not make backend servers the primitive.
The first primitive is a trusted SPA in the Epicenter webview.
```

## Phased Vision

### Phase 1: Trusted Source-Installed SPAs

- [ ] **1.1** Define an `app.json` manifest with id, name, entry, and permissions.
- [ ] **1.2** Define an install location for readable app source.
- [ ] **1.3** Load the installed SPA into an Epicenter Tauri webview.
- [ ] **1.4** Expose a minimal typed bridge package to installed SPAs.
- [ ] **1.5** Back the first bridge methods with Rust Tauri commands.
- [ ] **1.6** Allow direct `invoke` for small local UI behavior.
- [ ] **1.7** Show install review: files changed, manifest, requested permissions.
- [ ] **1.8** Prove the path with a Whispering-shaped source app.

### Phase 2: Bridge Coverage

- [ ] **2.1** Add `epicenter.documents`.
- [ ] **2.2** Add `epicenter.assets`.
- [ ] **2.3** Add `epicenter.window`.
- [ ] **2.4** Add `epicenter.audio` backed by Rust/Tauri for recording.
- [ ] **2.5** Add `epicenter.transcription`.
- [ ] **2.6** Decide which operations stay direct invoke only.

### Phase 3: Dynamic Scripts

- [ ] **3.1** Add a user-authored script entry point convention.
- [ ] **3.2** Let local scripts call the typed bridge where possible.
- [ ] **3.3** Keep scripts user-invoked by default.
- [ ] **3.4** Add an audit view for script source and granted permissions.

### Phase 4: Reusable Actions

- [ ] **4.1** Identify operations that need non-SPA callers.
- [ ] **4.2** Define the smallest action shape for those operations.
- [ ] **4.3** Keep action inputs and outputs serializable.
- [ ] **4.4** Reuse bridge-level product operations from actions.
- [ ] **4.5** Register actions for scripts, agents, CLI, peers, or workers.

### Phase 5: Peer And Worker Invocation

- [ ] **5.1** Advertise available actions through peer awareness.
- [ ] **5.2** Route non-local calls through sync RPC or worker RPC.
- [ ] **5.3** Represent files and streams as asset IDs, URLs, or path grants.
- [ ] **5.4** Keep transport details out of action definitions unless proven necessary.

### Phase 6: Marketplace Readiness

- [ ] **6.1** Add source provenance and signatures.
- [ ] **6.2** Add stronger permission UX.
- [ ] **6.3** Add install/update diffs.
- [ ] **6.4** Add app trust levels.
- [ ] **6.5** Add review automation that can summarize what an app can do.

## What This Refuses For Now

```txt
No Bun action runtime in phase 1.
No required actions.ts in phase 1.
No handler context object in phase 1.
No generic per-app backend servers as the primary primitive.
No silent background execution by default.
No marketplace trust story in phase 1.
No requirement that every app compile to WASM.
No requirement that every app be a separate OS application.
No requirement that every installed app include script source.
No default REST endpoint for every operation.
No transport matrix until reusable actions actually need one.
```

## Open Questions

1. Should installed app source live inside each workspace, inside a global Epicenter app directory, or both?
2. What is the package name for the typed SPA bridge: `@epicenter/app`, `@epicenter/bridge`, or something else?
3. Should the bridge be globally injected into the webview, imported as a package, or both?
4. Which commands should be wrapped immediately, and which should stay direct `invoke`?
5. How should TypeScript command input/output types be derived from Rust command contracts?
6. What permission review UI is enough for personal source apps?
7. What should happen when installed source changes while the app is running?
8. Should app updates preserve local edits, or require an explicit merge flow?
9. What is the smallest useful Whispering extraction that proves the model?
10. When should an operation graduate from bridge method to reusable action?

## Continuation Prompt

Use this prompt to continue the design:

```txt
We are designing Epicenter's source-installed app runtime. Read specs/20260512T234944-source-installed-app-runtime-vision.md first.

The current thesis is:

  Epicenter apps are source-installed SPAs that run in a trusted Tauri webview and call typed Epicenter commands.

Please continue the architecture conversation from that thesis. The simplified preferred shape is:

  - Phase 1 is SPA-first, not actions-first.
  - Installed app source is app.json plus ui/.
  - The SPA runs in an Epicenter-owned Tauri webview.
  - The SPA can call Tauri invoke directly.
  - Repeated product operations should use a typed bridge like epicenter.audio.record.
  - Rust/Tauri owns native effects.
  - Bun, actions.ts, handler context objects, peer invocation, worker invocation, and WASM are deferred.
  - Actions are introduced only when scripts, agents, CLI, peers, or workers need to call the same behavior outside the SPA.

Do not reintroduce a handler context object unless you can show why direct import or typed invoke fails. Do not make per-app backend servers the primitive. Do not require a Bun action runtime in phase 1.

Help refine:

  1. the app manifest,
  2. the typed bridge package,
  3. direct invoke versus bridge method rules,
  4. Rust command naming and typing,
  5. the install/review flow,
  6. the smallest Whispering-shaped prototype that proves the design.
```

## Bridge Best-Practices Prompt

Use this prompt to pressure-test implementation details:

```txt
We are designing the TypeScript bridge for trusted source-installed SPAs in Epicenter. Read specs/20260512T234944-source-installed-app-runtime-vision.md first.

Apply the radical-options skill. Start from this product sentence:

  Installed SPAs call typed Epicenter commands. The bridge is a convenience over Tauri invoke, not a new runtime.

Please simplify the bridge design before implementation.

Answer in this shape:

Current path:
  What complexity would we introduce if every native operation became a layered service, action, handler context object, and transport adapter?

Friction:
  Which layers are not needed for a trusted same-device SPA?

Radical option:
  What is the smallest typed invoke wrapper that still gives app authors good ergonomics?

Deletion prize:
  What concepts disappear if phase 1 is only SPA plus Tauri bridge?

User loss:
  What real behavior is lost by deferring Bun actions and peer invocation?

Decision:
  Pick the bridge shape and explain it in one sentence.

Constraints:
  - Same-device SPAs must be able to call Tauri/Rust without cloud.
  - Direct invoke is allowed for trusted audited source.
  - Repeated product operations should have typed bridge methods.
  - Command inputs and outputs must be serializable.
  - Rust owns native effects.
  - No handler context object in phase 1.

End with the smallest prototype:

  SPA button
    -> epicenter.audio.record
    -> Rust CPAL command
    -> assetId
    -> epicenter.transcription.run
    -> epicenter.documents.append
```
