import { nanoid } from 'nanoid/non-secure';
import { IS_MACOS } from '$lib/constants/platform';
import { desktopServices } from '$lib/services/desktop';
import { deviceConfig } from '$lib/state/device-config.svelte';
import {
	createRecordingMediaController,
	type MediaPauseSession,
} from './media-control-controller';

export { createRecordingMediaController, type MediaPauseSession };

export const recordingMediaController = createRecordingMediaController({
	toggleSystemPlayPause: () =>
		desktopServices.mediaControl.toggleSystemPlayPause(),
	isEnabled: () =>
		deviceConfig.get('recording.macos.pauseMediaDuringRecording'),
	isMacos: IS_MACOS,
	isDesktop: () => Boolean(window.__TAURI_INTERNALS__),
	createId: nanoid,
});

export type RecordingMediaController = typeof recordingMediaController;
