# Svelte's createSubscriber Is the Whole Adapter

The first time I needed to adapt an external client to Svelte 5, I wrote a
thirty-line wrapper. The second time, I wrote ten. The third time, three. The
pattern that survived looks like this:

```ts
const subscribe = createSubscriber((update) => {
  source.on('change', update);
  return () => source.off('change', update);
});

return {
  get value() {
    subscribe();
    return source.read();
  },
};
```

That's the whole adapter. Build a `subscribe` function. Inside it, hook
`update` to whatever event the source fires when its value changes, and return
the cleanup. Then expose a getter that calls `subscribe()` before reading. Any
`$derived` or `$effect` that touches `value` will re-run on every change.

The two pieces talk to each other through Svelte's reactivity tracker:
`subscribe()` registers the current reactive context as a listener, and the
`update` callback inside `createSubscriber` is what fires later to mark those
listeners dirty. The getter is the bridge. You don't have to wire it any
further than that.

If you've reached for `$state` and `$effect` to glue an external source into
Svelte and it felt like fighting the framework, this is probably what you
were missing. There's a primitive for it. It's called `createSubscriber`, and
it does most of the work.

There are two flavors of this pattern, depending on whether the thing you're
adapting already has methods worth keeping.

## Flavor 1: Nothing to Wrap

If the source is just an event emitter plus some value you want to read
reactively, you invent the reactive object yourself. Three lines, no spread.

Y.Doc is a good example. It fires `update` every time the document changes.
To expose the encoded size reactively, define a `bytes` getter:

```ts
function createYdocSize(ydoc: Y.Doc) {
  const subscribe = createSubscriber((update) => {
    ydoc.on('update', update);
    return () => ydoc.off('update', update);
  });
  return {
    get bytes() {
      subscribe();
      return encodeStateAsUpdate(ydoc).byteLength;
    },
  };
}
```

The KV store in `@epicenter/workspace` is similar. It has `observe(key,
callback)`, which subscribes to changes for one key and returns a cleanup
function. To make one key reactive:

```ts
export function fromKv<TDefs, K>(kv: Kv<TDefs>, key: K) {
  const subscribe = createSubscriber((update) => kv.observe(key, update));
  return {
    get current() {
      subscribe();
      return kv.get(key);
    },
    set current(newValue) {
      kv.set(key, newValue);
    },
  };
}
```

`kv.observe` already returns its own cleanup, so the `createSubscriber`
callback can just return what `observe` returns. The setter is a bonus
because KV writes need a path back; the reactive read is still the same three
pieces.

## Flavor 2: Wrap and Override

If the source already has a public surface (methods, getters, disposers) that
you want to expose, don't re-declare them. Spread the source. Override only
the read that needs to be reactive.

This is the `AuthClient` case in `@epicenter/auth-svelte`. The core
`@epicenter/auth` package is framework-agnostic on purpose: its `AuthClient`
has seven entries (`state`, `onStateChange`, `startSignIn`, `signOut`,
`fetch`, `openWebSocket`, `[Symbol.dispose]`), and we want Svelte components
to read `state` reactively. The other six already work as-is, because the
methods on `auth` are closure-bound inside the factory that built them. They
don't reach for `this`.

So spread them. Then override `state`:

```ts
export function createOAuthAppAuth(config: CreateOAuthAppAuthConfig): AuthClient {
  const auth = createCoreOAuthAppAuth(config);
  const subscribe = createSubscriber((update) => auth.onStateChange(update));
  return {
    ...auth,
    get state() {
      subscribe();
      return auth.state;
    },
  };
}
```

Spread copies every entry off `auth`. The getter declared after the spread
redefines `state` as a reactive property. JavaScript guarantees the override
wins because it comes later in the object literal.

This file used to be thirty lines. The previous version named each of the
seven entries explicitly: `signOut() { return auth.signOut(); }` and so on
for six methods, plus the reactive `state` getter. Once I noticed that six of
the seven entries were doing nothing but forwarding arguments, the spread
became obvious. The cost of writing the long version first was understanding
why the short one works.

## The Recipe

Both flavors reduce to:

```ts
function adapt(source) {
  const subscribe = createSubscriber((update) => {
    // Subscribe to whatever event signals a change on `source`.
    // Return a cleanup function (or return what the source's
    // subscribe method already returns, if it gives you one).
  });

  return {
    ...source, // include only if source has methods worth forwarding
    get value() {
      subscribe();
      // Read whatever you want to expose reactively.
      // Often it's source.something, or source.method(args), or a
      // freshly computed value derived from source.
      return source.value;
    },
  };
}
```

`source.value` in the recipe is a stand-in for "whatever the reactive read
returns." In the Y.Doc example it was `encodeStateAsUpdate(ydoc).byteLength`.
In the KV example it was `kv.get(key)`. In the auth example it was
`auth.state`. The shape of that line depends on what your source exposes; the
shape of `subscribe()` right above it does not.

The object spread is the part most people miss. If the source already has
methods you want to expose, JavaScript will copy them for you. You don't have
to hand-list them.

## Where Svelte Shows This Off

The canonical reference is the `MediaQuery` class in Svelte's own source.
Same shape: wraps `window.matchMedia`, holds a `createSubscriber` result,
exposes a `current` getter that calls `subscribe()` and returns the
underlying value. `fromStore` in `svelte/store` is the same pattern again,
applied to Svelte stores.

If the framework's own examples are doing this in three to five line bodies,
your adapter wrapping `AuthClient` or `Y.Doc` or `Kv` is the same job. The
class-shaped instinct ("I need to re-declare every method") is what creates
the ceremony. Spread the source, override one getter, done.
