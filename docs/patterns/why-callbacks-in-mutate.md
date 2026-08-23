# Why I Pass Callbacks to `.mutate()`

TanStack Query mutations have two callback layers. Put shared lifecycle behavior on the mutation options. Put local UI behavior at the `.mutate()` call site.

That distinction matters in Svelte components because local UI state lives at the click handler, form handler, or dialog boundary.

## The Two Callback Layers

Use an options accessor when wiring a shared RPC mutation:

```typescript
const deleteSessionMutation = createMutation(
	() => rpc.sessions.deleteSession.options,
);
```

Then pass UI-specific callbacks when triggering the mutation:

```typescript
deleteSessionMutation.mutate(
	{ sessionId },
	{
		onSuccess: () => {
			isDialogOpen = false;
			toast.success('Deleted');
		},
	},
);
```

The mutation definition stays reusable. The call site keeps access to local state, props, derived values, navigation, and refs.

## Shared Callback Behavior

If every call site needs the same behavior, compose that behavior into the hook options accessor:

```typescript
const deleteSessionMutation = createMutation(() => ({
	...rpc.sessions.deleteSession.options,
	onSuccess: (data) => {
		logAuditEvent('session_deleted', data.id);
	},
}));
```

This is still component-level TanStack setup. The shared RPC definition remains the plain Wellcrafted mutation definition, and `.options` stays a property.

## Local Callback Behavior

Prefer call-site callbacks for UI consequences:

```svelte
<script lang="ts">
	const copyToClipboard = createMutation(
		() => rpc.text.copyToClipboard.options,
	);

	let isDialogOpen = $state(false);
	let selectedText = $state('');
</script>

<Button
	onclick={() => {
		copyToClipboard.mutate(
			{ text: selectedText },
			{
				onSuccess: () => {
					isDialogOpen = false;
					selectedText = '';
					toast.success('Copied to clipboard');
				},
				onError: (error) => {
					report.error({ cause: error });
				},
			},
		);
	}}
>
	Copy
</Button>
```

Each interaction can do exactly what its UI context needs. A table row can show a small toast. A bulk action can update selection state. A dialog can close itself.

## Hook-Local Result Mutations

When the operation is one-off and returns a Wellcrafted `Result`, use `mutationOptions` directly at the hook call site:

```typescript
import { createMutation } from '@tanstack/svelte-query';
import { mutationOptions } from 'wellcrafted/query';

const startRecording = createMutation(() =>
	mutationOptions({
		mutationKey: ['recording', 'startManual'],
		mutationFn: startManualRecording,
	}),
);
```

Use a shared `defineMutation` only when the mutation belongs in `$lib/rpc` or `$lib/query` with reusable identity, cache invalidation, or multiple observers.

## Rule

- Shared RPC mutation hook: `createMutation(() => rpc.thing.options)`
- Shared callback for every call: `createMutation(() => ({ ...rpc.thing.options, onSuccess }))`
- Local UI callback: `mutation.mutate(input, { onSuccess, onError })`
- Hook-local Result operation: `createMutation(() => mutationOptions({ mutationKey, mutationFn }))`
- Imperative shared mutation outside hooks: `await rpc.thing(input)`

Do not use `createMutation(rpc.thing.options)` directly. Svelte Query expects an accessor so reactive options can be tracked consistently.
