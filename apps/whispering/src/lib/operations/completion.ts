import { CompleteError, complete, resolveConnection } from '@epicenter/client';
import type { Result } from 'wellcrafted/result';
import { customFetch } from '#platform/http';
import type { InferenceProviderId } from '$lib/constants/inference';
import {
	type CompletionState,
	resolveCompletionStateFromConfig,
} from '$lib/operations/completion-target';
import { services } from '$lib/services';
import type { CodexOAuthSession } from '$lib/services/codex';
import { deviceConfig } from '$lib/state/device-config.svelte';

type CompletionApp = {
	settings: {
		get(key: 'completionProvider'): InferenceProviderId;
		get(key: 'completionModel'): string;
	};
};

/**
 * Resolve the single global completion state: what to call (`target`), whether
 * Polish can run (`canRun`), and whether transcript text stays on this device
 * (`textStaysOnDevice`). All three are derived together from the global
 * `completion.*` setting and deviceConfig, read at use (ADR 0012) so nothing goes
 * stale. `target` is null when there is no base URL to talk to (Custom with no
 * endpoint configured), the one genuinely un-runnable route.
 */
export function resolveCompletionState(app: CompletionApp): CompletionState {
	return resolveCompletionStateFromConfig({
		provider: app.settings.get('completionProvider'),
		getDeviceConfig: deviceConfig.get,
		codexConnected: deviceConfig.get('auth.codex') !== null,
	});
}

type PrivateCodexError = {
	name: string;
	message: string;
	status?: number;
};

type SessionActivation = Result<CodexOAuthSession, PrivateCodexError>;

function waitForSessionActivation(
	activation: Promise<SessionActivation>,
	signal: AbortSignal | undefined,
): Promise<SessionActivation | undefined> {
	if (!signal) return activation;
	if (signal.aborted) return Promise.resolve(undefined);
	return new Promise((resolve, reject) => {
		const cancel = () => {
			signal.removeEventListener('abort', cancel);
			resolve(undefined);
		};
		signal.addEventListener('abort', cancel, { once: true });
		void activation.then(
			(result) => {
				signal.removeEventListener('abort', cancel);
				resolve(result);
			},
			(error) => {
				signal.removeEventListener('abort', cancel);
				reject(error);
			},
		);
	});
}

function mapCodexError(
	error: PrivateCodexError,
): Result<string, CompleteError> {
	if (error.name === 'RequestFailed' && error.status !== undefined) {
		return CompleteError.RequestFailed({
			status: error.status,
			detail: 'Codex subscription rejected the request.',
		});
	}
	return CompleteError.TransportFailed({ cause: new Error(error.message) });
}

async function completeWithCodex({
	model,
	systemPrompt,
	userPrompt,
	signal,
}: {
	model: string;
	systemPrompt: string;
	userPrompt: string;
	signal?: AbortSignal;
}): Promise<Result<string, CompleteError>> {
	const capturedSession = deviceConfig.get('auth.codex');
	if (!capturedSession) {
		return CompleteError.TransportFailed({
			cause: new Error('Connect ChatGPT to use Codex subscription.'),
		});
	}

	const activeResult = await waitForSessionActivation(
		services.codex.ensureActiveSession(capturedSession),
		signal,
	);
	if (!activeResult) {
		return CompleteError.TransportFailed({
			cause: new Error('Request cancelled'),
		});
	}
	if (activeResult.error !== null) return mapCodexError(activeResult.error);

	const activeSession = activeResult.data;
	const currentSession = deviceConfig.get('auth.codex');
	if (currentSession?.refreshToken === capturedSession.refreshToken) {
		deviceConfig.set('auth.codex', activeSession);
	} else if (currentSession?.refreshToken !== activeSession.refreshToken) {
		return CompleteError.TransportFailed({
			cause: new Error(
				'The ChatGPT account changed before the request could start.',
			),
		});
	}

	const completionResult = await services.codex.complete({
		session: activeSession,
		model,
		systemPrompt,
		userPrompt,
		signal,
	});
	if (completionResult.error !== null) {
		return mapCodexError(completionResult.error);
	}
	return completionResult;
}

/**
 * Run one completion against the single global AI default. Both the Polish pass
 * and every Recipe share this one call path, so provider, model, and credential
 * resolution live here once. API-key providers use the shared OpenAI-compatible
 * client. Codex uses its subscription protocol service. Provider and model come
 * from `completion.*` in settings. API-key providers resolve their key and
 * endpoint from deviceConfig. Codex activates its device-local session and
 * verifies storage ownership before sending text. All state is read at use
 * (ADR 0012), and pasted strings are trimmed.
 *
 * `signal` aborts the in-flight request (the Polish HUD's "ship raw" control).
 */
export function completeWithGlobalDefault(
	app: CompletionApp,
	{
		systemPrompt,
		userPrompt,
		signal,
	}: {
		systemPrompt: string;
		userPrompt: string;
		signal?: AbortSignal;
	},
): Promise<Result<string, CompleteError>> {
	if (app.settings.get('completionProvider') === 'Codex') {
		return completeWithCodex({
			model: app.settings.get('completionModel').trim(),
			systemPrompt,
			userPrompt,
			signal,
		});
	}
	const { target } = resolveCompletionState(app);
	if (!target) {
		const provider = app.settings.get('completionProvider');
		return Promise.resolve(
			CompleteError.TransportFailed({
				cause: new Error(
					`No base URL set for the ${provider} completion provider. Add an endpoint in settings.`,
				),
			}),
		);
	}
	if (!('baseUrl' in target)) {
		return Promise.resolve(
			CompleteError.TransportFailed({
				cause: new Error('The completion provider is not available.'),
			}),
		);
	}
	return complete(
		resolveConnection(
			{ baseUrl: target.baseUrl, apiKey: target.apiKey },
			customFetch,
		),
		{
			model: app.settings.get('completionModel').trim(),
			systemPrompt,
			userPrompt,
			signal,
		},
	);
}
