<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import * as Empty from '@epicenter/ui/empty';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import { openVaults } from '$lib/open-vaults.svelte';
</script>

<Empty.Root class="flex-1 border-0">
	<Empty.Media variant="icon"><FolderOpenIcon /></Empty.Media>
	<Empty.Title>Open a vault</Empty.Title>
	<Empty.Description>
		Choose a directory of markdown. A folder is a table once it has a matter.json, so Matter reads
		the marked folders at once and references resolve across them. Point it at a folder of marked
		tables, or open a single table folder on its own. An unmarked folder can be adopted as a table
		once it is open.
	</Empty.Description>
	<Empty.Content>
		<Button onclick={openVaults.open}>
			<FolderOpenIcon />
			Open vault
		</Button>
	</Empty.Content>
</Empty.Root>
