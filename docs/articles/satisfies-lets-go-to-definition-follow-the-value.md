# `satisfies` Lets Go to Definition Follow the Value

One of the biggest advantages of using `satisfies` instead of annotated return types in TypeScript is what happens when you press Go to Definition. If I access `ws.idb`, I do not want the editor to send me to the abstract `PersistedWorkspace` shape first. I want it to show me the object that actually got returned.

This keeps the trail from usage back to implementation.

Here is the contract:

```typescript
type PersistedWorkspace = Workspace & {
  idb: IndexedDbAttachment;
  clearLocalData(): Promise<unknown>;
};
```

Now compare two factories that both return a valid `PersistedWorkspace`.

```typescript
export function createAnnotatedWorkspace(): PersistedWorkspace {
  const idb = createIndexedDbAttachment();

  return {
    ...createBaseWorkspace(),
    idb,
    async clearLocalData() {
      return undefined;
    },
  };
}

const ws = createAnnotatedWorkspace();

ws.idb;
// ^ Go to Definition
```

With the explicit return annotation, `ws.idb` resolves to the contract:

```txt
ws.idb
  |
  | Go to Definition
  v
type PersistedWorkspace = Workspace & {
	idb: IndexedDbAttachment;
}
```

That is technically correct, but it is rarely the place I wanted to land. I already knew `idb` was part of `PersistedWorkspace`; I clicked because I wanted to see where this `idb` came from.

The `satisfies` version changes that path:

```typescript
export function createSatisfiedWorkspace() {
  const idb = createIndexedDbAttachment();

  return {
    ...createBaseWorkspace(),
    idb,
    async clearLocalData() {
      return undefined;
    },
  } satisfies PersistedWorkspace;
}

const ws = createSatisfiedWorkspace();

ws.idb;
// ^ Go to Definition
```

Now `ws.idb` resolves to the returned object member:

```txt
ws.idb
  |
  | Go to Definition
  v
return {
	idb,
}
```

And from there, the next jump takes you to the local value:

```txt
return {
	idb,
}
  |
  | Go to Definition
  v
const idb = createIndexedDbAttachment();
```

That is the difference. The annotated return type says, "treat this value as the contract." The `satisfies` expression says, "check this value against the contract, but keep the value's own shape."

```typescript
// Erases the returned object to the named contract.
function createAnnotatedWorkspace(): PersistedWorkspace {
	return { ... };
}

// Checks the contract while preserving the returned object.
function createSatisfiedWorkspace() {
	return { ... } satisfies PersistedWorkspace;
}
```

This matters most in factory-heavy code. Factories are already organized around the return object: state above, public API inside the returned shape. When Go to Definition lands inside that shape, the editor is following the same structure the code is written in.

The same idea applies when the factory's own return type needs a public name. Do not annotate the factory with the named type and then duplicate the object shape somewhere else. Let the factory own the shape, then derive the name from it:

```typescript
export type DisposableCache<
  Id extends string | number,
  TValue extends Disposable,
> = ReturnType<typeof createDisposableCache<Id, TValue>>;

export function createDisposableCache<
  Id extends string | number,
  TValue extends Disposable,
>(build: (id: Id) => TValue) {
  return {
    open(id: Id) {
      return build(id);
    },
    has(id: Id) {
      return cache.has(id);
    },
  };
}
```

`satisfies` is for checking a value against an external contract while preserving the value. `ReturnType<typeof createX>` is for naming the factory's own value after the fact. Both patterns protect the same editor path: usage points back to the implementation first.

The type is still available. It just belongs to the command that asks for type information:

| Cursor          | Go to Definition       | Go to Type Definition |
| --------------- | ---------------------- | --------------------- |
| `annotated.idb` | `PersistedWorkspace.idb` | `IndexedDbAttachment` |
| `satisfied.idb` | returned `idb` member  | `IndexedDbAttachment` |

So this is not "ignore the type." The type check still happens. The difference is that normal navigation follows the implementation first.

There are two caveats worth saying out loud.

First, `satisfies` preserves narrow inferred types. If your object says `transport: null`, the inferred return type contains `transport: null`, not `Transport | null`. If the public value really needs the wider type, make the value wide before returning it:

```typescript
function createSatisfiedWorkspace() {
  const idb = createIndexedDbAttachment();
  const transport: Transport | null = null;

  return {
    ...createBaseWorkspace(),
    idb,
    transport,
    async clearLocalData() {
      return undefined;
    },
  } satisfies PersistedWorkspace;
}
```

Second, explicit return types still have a place at package boundaries. If declaration output needs to expose a named type, or if you intentionally want to hide the concrete return shape from consumers, an annotation can be the right move.

One more caveat: do not turn every `satisfies` check into a `defineX()` helper. A constrained identity helper earns its keep when it saves the caller from spelling generics that TypeScript already knows.

Helper earns it:

```typescript
return defineWorkspace({
  ...workspace,
  ...runtime,
});
```

Here the helper hides the generic proof:

```typescript
TWorkspace extends Workspace<TTables, TKv, TActions>
```

Writing that at every call site would make the implementation harder to read. The helper exists to keep the object literal readable while preserving the exact inferred return type.

A concrete Epicenter example is a mount: the small object `epicenter.config.ts` gives the daemon. Every mount receives one `MountContext` with a nullable `session`:

```typescript
type Mount = {
  name: string;
  open(ctx: MountContext): MaybePromise<DaemonRuntime | MountInactive>;
};

type MountContext = {
  epicenterRoot: EpicenterRoot;
  mount: string;
  session: MountSession | null;
};
```

Notice what the helper earns. Most mounts need a signed-in session, so they declare with `defineSessionMount`: it does the `session === null` check once, hands the body a `SessionMountContext` whose `session` is non-null, and returns `inactive(...)` automatically when signed out. The caller never spells the narrowing.

Helper earns it:

```typescript
return defineSessionMount({
  name: 'fuji',
  open(ctx) {
    // ctx.session is non-null here, no guard needed
    return openFujiRuntime(ctx);
  },
});
```

For a mount that can run signed out, the branch is explicit and a raw object `satisfies Mount` is enough:

```typescript
return {
  name: 'mirror',
  open(ctx) {
    return ctx.session
      ? openSyncedRuntime(ctx)
      : inactive('sign in to enable mirror');
  },
} satisfies Mount;
```

`satisfies Mount` gives the `open(ctx)` parameter its contextual type, checks the daemon contract, and keeps the returned object as the source of truth. The helper is valuable when it removes the null-narrowing noise; it is not valuable just because a type exists.

The rule is not "avoid helpers when a type has generics." The rule is sharper: avoid helpers when the generics are already hidden by useful defaults, or when the contract is simple enough to read inline. Reach for the helper when the caller would otherwise have to write the type machinery by hand.

But inside the source tree, especially on factories, this is a real ergonomic win. `satisfies` gives you the contract check without cutting the editor's path back to the object that was actually returned.

For the factory-return version of this pattern, see [Let Factory Return Types Point Back to the Factory](./factory-return-types-should-point-back-to-the-factory.md). For the broader rule, see [Types Should Be Computed, Not Declared](./types-should-be-computed-not-declared.md).
