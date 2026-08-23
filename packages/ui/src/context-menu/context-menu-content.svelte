<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import type { WithoutChildrenOrChild } from '../utils.js';
	import { cn } from '../utils.js';
	import ContextMenuPortal from './context-menu-portal.svelte';

	let {
		ref = $bindable(null),
		portalProps,
		class: className,
		...restProps
	}: ContextMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<
			ComponentProps<typeof ContextMenuPortal>
		>;
	} = $props();
</script>

<ContextMenuPortal {...portalProps}>
	<ContextMenuPrimitive.Content
		bind:ref
		data-slot="context-menu-content"
		class={cn(
			'cn-context-menu-content cn-menu-translucent z-50 max-h-(--bits-context-menu-content-available-height) origin-(--bits-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto outline-none',
			className,
		)}
		{...restProps}
	/>
</ContextMenuPortal>
