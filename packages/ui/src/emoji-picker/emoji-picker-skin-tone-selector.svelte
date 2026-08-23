<script lang="ts">
	import { box } from 'svelte-toolbelt';
	import { Button } from '../button/index.js';
	import { cn } from '../utils.js';
	import { useEmojiPickerSkinToneSelector } from './emoji-picker.svelte.js';
	import type { EmojiPickerSkinProps } from './types.js';

	let {
		previewEmoji = '👋',
		variant = 'outline',
		size = 'icon',
		class: className,
		onclick,
		...rest
	}: EmojiPickerSkinProps = $props();

	const skinState = useEmojiPickerSkinToneSelector({
		previewEmoji: box.with(() => previewEmoji),
	});
</script>

<Button
	{...rest}
	{variant}
	{size}
	class={cn('size-8', className)}
	onclick={(e) => {
		// Button is polymorphic (button or anchor), so its onclick event is a
		// union that the consumer's identically-typed onclick cannot be proven
		// to accept. Forwarding it is sound; the cast just states that.
		(onclick as ((event: typeof e) => void) | undefined)?.(e);
		skinState.cycleSkinTone();
	}}
>
	{skinState.preview}
</Button>
