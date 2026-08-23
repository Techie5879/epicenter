<!--
	Render one settled assistant message with its deterministic reading overlay.

	Readings are a client-side derived view (ADR-0105): the message is stored and
	fed back to the model as clean text, and this component renders pronunciation
	on top. It loads the deterministic providers whose script appears in the
	passage (pinyin for Han today) and composes them into one synchronous
	romanizer for the unchanged `<Markdown>` seam. This is pure local work, a lazy
	import per script cached across messages, with no network, no model call, and
	no wrong-reading risk. Until the import resolves, and for all-Latin text, the
	identity romanizer renders plain text.
-->
<script lang="ts">
	import {
		Markdown,
		identityRomanizer,
		type Romanizer,
	} from '@epicenter/ui/markdown';
	import { resolveRomanizer } from '$lib/readings/registry';

	let {
		passage,
		showReadings,
	}: { passage: string; showReadings: boolean } = $props();

	let romanizer = $state<Romanizer>(identityRomanizer);
	/** Latched so providers load once, the first time readings are shown. */
	let resolved = $state(false);

	$effect(() => {
		if (!showReadings || resolved) return;
		resolved = true;
		void resolveRomanizer(passage).then((composed) => {
			romanizer = composed;
		});
	});
</script>

<Markdown content={passage} {romanizer} {showReadings} />
