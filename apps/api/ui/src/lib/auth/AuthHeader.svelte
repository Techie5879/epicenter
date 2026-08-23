<!--
	Centered header for the hosted auth surfaces. Owns the one auth title scale
	and centering so routes stop re-deciding typography per page: the h1 gives
	each surface a semantic heading, the description snippet carries any inline
	markup (a client id, a code span).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '@epicenter/ui/card';

	let {
		title,
		description,
	}: { title: string; description?: Snippet } = $props();
</script>

<Card.Header class="justify-items-center text-center">
	<Card.Title>
		<h1 class="text-xl font-semibold tracking-tight">{title}</h1>
	</Card.Title>
	{#if description}
		<Card.Description>{@render description()}</Card.Description>
	{/if}
</Card.Header>
