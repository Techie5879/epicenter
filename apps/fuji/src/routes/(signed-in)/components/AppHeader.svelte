<script lang="ts">
	import { AccountPopover } from '@epicenter/svelte/account-popover';
	import { Button } from '@epicenter/ui/button';
	import { GitHubButton, getStars } from '@epicenter/ui/github-button';
	import { Kbd } from '@epicenter/ui/kbd';
	import { LightSwitch } from '@epicenter/ui/light-switch';
	import * as Tooltip from '@epicenter/ui/tooltip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { requireFuji } from '$lib/session';
	import { auth } from '$platform/auth';
	import BulkAddModal from './BulkAddModal.svelte';

	let { onOpenSearch }: { onOpenSearch: () => void } = $props();
	const fuji = requireFuji();
</script>

<div class="flex h-10 shrink-0 items-center justify-between border-b px-3">
	<!-- Left: branding + actions -->
	<div class="flex items-center gap-1.5">
		<span class="text-sm font-semibold tracking-tight">Fuji</span>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						onclick={onOpenSearch}
					>
						<SearchIcon class="size-4" />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content> Search entries <Kbd>⌘K</Kbd> </Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						onclick={() => {
							const { id } = fuji.collaboration.actions.entries_create({});
							goto(`/entries/${id}`);
						}}
					>
						<PlusIcon class="size-4" />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content> New entry <Kbd>⌘N</Kbd> </Tooltip.Content>
		</Tooltip.Root>
		<BulkAddModal />
	</div>
	<!-- Right: external links + theme -->
	<div class="flex items-center gap-1">
		<AccountPopover
			{auth}
			collaboration={fuji.collaboration}
			syncNoun="entries"
			onForgetDevice={() => fuji.wipe()}
		/>
		<GitHubButton
			repo={{ owner: 'EpicenterHQ', repo: 'epicenter' }}
			path="/tree/main/apps/fuji"
			stars={getStars({ owner: 'EpicenterHQ', repo: 'epicenter', fallback: 500 })}
			variant="ghost"
			size="sm"
		/>
		<LightSwitch variant="ghost" />
	</div>
</div>
