<script lang="ts">
	import {
		createMutation,
		createQuery,
		useQueryClient,
	} from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import EntityRail from '$lib/components/EntityRail.svelte';
	import QueryPanel from '$lib/components/QueryPanel.svelte';
	import ReportPanel from '$lib/components/ReportPanel.svelte';
	import RowDetail from '$lib/components/RowDetail.svelte';
	import RowTable from '$lib/components/RowTable.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';

	type Tab = 'browse' | 'query' | 'reports';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'browse', label: 'Browse' },
		{ id: 'query', label: 'Query' },
		{ id: 'reports', label: 'Reports' },
	];
	let tab = $state<Tab>('browse');

	let selectedEntity = $state<string | null>(null);
	let selectedRowId = $state<string | null>(null);

	const queryClient = useQueryClient();

	const status = createQuery(() => ({
		queryKey: ['status'],
		queryFn: () => api.status(),
	}));
	const entities = createQuery(() => ({
		queryKey: ['entities'],
		queryFn: () => api.entities(),
	}));
	const rows = createQuery(() => ({
		queryKey: ['rows', selectedEntity],
		queryFn: () => api.rows(selectedEntity as string, { limit: 200 }),
		enabled: selectedEntity !== null,
	}));

	const sync = createMutation(() => ({
		mutationFn: () => api.sync(),
		onSuccess: (outcome) => {
			if (outcome.failures.length > 0) {
				toast.error(`Sync finished with ${outcome.failures.length} failure(s).`);
			} else {
				const upserted = outcome.entities.reduce((n, e) => n + e.upserted, 0);
				const deleted = outcome.entities.reduce((n, e) => n + e.deleted, 0);
				toast.success(
					`${outcome.mode} sync: ${upserted} upserted, ${deleted} removed.`,
				);
			}
			queryClient.invalidateQueries({ queryKey: ['status'] });
			queryClient.invalidateQueries({ queryKey: ['entities'] });
			queryClient.invalidateQueries({ queryKey: ['rows'] });
			queryClient.invalidateQueries({ queryKey: ['row'] });
		},
		onError: (error: Error) => toast.error(error.message),
	}));

	const entityList = $derived(entities.data?.entities ?? []);
	const selectedColumns = $derived(
		entityList.find((e) => e.entity === selectedEntity)?.columns ?? [],
	);
	const syncError = $derived(sync.error?.message ?? null);

	// Default the selection to the first initialized record type (the one with rows
	// worth browsing), falling back to the first entity so the pane is never empty.
	$effect(() => {
		if (selectedEntity !== null || entityList.length === 0) return;
		const withRows = entityList.find((e) => e.initialized && e.rows > 0);
		selectedEntity = withRows?.entity ?? entityList[0]?.entity ?? null;
	});

	// Keep the row selection valid: default to the first row, and re-resolve when an
	// entity change drops the current selection out of the list.
	$effect(() => {
		const list = rows.data?.rows ?? [];
		if (list.length === 0) {
			selectedRowId = null;
			return;
		}
		if (!selectedRowId || !list.some((r) => String(r.id) === selectedRowId)) {
			selectedRowId = String(list[0]?.id);
		}
	});

	function selectEntity(entity: string) {
		selectedEntity = entity;
		selectedRowId = null;
	}
</script>

<div class="flex h-full flex-col">
	<StatusBar
		status={status.data}
		syncing={sync.isPending}
		{syncError}
		onRefresh={() => sync.mutate()}
	/>

	<div class="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-3">
		{#each TABS as t (t.id)}
			<button
				type="button"
				class="rounded px-3 py-1 text-sm {tab === t.id
					? 'bg-muted font-medium text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (tab = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<div class="flex min-h-0 flex-1">
		{#if tab === 'browse'}
			<EntityRail
				entities={entityList}
				selected={selectedEntity}
				onSelect={selectEntity}
			/>
			<RowTable
				page={rows.data}
				loading={rows.isPending && selectedEntity !== null}
				error={rows.error?.message ?? null}
				selectedId={selectedRowId}
				onSelect={(id) => (selectedRowId = id)}
			/>
			<RowDetail
				entity={selectedEntity}
				id={selectedRowId}
				columns={selectedColumns}
				readOnly={status.data?.readOnly ?? false}
			/>
		{:else if tab === 'query'}
			<QueryPanel />
		{:else}
			<ReportPanel />
		{/if}
	</div>
</div>
