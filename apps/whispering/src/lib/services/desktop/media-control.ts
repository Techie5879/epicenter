import { invoke } from '@tauri-apps/api/core';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Ok, tryAsync } from 'wellcrafted/result';
import { IS_MACOS } from '$lib/constants/platform';

export const MediaControlError = defineErrors({
	TogglePlayPauseFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to toggle system media playback: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type MediaControlError = InferErrors<typeof MediaControlError>;

export const MediaControlServiceLive = {
	async toggleSystemPlayPause() {
		if (!IS_MACOS || !window.__TAURI_INTERNALS__) return Ok(undefined);

		return tryAsync({
			try: async () => {
				await invoke<void>('macos_toggle_system_media_play_pause');
			},
			catch: (error) =>
				MediaControlError.TogglePlayPauseFailed({ cause: error }),
		});
	},
};

export type MediaControlService = typeof MediaControlServiceLive;
