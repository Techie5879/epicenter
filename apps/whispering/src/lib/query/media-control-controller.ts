import { Err, Ok, type Result } from 'wellcrafted/result';

export type MediaPauseSession = {
	id: string;
	resumePending: boolean;
};

type PauseForRecordingResult = Result<MediaPauseSession | null, unknown>;

export function createRecordingMediaController({
	pauseSystemMedia,
	resumeSystemMedia,
	isEnabled,
	isMacos,
	isDesktop,
	createId,
}: {
	pauseSystemMedia: () => Promise<Result<{ shouldResume: boolean }, unknown>>;
	resumeSystemMedia: () => Promise<Result<void, unknown>>;
	isEnabled: () => boolean;
	isMacos: boolean;
	isDesktop: () => boolean;
	createId: () => string;
}) {
	async function pauseForRecording(): Promise<PauseForRecordingResult> {
		if (!isEnabled() || !isMacos || !isDesktop()) return Ok(null);

		const { data, error } = await pauseSystemMedia();
		if (error) return Err(error);
		if (!data?.shouldResume) return Ok(null);

		return Ok({ id: createId(), resumePending: true });
	}

	async function resumeAfterRecording(
		session: MediaPauseSession | null,
	): Promise<Result<void, unknown>> {
		if (!session?.resumePending || !isMacos || !isDesktop())
			return Ok(undefined);

		session.resumePending = false;
		return await resumeSystemMedia();
	}

	return {
		pauseForRecording,
		resumeAfterRecording,
	};
}
