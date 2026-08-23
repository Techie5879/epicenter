<script lang="ts">
	import { type InstanceSetting, normalizeInstanceUrl } from '@epicenter/auth';
	import { Button } from '@epicenter/ui/button';
	import { Input } from '@epicenter/ui/input';
	import { Label } from '@epicenter/ui/label';
	import * as Modal from '@epicenter/ui/modal';
	import { untrack } from 'svelte';

	let {
		open = $bindable(false),
		appName,
		setting,
		disabledReason,
	}: {
		open?: boolean;
		/** The app's display name, woven into the description. */
		appName: string;
		/** The shared instance setting handle this app injected. */
		setting: InstanceSetting;
		/**
		 * When set, saving and switching are disabled and this reason is shown. A
		 * host can block the page-reloading save while the modal is already open,
		 * e.g. Whispering when a recording starts on a global hotkey. Omit to leave
		 * the actions enabled.
		 */
		disabledReason?: string;
	} = $props();

	// Seed the form from the snapshot once; saving reloads so auth construction
	// re-reads the new instance, so there is no live value to track. `hasOverride`
	// only gates the "Use hosted" button, so it stays a derived read of the stable
	// handle.
	let urlInput = $state(
		untrack(() => (setting.isDefault() ? '' : setting.read().baseURL)),
	);
	let tokenInput = $state(untrack(() => setting.read().token ?? ''));
	let error = $state<string | null>(null);
	// URL-field feedback, distinct from the save-level `error` (token/reload): a
	// blur-time validation message, or a preview of the normalized target when it
	// differs from what was typed.
	let urlError = $state<string | null>(null);
	let willConnectTo = $state<string | null>(null);
	const hasOverride = $derived(!setting.isDefault());
	// Both actions reload the page, which would interrupt whatever the host is
	// guarding (a live recording), so a host lock disables them while the modal
	// stays open and readable.
	const accountLocked = $derived(!!disabledReason);

	// Validate and normalize the URL as the user leaves the field, previewing the
	// normalized target when it differs from what was typed. A bare host silently
	// gains `https://`, which would break an http-only homelab box; showing what
	// it resolves to surfaces that while the field is still editable, instead of
	// after a failed reload.
	function checkUrl() {
		const { data, error: urlErr } = normalizeInstanceUrl(urlInput);
		urlError = urlErr?.message ?? null;
		willConnectTo = data && data !== urlInput.trim() ? data : null;
	}

	// No pre-save connection test: the post-save reload's signed-out gate reports
	// connected-or-failed from the auth client's own boot check, so one surface
	// verifies the credential, not two.
	async function save() {
		const { data: baseURL, error: urlErr } = normalizeInstanceUrl(urlInput);
		if (urlErr) {
			urlError = urlErr.message;
			willConnectTo = null;
			return;
		}
		urlError = null;
		// ADR-0071: OAuth is hosted-only, so a self-hosted instance must carry the
		// token its box minted. There is no "leave blank to OAuth against this
		// origin" path.
		const token = tokenInput.trim();
		if (!token) {
			error = 'Paste the token your instance printed on first boot.';
			return;
		}
		error = null;
		await setting.write({ baseURL, token });
		location.reload();
	}

	async function useHosted() {
		await setting.clear();
		location.reload();
	}
</script>

<Modal.Root bind:open>
	<Modal.Content class="sm:max-w-md">
		<Modal.Header>
			<Modal.Title>Connect to a self-hosted instance</Modal.Title>
			<Modal.Description>
				Point {appName} at your own Epicenter instance. Your data and token go
				straight to it; nothing passes through the hosted cloud.
			</Modal.Description>
		</Modal.Header>
		<div class="flex flex-col gap-4">
			<div class="space-y-1.5">
				<Label for="instance-url">Instance URL</Label>
				<Input
					id="instance-url"
					bind:value={urlInput}
					onblur={checkUrl}
					aria-invalid={urlError ? true : undefined}
					placeholder="http://localhost:8788"
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
				/>
				{#if urlError}
					<p class="text-xs text-destructive">{urlError}</p>
				{:else if willConnectTo}
					<p class="text-xs text-muted-foreground">
						Will connect to {willConnectTo}
					</p>
				{/if}
			</div>
			<div class="space-y-1.5">
				<Label for="instance-token">Instance token</Label>
				<Input
					id="instance-token"
					type="password"
					bind:value={tokenInput}
					placeholder="Paste the token your instance printed"
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">
					Your instance prints this token the first time it boots.
				</p>
			</div>
			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
			{#if disabledReason}
				<p class="text-xs text-muted-foreground">{disabledReason}</p>
			{/if}
		</div>
		<Modal.Footer class="flex-col gap-2 sm:flex-row sm:justify-between">
			{#if hasOverride}
				<Button
					variant="ghost"
					type="button"
					onclick={useHosted}
					disabled={accountLocked}
				>
					Use hosted Epicenter
				</Button>
			{/if}
			<Button
				class="sm:ml-auto"
				type="button"
				onclick={save}
				disabled={accountLocked}
			>
				Save and reload
			</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
