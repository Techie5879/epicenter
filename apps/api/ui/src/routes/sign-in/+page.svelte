<!--
	Hosted sign-in surface.

	Signed out: social provider buttons (the static SOCIAL_PROVIDERS list; the
	server registers only the providers it has secrets for and rejects the rest
	at the call). Starting a provider POSTs Better Auth's /auth/sign-in/social
	with `oauth_query` (the signed authorize params) so an OAuth re-entry
	continues the flow after the IdP roundtrip.

	A passkey row renders when the browser exposes WebAuthn
	(PublicKeyCredential). The server side is always present because this app
	mounts the Better Auth passkey plugin. Successful authentication sets a
	standard session cookie, so a full reload with the query string intact
	re-enters the server's GET /sign-in, which already redirects `?sig=`
	sessions into the authorize flow.

	Signed in (no `sig` / safe `callbackURL`, which the server redirects before
	this renders): confirmation of which account this browser holds, passkey
	registration (the plugin requires a fresh session, so this signed-in card is
	the natural same-origin home for it), plus sign-out. Better Auth's
	/auth/sign-out rejects a bodyless POST with 415, so the request sends
	`Content-Type: application/json` and `{}`.
-->
<script lang="ts">
	import * as Alert from '@epicenter/ui/alert';
	import { Button } from '@epicenter/ui/button';
	import * as Card from '@epicenter/ui/card';
	import { Spinner } from '@epicenter/ui/spinner';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import FingerprintIcon from '@lucide/svelte/icons/fingerprint';
	import { createQuery } from '@tanstack/svelte-query';
	import AuthCard from '$lib/auth/AuthCard.svelte';
	import AuthHeader from '$lib/auth/AuthHeader.svelte';
	import ProviderButton from '$lib/auth/ProviderButton.svelte';
	import {
		authClient,
		isPasskeyCancellation,
		requiresReauth,
		supportsPasskeys,
	} from '$lib/auth/client';
	import { getOAuthQuery } from '$lib/auth/oauth-query';
	import {
		PROVIDER_LABELS,
		SOCIAL_PROVIDERS,
		type SocialProvider,
	} from '$lib/auth/providers';
	import { session, sessionKeys } from '$lib/auth/session';
	import UserIdentity from '$lib/auth/UserIdentity.svelte';
	import { queryClient } from '$lib/query/client';

	const sessionQuery = createQuery(() => session.options);
	const currentUser = $derived(sessionQuery.data?.user ?? null);

	// The backend always has the passkey plugin; the browser WebAuthn API is the
	// capability that varies by client.
	const passkeyAvailable = $derived(supportsPasskeys());

	let busy = $state(false);
	let signingOut = $state(false);
	let addingPasskey = $state(false);
	let passkeyAdded = $state(false);
	let errorMessage = $state<string | null>(null);

	async function startSocial(provider: SocialProvider) {
		errorMessage = null;
		busy = true;
		try {
			const body: Record<string, string> = {
				provider,
				callbackURL: window.location.href,
			};
			const oauthQuery = getOAuthQuery();
			if (oauthQuery) body.oauth_query = oauthQuery;

			const response = await fetch('/auth/sign-in/social', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(body),
			});

			const result: { url?: string; message?: string; error?: string } =
				await response.json().catch(() => ({}));
			if (result.url) {
				window.location.href = result.url;
				return;
			}
			if (response.redirected) {
				window.location.href = response.url;
				return;
			}
			errorMessage =
				result.message ||
				result.error ||
				`Failed to start ${PROVIDER_LABELS[provider]} sign-in.`;
			busy = false;
		} catch {
			errorMessage = 'Network error. Check your connection and try again.';
			busy = false;
		}
	}

	async function startPasskey() {
		errorMessage = null;
		busy = true;
		const { error } = await authClient.signIn.passkey();
		if (!error) {
			// Reload with the query string intact; the server's GET /sign-in sees
			// the new session cookie and continues the `?sig=` authorize re-entry
			// (or the safe callbackURL redirect) with no extra client logic.
			window.location.reload();
			return;
		}
		// A dismissed browser prompt is expected; reset quietly.
		errorMessage = isPasskeyCancellation(error)
			? null
			: (error.message ?? 'Passkey sign-in failed.');
		busy = false;
	}

	async function addPasskey() {
		errorMessage = null;
		passkeyAdded = false;
		addingPasskey = true;
		const { error } = await authClient.passkey.addPasskey();
		if (!error) {
			passkeyAdded = true;
		} else if (isPasskeyCancellation(error)) {
			// Dismissed prompt; reset quietly.
		} else if (requiresReauth(error)) {
			errorMessage = 'Sign in again to add a passkey.';
		} else {
			errorMessage = error.message ?? 'Could not add a passkey.';
		}
		addingPasskey = false;
	}

	async function signOut() {
		errorMessage = null;
		signingOut = true;
		try {
			const response = await fetch('/auth/sign-out', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: '{}',
			});
			if (!response.ok) {
				const result: { message?: string } = await response
					.json()
					.catch(() => ({}));
				throw new Error(result.message ?? `Sign-out failed (${response.status}).`);
			}
			// Refetch the session; the page re-renders as the sign-in form.
			await queryClient.invalidateQueries({ queryKey: sessionKeys.session });
		} catch (cause) {
			errorMessage =
				cause instanceof Error && cause.message
					? cause.message
					: 'Sign-out failed. Try again.';
		} finally {
			signingOut = false;
		}
	}
