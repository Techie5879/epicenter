import type { Result } from 'wellcrafted/result';
import type {
	CodexHttpError,
	CodexHttpRequest,
	CodexHttpResponse,
} from '$lib/tauri/commands';

const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const CODEX_RESPONSES_ENDPOINT =
	'https://chatgpt.com/backend-api/codex/responses';

type NativeRequest = (
	request: CodexHttpRequest,
) => Promise<Result<CodexHttpResponse, CodexHttpError>>;
type CodexFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Adapts the typed native Codex command to the Fetch contract expected by the
 * Codex service. Browser builds keep using the supplied browser fetch.
 */
export function createCodexFetch({
	request: sendNativeRequest,
	browserFetch = globalThis.fetch,
}: {
	request: NativeRequest | undefined;
	browserFetch?: CodexFetch;
}) {
	const codexFetch: CodexFetch = async (input, init) => {
		if (!sendNativeRequest) return browserFetch(input, init);

		const request = new Request(input, init);
		if (request.method !== 'POST') {
			throw new Error('Codex requests must use POST');
		}
		const body = await request.text();
		if (request.signal.aborted) throw new Error('Request cancelled');
		const nativeRequest = (() => {
			switch (request.url) {
				case CODEX_TOKEN_ENDPOINT:
					return { kind: 'token' as const, body };
				case CODEX_RESPONSES_ENDPOINT: {
					const authorization = request.headers.get('authorization');
					if (!authorization?.startsWith('Bearer ')) {
						throw new Error('The Codex access token is missing');
					}
					return {
						kind: 'responses' as const,
						accessToken: authorization.slice('Bearer '.length),
						accountId: request.headers.get('chatgpt-account-id'),
						residency: request.headers.get('x-openai-internal-codex-residency'),
						body,
					};
				}
				default:
					throw new Error('The Codex endpoint is not allowed');
			}
		})();

		const result = await waitForCommand(
			sendNativeRequest(nativeRequest),
			request.signal,
		);
		if (result.error) throw new Error(result.error.message);
		return new Response(result.data.body, { status: result.data.status });
	};
	return codexFetch;
}

function waitForCommand<T>(
	command: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(new Error('Request cancelled'));
	return new Promise((resolve, reject) => {
		const cancel = () => reject(new Error('Request cancelled'));
		signal.addEventListener('abort', cancel, { once: true });
		void command.then(resolve, reject).finally(() => {
			signal.removeEventListener('abort', cancel);
		});
	});
}
