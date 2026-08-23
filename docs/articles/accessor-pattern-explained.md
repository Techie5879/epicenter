# The Accessor Pattern: Why Svelte 5 Queries Need Functions

Svelte 5 query definitions should receive live values through accessor functions, not snapshots. If `recordingId` can change, pass `() => recordingId`.

```svelte
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/rpc';

	let recordingId = $state('abc');

	const playbackUrl = createQuery(() =>
		rpc.audio.getPlaybackUrl(() => recordingId).options,
	);
</script>
```

There are two functions in that line, and both matter:

```txt
createQuery(() => ...)
  outer accessor: lets TanStack re-read the whole options object

getPlaybackUrl(() => recordingId)
  inner accessor: lets the query key and query function read the current id
```

## The Failure Mode

Passing a value directly captures the value at the time the query definition is created.

```typescript
let recordingId = $state('abc');

const playbackUrl = createQuery(() =>
	rpc.audio.getPlaybackUrl(recordingId).options,
);
```

The first render creates a query for `abc`. If `recordingId` later changes to `xyz`, the query definition still has the old value. Svelte cannot track the read because it already happened outside the accessor boundary.

The accessor version keeps the read lazy:

```typescript
const playbackUrl = createQuery(() =>
	rpc.audio.getPlaybackUrl(() => recordingId).options,
);
```

When TanStack Query re-evaluates the options, `recordingId` is read inside Svelte's tracking context. The query key changes, the query function sees the new id, and the UI follows.

## Query Definitions

Shared Wellcrafted query definitions usually accept accessors for values that can change in Svelte components:

```typescript
import type { Accessor } from '@tanstack/svelte-query';
import { defineKeys } from 'wellcrafted/query';
import { defineQuery } from '$lib/rpc/client';
import { services } from '$lib/services';

export const audioKeys = defineKeys({
	playbackUrl: (id: string) => ['audio', 'playbackUrl', id] as const,
});

export const audio = {
	getPlaybackUrl: (recordingId: Accessor<string>) =>
		defineQuery({
			queryKey: audioKeys.playbackUrl(recordingId()),
			queryFn: () => services.blobs.audio.ensurePlaybackUrl(recordingId()),
		}),
};
```

`Accessor<T>` is just:

```typescript
type Accessor<T> = () => T;
```

The type is small, but the boundary is important. It tells the query layer, "read this value when you build the options, not before."

## Hook-Local Options

The same rule applies when there is no shared RPC definition. Use `queryOptions` for a hook-local Result-returning query, and keep reactive reads inside the hook accessor.

```svelte
<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { queryOptions } from 'wellcrafted/query';
	import { services } from '$lib/services';

	let recordingId = $state('abc');

	const transcript = createQuery(() =>
		queryOptions({
			queryKey: ['recording', recordingId, 'transcript'],
			queryFn: () => services.recordings.getTranscript(recordingId),
			enabled: recordingId.length > 0,
		}),
	);
</script>
```

This query does not need a reusable `.fetch()` or `.ensure()` method, so `queryOptions` is the right tool.

## Imperative Reads Are Different

`.fetch()` and `.ensure()` are one-time reads. They do not subscribe the UI to future value changes.

```typescript
const { data, error } = await rpc.audio
	.getPlaybackUrl(() => recordingId)
	.fetch();
```

That is fine in an event handler where you want one fresh read. It is not a replacement for `createQuery` in a component that should update when `recordingId` changes.

Use the policies deliberately:

```txt
.fetch()
  freshness-aware read. TanStack checks staleTime and may refetch.

.ensure()
  cache-first read. TanStack returns cached data when it exists.
```

Queries are not callable, so there is no `await userQuery()`. Mutations are callable, so there is no `await saveUser.execute(input)`.

## Quick Reference

```txt
Shared reactive query:
  createQuery(() => rpc.audio.getPlaybackUrl(() => recordingId).options)

Hook-local Result query:
  createQuery(() => queryOptions({ queryKey, queryFn }))

Imperative query:
  await rpc.audio.getPlaybackUrl(() => recordingId).fetch()
  await rpc.audio.getPlaybackUrl(() => recordingId).ensure()

Shared mutation:
  createMutation(() => rpc.transformer.transformRecording.options)
  await rpc.transformer.transformRecording(input)

Hook-local Result mutation:
  createMutation(() => mutationOptions({ mutationKey, mutationFn }))
```

When in doubt, ask what the caller needs. If the template reads loading, data, or error state, use a hook. If the caller needs one query result outside reactive UI, choose `.fetch()` or `.ensure()`. If the caller is running a mutation imperatively, call the mutation.
