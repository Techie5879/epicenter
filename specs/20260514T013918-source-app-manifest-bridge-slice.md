# Source App Manifest And Bridge Slice

**Date**: 2026-05-14
**Status**: Queued
**Author**: Braden + Codex
**Follow-up to**: `20260512T234944-source-installed-app-runtime-vision.md`

## Sentence

Define the first source-installed app contract in TypeScript: manifest parsing plus typed invoke bridge factories, without loading an app into Tauri yet.

## Current Code Truth

The source runtime package does not exist yet. There is no `@epicenter/app` package, no installed app loader, and no generic Epicenter Tauri shell for source apps.

The shipped action model is already settled for now:

```txt
actions
  defineActions({...})
  flat snake_case keys

generic peer dispatch
  no current collaboration surface
```

This slice must not change that model. The bridge is for trusted same-device SPAs calling Tauri commands. If a later operation needs scripts, agents, CLI, peers, or workers, a later spec can promote it into a flat snake_case action.

Whispering already proves the native side of the pattern with direct Tauri invoke calls for CPAL recording and transcription. This slice extracts the author-facing contract without moving Whispering or adding a loader.

## Scope

Implement a new package:

```txt
packages/app/
  package.json
  src/
    index.ts
    manifest.ts
    bridge.ts
    bridge.test.ts
    manifest.test.ts
  tsconfig.json
```

Package name:

```json
{
  "name": "@epicenter/app"
}
```

Exports:

```ts
export {
  AppManifest,
  AppPermission,
  AppManifestError,
  parseAppManifest,
  type SourceInstalledAppManifest,
} from './manifest.js';

export {
  createEpicenterBridge,
  type EpicenterBridge,
  type EpicenterInvoke,
} from './bridge.js';
```

## Manifest Contract

Define the phase 1 manifest shape:

```ts
type SourceInstalledAppManifest = {
  id: string;
  name: string;
  entry: string;
  permissions: AppPermission[];
};
```

Initial permission union:

```ts
type AppPermission =
  | 'workspace:read'
  | 'documents:write'
  | 'assets:write'
  | 'audio:record'
  | 'window:manage';
```

Validation rules:

```txt
id: lowercase ASCII slug, max 64 chars
name: non-empty string, max 80 chars
entry: relative path ending in .html
permissions: known strings only, deduped in original order
unknown keys: rejected
```

Use `arktype` for the runtime schema, following the existing package pattern in `packages/auth`, `packages/encryption`, and `packages/filesystem`.

Return a `Result<SourceInstalledAppManifest, AppManifestError>` instead of throwing. Use `defineErrors` for at least:

```txt
InvalidManifest
InvalidEntry
UnknownPermission
```

## Bridge Contract

The bridge is a typed wrapper around an injected invoke function:

```ts
export type EpicenterInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export function createEpicenterBridge(options: {
  invoke: EpicenterInvoke;
}): EpicenterBridge;
```

Initial bridge methods:

```ts
epicenter.audio.record(input)
epicenter.transcription.run(input)
epicenter.documents.append(input)
epicenter.window.resize(input)
```

For this slice, define serializable TypeScript input and output types next to the bridge. Do not derive them from Rust yet. The command names should stay snake_case and boring:

```txt
audio_record
transcription_run
documents_append
window_resize
```

Bridge tests should inject a fake invoke and assert that each method calls the expected command with the expected payload.

## Out Of Scope

- No installed source directory yet.
- No app copying, update flow, or merge flow.
- No Tauri webview loader.
- No Rust command changes.
- No Whispering extraction.
- No permission review UI.
- No Bun action runtime.
- No `actions.ts` convention.
- No handler context object.
- No peer, worker, or CLI invocation.
- No changes to `packages/workspace` RPC, presence, or action key behavior.

## Implementation Plan

- [ ] **1.1** Add `packages/app/package.json` and `tsconfig.json`.
- [ ] **1.2** Add `manifest.ts` with `AppManifest`, `AppPermission`, `parseAppManifest`, and `AppManifestError`.
- [ ] **1.3** Add manifest tests for valid input, unknown keys, bad entry paths, duplicate permissions, and unknown permissions.
- [ ] **1.4** Add `bridge.ts` with `createEpicenterBridge`, `EpicenterBridge`, `EpicenterInvoke`, and serializable method input/output types.
- [ ] **1.5** Add bridge tests with a fake invoke.
- [ ] **1.6** Export the package surface from `src/index.ts`.
- [ ] **1.7** Run `bun test packages/app` and `bun run --cwd packages/app typecheck`.

## Acceptance

- `@epicenter/app` exists as a small TypeScript-only package.
- Manifest validation rejects malformed app source before any loader exists.
- The typed bridge centralizes command names without changing Rust or existing apps.
- No existing app imports `@epicenter/app` in this slice.
- No action runtime, handler context object, or peer dispatch abstraction is introduced.

## Notes For The Implementer

Keep this boring. The package should be a contract and a convenience wrapper, not a runtime. If implementation pressure starts pulling in app loading, file copying, Tauri window creation, permissions UI, or action promotion, stop and write the next follow-up spec instead.
