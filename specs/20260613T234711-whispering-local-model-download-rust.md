# Whispering Local Model Download: move streaming into Rust

**Date**: 2026-06-13
**Status**: In Progress
**Owner**: Whispering (Braden)
**Branch**: `spec/whispering-local-model-download`

## One Sentence

Replace the webview's per-chunk `writeFile` download path with native Rust streaming, and delete the JS streaming code it makes redundant.

## Implementation status (v1 = `tauri-plugin-upload`)

After grounding both options (see Research Findings), **v1 ships the official `tauri-plugin-upload` `download()`**, not a hand-written command. It already does the streaming core natively (`reqwest` -> `tokio::fs` + `BufWriter`, content-length validation, redirects, progress), captures the entire performance win (no per-chunk IPC), and costs near-zero code we own. We keep atomicity by downloading to `{file}.partial` and `rename`-ing on success.

The custom Rust command (resume via `Range`, inline SHA256, concurrent multi-file) is **deferred to a Phase 2 upgrade**, justified only if real restart pain shows up on the 1.6GB models. Today's code has no resume either, so deferring it regresses nothing. The rest of this spec keeps the custom-command design as the Phase 2 reference; read the decision row "Plugin vs custom command" for the v1 choice.

## How to read this spec

```txt
Read first:      One Sentence, Motivation, Target Shape, Implementation Plan, Success Criteria
Read for design: Research Findings, Design Decisions, Architecture, Call Sites
Read if curious: Edge Cases, Open Questions, Bundled Cleanups
```

## Overview

Local catalog models (Whisper `.bin`, Parakeet/Moonshine multi-file directories) currently download by fetching in the webview and appending every stream chunk to disk through `@tauri-apps/plugin-fs`. This spec moves the byte-moving into a native Rust command so downloads are faster (no per-chunk IPC), resumable, and integrity-checked, while the JS layer keeps owning catalog data, the reactive state machine, and the UI.

## Motivation

### Current State

`apps/whispering/src/lib/services/transcription/local-model-folder.ts:183` streams in the webview and writes each chunk across the IPC boundary:

```ts
// downloadFileTo(): one IPC round-trip per stream chunk
const reader = response.body?.getReader();          // fetch body in JS (plugin-http)
await writeFile(filePath, new Uint8Array());        // truncate
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  await writeFile(filePath, value, { append: true }); // open/seek/write/close, every chunk
  bytes += value.length;
  onProgress(Math.round((bytes / totalBytes) * 100)); // unthrottled, every chunk
}
```

This creates problems:

1. **IPC per chunk**: A fetch `ReadableStream` yields ~16-64KB chunks. A 1.6GB model (`ggml-large-v3-turbo`) is tens of thousands of `writeFile` calls, each a serialize + context-switch + file open/seek/write/close. Bytes also cross the JS/Rust boundary twice (HTTP into the webview, then back out to disk).
2. **No resume**: An interrupted download is discarded (`DownloadIncomplete` removes the partial), so a dropped connection at 95% restarts from zero.
3. **Weak integrity**: Validity is "file exists and is at least 90% of catalog size" (`isModelFileSizeValid`). A truncated-but-large or corrupted-but-complete file passes and loads as a broken model.
4. **Unthrottled progress**: `onProgress` fires per chunk, driving one reactive `$state` write per chunk.

### Desired State

```txt
JS owns:   catalog data (local-models.ts), reactive state machine + UI, "is it installed" disk probe
Rust owns: fetching bytes and writing them to disk, resume, size/hash verification, progress

state.download(model)
  -> invoke('download_local_model', { manifest })   // one call
  <- Channel<DownloadProgress>                        // throttled streamed progress
  -> Result<void, DownloadError>
```

`downloadFileTo` and the webview `plugin-http` + `plugin-fs` streaming code are deleted.

## Research Findings

### How handy downloads models (`cjpais/handy`, `src-tauri/src/managers/model.rs`)

Read directly from source. handy is the closest comparable (Tauri + whisper/parakeet/moonshine desktop transcription app).

