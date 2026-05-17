import { Err, Ok, type Result } from 'wellcrafted/result';

export type MediaPauseSession = {
	id: string;
	resumePending: boolean;
};

type PauseForRecordingResult = Result<MediaPauseSession | null, unknown>;

export function createRecordingMediaController({
	toggleSystemPlayPause,
	isEnabled,
	isMacos,
	isDesktop,
	createId,
}: {
	toggleSystemPlayPause: () => Promise<Result<void, unknown>>;
	isEnabled: () => boolean;
	isMacos: boolean;
	isDesktop: () => boolean;
	createId: () => string;
}) {
	async function pauseForRecording(): Promise<PauseForRecordingResult> {
		if (!isEnabled() || !isMacos || !isDesktop()) return Ok(null);

		const { error } = await toggleSystemPlayPause();
		if (error) return Err(error);

		return Ok({ id: createId(), resumePending: true });
	}

	async function resumeAfterRecording(
		session: MediaPauseSession | null,
	): Promise<Result<void, unknown>> {
		if (!session?.resumePending || !isMacos || !isDesktop())
			return Ok(undefined);

		session.resumePending = false;
		return await toggleSystemPlayPause();
	}

	return {
		pauseForRecording,
		resumeAfterRecording,
	};
}
