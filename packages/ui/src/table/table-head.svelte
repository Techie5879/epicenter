<script lang="ts">
	import type { HTMLThAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLThAttributes> = $props();
</script>

<th
	bind:this={ref}
	data-slot="table-head"
	class={cn(
		'cn-table-head',
		'bg-clip-padding text-start [&:has([role=checkbox])]:pe-0',
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</th>
