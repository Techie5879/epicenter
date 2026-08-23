<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
	import {
		cn,
		type WithoutChild,
		type WithoutChildrenOrChild,
	} from '../utils.js';
	import AlertDialogOverlay from './alert-dialog-overlay.svelte';

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		size = 'default',
		...restProps
	}: WithoutChild<AlertDialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<AlertDialogPrimitive.PortalProps>;
		size?: 'sm' | 'default';
	} = $props();
</script>

<AlertDialogPrimitive.Portal {...portalProps}>
	<AlertDialogOverlay />
	<AlertDialogPrimitive.Content
		bind:ref
		data-slot="alert-dialog-content"
		data-size={size}
		class={cn(
			'cn-alert-dialog-content group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 outline-none',
			className,
		)}
		{...restProps}
	/>
</AlertDialogPrimitive.Portal>
