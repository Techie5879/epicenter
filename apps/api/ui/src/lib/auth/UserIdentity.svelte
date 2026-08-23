<!--
	One user's identity: their avatar (profile image, falling back to initials)
	beside or above their name and email. This is the single place both auth
	surfaces render "who is this", so the sign-in card and the account profile
	can never drift apart again (they once disagreed on the name rule).

	App-local on purpose: the only two consumers are this app's sign-in and
	account pages. Promote to a shared package when a second app grows an account
	surface, not before.
-->
<script lang="ts">
	import * as Avatar from '@epicenter/ui/avatar';

	let {
		user,
		orientation = 'row',
	}: {
		user: { name: string; email: string; image?: string | null };
		/** `row` sits the avatar beside the text; `stack` centers it above. */
		orientation?: 'row' | 'stack';
	} = $props();

	// Better Auth leaves `name` an empty string when the IdP returns none, never
	// the email (Apple's mapper is explicitly tested not to fall back to email,
	// and email/password is disabled here so every user is social). So a non-empty
	// name is the only "has a name" case; there is no name-equals-email to guard.
	const name = $derived(user.name.trim());
	// Avatar fallback: initials from the name (up to two words), or the email's
	// first letter when there is no name. Matches the canonical shadcn pattern.
	const initials = $derived(
		(name
			? name
					.split(/\s+/, 2)
					.map((part) => part[0] ?? '')
					.join('')
			: (user.email[0] ?? '')
		).toUpperCase(),
	);
	const stacked = $derived(orientation === 'stack');
</script>

<div
	class="flex gap-3 {stacked ? 'flex-col items-center text-center' : 'items-center'}"
>
	<Avatar.Root class="size-10">
		{#if user.image}
			<Avatar.Image src={user.image} alt={name || user.email} />
		{/if}
		<Avatar.Fallback>{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="flex flex-col {stacked ? 'items-center' : ''}">
		{#if name}
			<span class="text-sm font-medium">{name}</span>
		{/if}
		<span class="text-sm text-muted-foreground">{user.email}</span>
	</div>
</div>
