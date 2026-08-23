<script lang="ts">
	import { Badge } from '@epicenter/ui/badge';
	import { Button } from '@epicenter/ui/button';
	import * as Empty from '@epicenter/ui/empty';
	import { Input } from '@epicenter/ui/input';
	import { Loading } from '@epicenter/ui/loading';
	import {
		createMutation,
		createQuery,
		useQueryClient,
	} from '@tanstack/svelte-query';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { columnLabel, formatCell, shortTimestamp } from '$lib/format';
	import type { EntityColumn } from '$lib/types';

	let {
		entity,
		id,
		columns,
		readOnly,
	}: {
		entity: string | null;
		id: string | null;
		columns: EntityColumn[];
		readOnly: boolean;
	} = $props();

	const queryClient = useQueryClient();

	const detail = createQuery(() => ({
		queryKey: ['row', entity, id],
		queryFn: () => api.row(entity as string, id as string),
		enabled: entity !== null && id !== null,
	}));

	// Recategorize is the one QuickBooks write, and only expense transactions carry
	// an account-based line. Hidden when read-only or for any other record type.
	const canRecategorize = $derived(
		!readOnly && (entity === 'Purchase' || entity === 'Bill'),
	);

	let targetAccountId = $state('');
	let targetAccountName = $state('');

	const recategorize = createMutation(() => ({
		mutationFn: () =>
			api.recategorize({
				entity: entity as 'Purchase' | 'Bill',
				id: id as string,
				account_id: targetAccountId.trim(),
				account_name: targetAccountName.trim() || undefined,
			}),
		onSuccess: (result) => {
			const moves = result.changed
				.map((c) => `${c.fromAccount ?? '(none)'} → ${c.toAccount}`)
				.join(', ');
			toast.success(`Recategorized ${result.entity} ${result.id}: ${moves}`);
			targetAccountId = '';
			targetAccountName = '';
			queryClient.invalidateQueries({ queryKey: ['row', entity, id] });
			queryClient.invalidateQueries({ queryKey: ['rows'] });
			queryClient.invalidateQueries({ queryKey: ['entities'] });
		},
		onError: (error: Error) => toast.error(error.message),
	}));

	const rawJson = $derived(
		detail.data ? JSON.stringify(detail.data.raw, null, 2) : '',
	);
</script>

<aside class="flex w-96 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
	{#if !entity || !id}
		<Empty.Root class="flex-1 border-0">
			<Empty.Media variant="icon">
				<MousePointerClickIcon class="size-5" />
			</Empty.Media>
			<Empty.Title>No row selected</Empty.Title>
			<Empty.Description>Select a row to inspect it.</Empty.Description>
		</Empty.Root>
	{:else if detail.isPending}
		<Loading class="flex-1" label="Loading row" />
	{:else if detail.error}
		<Empty.Root class="flex-1 border-0">
			<Empty.Media variant="icon">
				<TriangleAlertIcon class="size-5 text-destructive" />
			</Empty.Media>
			<Empty.Title>Could not load row</Empty.Title>
			<Empty.Description>{detail.error.message}</Empty.Description>
		</Empty.Root>
	{:else if detail.data}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<header class="border-b border-border px-4 py-3">
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold">{detail.data.entity}</span>
					<span class="font-mono text-xs text-muted-foreground">{detail.data.id}</span>
					{#if detail.data.deleted}
						<Badge variant="outline" class="text-amber-500">deleted</Badge>
					{/if}
				</div>
				<div class="mt-1 text-xs text-muted-foreground">
					updated {shortTimestamp(detail.data.updatedAt)} · synced {shortTimestamp(
						detail.data.syncedAt,
					)}
				</div>
			</header>

			{#if columns.length > 0}
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-4 py-3 text-sm">
					{#each columns as column (column.name)}
						<dt class="capitalize text-muted-foreground">{columnLabel(column.name)}</dt>
						<dd class="truncate text-right tabular-nums">
							{formatCell(detail.data.columns[column.name], column)}
						</dd>
					{/each}
				</dl>
			{/if}

			{#if canRecategorize}
				<form
					class="border-b border-border px-4 py-3"
					onsubmit={(e) => {
						e.preventDefault();
						if (targetAccountId.trim()) recategorize.mutate();
					}}
				>
					<p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Recategorize
					</p>
					<div class="space-y-2">
						<Input
							bind:value={targetAccountId}
							placeholder="Target account id (accounts row id)"
							class="h-8 text-sm"
						/>
						<Input
							bind:value={targetAccountName}
							placeholder="Target account name (optional)"
							class="h-8 text-sm"
						/>
						<Button
							type="submit"
							size="sm"
							variant="outline"
							disabled={!targetAccountId.trim() || recategorize.isPending}
							class="w-full"
						>
							Move every expense line to this account
						</Button>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						Writes through to QuickBooks, then folds the response into the mirror.
					</p>
				</form>
			{/if}

			<div class="min-h-0 flex-1 px-4 py-3">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Raw QuickBooks JSON
				</p>
				<pre class="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-xs">{rawJson}</pre>
			</div>
		</div>
	{/if}
</aside>
