import { Ok } from 'wellcrafted/result';
import type { OAuthLauncher, OAuthLaunchResult } from './contract.js';
import {
	createOAuthClient,
	type MaybePromise,
	type OAuthClientConfig,
	OAuthClientError,
} from './oauth-client.js';

/**
 * Create the browser redirect launcher for hosted sign-in.
 *
 * Use this in web apps that can complete OAuth by returning to their own
 * redirect URI. It first tries to consume the current URL as a callback, then
 * starts a new authorization request only when no callback transaction is
 * present. That preserves the PKCE/state invariant across a full-page redirect
 * without exposing tokens to application routing code.
 */
export function createBrowserOAuthLauncher({
	redirectTo = (url) => {
		window.location.href = url;
	},
	redirectUri,
	...config
}: OAuthClientConfig & {
	redirectUri: string;
	redirectTo?: (url: string) => MaybePromise<void>;
}) {
	const client = createOAuthClient(config);
	return {
		async startSignIn() {
			const callbackParams = new URL(window.location.href).searchParams;
			if (callbackParams.has('code') || callbackParams.has('error')) {
				const callbackResult = await client.exchangeCallback(
					window.location.href,
				);
				if (callbackResult.error) return callbackResult;
				return Ok({
					status: 'completed',
					grant: callbackResult.data,
				} satisfies OAuthLaunchResult);
			}

			const urlResult = await client.createAuthorizationUrl(redirectUri);
			if (urlResult.error) return urlResult;
			await redirectTo(urlResult.data.toString());
			return Ok({ status: 'launched' } satisfies OAuthLaunchResult);
		},
	} satisfies OAuthLauncher;
}

/**
 * Create the extension launcher around the browser extension web-auth API.
 *
 * Use this when the runtime can open the hosted authorization URL and return
 * the final redirect URL without navigating the extension UI. It keeps the same
 * PKCE/state transaction as the browser launcher, but the token grant is
 * returned directly so the extension can persist it without relying on page
 * reloads.
 */
export function createExtensionOAuthLauncher({
	launchWebAuthFlow,
	redirectUri,
	...config
}: OAuthClientConfig & {
	redirectUri: string;
	launchWebAuthFlow: (url: string) => Promise<string>;
}) {
	const client = createOAuthClient(config);
	return {
		async startSignIn() {
			const urlResult = await client.createAuthorizationUrl(redirectUri);
			if (urlResult.error) return urlResult;

			try {
				const responseUrl = await launchWebAuthFlow(urlResult.data.toString());
				const callbackResult = await client.exchangeCallback(responseUrl);
				if (callbackResult.error) return callbackResult;
				return Ok({
					status: 'completed',
					grant: callbackResult.data,
				} satisfies OAuthLaunchResult);
			} catch (cause) {
				return OAuthClientError.LaunchFailed({ cause });
			}
		},
	} satisfies OAuthLauncher;
}
