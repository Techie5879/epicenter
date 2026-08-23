<script lang="ts" module>
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { type WithElementRef } from '../utils.js';
	import { type ItemSize, type ItemVariant } from './item.svelte';

	export type ItemButtonProps = WithElementRef<
		HTMLButtonAttributes,
		HTMLButtonElement
	> & {
		variant?: ItemVariant;
		size?: ItemSize;
	};
</script>

<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { cn } from '../utils.js';
	import { itemVariants } from './item.svelte';

	let {
		ref = $bindable(null),
		class: className,
		variant,
		size,
		type = 'button',
		children,
		...restProps
	}: ItemButtonProps = $props();

	// The interactive Item: Item.Root's styling rendered on a real <button>, so
	// callers stop hand-writing the `{#snippet child}` + `<button {...props}>`
	// dance. Composes via mergeProps like Button, so a parent trigger's child
	// props (e.g. ContextMenu.Trigger) merge instead of clobbering handlers/ref.
	// Hover/selected styling stays the caller's job (set it in `class`).
	const itemProps = $derived({
		class: cn(itemVariants({ variant, size }), className),
		'data-slot': 'item',
		'data-variant': variant,
		'data-size': size,
	});
</script>

<button bind:this={ref} {type} {...mergeProps(itemProps, restProps)}>
	{@render children?.()}
</button>
