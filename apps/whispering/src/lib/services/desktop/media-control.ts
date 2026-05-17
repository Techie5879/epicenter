import { invoke } from '@tauri-apps/api/core';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Ok, tryAsync } from 'wellcrafted/result';
import { IS_MACOS } from '$lib/constants/platform';

export const MediaControlError = defineErrors({
	PauseMediaFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to pause system media playback: ${extractErrorMessage(cause)}`,
		cause,
	}),
	ResumeMediaFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to resume system media playback: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type MediaControlError = InferErrors<typeof MediaControlError>;

export type PauseMediaForRecordingOutcome = {
	shouldResume: boolean;
};

export const MediaControlServiceLive = {
	async pauseForRecording() {
		if (!IS_MACOS || !window.__TAURI_INTERNALS__)
			return Ok({ shouldResume: false });

		return tryAsync({
			try: async () => {
				return await invoke<PauseMediaForRecordingOutcome>(
					'macos_pause_media_for_recording',
				);
			},
			catch: (error) => MediaControlError.PauseMediaFailed({ cause: error }),
		});
	},
	async resumeAfterRecording() {
		if (!IS_MACOS || !window.__TAURI_INTERNALS__) return Ok(undefined);

		return tryAsync({
			try: async () => {
				await invoke<void>('macos_resume_media_after_recording');
			},
			catch: (error) => MediaControlError.ResumeMediaFailed({ cause: error }),
		});
	},
};

export type MediaControlService = typeof MediaControlServiceLive;
