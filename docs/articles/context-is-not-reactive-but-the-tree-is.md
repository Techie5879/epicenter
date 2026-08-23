# Svelte Context Is Not Reactive, But `{#key}` Rebuilds the Tree

[`$state<Handle | null>` Is the Component Lifecycle in Disguise](./20260420T160000-state-handle-null-is-the-component-lifecycle-in-disguise.md) argued that resource identity should often belong to the Svelte tree: key the parent, open the handle synchronously in the child, and let unmount dispose it.

Context raises the next objection. If a scope component calls a context setter once, what happens when the upstream identity changes? Do descendants keep reading stale context?

The answer is yes, if you expected context itself to be a subscription. But that is the wrong contract. Context can carry reactive things. It is not reactive by itself. For identity-scoped resources, the cleaner move is the same as before: make the old subtree go away and mount a new one.

This is the shape people worry about:

```svelte
<script lang="ts">
	import { setVoiceSession } from '$lib/voice-session';

	let { speakerId }: { speakerId: string } = $props();

	const transcript = openTranscript({ speakerId });
	setVoiceSession({ speakerId, transcript });
</script>

<TranscriptEditor />
```

Calling `setVoiceSession({ speakerId, transcript })` does not mean "rerun this assignment whenever `speakerId` changes." It means "children in this subtree can read this voice session from the nearest scope."

This is the same shape as `$state<Handle | null>`. The mistake is treating an identity change as an in-place update. If `speakerId` defines which transcript workspace exists, then a new `speakerId` is a new scope, not a mutation of the old one.

## Context is a capability, not a signal

Use context when you want to say "below this component, this capability exists."

```txt
Below this component:
  a speaker id exists
  a transcript workspace exists for that speaker
  child components can read and write that workspace
```

That is different from saying "this value may change in place and every reader should update." If that is the contract, use a reactive object, a getter, a store, or props. Context can carry those things, but context itself is not the reactivity.

The clean context contract is scoped:

```ts
type VoiceSession = {
	speakerId: string;
	transcript: TranscriptWorkspace;
};
```

That pair should not drift. If the speaker changes, the old session is over. Destroy it and create a new one.

## `{#key}` makes the scope honest

The parent owns the identity boundary:

```svelte
{#if speakerId}
	{#key speakerId}
		<VoiceSessionScope {speakerId}>
			<TranscriptEditor />
		</VoiceSessionScope>
	{/key}
{/if}
```

When the key changes, Svelte does not patch the old subtree into a new identity. It destroys the old subtree and mounts a fresh one.

```txt
old speaker id
  destroy VoiceSessionScope
  dispose transcript workspace
  destroy children
  drop old context

new speaker id
  mount VoiceSessionScope
  open transcript workspace
  set fresh context
  mount children
  children read context again
```

That is the whole trick. Context did not become reactive. The tree made the old context irrelevant.

## The scope sets context once

The scope component should be boring:

```svelte
<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import { setVoiceSession } from '$lib/voice-session';
	import { openVoiceWorkspace } from '$lib/voice/browser';

	let {
		speakerId,
		children,
	}: {
		speakerId: string;
		children: Snippet;
	} = $props();

	const voice = openVoiceWorkspace({ speakerId });

	setVoiceSession({
		speakerId,
		voice,
	});

	onDestroy(() => voice[Symbol.dispose]());
</script>

{@render children()}
```

There is no `let voice = $state(null)`. There is no effect that opens the workspace and assigns it later. The component instance is the lifetime.

Children read the scoped capability:

```svelte
<script lang="ts">
	import { getVoiceSession } from '$lib/voice-session';

	const { speakerId, voice } = getVoiceSession();
</script>

<TranscriptPane {speakerId} workspace={voice} />
```

If the speaker changes, this component is destroyed too. Its context read does not need to update. It needs to happen again in a new component instance.

## Same-user updates are not scope changes

The same rule applies to signed-in app scopes, but not every upstream auth change should remount the subtree. A token refresh, cookie refresh, or encryption-key refresh for the same user is not a new scope.

In a signed-in session scope, handle that refresh inside the module that opened the workspace. Current workspace-backed apps use `createSession`, not a context setter component:

```ts
import { requireSignedIn } from '@epicenter/auth';
import { createSession, type InferSignedIn } from '@epicenter/svelte/auth';
import { auth } from '$lib/auth';
import { openVoiceWorkspace } from '$lib/voice/browser';

export const session = createSession({
	auth,
	build: (identity) => {
		const userId = identity.user.id;
		const voice = openVoiceWorkspace({
			userId,
			encryptionKeys: () => requireSignedIn(auth).encryptionKeys,
		});
		return {
			userId,
			voice,
			[Symbol.dispose]() {
				voice[Symbol.dispose]();
			},
		};
	},
});

export type VoiceSignedIn = InferSignedIn<typeof session>;
export function getVoiceSession(): VoiceSignedIn {
	const current = session.current;
	if (current.status !== 'signed-in') {
		throw new Error('Voice session is only available inside the signed-in branch');
	}
	return current.signedIn;
}
```

The key answers "is this still the same scope?" The auth callback answers "did something inside this scope refresh?" There is no separate listener and no mutation hook on the workspace: sync can read a refreshed token on connection attempts, and new encrypted attachments can derive from the current keys.

```txt
same user id
  keep subtree
  keep workspace
  new encrypted attachments derive from current keys
  already-attached stores keep their derived keyring

different user id
  destroy subtree
  dispose workspace
  build fresh context
```

Those are different transitions. Treating both as "context should update" is how the design gets muddy.

## Split contexts recreate the bug in type form

It is tempting to expose two contexts:

```ts
const identity = getIdentity();
const voice = getVoiceWorkspace();
```

That works, but it weakens the invariant. The useful fact is not "there is an identity somewhere" and "there is a workspace somewhere." The useful fact is the pair:

```txt
this workspace belongs to this signed-in identity
```

Keep the pair together:

```ts
type VoiceSession = {
	identity: AuthIdentity;
	voice: VoiceWorkspace;
};

export const [getVoiceSession, setVoiceSession] =
	createContext<VoiceSession>();
```

One context says one thing. Two contexts make the reader wonder whether the lifetimes can differ.

## Use a getter when the value must change in place

There is a real case where direct context is wrong. If descendants must stay mounted while the value changes in place, pass a getter or a reactive object through context.

```ts
export const [getCurrentTrack, setCurrentTrack] =
	createContext<() => Track | null>();
```

```svelte
<script lang="ts">
	let currentTrack = $state<Track | null>(null);

	setCurrentTrack(() => currentTrack);
</script>
```

That is a different contract:

```txt
The subtree stays mounted.
The selected track changes inside it.
Consumers should react to the current track.
```

Do not use keyed remounting for that unless changing the track really means destroying the whole experience. A music player usually keeps the shell mounted when the current track changes. A signed-in workspace usually should not survive a user switch.

## The rule

If the upstream value changing means "this is a different world," key the subtree and set context once inside it. If the upstream value changing means "same world, different selected value," put a reactive getter or object in context.

This builds on [`$state<Handle | null>` Is the Component Lifecycle in Disguise](./20260420T160000-state-handle-null-is-the-component-lifecycle-in-disguise.md). That article covers disposable handles. This one covers the context objection that follows: Svelte context is not reactive, but a keyed subtree does not need it to be.
