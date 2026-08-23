# Bind Platform Once. Bind Settings Every Time.

Some dependencies never change after the app starts. Others change every time the user opens settings. Treat them the same and you ship subtle bugs.

Epicenter has two kinds of swappable dependencies. The first kind is platform: web vs desktop. The second kind is settings: cpal vs navigator recorder, OpenAI vs Groq transcription, compression on vs off. Each kind needs a different binding strategy, and the difference is not academic; mixing them up is how we shipped a microphone-stays-on bug that took a month to surface.

## Platform never changes. Resolve once, cache the result.

You can't switch from Tauri to a browser without restarting the app. Whether you're running inside the Tauri shell is fixed at startup and stays fixed. So we resolve it once, at module load, and assign the result to a constant.

```typescript
// apps/whispering/src/lib/services/text/index.ts
import { isTauri } from '@tauri-apps/api/core';
import { createTextServiceDesktop } from './desktop';
import { createTextServiceWeb } from './web';

export const TextServiceLive: TextService = isTauri()
    ? createTextServiceDesktop()
    : createTextServiceWeb();
```

`isTauri()` reads a global flag (`globalThis.isTauri`) that Tauri sets when it injects its runtime. The check happens once when this file is first imported. `TextServiceLive` is a regular value after that. Every caller imports the same constant; there's nothing to re-evaluate.

```typescript
import { TextServiceLive } from '$lib/services/text';

await TextServiceLive.copyToClipboard(text);  // resolved at import time
```

This pattern is consistent across the app. Text, OS, HTTP, downloads, sounds, notifications, analytics, blob storage. All of them do exactly this dance: `isTauri() ? createXDesktop() : createXWeb()`, assigned to one const. You read the desktop file or the web file once when you want to understand what a service does, and you never have to think about which one is active at any given moment because the question can't be asked.

## Settings change. Resolve every call.

The recording method (`cpal` vs `navigator`) lives in user settings. The user can flip it at any time, including while a recording is in progress. So the service has to be re-resolved on each method call. There's no constant to cache; there's a function.

```typescript
// apps/whispering/src/lib/state/manual-recorder.svelte.ts
function recorderService() {
    if (!isTauri()) return services.navigatorRecorder;
    return deviceConfig.get('recording.method') === 'cpal'
        ? desktopServices.cpalRecorder
        : services.navigatorRecorder;
}
```

The shape is the same as the platform pattern, but it's wrapped in a function instead of assigned to a constant. Every call site invokes it fresh:

```typescript
await recorderService().enumerateDevices();
await recorderService().startRecording(params, callbacks);
```

This looks like overhead. Why call a function when you could cache the result? Because the setting can change between calls. If the user toggled `recording.method` from `cpal` to `navigator` between `enumerateDevices` and `startRecording`, you want the second call to use the new value. A cached const wouldn't.

The same pattern shows up everywhere settings drive behavior. The transcription service is read from settings on every transcribe:

```typescript
// apps/whispering/src/lib/query/transcription.ts
export async function transcribeBlob(blob: Blob) {
    const selectedService = settings.get('transcription.service');
    // ... dispatch to the right transcriber
}
```

So is whether compression runs:

```typescript
if (settings.get('transcription.compressionEnabled')) {
    const { data: compressedBlob } =
        await desktopServices.ffmpeg.compressAudioBlob(blob, ...);
}
```

None of these are cached. They're all read fresh on each operation, because all of them can change between operations.

## The trap is when a settings dependency spans an operation

Reading a setting at the start of one operation works. Reading it at the start AND the end of the same operation, and assuming the values match, doesn't.

The manual recorder had this exact bug for a month. The old code resolved the service on every method call. Start a navigator recording (resolved: navigator), toggle to cpal in settings, click stop. Stop re-resolved: cpal. Stop ran on a cpal session that didn't exist, returned `NotRecording`, while the navigator's `MediaStream` stayed acquired and the mic LED stayed on. Rare in click-driven UI; real for keyboard-shortcut flows where the recording is invisible.

The fix was to bind the service at the start of the operation and stash it on the instance for the duration:

```typescript
let _activeService: RecorderService | null = null;

async startRecording({ toastId }) {
    const service = recorderService();          // resolve here
    const { data, error } = await service.startRecording(...);
    if (error) return WhisperingErr({ ... });
    _activeService = service;                    // bind to the lifecycle
    return Ok(data);
}

async stopRecording({ toastId }) {
    const service = _activeService ?? recorderService();   // use the bound one
    // ...
    _activeService = null;
}
```

The rule that came out of it: settings binding is per-call by default, but anything that owns a lifecycle longer than one call (a recording session, an upload, a long-running mutation) has to capture the binding at the start and hold it until done. Otherwise a setting change mid-lifecycle silently routes the second half of the operation somewhere different from the first half.

## The two-line rule

Platform binding is a constant; settings binding is a function. If the dependency can change while the app is running, you can't cache it; if it can't, you should. The trickier case is the middle one, where a dependency can change but shouldn't change inside a single in-flight operation. Those need to be resolved once at the operation's start and held for its duration.

The cost of getting this wrong is not a crash. It's the kind of bug where everything looks fine in the logs, the user's UI looks fine, but the microphone LED stays on for the rest of the session and nobody notices until somebody walks past their laptop.
