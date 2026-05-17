import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import { BEARER_SUBPROTOCOL_PREFIX } from '@epicenter/constants/auth';
import { subjectKeyringsEqual } from '@epicenter/encryption';
import { defineErrors, extractErrorMessage } from 'wellcrafted/error';
import { createLogger, type Logger } from 'wellcrafted/logger';
import { Ok, type Result } from 'wellcrafted/result';
import type { AuthClient, AuthState } from './auth-contract.js';
import { AuthError } from './auth-errors.js';
import {
	ApiMeResponse,
	type OAuthTokenGrant,
	type PersistedAuth as PersistedAuthType,
} from './auth-types.js';
import { parseOAuthTokenGrant } from './oauth-token-response.js';

/**
 * Storage adapter for the single `PersistedAuth` cell (grant + localIdentity).
 * Two methods, no watch hook: cross-context sign-out propagates via the
 * server (next bearer-bearing call hits a revoked token and reauth-requires
 * organically). The server is the authority; brief cross-tab desync is
 * acceptable.
 */
export type PersistedAuthStorage = {
	get(): PersistedAuthType | null;
	set(value: PersistedAuthType | null): void | Promise<void>;
};

export type OAuthSignInLauncher = {
	startSignIn(): Promise<Result<OAuthTokenGrant | null, unknown>>;
};

type AuthFetchInput = Request | string | URL;

export type AuthFetch = (
	input: AuthFetchInput,
	init?: RequestInit,
) => Promise<Response>;

export type CreateOAuthAppAuthConfig = {
	baseURL?: string;
	clientId: string;
	persistedAuthStorage: PersistedAuthStorage;
	launcher: OAuthSignInLauncher;
	fetch?: AuthFetch;
	WebSocket?: typeof WebSocket;
	now?: () => number;
	log?: Logger;
};

const REFRESH_SKEW_MS = 60_000;

const AuthStateChangeError = defineErrors({
	SubscriberThrew: ({ cause }: { cause: unknown }) => ({
		message: `Auth state subscriber threw: ${extractErrorMessage(cause)}`,
		cause,
	}),
});

