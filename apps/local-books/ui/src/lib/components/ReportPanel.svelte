<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { Input } from '@epicenter/ui/input';
	import { Spinner } from '@epicenter/ui/spinner';
	import { createMutation } from '@tanstack/svelte-query';
	import { api, type ReportInput } from '$lib/api';

	// The live statements QuickBooks computes. Read live, never mirrored: there is
	// no change feed for a report, so a cached copy would be a stale snapshot.
	const REPORTS: ReportInput['report'][] = [
		'ProfitAndLoss',
		'BalanceSheet',
		'CashFlow',
		'AgedReceivables',
		'AgedPayables',
		'TrialBalance',
	];

	let report = $state<ReportInput['report']>('ProfitAndLoss');
	let startDate = $state('');
	let endDate = $state('');
	let method = $state<'' | 'Cash' | 'Accrual'>('');

	const run = createMutation(() => ({
		mutationFn: (input: ReportInput) => api.report(input),
	}));

	function submit() {
		run.mutate({
			report,
			start_date: startDate.trim() || undefined,
			end_date: endDate.trim() || undefined,
			accounting_method: method || undefined,
		});
	}

	const json = $derived(run.data ? JSON.stringify(run.data, null, 2) : '');
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<form
		class="flex shrink-0 flex-wrap items-end gap-3 border-b border-border p-3"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<label class="flex flex-col gap-1 text-xs text-muted-foreground">
			Report
			<select
				bind:value={report}
				class="h-8 rounded border border-input bg-background px-2 text-sm text-foreground"
			>
				{#each REPORTS as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-muted-foreground">
			Start
			<Input type="date" bind:value={startDate} class="h-8 w-40 text-sm" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-muted-foreground">
			End
			<Input type="date" bind:value={endDate} class="h-8 w-40 text-sm" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-muted-foreground">
			Basis
			<select
				bind:value={method}
				class="h-8 rounded border border-input bg-background px-2 text-sm text-foreground"
			>
				<option value="">Company default</option>
				<option value="Cash">Cash</option>
				<option value="Accrual">Accrual</option>
			</select>
		</label>
		<Button type="submit" size="sm" disabled={run.isPending}>
			{#if run.isPending}<Spinner class="size-3.5" />{/if}
			Run report
		</Button>
	</form>

	<div class="min-h-0 flex-1 overflow-auto p-3">
		{#if run.error}
			<p class="text-sm text-destructive">{run.error.message}</p>
		{:else if run.isPending}
			<p class="text-sm text-muted-foreground">Fetching live from QuickBooks…</p>
		{:else if run.data}
			<pre class="whitespace-pre-wrap break-words font-mono text-xs">{json}</pre>
		{:else}
			<p class="text-sm text-muted-foreground">
				Pick a statement and run it. Reports are computed live by QuickBooks.
			</p>
		{/if}
	</div>
</div>
