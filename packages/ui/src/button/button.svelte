<script lang="ts" module>
	import type {
		HTMLAnchorAttributes,
		HTMLButtonAttributes,
	} from 'svelte/elements';
	import { tv, type VariantProps } from 'tailwind-variants';
	import { cn, type WithElementRef } from '../utils.js';

	// Styling lives in the vendored Vega preset (cn-* classes); see
	// packages/ui/src/styles/style-vega.css. Epicenter-specific variants live in
	// packages/ui/src/styles/epicenter-overlay.css.
	export const buttonVariants = tv({
		base: 'cn-button group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
		variants: {
			variant: {
				default: 'cn-button-variant-default',
				destructive: 'cn-button-variant-destructive',
				outline: 'cn-button-variant-outline',
				secondary: 'cn-button-variant-secondary',
				ghost: 'cn-button-variant-ghost',
				link: 'cn-button-variant-link',
				// Epicenter custom variant (overlay, not upstream).
				'ghost-destructive': 'cn-button-variant-ghost-destructive',
			},
			size: {
				default: 'cn-button-size-default',
				xs: 'cn-button-size-xs',
				sm: 'cn-button-size-sm',
				lg: 'cn-button-size-lg',
				icon: 'cn-button-size-icon',
				'icon-xs': 'cn-button-size-icon-xs',
				'icon-sm': 'cn-button-size-icon-sm',
				'icon-lg': 'cn-button-size-icon-lg',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			/**
			 * Tooltip text to display on hover.
			 * Requires a parent `<Tooltip.Provider>` in the component tree.
			 * Wrap your app root with `<Tooltip.Provider>` to enable tooltip coordination.
			 */
			tooltip?: string;
		};
</script>

<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import * as Tooltip from '../tooltip/index.js';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		tooltip,
		...restProps
	}: ButtonProps = $props();
</script>

{#snippet buttonContent(tooltipProps?: Record<string, unknown>)}
	<!--
		When this button is also the child of another trigger, e.g. Popover.Trigger,
		the outer trigger props and tooltip trigger props land on the same element.
		Plain sequential spreads replace colliding handlers and ref attachments.
		mergeProps composes handlers and function props, merges class/style, and
		preserves distinct Svelte attachment keys. Plain attributes like id/data-state
		remain last-wins.
	-->
	{@const mergedProps = tooltipProps
		? mergeProps(restProps, tooltipProps)
		: restProps}
	{#if href}
		<!-- biome-ignore lint/a11y/useValidAriaRole: conditional role is valid -->
		<a
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size }), className)}
			href={disabled ? undefined : href}
			aria-disabled={disabled}
			role={disabled ? 'link' : undefined}
			tabindex={disabled ? -1 : undefined}
			{...mergedProps}
		>
			{@render children?.()}
		</a>
	{:else}
		<button
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size }), className)}
			{type}
			{disabled}
			{...mergedProps}
		>
			{@render children?.()}
		</button>
	{/if}
{/snippet}

<!--
	When using the tooltip prop, this component requires a parent Tooltip.Provider.
	Wrap your app root with <Tooltip.Provider> to enable tooltip coordination.
-->
{#if tooltip}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render buttonContent(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content class="max-w-xs text-center"> {tooltip} </Tooltip.Content>
	</Tooltip.Root>
{:else}
	{@render buttonContent()}
{/if}
