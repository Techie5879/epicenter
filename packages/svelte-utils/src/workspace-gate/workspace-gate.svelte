<!--
	Render gate that blocks children until `pending` resolves.

	Composition: defaults the loading state to <Loading> (the same shell
	used by pre-auth layouts) so the moment children mount is the only
	visible transition. The error state defaults to a workspace-flavored
	Empty.Root with Reload, Forget this device, and Sign out actions.

	Both branches accept snippet overrides for apps that need different chrome.
	Mount <ConfirmationDialog> once in the app layout when using onForgetDevice.

	@example
	```svelte
	<script lang="ts">
		import { WorkspaceGate } from '@epicenter/svelte/workspace-gate';
		import { auth, fuji } from '$lib/fuji/client';
	</script>

	<WorkspaceGate
		pending={fuji.idb.whenLoaded}
		onForgetDevice={() => fuji.wipe()}
		onSignOut={() => auth.signOut()}
	>
		{@render children?.()}
	</WorkspaceGate>
	```
-->
<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { confirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import * as Empty from '@epicenter/ui/empty';
	import { Loading } from '@epicenter/ui/loading';
	import { toast } from '@epicenter/ui/sonner';
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';
	import { extractErrorMessage } from 'wellcrafted/error';

	let {
		pending,
		children,
		loading,
		error,
		onForgetDevice,
		onSignOut,
	}: {
		/** Promise the gate awaits before rendering children. */
		pending: Promise<unknown>;
		/** Children rendered after `pending` resolves. */
		children: Snippet;
		/** Override for the loading branch. Defaults to <Loading>. */
		loading?: Snippet;
		/** Override for the error branch. Receives the rejection reason. */
		error?: Snippet<[unknown]>;
		/**
		 * If provided, the default error branch shows a Forget this device
		 * button. The callback is the destructive primitive (typically the
		 * workspace bundle's `wipe()`). The gate confirms with the user,
		 * awaits the callback, then reloads the page; reload after wipe is
		 * universal in this context so the component owns it rather than
		 * asking every caller to remember.
		 */
		onForgetDevice?: () => void | Promise<void>;
		/**
		 * If provided, the default error branch shows a Sign out button that
		 * invokes this callback. Omit on apps that have no auth (or where the
		 * gate runs above auth).
		 */
		onSignOut?: () => void;
	} = $props();

	let forgettingDevice = $state(false);

	function openForgetDeviceDialog() {
		if (!onForgetDevice) return;
		confirmationDialog.open({
			title: 'Forget this device?',
			description:
				'This deletes local data for this account on this device. Synced data stays in your account.',
			confirm: { text: 'Forget device', variant: 'destructive' },
			onConfirm: async () => {
				forgettingDevice = true;
				try {
					await onForgetDevice();
					window.location.reload();
				} catch (error) {
					toast.error('Failed to forget this device', {
						description: extractErrorMessage(error),
					});
				} finally {
					forgettingDevice = false;
				}
			},
		});
	}
</script>

{#await pending}
	{#if loading}
		{@render loading()}
	{:else}
		<Loading class="h-dvh" />
	{/if}
{:then _}
	{@render children()}
{:catch err}
	{#if error}
		{@render error(err)}
	{:else}
		<Empty.Root class="h-dvh flex-none border-0">
			<Empty.Media>
				<TriangleAlertIcon class="size-8 text-muted-foreground" />
			</Empty.Media>
			<Empty.Title>Failed to load workspace</Empty.Title>
			<Empty.Description>
				{err instanceof Error
					? err.message
					: 'The workspace could not be opened.'}
			</Empty.Description>
			<Empty.Content>
				<div class="flex flex-wrap items-center justify-center gap-2">
					<Button variant="outline" onclick={() => window.location.reload()}>
						<RefreshCwIcon class="size-4" />
						Reload
					</Button>
					{#if onForgetDevice}
						<Button
							variant="destructive"
							onclick={openForgetDeviceDialog}
							disabled={forgettingDevice}
						>
							{#if forgettingDevice}
								<LoaderCircleIcon class="size-4 animate-spin" />
							{:else}
								<DatabaseZapIcon class="size-4" />
							{/if}
							Forget this device
						</Button>
					{/if}
					{#if onSignOut}
						<Button variant="ghost" onclick={onSignOut}>
							<LogOutIcon class="size-4" />
							Sign out
						</Button>
					{/if}
				</div>
			</Empty.Content>
		</Empty.Root>
	{/if}
{/await}
