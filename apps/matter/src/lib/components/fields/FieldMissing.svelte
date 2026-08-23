<script lang="ts">
	import type { MissingCell } from '@epicenter/matter-core';

	let { cell }: { cell: MissingCell } = $props();

	// The shared missing-value indicator, rendered by every Field's missing branch. It
	// reads the classified cell state, not schema policy: MISSING_REQUIRED gets an
	// attention label, MISSING_OPTIONAL gets quiet absence. INVALID is gated elsewhere
	// and OK shows a value.
	//
	// The CELL already carries the amber ring + tint (TableGrid's cellStateClass), so
	// the required label is plain colored text, not a second boxed badge stacked inside that ring:
	// one quiet label per missing cell instead of a wall of outlined pills on a sparse row.
	const missingRequired = $derived(cell.state === 'MISSING_REQUIRED');
</script>

{#if missingRequired}
	<span class="text-xs font-medium text-amber-700 dark:text-amber-500">required</span>
{:else}
	<span aria-hidden="true" class="inline-block h-4"></span>
	<span class="sr-only">No value</span>
{/if}
