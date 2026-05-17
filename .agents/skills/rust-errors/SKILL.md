---
name: rust-errors
description: Rust to TypeScript error handling for Tauri apps. Use when mentioning Rust errors, Tauri command errors, invoke errors, or defining Rust error types for TS consumption.
metadata:
  author: epicenter
  version: '1.0'
---

# Rust to TypeScript Error Handling
## Reference Repositories

- [Tauri](https://github.com/tauri-apps/tauri) — Desktop app framework (source of Rust-to-TypeScript error patterns)

## When to Apply This Skill

Use this pattern when you need to:

- Send Rust errors through Tauri commands to TypeScript clients.
- Define Rust enums that serialize into discriminated union error shapes.
- Validate unknown error payloads in TypeScript before switching on variants.
- Keep cross-language error payloads consistent with `name` and `message` fields.
- Avoid serde tagging patterns that produce nested, awkward TypeScript shapes.

## Discriminated Union Pattern for Errors

When passing errors from Rust to TypeScript through Tauri commands, use internally-tagged enums to create discriminated unions that TypeScript can handle naturally.

### Rust Error Definition

```rust
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, Serialize, Deserialize)]
#[serde(tag = "name")]
pub enum TranscriptionError {
    #[error("Audio read error: {message}")]
    AudioReadError { message: String },

    #[error("GPU error: {message}")]
    GpuError { message: String },

    #[error("Model load error: {message}")]
    ModelLoadError { message: String },

    #[error("Transcription error: {message}")]
    TranscriptionError { message: String },
}
```

### Key Rust Patterns

1. **Use internally tagged enums**: `#[serde(tag = "name")]` creates a discriminator field
2. **Follow naming conventions**: Enum variants should be PascalCase
3. **Include structured data**: Each variant can have fields like `message: String`
4. **Single-variant enums are okay**: Use when you want consistent error structure

```rust
// Single-variant enum for consistency
#[derive(Error, Debug, Serialize, Deserialize)]
#[serde(tag = "name")]
enum ArchiveExtractionError {
    #[error("Archive extraction failed: {message}")]
    ArchiveExtractionError { message: String },
}
```

### TypeScript Error Handling

```typescript
import { type } from 'arktype';

// Define the error type to match Rust serialization
const TranscriptionErrorType = type({
	name: "'AudioReadError' | 'GpuError' | 'ModelLoadError' | 'TranscriptionError'",
	message: 'string',
});

// Use in error handling
const result = await tryAsync({
	try: () => invoke('transcribe_audio_whisper', params),
	catch: (unknownError) => {
		const result = TranscriptionErrorType(unknownError);
		if (result instanceof type.errors) {
			// Handle unexpected error shape
			return WhisperingErr({
				title: 'Unexpected Error',
				description: extractErrorMessage(unknownError),
				action: { type: 'more-details', error: unknownError },
			});
		}

		const error = result;
		// Now we have properly typed discriminated union
		switch (error.name) {
			case 'ModelLoadError':
				return WhisperingErr({
					title: 'Model Loading Error',
					description: error.message,
					action: {
						type: 'more-details',
						error: new Error(error.message),
					},
				});

			case 'GpuError':
				return WhisperingErr({
					title: 'GPU Error',
					description: error.message,
					action: {
						type: 'link',
						label: 'Configure settings',
						href: '/settings/transcription',
					},
				});

			// Handle other cases...
		}
	},
});
```

### Serialization Format

The Rust enum serializes to this TypeScript-friendly format:

```json
// AudioReadError variant
{ "name": "AudioReadError", "message": "Failed to decode audio file" }

// GpuError variant
{ "name": "GpuError", "message": "GPU acceleration failed" }
```

### Best Practices

1. **Consistent error structure**: All errors have the same shape with `name` and `message`
2. **TypeScript type safety**: Use runtime validation with arktype to ensure type safety
3. **Exhaustive handling**: Switch statements provide compile-time exhaustiveness checking
4. **Don't use `content` attribute**: Avoid `#[serde(tag = "name", content = "data")]` as it creates nested structures
5. **Keep enums private when possible**: Only make public if used across modules

### Anti-Patterns to Avoid

```rust
// DON'T: External tagging (default behavior)
#[derive(Serialize)]
pub enum BadError {
    ModelLoadError { message: String }
}
// Produces: { "ModelLoadError": { "message": "..." } }

// DON'T: Adjacent tagging with content
#[derive(Serialize)]
#[serde(tag = "type", content = "data")]
pub enum BadError {
    ModelLoadError { message: String }
}
// Produces: { "type": "ModelLoadError", "data": { "message": "..." } }

// DON'T: Manual Serialize implementation when derive works
impl Serialize for MyError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Unnecessary complexity
    }
}
```

This pattern ensures clean, type-safe error handling across the Rust-TypeScript boundary with minimal boilerplate and maximum type safety.

## `tracing` ↔ `wellcrafted/logger`

`defineErrors` mirrors `thiserror`; the workspace logger mirrors `tracing`. Together they give TypeScript the same split Rust has: errors are data, level is chosen at the emit site.

### Level mapping (5 levels, no `fatal`)

| `tracing` macro | Workspace `Logger` method | Use when |
|---|---|---|
| `tracing::trace!(...)` | `log.trace(message, data?)` | Per-token / per-message noise for deep debugging |
| `tracing::debug!(...)` | `log.debug(message, data?)` | Internal state transitions (handshakes, cache fills) |
| `tracing::info!(...)` | `log.info(message, data?)` | Lifecycle events (connected, loaded, flushed) |
| `tracing::warn!(?err)` | `log.warn(err)` | Recoverable failure — retry path, fallback taken |
| `tracing::error!(?err)` | `log.error(err)` | Unrecoverable at this layer — call it loudly |

`tracing` has no `fatal`; neither do we. Process termination is the app's decision (`process.exit`), not the library's.

### Level on the variant? No.

```rust
// Rust: level is on the CALL, not the enum variant
tracing::warn!(?err, "cache miss"); // same err, different sites
tracing::error!(?err, "giving up");
```

```ts
// TS: same rule
log.warn(CacheError.Miss({ key }));  // recoverable
log.error(CacheError.Miss({ key })); // terminal
```

No Rust logging crate attaches level to the error type (`thiserror`, `anyhow`, `slog`, `log`). `miette` is the exception — but `miette` is a compiler-diagnostics library, not a general logger. We follow `tracing`: level is context, not identity.

### The `?err` idiom ↔ `tapErr`

`tracing`'s `?err` interpolates a structured error field into the log event. In TS, the Result-flow equivalent is `tapErr`:

```rust
let result = do_thing().inspect_err(|err| tracing::warn!(?err, "do_thing failed"));
```

```ts
const result = await tryAsync({
  try: () => doThing(),
  catch: (cause) => DoThingError.Failed({ cause }),
}).then(tapErr(log.warn));
```

Both: pass-through on success, log the structured error on failure.
