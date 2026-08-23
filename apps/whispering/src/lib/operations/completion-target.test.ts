/**
 * Completion Target Tests
 *
 * Verifies the pure completion targeting rules that decide whether Polish can
 * run and what privacy boundary the UI reports.
 *
 * Key behaviors:
 * - Custom endpoint without a key is a usable local completion target
 * - Cloud providers need a key before Polish can run
 * - Locality follows the resolved host (loopback), not the provider id or key
 * - Destination copy separates local audio from local transcript text
 */
import { describe, expect, test } from 'bun:test';
import type { InferenceProviderId } from '../constants/inference';
import {
	type CompletionState,
	describeCompletionReadiness,
	describePolishDestination,
	type InferenceConfigKey,
	resolveCompletionStateFromConfig,
} from './completion-target';

function config(values: Partial<Record<InferenceConfigKey, string>>) {
	return (key: InferenceConfigKey) => values[key] ?? '';
}

function state(
	provider: InferenceProviderId,
	values: Partial<Record<InferenceConfigKey, string>>,
): CompletionState {
	return resolveCompletionStateFromConfig({
		provider,
		getDeviceConfig: config(values),
	});
}

describe('resolveCompletionState', () => {
	test('endpoint override beats the provider default', () => {
		expect(
			state('OpenAI', {
				'providers.openai.endpoint': ' https://proxy.example/v1 ',
				'providers.openai.apiKey': ' sk-test ',
			}),
		).toEqual({
			target: { baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test' },
			canRun: true,
			textStaysOnDevice: false,
		});
	});

	test('Custom without an endpoint has no completion target and cannot run', () => {
		expect(state('Custom', {})).toEqual({
			target: null,
			canRun: false,
			textStaysOnDevice: false,
		});
	});

	test('keyless Custom loopback endpoint can serve local Polish', () => {
		expect(
			state('Custom', {
				'providers.custom.endpoint': 'http://localhost:11434/v1',
			}),
		).toEqual({
			target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
			canRun: true,
			textStaysOnDevice: true,
		});
	});

	test('cloud provider without a key cannot serve Polish', () => {
		expect(state('Google', {})).toEqual({
			target: {
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
				apiKey: undefined,
			},
			canRun: false,
			textStaysOnDevice: false,
		});
	});

	test('cloud provider endpoint override to localhost with no key runs and stays on device', () => {
		expect(
			state('OpenAI', {
				'providers.openai.endpoint': 'http://localhost:1234/v1',
			}),
		).toEqual({
			target: { baseUrl: 'http://localhost:1234/v1', apiKey: undefined },
			canRun: true,
			textStaysOnDevice: true,
		});
	});

	test('loopback endpoint with a key still stays on device', () => {
		expect(
			state('Custom', {
				'providers.custom.endpoint': 'http://127.0.0.1:11434/v1',
				'providers.custom.apiKey': 'local-key',
			}),
		).toEqual({
			target: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'local-key' },
			canRun: true,
			textStaysOnDevice: true,
		});
	});
});

describe('describePolishDestination', () => {
	const onDevice = { onDevice: true, name: 'Local Model' } as const;
	const cloud = { onDevice: false, name: 'OpenAI' } as const;
	const selfHosted = {
		onDevice: false,
		name: 'your Speaches server',
	} as const;

	test('on-device audio and keyless Custom keeps audio and text on device', () => {
		expect(
			describePolishDestination(onDevice, 'Custom', {
				target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe('Audio and transcript text both stay on this device.');
	});

	test('on-device audio and cloud Polish names the text provider', () => {
		expect(
			describePolishDestination(onDevice, 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is transcribed on-device, but Polish sends transcript text to Google.',
		);
	});

	test('cloud audio and keyless Custom splits audio from local text', () => {
		expect(
			describePolishDestination(cloud, 'Custom', {
				target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe(
			'Audio is sent to OpenAI, then Polish keeps transcript text on this device.',
		);
	});

	test('on-device audio and loopback override keeps audio and text on device', () => {
		expect(
			describePolishDestination(onDevice, 'OpenAI', {
				target: { baseUrl: 'http://localhost:1234/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toBe('Audio and transcript text both stay on this device.');
	});

	test('cloud audio and cloud Polish names both providers', () => {
		expect(
			describePolishDestination(cloud, 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is sent to OpenAI, and Polish sends transcript text to Google.',
		);
	});

	test('a remote self-hosted server reads as the user own server, not a cloud vendor', () => {
		expect(
			describePolishDestination(selfHosted, 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is sent to your Speaches server, and Polish sends transcript text to Google.',
		);
	});

	test('on-device audio ships raw instead of claiming Polish sends text when not ready', () => {
		expect(
			describePolishDestination(onDevice, 'Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: undefined,
				},
				canRun: false,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio stays on this device. Polish is not ready, so transcripts ship raw.',
		);
	});

	test('remote Custom names the resolved host, matching describeCompletionReadiness', () => {
		// Custom's label is an API shape, not a destination, so the pipeline
		// sentence must name the resolved host, exactly as the Processing surface
		// does. Both surfaces resolve the same fact, so they never disagree.
		expect(
			describePolishDestination(onDevice, 'Custom', {
				target: { baseUrl: 'https://completion.example/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toBe(
			'Audio is transcribed on-device, but Polish sends transcript text to completion.example.',
		);
	});
});

describe('describeCompletionReadiness', () => {
	test('Custom with no endpoint asks for a server URL', () => {
		expect(
			describeCompletionReadiness('Custom', {
				target: null,
				canRun: false,
				textStaysOnDevice: false,
			}),
		).toEqual({
			ready: false,
			summary: 'Add a server URL below. Until then, transcripts ship raw.',
		});
	});

	test('cloud provider without a key asks for that provider key', () => {
		expect(
			describeCompletionReadiness('Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: undefined,
				},
				canRun: false,
				textStaysOnDevice: false,
			}),
		).toEqual({
			ready: false,
			summary:
				'Add the Google API key below. Until then, transcripts ship raw.',
		});
	});

	test('keyless loopback Custom keeps text on device', () => {
		expect(
			describeCompletionReadiness('Custom', {
				target: { baseUrl: 'http://localhost:11434/v1', apiKey: undefined },
				canRun: true,
				textStaysOnDevice: true,
			}),
		).toEqual({
			ready: true,
			summary: 'Transcript text stays on this device.',
		});
	});

	test('ready cloud provider names itself as the destination', () => {
		expect(
			describeCompletionReadiness('Google', {
				target: {
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
					apiKey: 'key',
				},
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toEqual({
			ready: true,
			summary: 'Transcript text is sent to Google.',
		});
	});

	test('ready remote Custom shows the resolved host, not the placeholder label', () => {
		expect(
			describeCompletionReadiness('Custom', {
				target: { baseUrl: 'https://ai.example.com:8443/v1', apiKey: 'key' },
				canRun: true,
				textStaysOnDevice: false,
			}),
		).toEqual({
			ready: true,
			summary: 'Transcript text is sent to ai.example.com:8443.',
		});
	});
});
