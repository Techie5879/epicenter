import { defineErrors, type InferErrors } from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import { type Tauri, tauri } from '#platform/tauri';
import { services } from '$lib/services';
import type { CodexOAuthSession, CodexService } from '$lib/services/codex';
import { deviceConfig } from '$lib/state/device-config.svelte';

const CodexAccountError = defineErrors({
	Unsupported: () => ({
		message: 'Connecting ChatGPT is available in the desktop app.',
	}),
	ConnectFailed: () => ({
		message: 'Could not connect ChatGPT. Try again.',
	}),
	Superseded: () => ({
		message: 'This ChatGPT connection attempt was replaced.',
	}),
});
type CodexAccountError = InferErrors<typeof CodexAccountError>;

type CodexAccountDependencies = {
	codex: CodexService;
	getTauri: () => Tauri | null;
	setSession: (session: CodexOAuthSession | null) => void;
};

export function createCodexAccountOperations({
	codex,
	getTauri,
	setSession,
}: CodexAccountDependencies) {
	let activeAttempt: symbol | null = null;

	async function connect(): Promise<
		Result<CodexOAuthSession, CodexAccountError>
	> {
		const attempt = Symbol();
		activeAttempt = attempt;
		try {
			const activeTauri = getTauri();
			if (!activeTauri) return CodexAccountError.Unsupported();

			const authorization = await codex.createAuthorization();
			if (activeAttempt !== attempt) return CodexAccountError.Superseded();
			if (authorization.error !== null)
				return CodexAccountError.ConnectFailed();

			const callback = await activeTauri.codex.completeOAuthLogin(
				authorization.data.authorizeUrl,
				authorization.data.state,
			);
			if (activeAttempt !== attempt) return CodexAccountError.Superseded();
			if (callback.error !== null) return CodexAccountError.ConnectFailed();

			const exchange = await codex.exchangeAuthorizationCode({
				code: callback.data,
				verifier: authorization.data.verifier,
			});
			if (activeAttempt !== attempt) return CodexAccountError.Superseded();
			if (exchange.error !== null) return CodexAccountError.ConnectFailed();

			setSession(exchange.data);
			return exchange;
		} finally {
			if (activeAttempt === attempt) activeAttempt = null;
		}
	}

	function disconnect(): void {
		activeAttempt = null;
		codex.clearSessionCache();
		setSession(null);
	}

	return { connect, disconnect };
}

const codexAccount = createCodexAccountOperations({
	codex: services.codex,
	getTauri: () => tauri,
	setSession: (session) => deviceConfig.set('auth.codex', session),
});

export const connectCodexAccount = codexAccount.connect;
export const disconnectCodexAccount = codexAccount.disconnect;
