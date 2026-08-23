# @epicenter/recorder

Browser microphone capture and voice-activity detection, with no app glue: no
settings store, no tables, no transcription, no UI. It hands back a `Blob` plus
level and speech callbacks.

Manual recording products (start/stop lifecycles, artifact shapes, native
recorders) are intentionally not here; an app builds those on top of this
package's stream acquisition. This package is the browser-portable audio
toolkit.

## Public API

```ts
import {
  // Device stream (navigator.mediaDevices)
  getRecordingStream,
  enumerateDevices,
  cleanupRecordingStream,
  DeviceStreamError,

  // Voice activity detection (Silero v5 via @ricky0123/vad-web)
  createVadRecorder,

  // Device vocabulary
  asDeviceIdentifier,
} from '@epicenter/recorder';
```

Types: `Device`, `DeviceIdentifier`, `DeviceAcquisitionOutcome`,
`VadRecorder`, `VadRecorderError`, `StartActiveListeningOptions`.

The core is callback and `Result` based, with no framework reactivity. A Svelte
app that wants reactive state wraps the core in its own thin runes layer (see
Whispering's `vad-recorder.svelte.ts`).

## VAD runtime assets (required)

`@ricky0123/vad-web` fetches its worklet, Silero ONNX model, and onnxruntime
wasm from a base path at runtime; the files are not bundled. `createVadRecorder`
loads them from `assetBaseUrl` (default `/vad/`). Each consuming app must copy
those files so they are served at that path, or VAD fails to initialize at
runtime (this is not caught by `tsc`).

The package resolves the source paths from its own pinned dependency tree.
Feed them to your build's static-copy step. With Vite:

```ts
// vite.config.ts
import { VAD_ASSET_DEST, vadAssetSources } from '@epicenter/recorder/vad-assets';
import { viteStaticCopy } from 'vite-plugin-static-copy';

viteStaticCopy({
  targets: vadAssetSources.map((src) => ({
    src,
    dest: VAD_ASSET_DEST, // 'vad' -> served at /vad/
    rename: { stripBase: true },
  })),
});
```

If you set a non-default `assetBaseUrl`, serve the files at that path instead.