| Concern | handy's approach |
| --- | --- |
| Transport | Native `reqwest::Client` in Rust, `response.bytes_stream()` -> `file.write_all(&chunk)` |
| Destination | Writes to `{filename}.partial`, promotes to final only after verification |
| Resume | `Range: bytes={resume_from}-` header; if server answers `200` not `206`, deletes partial and restarts fresh |
| Total size | `resume_from + content_length` for resumed downloads |
| Progress | Global `emit("model-download-progress", ...)`, throttled to 10/sec (100ms) |
| Integrity | Size check, then SHA256 (`spawn_blocking` so hashing a 1.6GB file does not stall the async executor); deletes partial on mismatch |
| Cancellation | `Arc<AtomicBool>` checked per chunk; keeps the partial for later resume |
| Cleanup | RAII guard resets `is_downloading` / cancel flags on every error path |

**Key finding**: every weakness in our current path (IPC-per-chunk, no resume, no checksum, no throttle) is solved by handy doing the work in Rust.

**Difference from us**: handy ships single `.tar.gz` archives and extracts them. Our Parakeet/Moonshine models are **multi-file directories** downloaded file by file (see `local-models.ts` `files: [...]`). Our Rust command must loop over a file list into the engine directory, not extract an archive.

### What Tauri recommends (DeepWiki, `tauri-apps/tauri`)

> "Downloading natively in Rust is generally preferred for large files... Fetching in the webview with `@tauri-apps/plugin-http` and writing each chunk via `plugin-fs writeFile` with `append:true` would involve significant performance overhead due to frequent IPC calls."

The `on_download` webview handler only exposes `Requested`/`Finished`, no granular progress, so it is unsuitable for a progress bar. **Tauri's own guidance: a custom Rust command using `reqwest` streaming to disk, emitting progress, is the efficient path.** For per-invocation streaming, Tauri v2 provides `tauri::ipc::Channel<T>`, which is scoped to the call (no global event name, no `model_id` filtering) and is the modern alternative to handy's global `emit`.

### The official built-in: `tauri-plugin-upload` `download()` (DeepWiki, `tauri-apps/plugins-workspace`)

There is an official plugin with a `download(url, filePath, onProgress, headers, body)` function. From source: it streams natively via `reqwest::Response::bytes_stream()` into a `tokio::fs::File` wrapped in a **`BufWriter`**, and reports progress through a scoped `Channel<ProgressPayload>` carrying `progress`, `progress_total`, `total`, and `transfer_speed`.

| Capability | `plugin-upload` `download()` | Custom command (handy-style) |
| --- | --- | --- |
| Kill IPC-per-chunk (the main win) | Yes | Yes |
| Write path | `tokio::fs` + `BufWriter` (good) | handy: blocking `std::fs`, unbuffered |
| Progress + transfer speed | Yes (`Channel`) | Manual |
| Resume (Range) | **No** | Yes |
| Checksum | **No** | Yes |
| Atomic `.partial` -> final | **No** (writes to final path) | Yes |
| Multi-file aggregation | No (one file/call) | Yes (server-side) |

