<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as Field from '@epicenter/ui/field';
	import { Spinner } from '@epicenter/ui/spinner';
	import { createMutation } from '@tanstack/svelte-query';
	import { resultMutationOptions } from 'wellcrafted/query';
	import { Ok } from 'wellcrafted/result';
	import {
		connectCodexAccount,
		disconnectCodexAccount,
	} from '$lib/operations/codex-account';
	import { deviceConfig } from '$lib/state/device-config.svelte';

	const session = $derived(deviceConfig.get('auth.codex'));
	const identity = $derived(session?.email ?? session?.accountId ?? 'Connected');
	const connect = createMutation(() =>
		resultMutationOptions({
			mutationKey: ['codex-account', 'connect'],
			mutationFn: connectCodexAccount,
		}),
	);
	const disconnect = createMutation(() =>
		resultMutationOptions({
			mutationKey: ['codex-account', 'disconnect'],
			mutationFn: async () => {
				disconnectCodexAccount();
				return Ok(undefined);
			},
		}),
	);
	const pending = $derived(connect.isPending || disconnect.isPending);
	const error = $derived(connect.error ?? disconnect.error);
</script>

<Field.Field orientation="horizontal">
	<Field.Content>
		<Field.Label>ChatGPT account</Field.Label>
		<Field.Description>
			{session
				? identity
				: 'Connect your ChatGPT subscription to use Codex.'}
		</Field.Description>
		{#if error}
			<Field.Description class="text-destructive">
				{error.message}
			</Field.Description>
		{/if}
	</Field.Content>
	{#if session}
		<Button
			variant="outline"
			size="sm"
			disabled={pending}
			onclick={() => disconnect.mutate()}
		>
			{#if disconnect.isPending}<Spinner class="size-4" />{/if}
			Disconnect
		</Button>
	{:else}
		<Button size="sm" disabled={pending} onclick={() => connect.mutate()}>
			{#if connect.isPending}<Spinner class="size-4" />{/if}
			Connect ChatGPT
		</Button>
	{/if}
</Field.Field>
