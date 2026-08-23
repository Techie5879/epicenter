# Collapse the local model lifecycle to lazy load-on-use

## The asymmetric win in one line

Delete eager preload. Then the entire `model_generation` subsystem (the hardest
code in `model_manager.rs`) has nothing left to guard, so it goes too. We lose
one latency optimization (a warm model before the first transcription) and
delete the most error-prone concurrency reasoning in the Tauri backend.

Estimated: `model_manager.rs` drops from ~960 to ~550 lines, `config.rs` loses
`should_preload`, and zero out-of-order async model loads remain to reason about.

## Why this is the right altitude (grounding)

Handy (`cjpais/handy`) is the closest comparable: a minimal Tauri transcription
app built on the **same `transcribe-rs` library** Whispering uses. Its resident
model lifecycle:

- **Lazy load.** The model loads when transcription is attempted and it is not
  already loaded, not when the user selects it.
- **Single resident model** (`engine: Arc<Mutex<Option<LoadedEngine>>>`), reused
  across transcriptions.
- **Idle unload** via a `ModelUnloadTimeout` setting and a 10s watcher, with an
  `Immediately` variant. Refreshed during active recording.
- **No generation/version token.** Concurrency is handled by a `LoadingGuard`
  RAII (one load at a time), not by reconciling which selection is newest.
- No disk-change detection at all (so Handy still has the re-download-stale bug
  that our disk-identity change fixes).

Handy delivers the same product (pick a model, transcribe, model stays warm,
unloads when idle) with materially less machinery. The delta is exactly
Whispering's eager preload and its generation token. That delta is the cut.

## What eager preload costs us today

`set_transcription_config` does not just store config. On an `(engine, name)`
change it bumps `model_generation`, spawns a blocking thread, evicts the old
model, and preloads the new one, all while newer pushes may arrive. To keep a
stale background preload from publishing "Ready" after a newer selection, the
file threads a generation token through nearly every method:

- `model_generation: Arc<AtomicU64>`
- `should_preload()` (config.rs) and `read_config_with_generation()`
- `preload()` (~70 lines)
- `LoadCaller` enum + impl, `EnsureLoaded::Stale`
- `is_current_model_generation()`, `with_current_model_generation()`
- a generation argument on `publish_if_current()`, `ensure_loaded()`,
  `evict_with_reason_if_current()`, and the `with_*` engine helpers
- the `spawn_blocking` block and the `Switching` status

Every one of those exists to make eager background preload safe. None is needed
if the model loads synchronously on the transcription that needs it. Whispering
already loads-on-use for the transcription path (`with_engine` -> `ensure_loaded`
with `LoadCaller::Transcription`); preload is a second, eager copy of that path
with all the staleness scaffolding bolted on.

## Target design

### Config push becomes pure state

```rust
pub fn set_transcription_config(&self, config: TranscriptionConfig) {
    // Validate eagerly (cheap, no model load) so a bad selection surfaces now.
    if let Err(message) = self.model_path_for(&config) {
        *self.write_config() = None;
        self.evict(UnloadReason::ConfigChanged);
        self.set_status(ModelStatus::Error { message: message.clone() });
        self.emit(ModelStateEvent::LoadingFailed { state: self.snapshot(), error: message });
        return;
    }
    *self.write_config() = Some(config);
    self.emit(ModelStateEvent::SelectionChanged { state: self.snapshot() });
}
```

No generation bump, no thread, no eager evict, no preload. Switching models just
updates config; the old engine is dropped when the next transcription loads the
new one (the cache already does `guard.take()` before loading a non-matching
model), or by the idle watcher if no transcription comes.

We keep **eager validation** (it is a path check, not a model load) so an invalid
selection still errors at selection time, not mid-recording.

### Transcribe loads on demand (already true)

`transcribe()` -> `with_engine` -> `ensure_loaded` already reuses the resident
engine or loads it under the cache lock, emitting `LoadingStarted` /
`LoadingCompleted`. After the cut this is the *only* load path. The FE still sees
loading events; they fire on the first transcription instead of on selection.

### ensure_loaded collapses

With no preload caller, `ensure_loaded` loses the `LoadCaller`/generation
parameter, every `is_current_model_generation` guard, and the `EnsureLoaded::Stale`
return. It becomes: lock, compute disk identity, reuse if (path, identity, kind)
match else drop-and-load, emit, return the guard.

### Keep

- **Single resident cache** with **disk-identity revalidation** (the prior PR).
  This is the correctness core and even Handy lacks it; keep it.
- **Idle unload** (`ModelManager::start_idle_watcher`, `tick_idle`,
  `evict_if_immediate`). Genuine memory hygiene for multi-GB models. The watcher
  needs no generation token; it just unloads whatever is resident when idle.
- **Inference lifecycle events** the FE status UI consumes (Loading, Inferring,
  Ready, Error). They now all originate from the transcribe path.

## What changes for the user

- First transcription of a session (or first after an idle unload) pays the model
  load latency once, behind the spinner the FE already shows during transcription.
  Subsequent transcriptions are warm.
- Selecting a model no longer warms it in the background. An invalid selection
  still errors immediately (validation is kept).
- Switching models frees the old one on the next transcription or idle tick
  rather than instantly. A brief extra memory hold, never a leak.

That is the ~10% we give up: pre-warming, and instant eviction on switch.

## Deliberate non-goals

- **No background load thread / loading guard.** Handy uses one for UI
  responsiveness; Whispering's transcription is already async from the FE's view,
  so loading inline under the cache lock is simpler and sufficient. Do not add a
  half-measure that reintroduces races. If pre-warming is ever wanted back, add it
  as one explicit, cache-checked background load, decided on its own merits.
- **Unload-policy enum trimming.** The four-way `Never / Immediately /
  After5Minutes / After30Minutes` could collapse to a single default, but that is
  a separate, more debatable cut. Out of scope here.

## Sequencing

1. (Done) Disk-identity revalidation in the cache. Correctness, composes forward.
2. Delete eager preload: `preload()`, the `spawn_blocking` in
   `set_transcription_config`, `should_preload`, `LoadCaller`, `EnsureLoaded::Stale`,
   `model_generation` and its helpers, the generation args, the `Switching` status.
3. Simplify `ensure_loaded` / `with_engine` signatures to drop the caller param.
4. Confirm the FE still renders status correctly from the transcribe-path events;
   remove any FE handling that only existed for preload/Switching.

Each step compiles and keeps tests green independently.
```
