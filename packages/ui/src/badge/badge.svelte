<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	// Styling lives in the vendored Vega preset (cn-* classes); see
	// packages/ui/src/styles/style-vega.css. Epicenter-specific variants live in
	// packages/ui/src/styles/epicenter-overlay.css.
	export const badgeVariants = tv({
		base: 'cn-badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-[3px] [&>svg]:pointer-events-none',
		variants: {
			variant: {
				default: 'cn-badge-variant-default',
				secondary: 'cn-badge-variant-secondary',
				destructive: 'cn-badge-variant-destructive',
				outline: 'cn-badge-variant-outline',
				// Epicenter custom variants (overlay, not upstream).
				id: 'cn-badge-variant-id',
				'status.completed': 'cn-badge-variant-status-completed',
				'status.failed': 'cn-badge-variant-status-failed',
				'status.running': 'cn-badge-variant-status-running',
				success: 'cn-badge-variant-success',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../utils.js';

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	} = $props();
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
