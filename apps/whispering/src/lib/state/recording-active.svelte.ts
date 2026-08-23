import { manualRecorder } from './manual-recorder.svelte';
import { vadRecorder } from './vad-recorder.svelte';

/**
 * True while any recorder is capturing audio (manual recording in progress, or
 * VAD armed/listening). A principal identity change reloads the page (Option A) and
 * the browser `MediaRecorder` cannot survive a reload, so the account controls
 * gate on this: you cannot change accounts mid-capture and lose the recording.
 */
export const recordingActive = {
	get current(): boolean {
		return manualRecorder.state === 'RECORDING' || vadRecorder.state !== 'IDLE';
	},
};
