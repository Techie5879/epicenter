<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const itemMediaVariants = tv({
		// Styling lives in the vendored Vega preset (cn-* classes); see
		// packages/ui/src/styles/style-vega.css.
		base: 'cn-item-media flex shrink-0 items-center justify-center [&_svg]:pointer-events-none',
		variants: {
			variant: {
				default: 'cn-item-media-variant-default',
				icon: 'cn-item-media-variant-icon',
				image: 'cn-item-media-variant-image',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	});

	export type ItemMediaVariant = VariantProps<
		typeof itemMediaVariants
	>['variant'];
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		variant = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: ItemMediaVariant;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="item-media"
	data-variant={variant}
	class={cn(itemMediaVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
