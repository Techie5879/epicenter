<script lang="ts">
	import { basename } from '@epicenter/matter-core';
	import type { PageData } from './$types';
	import VaultShell from './VaultShell.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Matter / {basename(data.root)}</title></svelte:head>

<!-- SvelteKit reuses this component across `[id]` changes, so key the live vault on its
     root: a new key tears down the old VaultShell (its root watch and every composed table
     watch dispose) and mounts a fresh one for the new vault. open() dedups by root, so each id
     maps to a unique root, making key-on-root equivalent to key-on-id. -->
{#key data.root}
	<VaultShell root={data.root} />
{/key}
