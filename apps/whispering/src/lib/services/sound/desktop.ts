import { tryAsync } from 'wellcrafted/result';
import type { PlaySoundService } from '.';
import { soundSources } from './assets';
import { SoundError } from './types';

async function playSoundSource(sourceUrl: string) {
	const audioContext = new AudioContext();

	try {
		if (audioContext.state === 'suspended') {
			await audioContext.resume();
		}

		const response = await fetch(sourceUrl);
		const encodedAudio = await response.arrayBuffer();
		const decodedAudio = await audioContext.decodeAudioData(encodedAudio);
		const source = audioContext.createBufferSource();

		source.buffer = decodedAudio;
		source.connect(audioContext.destination);
		source.addEventListener(
			'ended',
			() => {
				void audioContext.close();
			},
			{ once: true },
		);
		source.start();
	} catch (error) {
		await audioContext.close();
		throw error;
	}
}

export function createPlaySoundServiceDesktop() {
	return {
		playSound: async (soundName) =>
			tryAsync({
				try: async () => {
					await playSoundSource(soundSources[soundName]);
				},
				catch: (error) => SoundError.Play({ cause: error }),
			}),
	} satisfies PlaySoundService;
}
