import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Err, Ok, type Result, tryAsync, trySync } from 'wellcrafted/result';

// Protocol details follow OpenCode at e2505d434a6d78904ecfe546c4a1980d26bd8cd1
// (MIT) and OpenAI Codex at 3b45c29062ff0e76e71c91b6753290400e7fa8da.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
const RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CALLBACK_URL = 'http://localhost:1455/auth/callback';
const OAUTH_SCOPE = 'openid profile email offline_access';
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_WINDOW_MS = 60_000;
const PKCE_ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

const CodexAuthError = defineErrors({
	AuthorizationSetupFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not prepare ChatGPT sign in: ${extractErrorMessage(cause)}`,
		cause,
	}),
	TokenExchangeFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not connect the ChatGPT subscription: ${extractErrorMessage(cause)}`,
		cause,
	}),
	TokenRefreshFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not refresh the ChatGPT subscription: ${extractErrorMessage(cause)}`,
		cause,
	}),
	InvalidTokenResponse: ({ cause }: { cause: unknown }) => ({
		message: `ChatGPT returned invalid sign-in details: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
type CodexAuthError = InferErrors<typeof CodexAuthError>;

const CodexCompletionError = defineErrors({
	TransportFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not reach Codex: ${extractErrorMessage(cause)}`,
		cause,
	}),
	RequestFailed: ({ status }: { status: number }) => ({
		message: `Codex rejected the request (${status})`,
		status,
	}),
	InvalidResponse: ({ cause }: { cause: unknown }) => ({
		message: `Codex returned an invalid response: ${extractErrorMessage(cause)}`,
		cause,
	}),
	GenerationFailed: () => ({
		message: 'Codex reported a generation failure',
	}),
	EmptyResponse: () => ({
		message: 'Codex returned no text',
	}),
});
type CodexCompletionError = InferErrors<typeof CodexCompletionError>;

export type CodexOAuthSession = {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	email?: string;
};

type TokenResponse = {
	accessToken: string;
	refreshToken?: string;
	idToken?: string;
	expiresIn?: number;
};

type CodexFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

type CodexServiceOptions = {
	fetch?: CodexFetch;
	now?: () => number;
	randomBytes?: (length: number) => Uint8Array;
	sha256?: (value: Uint8Array) => Promise<ArrayBuffer>;
};

type RefreshCacheEntry = {
	promise: Promise<Result<CodexOAuthSession, CodexAuthError>>;
};

export function createCodexService({
	fetch: fetchRequest = globalThis.fetch.bind(globalThis),
	now = Date.now,
	randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length)),
	sha256 = (value) =>
		crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer),
}: CodexServiceOptions = {}) {
	const refreshCache = new Map<string, RefreshCacheEntry>();

	async function requestRefreshedSession(
		session: CodexOAuthSession,
	): Promise<Result<CodexOAuthSession, CodexAuthError>> {
		const { data: response, error: requestError } = await tryAsync({
			try: () =>
				fetchRequest(TOKEN_ENDPOINT, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						grant_type: 'refresh_token',
						refresh_token: session.refreshToken,
						client_id: CLIENT_ID,
					}).toString(),
				}),
			catch: () =>
				CodexAuthError.TokenRefreshFailed({
					cause: 'The token endpoint could not be reached',
				}),
		});
		if (requestError) return Err(requestError);

		if (!response.ok) {
			return CodexAuthError.TokenRefreshFailed({
				cause: `Request failed (${response.status})`,
			});
		}
		const { data: tokens, error: tokenError } = await readTokenResponse(
			response,
			'The refreshed token response could not be read',
		);
		if (tokenError) return Err(tokenError);

		const identity = decodeIdentity(tokens);
		return Ok({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken ?? session.refreshToken,
			expiresAt:
				now() + (tokens.expiresIn ?? DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000,
			accountId: identity.accountId ?? session.accountId,
			email: identity.email ?? session.email,
		});
	}

	async function refreshSession(
		session: CodexOAuthSession,
		activeAfter: number,
	): Promise<Result<CodexOAuthSession, CodexAuthError>> {
		let sessionToRefresh = session;
		const followedTokens = new Set<string>();

		while (true) {
			const refreshToken = sessionToRefresh.refreshToken;
			if (followedTokens.has(refreshToken)) {
				return CodexAuthError.InvalidTokenResponse({
					cause: 'Refresh token rotation contained a cycle',
				});
			}
			followedTokens.add(refreshToken);

			const cachedRefresh = refreshCache.get(refreshToken);
			if (!cachedRefresh) break;

			const result = await cachedRefresh.promise;
			if (result.error) return result;
			if (result.data.expiresAt > activeAfter) return result;

			if (result.data.refreshToken === refreshToken) {
				if (refreshCache.get(refreshToken) === cachedRefresh) {
					refreshCache.delete(refreshToken);
				}
				sessionToRefresh = result.data;
				break;
			}
			sessionToRefresh = result.data;
		}

		const refreshToken = sessionToRefresh.refreshToken;
		const entry: RefreshCacheEntry = {
			promise: requestRefreshedSession(sessionToRefresh),
		};
		entry.promise = entry.promise.then((result) => {
			if (result.error && refreshCache.get(refreshToken) === entry) {
				refreshCache.delete(refreshToken);
			}
			return result;
		});
		refreshCache.set(refreshToken, entry);
		return entry.promise;
	}

	return {
		clearSessionCache() {
			refreshCache.clear();
		},

		async createAuthorization() {
			return tryAsync({
				try: async () => {
					const verifier = Array.from(randomBytes(43), (byte) =>
						PKCE_ALPHABET.at(byte % PKCE_ALPHABET.length),
					).join('');
					const challenge = encodeBase64Url(
						new Uint8Array(await sha256(new TextEncoder().encode(verifier))),
					);
					const state = encodeBase64Url(randomBytes(32));
					const params = new URLSearchParams({
						response_type: 'code',
						client_id: CLIENT_ID,
						redirect_uri: CALLBACK_URL,
						scope: OAUTH_SCOPE,
						code_challenge: challenge,
						code_challenge_method: 'S256',
						id_token_add_organizations: 'true',
						codex_cli_simplified_flow: 'true',
						state,
						originator: 'whispering',
					});
					return {
						authorizeUrl: `${ISSUER}/oauth/authorize?${params.toString()}`,
						verifier,
						state,
					};
				},
				catch: () =>
					CodexAuthError.AuthorizationSetupFailed({
						cause: 'PKCE values could not be generated',
					}),
			});
		},

		async exchangeAuthorizationCode({
			code,
			verifier,
		}: {
			code: string;
			verifier: string;
		}): Promise<Result<CodexOAuthSession, CodexAuthError>> {
			const { data: response, error: requestError } = await tryAsync({
				try: () =>
					fetchRequest(TOKEN_ENDPOINT, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
						},
						body: new URLSearchParams({
							grant_type: 'authorization_code',
							code,
							redirect_uri: CALLBACK_URL,
							client_id: CLIENT_ID,
							code_verifier: verifier,
						}).toString(),
					}),
				catch: () =>
					CodexAuthError.TokenExchangeFailed({
						cause: 'The token endpoint could not be reached',
					}),
			});
			if (requestError) return Err(requestError);

			if (!response.ok) {
				return CodexAuthError.TokenExchangeFailed({
					cause: `Request failed (${response.status})`,
				});
			}
			const { data: tokens, error: tokenError } = await readTokenResponse(
				response,
				'The token response could not be read',
			);
			if (tokenError) return Err(tokenError);
			if (!tokens.refreshToken) {
				return CodexAuthError.InvalidTokenResponse({
					cause: 'Missing refresh token',
				});
			}

			const identity = decodeIdentity(tokens);
			refreshCache.clear();
			return Ok({
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt:
					now() + (tokens.expiresIn ?? DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000,
				...identity,
			});
		},

		ensureActiveSession(
			session: CodexOAuthSession,
		): Promise<Result<CodexOAuthSession, CodexAuthError>> {
			const activeAfter = now() + REFRESH_WINDOW_MS;
			if (session.expiresAt > activeAfter) return Promise.resolve(Ok(session));
			return refreshSession(session, activeAfter);
		},

		async complete({
			session,
			model,
			systemPrompt,
			userPrompt,
			signal,
		}: {
			session: CodexOAuthSession;
			model: string;
			systemPrompt: string;
			userPrompt: string;
			signal?: AbortSignal;
		}): Promise<Result<string, CodexCompletionError>> {
			const headers = new Headers({
				Accept: 'text/event-stream',
				Authorization: `Bearer ${session.accessToken}`,
				'Content-Type': 'application/json',
				originator: 'whispering',
			});
			if (session.accountId) {
				headers.set('ChatGPT-Account-Id', session.accountId);
			}
			const residency = getResidency(parseJwtClaims(session.accessToken));
			if (residency) {
				headers.set('x-openai-internal-codex-residency', residency);
			}

			const { data: response, error: requestError } = await tryAsync({
				try: () =>
					fetchRequest(RESPONSES_ENDPOINT, {
						method: 'POST',
						headers,
						body: JSON.stringify({
							model,
							instructions: systemPrompt,
							input: userPrompt,
							store: false,
							stream: true,
						}),
						signal,
					}),
				catch: () =>
					CodexCompletionError.TransportFailed({
						cause: 'The Responses endpoint could not be reached',
					}),
			});
			if (requestError) return Err(requestError);

			if (!response.ok) {
				return CodexCompletionError.RequestFailed({ status: response.status });
			}
			const { data: eventStream, error: readError } = await tryAsync({
				try: () => response.text(),
				catch: () =>
					CodexCompletionError.TransportFailed({
						cause: 'The response stream could not be read',
					}),
			});
			if (readError) return Err(readError);

			return parseEventStream(eventStream);
		},
	};
}

export type CodexService = ReturnType<typeof createCodexService>;

async function readTokenResponse(
	response: Response,
	readFailure: string,
): Promise<Result<TokenResponse, CodexAuthError>> {
	const { data: responseText, error: readError } = await tryAsync({
		try: () => response.text(),
		catch: () => CodexAuthError.InvalidTokenResponse({ cause: readFailure }),
	});
	if (readError) return Err(readError);

	const { data: value, error: jsonError } = trySync({
		try: (): unknown => JSON.parse(responseText),
		catch: () =>
			CodexAuthError.InvalidTokenResponse({
				cause: 'The token response was not valid JSON',
			}),
	});
	if (jsonError) return Err(jsonError);
	return parseTokenResponse(value);
}

function parseTokenResponse(
	value: unknown,
): Result<TokenResponse, CodexAuthError> {
	if (!isRecord(value)) {
		return CodexAuthError.InvalidTokenResponse({
			cause: 'Expected a token response object',
		});
	}

	const accessToken = value.access_token;
	const refreshToken = value.refresh_token;
	const idToken = value.id_token;
	const expiresIn = value.expires_in;
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		return CodexAuthError.InvalidTokenResponse({
			cause: 'Missing access token',
		});
	}
	if (
		refreshToken !== undefined &&
		(typeof refreshToken !== 'string' || refreshToken.length === 0)
	) {
		return CodexAuthError.InvalidTokenResponse({
			cause: 'Invalid refresh token',
		});
	}
	if (idToken !== undefined && typeof idToken !== 'string') {
		return CodexAuthError.InvalidTokenResponse({
			cause: 'Invalid identity token',
		});
	}
	if (
		expiresIn !== undefined &&
		(typeof expiresIn !== 'number' || expiresIn < 0)
	) {
		return CodexAuthError.InvalidTokenResponse({
			cause: 'Invalid token lifetime',
		});
	}

	return Ok({ accessToken, refreshToken, idToken, expiresIn });
}

function parseEventStream(
	eventStream: string,
): Result<string, CodexCompletionError> {
	let text = '';
	let completed = false;

	for (const block of eventStream.split(/\r?\n\r?\n/)) {
		const eventData = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice('data:'.length).replace(/^ /, ''))
			.join('\n');
		if (!eventData || eventData === '[DONE]') continue;

		const { data: event, error: parseError } = trySync({
			try: (): unknown => JSON.parse(eventData),
			catch: () =>
				CodexCompletionError.InvalidResponse({
					cause: 'The response stream contained malformed event data',
				}),
		});
		if (parseError) return Err(parseError);
		if (!isRecord(event)) {
			return CodexCompletionError.InvalidResponse({
				cause: 'The response stream contained an invalid event',
			});
		}

		const eventType = getString(event, 'type');
		if (eventType === 'response.output_text.delta') {
			const delta = getString(event, 'delta');
			if (delta === undefined) {
				return CodexCompletionError.InvalidResponse({
					cause: 'A text event did not contain a text delta',
				});
			}
			text += delta;
			continue;
		}
		if (eventType === 'response.completed') {
			completed = true;
			continue;
		}
		if (eventType === 'error' || eventType === 'response.failed') {
			return CodexCompletionError.GenerationFailed();
		}
	}

	if (!completed) {
		return CodexCompletionError.InvalidResponse({
			cause: 'The response stream ended before completion',
		});
	}
	if (!text) return CodexCompletionError.EmptyResponse();
	return Ok(text);
}

function decodeIdentity({
	idToken,
	accessToken,
}: Pick<TokenResponse, 'idToken' | 'accessToken'>) {
	const idClaims = idToken ? parseJwtClaims(idToken) : undefined;
	const accessClaims = parseJwtClaims(accessToken);
	return {
		accountId: getAccountId(idClaims) ?? getAccountId(accessClaims),
		email: getString(idClaims, 'email') ?? getString(accessClaims, 'email'),
	};
}

function parseJwtClaims(token: string) {
	const parts = token.split('.');
	const encodedClaims = parts.at(1);
	if (parts.length !== 3 || !encodedClaims) return undefined;

	const { data: claims } = trySync({
		try: () => {
			const json = new TextDecoder().decode(decodeBase64Url(encodedClaims));
			const parsed: unknown = JSON.parse(json);
			return isRecord(parsed) ? parsed : undefined;
		},
		catch: () => Ok(undefined),
	});
	return claims;
}

function getAccountId(claims: Record<string, unknown> | undefined) {
	return (
		getString(claims, 'chatgpt_account_id') ??
		getString(getAuthClaims(claims), 'chatgpt_account_id') ??
		getFirstOrganizationId(claims)
	);
}

function getResidency(claims: Record<string, unknown> | undefined) {
	const residency =
		getString(getAuthClaims(claims), 'chatgpt_compute_residency') ??
		getString(claims, 'chatgpt_compute_residency');
	return residency === 'no_constraint' ? undefined : residency;
}

function getAuthClaims(claims: Record<string, unknown> | undefined) {
	const auth = claims?.['https://api.openai.com/auth'];
	return isRecord(auth) ? auth : undefined;
}

function getFirstOrganizationId(claims: Record<string, unknown> | undefined) {
	const organizations = claims?.organizations;
	if (!Array.isArray(organizations)) return undefined;
	const first = organizations.at(0);
	return isRecord(first) ? getString(first, 'id') : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string) {
	const value = record?.[key];
	return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function encodeBase64Url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

function decodeBase64Url(value: string) {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
