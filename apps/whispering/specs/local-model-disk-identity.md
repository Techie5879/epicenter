# Local model reload on re-download: cache the bytes, not just the path

## Problem

Deleting a local transcription model and re-downloading it under the same name
(or replacing the file in the models folder by hand) left Rust serving the
**old** resident model. The user saw broken or stale transcription until they
manually re-selected the model in settings.

## Root cause (Rust, not the frontend)

`ModelManager` caches one resident engine as `(PathBuf, Engine)` and decides
reuse on **path equality alone**:

```rust
// model_manager.rs, ensure_loaded
let reuse = matches!(&*guard, Some((p, e)) if p == &model_path && can_reuse(e));
```

The models folder is explicitly "user-editable truth": entries can be deleted,
re-downloaded, or swapped in place. The path stays the same across all of those,
so the cache never notices the bytes changed and keeps serving the resident copy.

`should_preload` compounds it: it keys on `(engine, model_name)` only, so a
re-pushed *identical* config (same name) returns `false` and triggers no reload.
That is why the frontend "re-fire the config push" workaround does not actually
force a reload, and why the manual fix that *did* work (re-select a different
model, then back) worked: it changed `model_name`, making `should_preload` true.

A frontend signal also cannot cover the whole promise: it can only observe
in-app downloads, never a file the user replaces in Finder. The fix belongs in
the layer that owns disk truth.

## Fix

Give the resident cache eyes. Fingerprint the bytes the engine was loaded from,
store the fingerprint next to the cached engine, and revalidate it on reuse.

```rust
type Cached = Option<(PathBuf, Option<DiskIdentity>, Engine)>;

struct DiskIdentity { len: u64, mtime: Option<SystemTime> }
```

- File model: `(len, mtime)` of the file. `len` catches a swap to a different
  model; `mtime` catches a same-size rewrite.
- Directory model: aggregate `len` (sum) and `mtime` (max) over the contained
  files, because overwriting a file in place leaves the directory's own mtime
  untouched.

Reuse only when path, engine kind, **and** disk identity all match; otherwise
drop and reload. A delete + re-download (new mtime, often new size) now
invalidates the cache automatically. No frontend coordination, no bump signal.

## Behavior after the fix

- Same-name re-download: next transcription recomputes identity, sees a
  mismatch, reloads fresh from disk. Correct without any FE push.
- External file swap in the models folder: same revalidation path covers it.
- Identical re-download (byte-for-byte same model): identity may match, cache is
  reused. This is correct: the resident bytes are the same bytes.

## Deliberately out of scope

Eager preload after a same-name re-download. `should_preload` stays name-only,
so a re-download reloads lazily on the next transcription (one cold start)
rather than eagerly. Correctness over a one-time latency shave; the eager path
was never reliable here anyway.

## Cost

One `fs::metadata` per file transcription/preload, plus a shallow directory walk
(a handful of ONNX files) for directory models. Negligible against model load
and inference.
