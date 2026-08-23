import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { tryAsync } from 'wellcrafted/result';
import type { WhisperingSoundNames } from '$lib/constants/sounds';
import { soundSources } from './assets';

export const SoundError = defineErrors({
	Play: ({ cause }: { cause: unknown }) => ({
		message: `Failed to play sound: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type SoundError = InferErrors<typeof SoundError>;

async function playSoundUrl(soundUrl: string) {
	const context = new AudioContext();
	try {
		// A fresh context can start suspended under the browser autoplay policy
		// (e.g. Safari cold start). These cues always follow a user action, so
		// resuming here is safe and keeps the sound audible.
		if (context.state === 'suspended') {
			await context.resume();
		}

		const response = await fetch(soundUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch sound: ${response.statusText}`);
		}
		const audioBuffer = await context.decodeAudioData(
			await response.arrayBuffer(),
		);

		const bufferSource = context.createBufferSource();
		bufferSource.buffer = audioBuffer;
		bufferSource.connect(context.destination);

		await new Promise<void>((resolve) => {
			// Close once the clip ends, but bound the wait: onended is not
			// guaranteed to fire if the context is interrupted, and the finally
			// must always close the context so the app never lingers as the OS
			// media target.
			const fallback = setTimeout(resolve, audioBuffer.duration * 1000 + 250);
			bufferSource.onended = () => {
				clearTimeout(fallback);
				resolve();
			};
			bufferSource.start();
		});
	} finally {
		try {
			await context.close();
		} catch {
			// Best effort cleanup. Playback success should not become a sound failure
			// because the browser refused to close an already-ending context.
		}
	}
}

export const PlaySoundServiceLive = {
	playSound: (soundName: WhisperingSoundNames) =>
		tryAsync({
			try: () => playSoundUrl(soundSources[soundName]),
			catch: (error) => SoundError.Play({ cause: error }),
		}),
};
