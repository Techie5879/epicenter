<script lang="ts">
	import * as Tooltip from '@epicenter/ui/tooltip';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import { stemOf, type ReferenceVerdict } from '@epicenter/matter-core';

	// The cross-table verdict for one reference cell, colored by state: a resolved pointer is a
	// quiet link, a dangling one is a red break, a missing-target column an amber unlink. The
	// editable value stays in the cell's own widget; this is the adornment that says whether that
	// value lands. The verdict comes straight from the vault's assessed cell, so it never re-decides
	// resolution: the grid and the integrity panel read the same `assess` result.
	let { verdict }: { verdict: ReferenceVerdict } = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<span {...props} class="flex shrink-0 cursor-default items-center">
				{#if verdict.state === 'resolved'}
					<Link2Icon class="size-3.5 text-emerald-600 dark:text-emerald-400" />
				{:else if verdict.state === 'dangling'}
					<TriangleAlertIcon class="size-3.5 text-destructive" />
				{:else}
					<UnlinkIcon class="size-3.5 text-amber-600 dark:text-amber-400" />
				{/if}
			</span>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		{#if verdict.state === 'resolved'}
			Resolves to
			<span class="font-mono">{verdict.target}/{stemOf(verdict.targetRow.fileName)}</span>
		{:else if verdict.state === 'dangling'}
			No row <span class="font-mono">{verdict.value}</span> in
			<span class="font-mono">{verdict.target}</span> — dangling reference
		{:else}
			Target table <span class="font-mono">{verdict.target}</span> is not in this vault
		{/if}
	</Tooltip.Content>
</Tooltip.Root>
