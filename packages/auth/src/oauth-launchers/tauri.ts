import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Ok, type Result } from 'wellcrafted/result';
import type { OAuthLauncher, OAuthLaunchResult } from './contract.js';
import {
	createOAuthClient,
	type OAuthClientConfig,
	OAuthClientError,
} from './oauth-client.js';

const DEFAULT_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Create the native deep-link launcher for desktop (Tauri) sign-in.
 *
 * Use this in Tauri apps that complete OAuth through a registered custom URL
 * scheme (for example `epicenter-whispering://auth/callback`). It installs the
 * deep-link listener before opening the system browser, then exchanges the
 * first matching callback URL for a token grant. Every Tauri app wires the same
 * three plugin calls (`getCurrent`, `onOpenUrl`, `openUrl`), so they live here
 * rather than being copied into each app's `#platform/auth` seam.
 *
 * A deep-link callback can cold-start the app, so pass a durable `storage` (for
 * example `window.localStorage`) in the config: `sessionStorage` would lose the
 * PKCE transaction across the launch.
 *
 * The `@tauri-apps/*` packages are optional peer dependencies; only Tauri apps
 * import this subpath, so a web-only consumer never pulls them in.
 */
export function createTauriDeepLinkOAuthLauncher({
	redirectUri,
	timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS,
	...config
}: OAuthClientConfig & {
	redirectUri: string;
	timeoutMs?: number;
}) {
	const client = createOAuthClient(config);
	return {
		async startSignIn() {
			// The callback URL may already be queued if it cold-started the app.
			const currentUrls = await getCurrent().catch(() => null);
			const currentCallback = currentUrls?.find((url) =>
				isRedirectUrl(url, redirectUri),
			);
			if (currentCallback) {
				const callbackResult = await client.exchangeCallback(currentCallback);
				if (callbackResult.error) return callbackResult;
				return Ok({
					status: 'completed',
					grant: callbackResult.data,
				} satisfies OAuthLaunchResult);
			}

			const urlResult = await client.createAuthorizationUrl(redirectUri);
			if (urlResult.error) return urlResult;

			const callbackUrl = await waitForRedirectUrl({
				authorizationUrl: urlResult.data.toString(),
				redirectUri,
				timeoutMs,
			});
			if (callbackUrl.error) return callbackUrl;

			const callbackResult = await client.exchangeCallback(callbackUrl.data);
			if (callbackResult.error) return callbackResult;
			return Ok({
				status: 'completed',
				grant: callbackResult.data,
			} satisfies OAuthLaunchResult);
		},
	} satisfies OAuthLauncher;
}

// Tauri can deliver arbitrary URLs for the registered scheme. Claim only the
// exact OAuth redirect endpoint when it carries an OAuth callback payload.
function isRedirectUrl(url: string, redirectUri: string): boolean {
	if (url !== redirectUri && !url.startsWith(`${redirectUri}?`)) return false;
	try {
		const callbackUrl = new URL(url);
		return (
			callbackUrl.searchParams.has('code') ||
			callbackUrl.searchParams.has('error')
		);
	} catch {
		return false;
	}
}

// Install the deep-link listener before opening the browser, then resolve the
// first matching callback URL. Token exchange happens after URL capture.
function waitForRedirectUrl({
	authorizationUrl,
	redirectUri,
	timeoutMs,
}: {
	authorizationUrl: string;
	redirectUri: string;
	timeoutMs: number;
}): Promise<Result<string, OAuthClientError>> {
	return new Promise<Result<string, OAuthClientError>>((resolve) => {
		let settled = false;
		let unlisten: UnlistenFn | null = null;

		const settle = (result: Result<string, OAuthClientError>) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			unlisten?.();
			resolve(result);
		};

		const timeout = window.setTimeout(() => {
			settle(
				OAuthClientError.LaunchFailed({
					cause: new Error('Timed out waiting for OAuth callback.'),
				}),
			);
		}, timeoutMs);

		onOpenUrl((urls) => {
			if (settled) return;
			const callbackUrl = urls.find((url) => isRedirectUrl(url, redirectUri));
			if (!callbackUrl) return;
			settle(Ok(callbackUrl));
		})
			.then((nextUnlisten) => {
				unlisten = nextUnlisten;
				return openUrl(authorizationUrl);
			})
			.catch((cause) => {
				settle(OAuthClientError.LaunchFailed({ cause }));
			});
	});
}
