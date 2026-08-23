<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Textarea } from '../textarea/index.js';
	import { cn } from '../utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...props
	}: ComponentProps<typeof Textarea> = $props();
</script>

<Textarea
	bind:ref
	data-slot="input-group-control"
	class={cn('cn-input-group-textarea flex-1 resize-none', className)}
	bind:value
	{...props}
/>
