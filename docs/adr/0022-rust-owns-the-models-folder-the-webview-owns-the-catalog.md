# 0022. Rust owns the models folder, the webview owns the catalog

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Whispering's local-model files on disk had two owners. The webview reached into
the models folder directly through `plugin-fs`: it listed entries, statted files,
and judged whether an install was complete, while Rust owned the download. "What
counts as a complete file on disk" was therefore duplicated across the IPC
boundary, the 90% size rule living once in Rust's download integrity check and
again in the webview's read path (`isInstalled` and the Whisper truncation
check). The split bought a boundary cost with no clean story: the folder stayed
touched by both languages, `plugin-fs` stayed imported only to stat models, and
the same constant had to be kept in sync by hand. This is the resource-ownership
sibling of [ADR-0012](0012-transcription-settings-are-read-at-use-not-mirrored-into-rust.md):
the process that holds a resource should own the truth about it.

## Decision

Rust owns the entire models folder; the webview owns the catalog. Rust lists,
stats, resolves entries through any symlink, downloads (stage, integrity-check,
then promote with one atomic rename), deletes, and renders the completeness
verdict. The webview owns which models exist, their expected sizes, and their
display, and it hands the expected sizes to Rust at the point of a question.

"What counts as a complete file on disk" is filesystem-validity truth, not
catalog policy, so the 90% rule lives once in Rust next to the stat
(`COMPLETENESS_FLOOR`, `is_size_complete`), shared by the download integrity
check (`ensure_complete`) and the read path (`resolve_model_files`). The webview
keeps catalog data only and reads the returned `complete` verdict.

## Consequences

- `PATHS.MODELS` and the webview's `plugin-fs` model imports are deleted;
  `local-model-folder.ts` becomes thin command wrappers. The models folder is a
  native resource reached only through Tauri commands.
- One path serves downloaded, linked, and hand-dropped installs identically. A
  linked-but-broken entry now reads as not-installed, and a linked entry can be
  removed from the UI.
- Cancel cleanup is a Rust `StagingGuard` whose `Drop` removes the `.partial`:
  aborting the tokio task drops the guard, which removes the staging. The
  webview's pre-check race against the filesystem is gone.
- `resolve_model_files` carries the one subtle rule in the seam: an empty
  `filenames` list means the entry is itself the file (Whisper), checked against
  `expected_sizes[0]`; otherwise one verdict per file. A dead link reports
  `size: None, complete: false`.
- Cost: the webview can no longer introspect model files on its own; every folder
  fact crosses a command. This is acceptable because the folder is a desktop-only
  native resource, and it forecloses a future web build managing local models,
  which is already impossible (local engines are desktop-only).

## Considered alternatives

- **The half-move: give Rust the read surface, leave download in the webview.**
  Rejected: it pays for a boundary shift without buying a clean story. The folder
  stays bi-lingual, `plugin-fs` stays imported, and the completeness rule stays
  duplicated.
- **Keep the rule webview-owned and pass raw sizes back.** Rejected: the download
  path must validate natively before it promotes a staged file, so the constant
  was always going to live in Rust too; a single owner next to the stat removes
  the second copy.

Relates to [ADR-0012](0012-transcription-settings-are-read-at-use-not-mirrored-into-rust.md):
0012 gives Rust the resident-model *mechanism* while the webview owns the setting
*values*; 0013 gives Rust the *bytes on disk* while the webview owns the
*catalog*. Both are the same principle, the holding process owns the truth about
its resource, applied to the two halves of a local model.