export function createOAuthAppAuth({
	baseURL = EPICENTER_API_URL,
	clientId,
	persistedAuthStorage,
	launcher,
	fetch: fetchImpl = globalThis.fetch.bind(globalThis),
	WebSocket: WebSocketImpl = globalThis.WebSocket,
	now = Date.now,
	log = createLogger('auth/oauth-app'),
}: CreateOAuthAppAuthConfig): AuthClient {
	let persisted = persistedAuthStorage.get();
	let verifiedPersisted: PersistedAuthType | null = null;
	let networkAuthPaused = false;
	let refreshPromise: Promise<boolean> | null = null;
	let identityPromise: Promise<Result<ApiMeResponse, AuthError>> | null = null;

	let state = deriveState();
	const stateChangeListeners = new Set<(state: AuthState) => void>();

	function deriveState(): AuthState {
		if (persisted === null) return { status: 'signed-out' };
		if (networkAuthPaused) {
			return {
				status: 'reauth-required',
				localIdentity: persisted.localIdentity,
			};
		}
		return {
			status: 'signed-in',
			localIdentity: persisted.localIdentity,
		};
	}

	function publishState() {
		const next = deriveState();
		if (state.status === next.status) {
			if (state.status === 'signed-out') return;
			if (
				next.status !== 'signed-out' &&
				state.localIdentity.subject === next.localIdentity.subject &&
				subjectKeyringsEqual(
					state.localIdentity.keyring,
					next.localIdentity.keyring,
				)
			) {
				return;
			}
		}
		state = next;
		for (const listener of stateChangeListeners) {
			try {
				listener(next);
			} catch (error) {
				log.error(AuthStateChangeError.SubscriberThrew({ cause: error }));
			}
		}
	}

	async function refreshGrant(force: boolean): Promise<boolean> {
		if (persisted === null || networkAuthPaused) return false;
		if (
			!force &&
			persisted.grant.accessTokenExpiresAt > now() + REFRESH_SKEW_MS
		) {
			return true;
		}
		if (refreshPromise) return refreshPromise;

		const startedFrom = persisted;
		refreshPromise = (async () => {
			try {
				const grant = await refreshOAuthTokenWithEndpoint({
					baseURL,
					clientId,
					grant: startedFrom.grant,
					fetch: fetchImpl,
					now,
				});
				if (persisted !== startedFrom) return false;
				const next: PersistedAuthType = {
					grant,
					localIdentity: startedFrom.localIdentity,
				};
				await persistedAuthStorage.set(next);
				if (persisted !== startedFrom) return false;
				persisted = next;
				verifiedPersisted = null;
				publishState();
				return true;
			} catch (cause) {
				if (persisted === startedFrom) {
					networkAuthPaused = true;
					publishState();
					log.error(AuthError.RefreshGrantFailed({ cause }));
				}
				return false;
			} finally {
				refreshPromise = null;
			}
		})();

		return refreshPromise;
	}

	async function callApiMe(
		grant: OAuthTokenGrant,
	): Promise<Result<ApiMeResponse, AuthError>> {
		let response: Response;
		try {
			response = await fetchImpl(`${baseURL}/api/me`, {
				headers: { Authorization: `Bearer ${grant.accessToken}` },
				credentials: 'omit',
			});
		} catch (cause) {
			return AuthError.VerifyIdentityFailed({ cause });
		}
		if (!response.ok) {
			return AuthError.VerifyIdentityFailed({
				cause: new Error(`/api/me failed with ${response.status}.`),
			});
		}
		try {
			return Ok(ApiMeResponse.assert(await response.json()));
		} catch (cause) {
			return AuthError.VerifyIdentityFailed({ cause });
		}
	}

	/**
	 * Verify `/api/me` against the persisted cell. Marks the cell verified;
	 * writes the localIdentity cell only when the keyring actually changed.
	 * Wipes the cell on same-subject-guard mismatch. Single-flight: concurrent
	 * callers share the in-flight promise.
	 */
	async function verifyIdentity(
		startedFrom: PersistedAuthType,
	): Promise<Result<ApiMeResponse, AuthError>> {
		if (identityPromise) return identityPromise;
		identityPromise = (async (): Promise<Result<ApiMeResponse, AuthError>> => {
			const { data: apiMe, error } = await callApiMe(startedFrom.grant);
			if (error) return AuthError.VerifyIdentityFailed({ cause: error });
			if (persisted !== startedFrom) return Ok(apiMe);

			if (persisted.localIdentity.subject !== apiMe.localIdentity.subject) {
				await persistedAuthStorage.set(null);
				persisted = null;
				verifiedPersisted = null;
				networkAuthPaused = false;
				publishState();
				return Ok(apiMe);
			}

			if (
				!subjectKeyringsEqual(
					persisted.localIdentity.keyring,
					apiMe.localIdentity.keyring,
				)
			) {
				const next: PersistedAuthType = {
					grant: persisted.grant,
					localIdentity: apiMe.localIdentity,
				};
				await persistedAuthStorage.set(next);
				if (persisted !== startedFrom) return Ok(apiMe);
				persisted = next;
			}
			verifiedPersisted = persisted;
			publishState();
			return Ok(apiMe);
		})().finally(() => {
			identityPromise = null;
		});

		return identityPromise;
	}

	/**
	 * Network gate. Returns the access token to attach to a bearer-bearing
	 * request, or `null` if no bearer should be attached.
	 *
	 * Refuses to attach unless `/api/me` has confirmed the current cell in
	 * this runtime. Cold boot online: refresh grant if
	 * stale, call `/api/me`, then attach. Offline: fails closed; local
	 * workspace decrypt continues via `localIdentity`.
	 */
	async function bearerForNetwork(force: boolean): Promise<string | null> {
		if (persisted === null || networkAuthPaused) return null;
		const refreshed = await refreshGrant(force);
		if (!refreshed || persisted === null || networkAuthPaused) return null;
		if (verifiedPersisted !== persisted) {
			await verifyIdentity(persisted);
			if (
				persisted === null ||
				networkAuthPaused ||
				verifiedPersisted !== persisted
			) {
				return null;
			}
		}
		return persisted.grant.accessToken;
	}

	async function fetchWithAuth(
		input: AuthFetchInput,
		init: RequestInit | undefined,
		forceRefresh: boolean,
	) {
		const headers = headersFromRequest(input, init);
		const accessToken = await bearerForNetwork(forceRefresh);
		if (accessToken) {
			headers.set('Authorization', `Bearer ${accessToken}`);
		} else {
			headers.delete('Authorization');
		}
		let normalizedInput: AuthFetchInput = input;
		if (input instanceof Request) {
			normalizedInput = input.clone() as Request;
		} else if (typeof input === 'string' && input.startsWith('/')) {
			normalizedInput = new URL(input, baseURL).toString();
		}
		return fetchImpl(normalizedInput, {
			...init,
			headers,
			credentials: 'omit',
		});
	}

	async function applySignIn(
		grant: OAuthTokenGrant,
	): Promise<Result<undefined, AuthError>> {
		const callResult = await callApiMe(grant);
		if (callResult.error) {
			return AuthError.StartSignInFailed({ cause: callResult.error });
		}
		const apiMe = callResult.data;
		const next: PersistedAuthType = {
			grant,
			localIdentity: apiMe.localIdentity,
		};
		await persistedAuthStorage.set(next);
		persisted = next;
		verifiedPersisted = next;
		networkAuthPaused = false;
		publishState();
		return Ok(undefined);
	}

	return {
		get state() {
			return state;
		},
		onStateChange(fn) {
			stateChangeListeners.add(fn);
			return () => {
				stateChangeListeners.delete(fn);
			};
		},
		async startSignIn() {
			try {
				const result = await launcher.startSignIn();
				if (result.error) {
					return AuthError.StartSignInFailed({ cause: result.error });
				}
				if (result.data === null) return Ok(undefined);
				return applySignIn(result.data);
			} catch (cause) {
				return AuthError.StartSignInFailed({ cause });
			}
		},
		async signOut() {
			try {
				const refreshTokenToRevoke = persisted?.grant.refreshToken;
				identityPromise = null;
				await persistedAuthStorage.set(null);
				persisted = null;
				verifiedPersisted = null;
				networkAuthPaused = false;
				publishState();
				if (refreshTokenToRevoke) {
					void revokeOAuthRefreshTokenWithEndpoint({
						baseURL,
						clientId,
						refreshToken: refreshTokenToRevoke,
						fetch: fetchImpl,
					}).catch(() => undefined);
				}
				return Ok(undefined);
			} catch (cause) {
				return AuthError.SignOutFailed({ cause });
			}
		},
		async fetch(input, init?: RequestInit) {
			const response = await fetchWithAuth(input, init, false);
			if (response.status !== 401) return response;
			const refreshed = await refreshGrant(true);
			if (!refreshed) return response;
			const retryResponse = await fetchWithAuth(input, init, false);
			if (retryResponse.status === 401) {
				networkAuthPaused = true;
				publishState();
			}
			return retryResponse;
		},
		async openWebSocket(url, protocols = []) {
			const accessToken = await bearerForNetwork(false);
			const authProtocols = accessToken
				? [...protocols, `${BEARER_SUBPROTOCOL_PREFIX}${accessToken}`]
				: protocols;
			return new WebSocketImpl(String(url), authProtocols);
		},
		[Symbol.dispose]() {
			stateChangeListeners.clear();
		},
	};
}

