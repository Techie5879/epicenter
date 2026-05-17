<script lang="ts">
	import { WorkspaceGate } from '@epicenter/svelte/workspace-gate';
	import { Loading } from '@epicenter/ui/loading';
	import { goto } from '$app/navigation';
	import { requireZhongwen, session } from '$lib/session';
	import { auth } from '$platform/auth';

	let { children } = $props();

	const current = $derived(session.current);

	$effect(() => {
		if (!current) {
			void goto('/sign-in', { replaceState: true });
		}
	});
</script>

{#if current}
	<WorkspaceGate
		pending={current.idb.whenLoaded}
		onForgetDevice={() => requireZhongwen().wipe()}
		onSignOut={() => auth.signOut()}
	>
		{@render children?.()}
	</WorkspaceGate>
{:else}
	<Loading class="h-dvh" />
{/if}
