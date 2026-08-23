<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';
	import type { ConversationHandle } from './agent-chat.svelte.js';

	let {
		conversation,
		onSignIn,
		onUpgrade,
	}: {
		/** The active conversation whose error state drives the banner. */
		conversation: ConversationHandle;
		/** Open the app's sign-in flow (the turn failed with HTTP 401). Omit to hide
		 * the Sign In button (apps without a sign-in surface still get the message). */
		onSignIn?: () => void;
		/** Open the app's upgrade/billing flow (the turn failed with HTTP 402). Omit
		 * to hide the Upgrade button (the message still shows). */
		onUpgrade?: () => void;
	} = $props();

	const bannerClass =
		'flex items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive';
	const actionClass =
		'h-6 gap-1 px-2 text-xs text-destructive hover:text-destructive';
</script>

<!-- Auth and credits are persistent prompts (no dismiss); every other failure is
     dismissable and retryable. Retry and dismiss are wired straight to the handle,
     so the only app-specific parts are the sign-in and upgrade destinations. -->
{#if conversation.isUnauthorized}
	<div role="alert" class={bannerClass}>
		<span class="min-w-0 flex-1">Sign in to use AI Chat</span>
		{#if onSignIn}
			<Button variant="ghost" size="sm" class={actionClass} onclick={onSignIn}>
				<LogInIcon class="size-3" />
				Sign In
			</Button>
		{/if}
	</div>
{:else if conversation.isCreditsExhausted}
	<div role="alert" class={bannerClass}>
		<span class="min-w-0 flex-1">You're out of credits</span>
		{#if onUpgrade}
			<Button variant="ghost" size="sm" class={actionClass} onclick={onUpgrade}>
				Upgrade
			</Button>
		{/if}
	</div>
{:else if conversation.visibleError}
	<div role="alert" class={bannerClass}>
		<span class="min-w-0 flex-1">{conversation.visibleError.message}</span>
		<div class="flex shrink-0 items-center gap-1">
			<Button
				variant="ghost"
				size="sm"
				class={actionClass}
				onclick={() => conversation.reload()}
			>
				<RotateCcwIcon class="size-3" />
				Retry
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="text-destructive hover:text-destructive"
				onclick={() => conversation.dismissError()}
			>
				<XIcon class="size-3" />
			</Button>
		</div>
	</div>
{/if}
