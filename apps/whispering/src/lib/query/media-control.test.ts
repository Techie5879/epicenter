/**
 * Recording Media Controller Tests
 *
 * Verifies the small state machine that coordinates macOS media pause and
 * resume around recording sessions.
 *
 * Key behaviors:
 * - Disabled or non-desktop environments do not send media commands
 * - A successful pause returns a session only when the native layer paused media
 * - Resume only runs once for the session this app paused
 * - Pause failures return errors without creating resume state
 */
import { describe, expect, test } from 'bun:test';
import { Err, Ok, type Result } from 'wellcrafted/result';
import { createRecordingMediaController } from './media-control-controller';

type MediaCall = 'pause' | 'resume';

function setup({
	enabled = true,
	isMacos = true,
	isDesktop = true,
	pauseResult = Ok({ shouldResume: true }),
	resumeResult = Ok(undefined),
}: {
	enabled?: boolean;
	isMacos?: boolean;
	isDesktop?: boolean;
	pauseResult?: Result<{ shouldResume: boolean }, unknown>;
	resumeResult?: Result<void, unknown>;
} = {}) {
	const calls: MediaCall[] = [];
	const controller = createRecordingMediaController({
		pauseSystemMedia: async () => {
			calls.push('pause');
			return pauseResult;
		},
		resumeSystemMedia: async () => {
			calls.push('resume');
			return resumeResult;
		},
		isEnabled: () => enabled,
		isMacos,
		isDesktop: () => isDesktop,
		createId: () => 'test-session-id',
	});

	return { controller, calls };
}

describe('createRecordingMediaController', () => {
	test('pauseForRecording returns null when disabled', async () => {
		const { controller, calls } = setup({ enabled: false });

		const { data, error } = await controller.pauseForRecording();

		expect(error).toBeNull();
		expect(data).toBeNull();
		expect(calls).toEqual([]);
	});

	test('pauseForRecording returns a session when native media was paused', async () => {
		const { controller, calls } = setup();

		const { data, error } = await controller.pauseForRecording();

		expect(error).toBeNull();
		expect(data).toEqual({ id: 'test-session-id', resumePending: true });
		expect(calls).toEqual(['pause']);
	});

	test('pauseForRecording returns null when native media was already paused', async () => {
		const { controller, calls } = setup({
			pauseResult: Ok({ shouldResume: false }),
		});

		const { data, error } = await controller.pauseForRecording();

		expect(error).toBeNull();
		expect(data).toBeNull();
		expect(calls).toEqual(['pause']);
	});

	test('resumeAfterRecording resumes media once for a paused session', async () => {
		const { controller, calls } = setup();

		const { data: session } = await controller.pauseForRecording();
		await controller.resumeAfterRecording(session);
		await controller.resumeAfterRecording(session);

		expect(calls).toEqual(['pause', 'resume']);
	});

	test('resumeAfterRecording does nothing without a paused session', async () => {
		const { controller, calls } = setup();

		const { error } = await controller.resumeAfterRecording(null);

		expect(error).toBeNull();
		expect(calls).toEqual([]);
	});

	test('pauseForRecording returns error without creating session state', async () => {
		const pauseError = {
			name: 'PauseMediaFailed',
			message: 'Failed to pause system media playback: test failure',
			cause: 'test failure',
		};
		const { controller, calls } = setup({ pauseResult: Err(pauseError) });

		const { data, error } = await controller.pauseForRecording();

		expect(data).toBeNull();
		expect(error).toBe(pauseError);
		expect(calls).toEqual(['pause']);
	});

	test('pauseForRecording returns null outside macOS desktop', async () => {
		const browser = setup({ isDesktop: false });
		const linuxDesktop = setup({ isMacos: false });

		expect((await browser.controller.pauseForRecording()).data).toBeNull();
		expect((await linuxDesktop.controller.pauseForRecording()).data).toBeNull();
		expect(browser.calls).toEqual([]);
		expect(linuxDesktop.calls).toEqual([]);
	});
});
