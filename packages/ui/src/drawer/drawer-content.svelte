<script lang="ts">
	import { Drawer as DrawerPrimitive } from 'vaul-svelte';
	import { cn } from '../utils.js';
	import DrawerOverlay from './drawer-overlay.svelte';

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		...restProps
	}: DrawerPrimitive.ContentProps & {
		portalProps?: DrawerPrimitive.PortalProps;
	} = $props();
</script>

<DrawerPrimitive.Portal {...portalProps}>
	<DrawerOverlay />
	<!-- TODO: Remove onOpenAutoFocus workaround when vaul-svelte releases a version compatible with bits-ui 2.x.
	     vaul-svelte 1.0.0-next.7 depends on bits-ui ^1.1.0, causing an infinite handleFocus recursion
	     with bits-ui 2.x. See: https://github.com/huntabyte/vaul-svelte/issues/135 -->
	<DrawerPrimitive.Content
		bind:ref
		onOpenAutoFocus={(e) => e.preventDefault()}
		data-slot="drawer-content"
		class={cn('cn-drawer-content group/drawer-content fixed z-50', className)}
		{...restProps}
	>
		<div
			class="cn-drawer-handle bg-muted mx-auto hidden shrink-0 group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
		></div>
		<!-- Custom: Scrollable content area. flex-1 takes remaining space after drag handle,
		     overflow-y-auto enables vertical scrolling when content exceeds drawer height. -->
		<div class="flex-1 overflow-y-auto">{@render children?.()}</div>
	</DrawerPrimitive.Content>
</DrawerPrimitive.Portal>