function headersFromRequest(input: Request | string | URL, init?: RequestInit) {
	const headers = new Headers(
		input instanceof Request ? input.headers : undefined,
	);
	copyHeaders(headers, init?.headers);
	return headers;
}

function copyHeaders(target: Headers, source: RequestInit['headers']) {
	if (!source) return;

	if (source instanceof Headers) {
		source.forEach((value, key) => target.set(key, value));
		return;
	}

	const value = source as unknown;

	if (Array.isArray(value)) {
		for (const [key, headerValue] of value) {
			setHeaderValue(target, key, headerValue);
		}
		return;
	}

	if (isHeaderIterable(value)) {
		for (const [key, headerValue] of value) {
			setHeaderValue(target, key, headerValue);
		}
		return;
	}

	for (const [key, headerValue] of Object.entries(
		value as Record<string, string | readonly string[] | undefined>,
	)) {
		setHeaderValue(target, key, headerValue);
	}
}

function setHeaderValue(
	target: Headers,
	key: string,
	value: string | readonly string[] | undefined,
) {
	if (value === undefined) return;
	if (typeof value === 'string') {
		target.set(key, value);
		return;
	}
	for (const item of value) target.append(key, item);
}

function isHeaderIterable(
	value: unknown,
): value is Iterable<readonly [string, string]> {
	return (
		value !== null && typeof value === 'object' && Symbol.iterator in value
	);
}

async function refreshOAuthTokenWithEndpoint({
	baseURL,
	clientId,
	grant,
	fetch,
	now,
}: {
	baseURL: string;
	clientId: string;
	grant: OAuthTokenGrant;
	fetch: AuthFetch;
	now: () => number;
}): Promise<OAuthTokenGrant> {
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: grant.refreshToken,
		client_id: clientId,
		resource: baseURL,
	});
	const response = await fetch(`${baseURL}/auth/oauth2/token`, {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		credentials: 'omit',
	});
	if (!response.ok) {
		throw new Error(`OAuth refresh failed with ${response.status}.`);
	}
	const data = await response.json();
	return parseOAuthTokenGrant(data, {
		now,
		fallbackRefreshToken: grant.refreshToken,
	});
}

async function revokeOAuthRefreshTokenWithEndpoint({
	baseURL,
	clientId,
	refreshToken,
	fetch,
}: {
	baseURL: string;
	clientId: string;
	refreshToken: string;
	fetch: AuthFetch;
}) {
	const body = new URLSearchParams({
		client_id: clientId,
		token: refreshToken,
		token_type_hint: 'refresh_token',
	});
	const response = await fetch(`${baseURL}/auth/oauth2/revoke`, {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		credentials: 'omit',
	});
	if (!response.ok) {
		throw new Error(`OAuth revoke failed with ${response.status}.`);
	}
}