</script>

<svelte:head><title>Sign in: Epicenter</title></svelte:head>

<AuthCard>
	{#if sessionQuery.isLoading}
		<Card.Content class="flex justify-center py-6">
			<Spinner class="size-5" />
		</Card.Content>
	{:else if currentUser}
		<AuthHeader title="You're signed in">
			{#snippet description()}This browser is ready for Epicenter.{/snippet}
		</AuthHeader>
		<Card.Content class="flex justify-center">
			<UserIdentity user={currentUser} orientation="stack" />
		</Card.Content>
		<Card.Footer class="flex-col gap-3">
			{#if errorMessage}
				<Alert.Root variant="destructive">
					<CircleAlertIcon class="size-4" />
					<Alert.Description>{errorMessage}</Alert.Description>
				</Alert.Root>
			{/if}
			{#if passkeyAdded}
				<p class="text-sm text-muted-foreground">
					Passkey added. Use it the next time you sign in.
				</p>
			{/if}
			{#if passkeyAvailable}
				<Button
					variant="outline"
					class="w-full"
					onclick={addPasskey}
					disabled={addingPasskey || signingOut}
				>
					{#if addingPasskey}
						<Spinner class="size-3.5" />
						<span>Adding passkey</span>
					{:else}
						<FingerprintIcon class="size-4" />
						Add a passkey
					{/if}
				</Button>
			{/if}
			<Button
				variant="outline"
				class="w-full"
				onclick={signOut}
				disabled={signingOut || addingPasskey}
			>
				{#if signingOut}
					<Spinner class="size-3.5" />
					<span>Signing out</span>
				{:else}
					Sign out
				{/if}
			</Button>
		</Card.Footer>
	{:else}
		<AuthHeader title="epicenter">
			{#snippet description()}Sign in to your account{/snippet}
		</AuthHeader>
		<Card.Content class="flex flex-col gap-3">
			{#each SOCIAL_PROVIDERS as provider (provider)}
				<ProviderButton
					{provider}
					disabled={busy}
					onclick={() => startSocial(provider)}
				/>
			{/each}
			{#if passkeyAvailable}
				<Button
					variant="outline"
					size="lg"
					class="w-full"
					disabled={busy}
					onclick={startPasskey}
				>
					<FingerprintIcon class="size-4" />
					Continue with passkey
				</Button>
			{/if}
			{#if errorMessage}
				<Alert.Root variant="destructive">
					<CircleAlertIcon class="size-4" />
					<Alert.Description>{errorMessage}</Alert.Description>
				</Alert.Root>
			{/if}
		</Card.Content>
		<Card.Footer class="justify-center">
			<p class="text-sm text-muted-foreground">
				First time? Learn more at
				<a
					href="https://epicenter.so"
					class="font-medium text-foreground underline underline-offset-4"
				>
					epicenter.so
				</a>
				.
			</p>
		</Card.Footer>
	{/if}
</AuthCard>
