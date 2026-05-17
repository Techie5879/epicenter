import * as oauth from 'oauth4webapi';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { OAuthTokenGrant } from '../auth-types.js';
import type { AuthFetch } from '../create-oauth-app-auth.js';
import {
	OAuthTokenResponseError,
	parseOAuthTokenGrant,
} from '../oauth-token-response.js';

export const OAuthClientError = defineErrors({
	MissingCallbackTransaction: () => ({
		message:
			'OAuth sign-in could not finish because callback state was missing.',
	}),
	StateMismatch: () => ({
		message: 'OAuth sign-in state did not match.',
	}),
	AuthorizationFailed: ({
		error,
		description,
	}: {
		error: string;
		description: string | null;
	}) => ({
		message: description
			? `OAuth authorization failed: ${description}`
			: `OAuth authorization failed: ${error}`,
		error,
		description,
	}),
	TokenExchangeFailed: ({ cause }: { cause: unknown }) => ({
		message: `OAuth token exchange failed: ${extractErrorMessage(cause)}`,
		cause,
	}),
	MissingAccessToken: () => ({
		message: 'OAuth token exchange did not return an access token.',
	}),
	MissingRefreshToken: () => ({
		message: 'OAuth token exchange did not return a refresh token.',
	}),
	MissingExpiresIn: () => ({
		message: 'OAuth token exchange did not return an access-token lifetime.',
	}),
	LaunchFailed: ({ cause }: { cause: unknown }) => ({
		message: `OAuth sign-in launch failed: ${extractErrorMessage(cause)}`,
		cause,
	}),
});

export type OAuthClientError = InferErrors<typeof OAuthClientError>;

export type OAuthTemporaryStorage = {
	getItem(key: string): MaybePromise<string | null>;
	setItem(key: string, value: string): MaybePromise<void>;
	removeItem(key: string): MaybePromise<void>;
};

export type OAuthClientConfig = {
	issuer: string;
	clientId: string;
	redirectUri: string;
	resource: string;
	scope?: string;
	storage: OAuthTemporaryStorage;
	fetch?: AuthFetch;
};

export type OAuthLauncher = {
	startSignIn(): Promise<Result<OAuthTokenGrant | null, OAuthClientError>>;
};

type MaybePromise<T> = T | Promise<T>;

type OAuthTransaction = {
	state: string;
	codeVerifier: string;
	redirectUri: string;
};

type RedirectTo = (url: string) => MaybePromise<void>;
type LaunchWebAuthFlow = (url: string) => Promise<string>;

const DEFAULT_SCOPE = 'openid profile email offline_access workspaces:open';

export function createBrowserOAuthLauncher({
	redirectTo = (url) => {
		window.location.href = url;
	},
	...config
}: OAuthClientConfig & {
	redirectTo?: RedirectTo;
}) {
	const client = createOAuthClient(config);
	return {
		async startSignIn() {
			const callbackResult = await client.handleCallback(window.location.href);
			if (callbackResult.data) return callbackResult;
			if (callbackResult.error?.name !== 'MissingCallbackTransaction') {
				return callbackResult;
			}

			const urlResult = await client.createAuthorizationUrl();
			if (urlResult.error) return urlResult;
			await redirectTo(urlResult.data.toString());
			return Ok(null);
		},
	} satisfies OAuthLauncher;
}

export function createExtensionOAuthLauncher({
	launchWebAuthFlow,
	...config
}: OAuthClientConfig & {
	launchWebAuthFlow: LaunchWebAuthFlow;
}) {
	const client = createOAuthClient(config);
	return {
		async startSignIn() {
			const urlResult = await client.createAuthorizationUrl();
			if (urlResult.error) return urlResult;

			try {
				const responseUrl = await launchWebAuthFlow(urlResult.data.toString());
				return await client.handleCallback(responseUrl);
			} catch (cause) {
				return OAuthClientError.LaunchFailed({ cause });
			}
		},
	} satisfies OAuthLauncher;
}

