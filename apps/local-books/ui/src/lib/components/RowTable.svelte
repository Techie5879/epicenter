<script lang="ts">
	import * as Empty from '@epicenter/ui/empty';
	import { Loading } from '@epicenter/ui/loading';
	import * as Table from '@epicenter/ui/table';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { columnLabel, formatCell, numberFmt } from '$lib/format';
	import type { EntityRowsPage } from '$lib/types';

	let {
		page,
		loading,
		error,
		selectedId,
		onSelect,
	}: {
		page: EntityRowsPage | undefined;
		loading: boolean;
		error: string | null;
		selectedId: string | null;
		onSelect: (id: string) => void;
	} = $props();

	const columns = $derived(page?.columns ?? []);
	const rows = $derived(page?.rows ?? []);
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div
		class="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-xs text-muted-foreground"
	>
		{#if page}
			<span>{page.entity}</span>
			<span class="tabular-nums">
				{numberFmt.format(rows.length)} of {numberFmt.format(page.total)} rows
			</span>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		{#if error}
			<Empty.Root class="h-full border-0">
				<Empty.Media variant="icon">
					<TriangleAlertIcon class="size-5 text-destructive" />
				</Empty.Media>
				<Empty.Title>Could not load rows</Empty.Title>
				<Empty.Description>{error}</Empty.Description>
			</Empty.Root>
		{:else if loading}
			<Loading class="h-full" label="Loading rows" />
		{:else if rows.length === 0}
			<Empty.Root class="h-full border-0">
				<Empty.Media variant="icon">
					<DatabaseIcon class="size-5" />
				</Empty.Media>
				<Empty.Title>No rows</Empty.Title>
				<Empty.Description>This record type may not be synced yet.</Empty.Description>
			</Empty.Root>
		{:else}
			<Table.Root class="text-sm">
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-24 font-mono text-xs">id</Table.Head>
						{#each columns as column (column.name)}
							<Table.Head class="capitalize {column.type === 'REAL' ? 'text-right' : ''}">
								{columnLabel(column.name)}
							</Table.Head>
						{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.id)}
						<Table.Row
							class="cursor-pointer {selectedId === String(row.id) ? 'bg-muted' : ''} {row.deleted === 1 ? 'text-muted-foreground line-through' : ''}"
							onclick={() => onSelect(String(row.id))}
						>
							<Table.Cell class="font-mono text-xs">{row.id}</Table.Cell>
							{#each columns as column (column.name)}
								<Table.Cell class={column.type === 'REAL' ? 'text-right tabular-nums' : ''}>
									{formatCell(row[column.name], column)}
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
