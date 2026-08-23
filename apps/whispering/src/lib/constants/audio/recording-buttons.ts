/**
 * Recording action button iconography.
 *
 * The current recorder state owns the verb the button performs. Manual and VAD
 * are separate state machines with separate verbs ("recording" vs "listening")
 * and an `IDLE` that means different things, so each gets its own table.
 */

import AudioLinesIcon from '@lucide/svelte/icons/audio-lines';
import EarIcon from '@lucide/svelte/icons/ear';
import MicIcon from '@lucide/svelte/icons/mic';
import SquareIcon from '@lucide/svelte/icons/square';
import type { Component } from 'svelte';
import type { VadState, WhisperingRecordingState } from './recording-states';

export const MANUAL_RECORDING_BUTTON = {
	IDLE: { Icon: MicIcon, label: 'Start recording' },
	RECORDING: { Icon: SquareIcon, label: 'Stop recording' },
} as const satisfies Record<
	WhisperingRecordingState,
	{ Icon: Component<{ class?: string }>; label: string }
>;

export const VAD_RECORDING_BUTTON = {
	IDLE: { Icon: EarIcon, label: 'Start listening' },
	LISTENING: { Icon: EarIcon, label: 'Stop listening' },
	SPEECH_DETECTED: { Icon: AudioLinesIcon, label: 'Stop listening' },
} as const satisfies Record<
	VadState,
	{ Icon: Component<{ class?: string }>; label: string }
>;
