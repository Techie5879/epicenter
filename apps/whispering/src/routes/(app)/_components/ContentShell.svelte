<script lang="ts">
	let { children } = $props();
</script>

<!--
	The page content region, rendered inside whichever nav chrome the responsive
	branch picked. Pure view: it owns no app lifecycle, so the nav branch is free
	to remount it on a breakpoint change.
-->
<div class="flex flex-1 flex-col gap-2 min-w-0 w-full">
	{@render children()}
</div>