**Key finding**: the plugin already does the efficient streaming core (better than handy's unbuffered loop), but it cannot resume, has no partial file to resume *from*, and does no integrity check. For 1.6GB models on flaky networks, resume is the feature we actually want, and it is structurally absent here.

**Implication**: build a custom command (handy's reliability shape) but adopt the plugin's internals (`tokio::fs` + `BufWriter` + `Channel` with `transfer_speed`) over handy's blocking loop. Keep `plugin-upload` as the documented fallback if we ever choose to ship the 90% win without resume.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Plugin vs custom command | 3 taste | **v1: `tauri-plugin-upload`**; custom command deferred | The plugin captures the whole perf win for ~zero owned code. Custom command's only extra is resume, and today has none either, so deferring regresses nothing. Revisit when restart pain appears on 1.6GB models |
| Atomicity without resume | 2 coherence | Download to `{file}.partial`, `rename` on success | A crash mid-download leaves `.partial` (ignored by listing), never a truncated file at the canonical path |
| Write path | 1 evidence | `tokio::fs::File` + `BufWriter` | `plugin-upload` source; fewer write syscalls than handy's unbuffered `std::fs` loop |
| Catalog source of truth | 2 coherence | Stays in TS (`local-models.ts`); command receives a manifest | One catalog. Do not mirror it in Rust (handy does, and pays a dual-catalog cost) |
| Progress transport | 1 evidence | `tauri::ipc::Channel<DownloadProgress>` arg, throttled ~10/sec, carries `transfer_speed` | `plugin-upload` proves the shape; scoped per-invocation. Verify Channel exists in our Tauri version |
| Partial files + resume | 2 coherence | `{filename}.partial`, `Range` header, `200`-not-`206` -> restart | Matches handy; resumes large interrupted downloads |
| Integrity: size | 2 coherence | Rust verifies final byte count equals expected before promoting | Replaces the JS 90%-size heuristic with an exact Rust check |
| Integrity: SHA256 | Deferred | Inline hash while streaming (single pass), verify on completion | Catalog has no hashes today; gathering them is its own task. Inline beats handy's second full-file read; see resume caveat in Improvements |
| Multi-file models | 2 coherence | Command takes `files: [...]`, downloads each into the engine dir, aggregates progress by bytes | Parakeet/Moonshine are directories, not archives |
| Multi-file concurrency | 3 taste | Bounded-concurrent file downloads, one shared `reqwest::Client` | Saturates bandwidth for 3-file parakeet/moonshine; handy never faced this (single archive). Constraint: progress aggregation is trickier. Revisit if sequential is fast enough |
| `reqwest` dependency | 1 evidence | Add `reqwest` (rustls, stream features) to `src-tauri/Cargo.toml` | No HTTP client exists in Rust today (verified: no `reqwest` references) |
| HTTP in webview | 2 coherence | Drop `@tauri-apps/plugin-http` for downloads | Bytes no longer transit the webview |

## Architecture

### Flow: before and after

```txt
BEFORE
  LocalModelDownloadCard / hero
    -> state.download(model)
      -> storage.download({ onProgress })
        -> downloadFileTo()  [webview: fetch -> per-chunk writeFile(append) -> IPC]

AFTER
  LocalModelDownloadCard / hero
    -> state.download(model)
      -> invoke('download_local_model', { manifest, channel })   [TS boundary file]
           Rust: for each file -> reqwest stream -> {name}.partial -> write_all
                 resume via Range, throttle progress to channel,
                 size-verify (+ sha256 when present), promote .partial -> final
      <- channel.onmessage = (p) => progress = p.percentage         [throttled]
      -> Result<void, DownloadError>
      -> refresh()  // disk-truth probe, unchanged
```

### Command shape (manifest passed from TS, catalog stays in TS)

```rust
#[derive(Deserialize, specta::Type)]
struct DownloadFile { url: String, filename: String, size_bytes: u64, sha256: Option<String> }

#[derive(Deserialize, specta::Type)]
struct DownloadManifest {
  engine: Engine,         // whispercpp | parakeet | moonshine
  entry_name: String,     // file name (whisper) or directory name (parakeet/moonshine)
  files: Vec<DownloadFile>,
}

#[derive(Serialize, Clone, specta::Type)]
struct DownloadProgress { downloaded: u64, total: u64, percentage: f64, transfer_speed: f64 }

#[tauri::command]
#[specta::specta]
async fn download_local_model(
  app: AppHandle,
  manifest: DownloadManifest,
  on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> { /* ... */ }
```

Registered in `make_specta_builder()` (`src-tauri/src/lib.rs:40`), bindings regenerated, surfaced through the command boundary file (`src/lib/tauri/commands.ts`). The webview never sees model bytes again.

## Improvements over handy

handy is the reliability reference, but it is not the efficiency ceiling. Where we can do better, grounded in `plugin-upload`'s source:

1. **Buffered, async writes.** handy uses blocking `std::fs::File` + `write_all` (a syscall per chunk). Use `tokio::fs` + `BufWriter` like `plugin-upload`, so the async executor is not blocked and writes batch.
2. **Single-pass inline hashing.** handy verifies SHA256 by reading the whole file again after download (a second full pass over up to 1.6GB). Feed each chunk into the hasher as it streams, so verification is free at completion.
   - Caveat: a resumed download did not see the earlier bytes. On resume, either hash the existing `.partial` once before continuing, or fall back to a post-completion full read for that case. Keep the simple full-read path until hashes land in the catalog anyway.
3. **Concurrent multi-file with a shared client.** Parakeet/Moonshine download 3 files; do them with bounded concurrency over one `reqwest::Client` (connection reuse, HTTP/2 to the host). handy ships a single archive and never parallelizes. Aggregate progress by summed bytes across files.
4. **Transfer speed in the UI.** `plugin-upload`'s `ProgressPayload` carries `transfer_speed`; surface a speed/ETA the progress bar, which handy does not expose.

Net: same reliability shape as handy (resume, `.partial`, size + hash), with `plugin-upload`'s tighter write loop and two wins neither has (inline hash, concurrent multi-file).

## Call sites: before and after

### 1. Delete the webview streamer

**Before** (`local-model-folder.ts:183-249`): `downloadFileTo` (fetch + per-chunk append).

**After**: deleted. `@tauri-apps/plugin-http` import removed; `writeFile` no longer used for download.

### 2. `createModelStorage.download` becomes an invoke

**Before** (`local-model-folder.ts:338`):

```ts
async download({ onProgress }): Promise<Result<void, LocalModelFolderError>> {
  // mkdir, then downloadFileTo per file with aggregated progress
}
```

**After**: builds the manifest from the model config and invokes the command, forwarding channel progress to `onProgress`. The engine `switch` for whisper-file vs directory collapses into a single `files` list (one entry for whisper, N for parakeet/moonshine).

### 3. `state.download()` is unchanged in shape

`local-model-downloads.svelte.ts:78` keeps returning `Result<{ outcome, entryName } | null, ...>` and still calls `storage.getInstalledPath()` to short-circuit an existing install. Only the transport underneath changes. UI (`announceModelDownload`, `bind:value`) is untouched.

## Implementation Plan

Build, Prove, Remove. Do not delete the JS path before the Rust path is proven.

### Phase 1: Build the Rust command

- [ ] **1.1** Add `reqwest` (rustls + stream) to `src-tauri/Cargo.toml`; load the `tauri` and `rust-errors` skills first.
- [ ] **1.2** Define `DownloadManifest`/`DownloadFile`/`DownloadProgress` with `specta::Type`; verify `tauri::ipc::Channel` exists in our Tauri version (else fall back to a scoped event).
- [ ] **1.3** Implement `download_local_model`: per-file `.partial`, `Range` resume, `200`-not-`206` restart, throttled progress, exact size verify, promote `.partial` -> final. Reuse the same path resolution as `model_path_for` (`model_manager.rs:164`).
- [ ] **1.4** Register in `collect_commands!` (`lib.rs:40`), regenerate bindings, add to `src/lib/tauri/commands.ts`. Keep specta builder + bindings + boundary file in sync.

### Phase 2: Wire the JS path

- [ ] **2.1** `createModelStorage.download` builds a manifest from `LocalModelConfig` and invokes the command, mapping `Channel` messages to `onProgress`. Map Rust error strings to `LocalModelFolderError`.
- [ ] **2.2** Manual smoke: download whisper (single file) and parakeet (multi-file); kill the network mid-download and confirm resume; confirm progress bar moves smoothly.

### Phase 3: Prove, then Remove

- [ ] **3.1** Typecheck (`bun run typecheck`), `cargo check`, smoke both engines end to end.
- [ ] **3.2** Delete `downloadFileTo` and the now-dead `plugin-http`/`writeFile` download imports.
- [ ] **3.3** Drop `DownloadIncomplete`/`DownloadRequestFailed` if the Rust error mapping replaces them; keep `DeleteFailed`.

### Phase 4: Bundled cleanups (carried per owner decision)

- [x] **4.1** Dead path: `getInstalledPath(): Promise<string|null>` -> `isInstalled(): Promise<boolean>`. Both callers only tested null-ness; the path return surface is deleted. Done.
- [~] **4.2** Staleness regression test: **deferred**. Whispering has no frontend test infra (no vitest/testing-library), and extracting the one-line `isSelectionMissing` predicate solely to unit-test it is the cohesion-over-testability anti-pattern. Behavior is verified by trace and backstopped by Rust `model_path_for`. Revisit as a component test when frontend test infra exists.

### Deferred (own follow-up)

- [ ] SHA256 catalog hashes + Rust verification (Design Decisions: Deferred). Add `sha256` to each catalog file, verify in `spawn_blocking`.
- [ ] Cancel button wired to an `AtomicBool` cancel flag, keeping the `.partial` for resume.

## Edge Cases

### Server ignores Range (no resume support)

1. Client sends `Range: bytes=N-` for an existing `.partial`.
2. Server returns `200 OK` (full body) instead of `206 Partial Content`.
3. Delete the `.partial`, restart from zero (appending a full body onto a partial would corrupt it). Matches handy.

### Selected model deleted underneath (staleness)

1. `value` = active entry name; the file is removed in Finder while the app is open.
2. Next refresh signal (window focus, engine change, post-op) reruns `refreshEntries`; `entries` no longer contains `value`.
3. `isSelectionMissing` (`LocalModelSelector.svelte`) flips true and the amber warning renders. Verified by trace (test deferred, see 4.2). Rust `model_path_for` re-validates at load time, so even a momentarily stale UI cannot transcribe with a missing model.

### Multi-file partial directory

1. A parakeet download completes 2 of 3 files, then drops.
2. Each file has its own `.partial`; resume continues per file. `getInstalledPath` already requires every expected file present and size-valid, so a partial directory reads as not-installed.

## Open Questions

1. **Progress transport: `Channel` vs scoped event.**
   - Options: (a) `tauri::ipc::Channel<DownloadProgress>` command arg, (b) `app.emit` with a per-call id.
   - **Recommendation**: (a) if our Tauri version exposes it; it is scoped to the invocation and needs no id filtering. Verify the version first (Class 1).

2. **Error surface: typed Rust errors vs string.**
   - Options: (a) keep `Result<(), String>` and map strings in TS, (b) a `specta`-typed error enum (load `rust-errors`).
   - **Recommendation**: (b) for a clean TS discriminated union, matching repo conventions.

3. **Where the manifest is built.**
   - Options: (a) `createModelStorage.download` builds it, (b) a small `toDownloadManifest(model)` helper in `local-models.ts`.
   - **Recommendation**: (b); keeps catalog-shape knowledge next to the catalog.

## Success Criteria

- [ ] Downloading a 1.6GB whisper model does not issue per-chunk IPC writes; bytes are written in Rust.
- [ ] Killing the connection mid-download and retrying resumes from the partial rather than restarting.
- [ ] Final file is rejected unless its byte count matches the expected size.
- [ ] Progress updates are throttled (no more than ~10/sec) and reach 100%.
- [ ] `downloadFileTo` and the webview download imports are deleted; `bun run typecheck` and `cargo check` pass.
- [ ] `getInstalledPath` is gone in favor of `isInstalled(): Promise<boolean>`.
- [ ] A test covers the missing-selection warning.

## References

- `apps/whispering/src/lib/services/transcription/local-model-folder.ts` - `downloadFileTo` (delete), `createModelStorage.download` (rewire), `getInstalledPath` (-> `isInstalled`)
- `apps/whispering/src/lib/state/local-model-downloads.svelte.ts` - `download()` keeps shape; callers of `getInstalledPath`
- `apps/whispering/src/lib/constants/local-models.ts` - catalog manifest source; add `sha256?` when hashes are gathered
- `apps/whispering/src-tauri/src/lib.rs:40` - `make_specta_builder()` / `collect_commands!`
- `apps/whispering/src-tauri/src/transcription/model_manager.rs:164` - `model_path_for` path resolution to reuse
- `apps/whispering/src/lib/tauri/commands.ts` - command boundary file to keep in sync
- `cjpais/handy` `src-tauri/src/managers/model.rs` `download_model` - reliability reference (resume, throttle, sha256, cancel)
- `tauri-apps/plugins-workspace` `plugins/upload` `download()` - efficient streaming reference (`tokio::fs` + `BufWriter` + `Channel` with `transfer_speed`); documented fallback if we drop resume
- Skills to load when implementing: `tauri`, `rust-errors`, `svelte`
