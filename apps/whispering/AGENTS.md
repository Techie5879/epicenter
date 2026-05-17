# Whispering App

Tauri + Svelte 5 desktop/web app for voice transcription.

## Key Points

- Three-layer architecture: Service → Query → UI
- Services are pure functions returning `Result<T, E>`
- Platform detection at build time via `window.__TAURI_INTERNALS__`
- Query layer handles reactivity, caching, and error transformation
- See `ARCHITECTURE.md` for detailed patterns
- Desktop feedback sounds use Web Audio instead of `HTMLAudioElement.play()` so short app sounds do not become the macOS media key target. Keep this fix in the desktop sound service; do not add media pause/resume behavior to sound playback.

## Don'ts

- Don't put business logic in Svelte components
- Don't access settings directly in services (pass as parameters)
- Don't use try-catch; use wellcrafted Result types

## Specs and Docs

- App-specific specs: `./specs/`
- App-specific docs: `./docs/` (if needed)
- Cross-cutting specs: `/specs/`
- Cross-cutting docs: `/docs/`

See root `AGENTS.md` for the full organization guide.
