<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as Command from '@epicenter/ui/command';
	import { confirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import { useCombobox } from '@epicenter/ui/hooks';
	import * as Popover from '@epicenter/ui/popover';
	import { Spinner } from '@epicenter/ui/spinner';
	import { cn } from '@epicenter/ui/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import type { ConversationId } from '@epicenter/chat';
	import type { ConversationHandle } from './agent-chat.svelte.js';

	let {
		conversations,
		activeConversationId,
		onSwitch,
		onCreate,
	}: {
		conversations: ConversationHandle[];
		activeConversationId: ConversationId | null;
		onSwitch: (id: ConversationId) => void;
		onCreate: () => void;
	} = $props();

	const conversationPicker = useCombobox();
	let conversationSearch = $state('');

	const filteredConversations = $derived(
		conversationSearch
			? conversations.filter((c) =>
					c.title.toLowerCase().includes(conversationSearch.toLowerCase()),
				)
			: conversations,
	);

	/** Whether there are any conversations to show in the dropdown. */
	const hasConversations = $derived(conversations.length > 0);

	/** Active conversation title for the header bar. */
	const activeTitle = $derived(
		conversations.find((c) => c.id === activeConversationId)?.title ??
			'New Chat',
	);

	/** Format an ISO instant (the row's `updatedAt`) as a short relative time. */
	function formatRelativeTime(iso: string): string {
		const ms = Date.parse(iso);
		if (Number.isNaN(ms)) return '';
		const seconds = Math.floor((Date.now() - ms) / 1000);
		if (seconds < 60) return 'now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d`;
		return new Date(ms).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
		});
	}
</script>

<div class="flex items-center gap-1 border-b px-2 py-1.5">
	{#if hasConversations}
		<Popover.Root bind:open={conversationPicker.open}>
			<Popover.Trigger bind:ref={conversationPicker.triggerRef}>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						role="combobox"
						aria-expanded={conversationPicker.open}
						class="h-7 min-w-0 flex-1 justify-between gap-1 px-2 text-xs"
					>
						<span class="truncate">{activeTitle}</span>
						<ChevronDownIcon class="size-3 shrink-0 opacity-50" />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-[280px] p-0" align="start">
				<Command.Root shouldFilter={false}>
					<Command.Input
						placeholder="Search conversations..."
						class="h-9 text-sm"
						bind:value={conversationSearch}
					/>
					<Command.List class="max-h-[300px]">
						<Command.Empty>No conversations found.</Command.Empty>
						{#each filteredConversations as conv (conv.id)}
							<Command.Item
								value={conv.id}
								class="group flex-col items-start gap-0.5"
								onSelect={() => {
									onSwitch(conv.id);
									conversationSearch = '';
									conversationPicker.closeAndFocusTrigger();
								}}
							>
								<span
									class="flex w-full items-center justify-between gap-1.5 text-xs"
								>
									<span class="flex min-w-0 items-center gap-1.5">
										<CheckIcon
											class={cn('mr-0.5 size-3 shrink-0', {
												'text-transparent':
													conv.id !== activeConversationId,
											})}
										/>
										<span class="min-w-0 truncate font-medium"
											>{conv.title}</span
										>
										{#if conv.isLoading}
											<Spinner class="size-3 shrink-0 text-muted-foreground" />
										{/if}
									</span>
									<span class="flex shrink-0 items-center gap-1">
										<span class="text-[10px] text-muted-foreground"
											>{formatRelativeTime(conv.updatedAt)}</span
										>
										<Button
											variant="ghost-destructive"
											size="icon-xs"
											class="opacity-0 group-hover:opacity-100"
											onclick={(e: MouseEvent) => {
												e.stopPropagation();
												e.preventDefault();
												confirmationDialog.open({
													title: 'Delete conversation',
													description: `Delete "${conv.title}"? This will remove all messages in this conversation.`,
													confirm: { text: 'Delete', variant: 'destructive' },
													onConfirm: () => conv.delete(),
												});
											}}
										>
											<TrashIcon class="size-3" />
										</Button>
									</span>
								</span>
								{#if conv.lastMessagePreview}
									<span
										class="w-full truncate pl-5 text-[10px] text-muted-foreground"
										>{conv.lastMessagePreview}</span
									>
								{/if}
							</Command.Item>
						{/each}
					</Command.List>
				</Command.Root>
			</Popover.Content>
		</Popover.Root>
	{:else}
		<span class="flex-1 px-2 text-xs text-muted-foreground">No chats yet</span>
	{/if}

	<Button
		variant="ghost"
		size="icon"
		class="size-7 shrink-0"
		onclick={() => onCreate()}
	>
		<MessageSquarePlusIcon class="size-3.5" />
	</Button>
</div>
