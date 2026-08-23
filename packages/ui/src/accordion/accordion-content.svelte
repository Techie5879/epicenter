<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<AccordionPrimitive.ContentProps> = $props();
</script>

<AccordionPrimitive.Content
	bind:ref
	data-slot="accordion-content"
	class="cn-accordion-content overflow-hidden"
	{...restProps}
>
	<div class={cn('cn-accordion-content-inner', className)}>
		{@render children?.()}
	</div>
</AccordionPrimitive.Content>
