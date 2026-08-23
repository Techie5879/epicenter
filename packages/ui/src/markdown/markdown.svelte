<!--
	Render a markdown string as a Svelte component tree (no `{@html}`, no
	sanitize). Lex once with `marked`, then walk the tokens into real DOM via
	`<MarkdownNode>`. An optional `romanizer` annotates text leaves with readings
	(pinyin, romaji, ...) shown as native `<ruby>`; `showReadings` toggles them by
	swapping in the identity romanizer, so the pass is skipped entirely when off.

	This runs once per settled message (streaming messages render raw text
	upstream), so a full re-lex on `content` change is intentional and cheap.
-->
<script lang="ts">
	import { marked } from 'marked';
	import { cn } from '../utils.js';
	import MarkdownNode from './markdown-node.svelte';
	import { identityRomanizer, type Romanizer } from './romanizer.js';

	let {
		content,
		romanizer = identityRomanizer,
		showReadings = true,
		class: className,
	}: {
		content: string;
		/** Annotates text leaves with readings; defaults to passing text through. */
		romanizer?: Romanizer;
		/** When false, readings are skipped (the identity romanizer is used). */
		showReadings?: boolean;
		class?: string;
	} = $props();

	const tokens = $derived(marked.lexer(content, { gfm: true, breaks: true }));
	const activeRomanizer = $derived(showReadings ? romanizer : identityRomanizer);
</script>

<div class={cn('prose prose-sm', className)}>
	{#each tokens as token, i (i)}<MarkdownNode {token} romanizer={activeRomanizer} />{/each}
</div>
