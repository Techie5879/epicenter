<script lang="ts">
	import type { AuthClient } from '@epicenter/auth';
	import { Button } from '@epicenter/ui/button';
	import { Spinner } from '@epicenter/ui/spinner';
	import Cloud from '@lucide/svelte/icons/cloud';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Server from '@lucide/svelte/icons/server';

	/**
	 * The signed-out panel inside the account popover, the app's only auth
	 * surface (ADR-0088).
	 *
	 * Renders entirely from `auth.deployment`: a hosted deployment gets the
	 * hosted sign-in action, a self-hosted one gets the connect/retry action
	 * and the live connection copy. All wording lives here; the parent passes
	 * only what varies per app (the sync noun).
	 */
	type SignInPanelProps = {
		/** The app's auth client; its `startSignIn` drives the primary button. */
		auth: AuthClient;
		/** Noun describing what gets synced, e.g. "tabs" or "notes". */
		syncNoun: string;
		/**
		 * Open the instance-settings modal. The popover owns that modal, not this
		 * component, because its lifetime differs: it is root-mounted beside the
		 * popover so closing the popover cannot tear an open modal down.
		 */
		onConfigure: () => void;
		/**
		 * When set, the primary sign-in and the connect/change actions are
		 * disabled, and the reason is shown as a muted line. Lets a host block a
		 * page-reloading account change at an unsafe moment, e.g. Whispering during
		 * a recording. Omit to leave the actions enabled.
		 */
		disabledReason?: string;
	};

	let {
		auth,
		syncNoun,
		onConfigure,
		disabledReason,
	}: SignInPanelProps = $props();

	let signingIn = $state(false);
	let signInError = $state<string | null>(null);
	const accountLocked = $derived(!!disabledReason);
	// The deployment is the one owner of the hosted vs self-hosted fact: a
	// self-hosted deployment flips the labels from "sign in / connect" to
	// "retry / change". Fixed at construction; it only changes across a reload.
	const selfHosted = $derived(
		auth.deployment.kind === 'self-hosted' ? auth.deployment : undefined,
	);
	const host = $derived(
		selfHosted ? new URL(selfHosted.baseURL).host : undefined,
	);

	// A self-hosted deployment reports whether the configured instance accepted
	// its token; hosted OAuth has no such channel and falls back to the generic
	// startSignIn error rendered below.
	const connectionNotice = $derived.by(() => {
		if (!selfHosted) return null;
		switch (selfHosted.connection.status) {
			case 'connecting':
				return {
					text: `Connecting to ${host}…`,
					tone: 'text-muted-foreground',
				};
			case 'rejected':
				return {
					text: `${host} rejected the saved token.`,
					tone: 'text-destructive',
				};
			case 'unreachable':
				return {
					text: `Couldn't reach ${host}. Check the URL and that your server is running.`,
					tone: 'text-destructive',
				};
			case 'connected':
				return null;
		}
	});
	// Busy while the boot check is still connecting or a manual retry is in
	// flight. A pending boot check has no ceiling here: `fetch` has no default
	// timeout, so a box that accepts the socket but never answers leaves this on
	// "Connecting…" until the browser's own timeout fires. Refused connections
	// and 401s fail fast, so the common failures self-heal into a retryable state.
	const busy = $derived(
		signingIn || selfHosted?.connection.status === 'connecting',
	);

	// One sign-in surface: the primary button and the "retry" action are the same
	// `auth.startSignIn()`, whose meaning (hosted OAuth vs. verifying the saved
	// token) is fixed by the constructed client, so the label follows the
	// deployment kind.
	async function startSignIn() {
		signInError = null;
		signingIn = true;
		try {
			const { error } = await auth.startSignIn();
			if (error) signInError = error.message;
		} finally {
			signingIn = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="space-y-1">
		<p class="text-sm font-medium">
			{selfHosted ? `Connect to ${host}` : 'Sync across devices'}
		</p>
		<p class="text-xs leading-relaxed text-muted-foreground">
			{selfHosted
				? 'Sign in to your self-hosted instance.'
				: `Your ${syncNoun} live on this device. Sign in to sync them to your other devices.`}
		</p>
	</div>
	{#if disabledReason}
		<p class="text-xs text-muted-foreground">{disabledReason}</p>
	{/if}
	{#if connectionNotice}
		<p class="text-xs {connectionNotice.tone}">{connectionNotice.text}</p>
	{:else if signInError}
		<p class="text-xs text-destructive">{signInError}</p>
	{/if}
	<Button class="w-full" disabled={busy || accountLocked} onclick={startSignIn}>
		{#if busy}
			<Spinner class="size-4" />
			{selfHosted ? 'Connecting…' : 'Signing in…'}
		{:else if auth.state.status === 'reauth-required'}
			Reconnect
		{:else if selfHosted}
			<RefreshCw class="size-4" />
			Retry connection
		{:else}
			<Cloud class="size-4" />
			Sign in with Epicenter
		{/if}
	</Button>
	<!-- Self-host is a real mode (Cloud vs Server names the deployments), but
	     hosted sign-in is the common path, so the instance action reads like
	     the signed-in panel's utility rows instead of competing as a peer
	     button. -->
	<div class="border-t pt-3">
		<Button
			variant="ghost"
			size="sm"
			class="w-full justify-start text-muted-foreground hover:text-foreground"
			disabled={accountLocked}
			onclick={onConfigure}
		>
			<Server class="size-3.5" />
			{selfHosted ? 'Change instance' : 'Use a self-hosted instance'}
		</Button>
	</div>
</div>
