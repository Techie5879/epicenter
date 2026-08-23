<!--
	Hosted auth card shell shared by sign-in, consent, and CLI callback.

	Keep this surface plain and operational: see ADR-0113.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '@epicenter/ui/card';
	import EpicenterMark from './EpicenterMark.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="flex min-h-dvh items-center justify-center p-6">
	<Card.Root class="w-full max-w-sm gap-5">
		<div class="flex justify-center">
			<EpicenterMark class="size-12 rounded-xl" />
		</div>
		{@render children()}
	</Card.Root>
</div>
