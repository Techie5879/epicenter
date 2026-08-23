<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	const inputGroupButtonVariants = tv({
		base: 'cn-input-group-button flex items-center shadow-none',
		variants: {
			size: {
				xs: 'cn-input-group-button-size-xs',
				'icon-xs': 'cn-input-group-button-size-icon-xs',
				'icon-sm': 'cn-input-group-button-size-icon-sm',
			},
		},
		defaultVariants: {
			size: 'xs',
		},
	});

	export type InputGroupButtonSize = VariantProps<
		typeof inputGroupButtonVariants
	>['size'];
</script>

<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Button } from '../button/index.js';
	import { cn } from '../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		type = 'button',
		variant = 'ghost',
		size = 'xs',
		...restProps
	}: Omit<ComponentProps<typeof Button>, 'href' | 'size'> & {
		size?: InputGroupButtonSize;
	} = $props();
</script>

<Button
	bind:ref
	{type}
	data-size={size}
	{variant}
	class={cn(inputGroupButtonVariants({ size }), className)}
	{...restProps}
>
	{@render children?.()}
</Button>
