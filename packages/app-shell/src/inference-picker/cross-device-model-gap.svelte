<script lang="ts">
	/**
	 * The cross-device model gap banner (ADR-0059): the one place that renders
	 * "this device can't serve the conversation's model." A model set on another
	 * device (a custom connection or a `localhost` URL) syncs in the conversation's
	 * model column but resolves to nothing here, so the banner offers the app's
	 * always-available hosted default and sending is blocked upstream.
	 *
	 * Self-contained: it reads the registry's `canServe` predicate and renders
	 * nothing when the model is served, so every chat surface drops it in place of a
	 * hand-rolled banner. The two per-app facts, what the hosted default is and how
	 * to write the model, are injected via {@link Props.onUseDefault}; the synced
	 * model column is never rewritten on detection, only by this explicit pick.
	 */
	import { Button } from '@epicenter/ui/button';
	import type { InferenceConnections } from './connections.svelte.js';

	type Props = {
		/** The conversation's current model id (synced, ADR-0055). */
		model: string;
		/** The device's inference connection registry. */
		connections: InferenceConnections;
		/** Switch this conversation to the app's hosted default. */
		onUseDefault: () => void;
	};

	let { model, connections, onUseDefault }: Props = $props();
</script>

{#if !connections.canServe(model)}
	<div
		class="flex items-center justify-between gap-2 border-t bg-muted/50 px-3 py-2 text-xs"
	>
		<span class="min-w-0 flex-1">
			This conversation uses
			<span class="font-mono">{model}</span>, set up on another device and not
			reachable here.
		</span>
		<Button
			variant="outline"
			size="sm"
			class="h-6 px-2 text-xs"
			onclick={onUseDefault}
		>
			Use the default
		</Button>
	</div>
{/if}
