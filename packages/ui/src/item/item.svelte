<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const itemVariants = tv({
		// Styling lives in the vendored Vega preset (cn-* classes); see
		// packages/ui/src/styles/style-vega.css.
		// Custom overrides preserved inline: `relative` is needed for the
		// absolute-positioned showOnHover Actions, and `[a]:hover:bg-accent/50`
		// keeps the Epicenter accent hover color (cn-item uses bg-muted).
		base: 'cn-item group/item relative [a]:hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 flex flex-wrap items-center transition-colors duration-100 outline-none focus-visible:ring-[3px] [a]:transition-colors',
		variants: {
			variant: {
				default: 'cn-item-variant-default',
				outline: 'cn-item-variant-outline',
				muted: 'cn-item-variant-muted',
			},
			size: {
				default: 'cn-item-size-default',
				sm: 'cn-item-size-sm',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	});

	export type ItemSize = VariantProps<typeof itemVariants>['size'];
	export type ItemVariant = VariantProps<typeof itemVariants>['variant'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		child,
		variant,
		size,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
		variant?: ItemVariant;
		size?: ItemSize;
	} = $props();

	const mergedProps = $derived({
		class: cn(itemVariants({ variant, size }), className),
		'data-slot': 'item',
		'data-variant': variant,
		'data-size': size,
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<div bind:this={ref} {...mergedProps}>{@render mergedProps.children?.()}</div>
{/if}