export function createOAuthClient({
	issuer,
	clientId,
	redirectUri,
	resource,
	scope = DEFAULT_SCOPE,
	storage,
	fetch: fetchImpl,
}: OAuthClientConfig) {
	const storageKey = `epicenter.oauth.${clientId}`;
	const client: oauth.Client = {
		client_id: clientId,
		token_endpoint_auth_method: 'none',
	};

	const httpOptions = {
		[oauth.allowInsecureRequests]: new URL(issuer).protocol === 'http:',
		...(fetchImpl ? { [oauth.customFetch]: fetchImpl } : {}),
	};

	async function discover() {
		const issuerUrl = new URL(issuer);
		const response = await oauth.discoveryRequest(issuerUrl, {
			algorithm: 'oauth2',
			...httpOptions,
		});
		return await oauth.processDiscoveryResponse(issuerUrl, response);
	}

	async function createAuthorizationUrl(): Promise<
		Result<URL, OAuthClientError>
	> {
		try {
			const as = await discover();
			const state = oauth.generateRandomState();
			const codeVerifier = oauth.generateRandomCodeVerifier();
			const codeChallenge =
				await oauth.calculatePKCECodeChallenge(codeVerifier);
			await writeTransaction({
				state,
				codeVerifier,
				redirectUri,
			});

			const authorizationEndpoint = as.authorization_endpoint;
			if (!authorizationEndpoint) {
				throw new Error('Authorization endpoint is missing.');
			}

			const url = new URL(authorizationEndpoint);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('client_id', clientId);
			url.searchParams.set('redirect_uri', redirectUri);
			url.searchParams.set('scope', scope);
			url.searchParams.set('state', state);
			url.searchParams.set('code_challenge', codeChallenge);
			url.searchParams.set('code_challenge_method', 'S256');
			url.searchParams.set('resource', resource);
			return Ok(url);
		} catch (cause) {
			return OAuthClientError.LaunchFailed({ cause });
		}
	}

	async function handleCallback(
		url: string | URL,
	): Promise<Result<OAuthTokenGrant | null, OAuthClientError>> {
		const callbackUrl = new URL(url);
		if (
			!callbackUrl.searchParams.has('code') &&
			!callbackUrl.searchParams.has('error')
		) {
			return OAuthClientError.MissingCallbackTransaction();
		}

		const callbackError = callbackUrl.searchParams.get('error');
		if (callbackError) {
			return OAuthClientError.AuthorizationFailed({
				error: callbackError,
				description: callbackUrl.searchParams.get('error_description'),
			});
		}

		const transaction = await readTransaction();
		if (!transaction) return OAuthClientError.MissingCallbackTransaction();

		try {
			const as = await discover();
			if (callbackUrl.searchParams.get('state') !== transaction.state) {
				return OAuthClientError.StateMismatch();
			}
			const params = oauth.validateAuthResponse(
				as,
				client,
				callbackUrl,
				transaction.state,
			);
			const response = await oauth.authorizationCodeGrantRequest(
				as,
				client,
				oauth.None(),
				params,
				transaction.redirectUri,
				transaction.codeVerifier,
				{
					additionalParameters: { resource },
					...httpOptions,
				},
			);
			const tokenResponse = await oauth.processAuthorizationCodeResponse(
				as,
				client,
				response,
			);
			const tokenResult = parseTokenResult(tokenResponse);
			if (tokenResult.error) return tokenResult;

			await storage.removeItem(storageKey);
			return tokenResult;
		} catch (cause) {
			return OAuthClientError.TokenExchangeFailed({ cause });
		}
	}

	async function writeTransaction(transaction: OAuthTransaction) {
		await storage.setItem(storageKey, JSON.stringify(transaction));
	}

	async function readTransaction(): Promise<OAuthTransaction | null> {
		const raw = await storage.getItem(storageKey);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as Partial<OAuthTransaction>;
			if (
				typeof parsed.state !== 'string' ||
				typeof parsed.codeVerifier !== 'string' ||
				typeof parsed.redirectUri !== 'string'
			) {
				return null;
			}
			return {
				state: parsed.state,
				codeVerifier: parsed.codeVerifier,
				redirectUri: parsed.redirectUri,
			};
		} catch {
			return null;
		}
	}

	return {
		createAuthorizationUrl,
		handleCallback,
	};
}

function parseTokenResult(
	tokenResponse: oauth.TokenEndpointResponse,
): Result<OAuthTokenGrant, OAuthClientError> {
	try {
		return Ok(parseOAuthTokenGrant(tokenResponse, { now: Date.now }));
	} catch (cause) {
		if (cause instanceof OAuthTokenResponseError) {
			switch (cause.issue) {
				case 'missing_access_token':
					return OAuthClientError.MissingAccessToken();
				case 'missing_refresh_token':
					return OAuthClientError.MissingRefreshToken();
				case 'missing_expires_in':
					return OAuthClientError.MissingExpiresIn();
				case 'invalid_response':
				case 'invalid_token_type':
					return OAuthClientError.TokenExchangeFailed({ cause });
			}
		}
		return OAuthClientError.TokenExchangeFailed({ cause });
	}
}
