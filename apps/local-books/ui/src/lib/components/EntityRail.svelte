<script lang="ts">
	import { numberFmt } from '$lib/format';
	import type { EntitySummary } from '$lib/types';

	let {
		entities,
		selected,
		onSelect,
	}: {
		entities: EntitySummary[];
		selected: string | null;
		onSelect: (entity: string) => void;
	} = $props();
</script>

<nav class="w-56 shrink-0 overflow-y-auto border-r border-border bg-background">
	<div class="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
		Record types
	</div>
	<ul class="pb-4">
		{#each entities as entity (entity.entity)}
			<li>
				<button
					type="button"
					class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60
						{selected === entity.entity ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}"
					onclick={() => onSelect(entity.entity)}
				>
					<span class="truncate">{entity.entity}</span>
					{#if entity.initialized}
						<span class="shrink-0 tabular-nums text-xs text-muted-foreground">
							{numberFmt.format(entity.rows)}
						</span>
					{:else}
						<span
							class="shrink-0 text-xs text-muted-foreground/60"
							title="Not synced yet"
						>
							&mdash;
						</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</nav>
