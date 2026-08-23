# Annotated PR Body Examples

## When To Read This

Read when you want a full worked body to imitate. Each example names the pattern it demonstrates, why it works, and when to reach for it. The patterns themselves live in [body-patterns.md](body-patterns.md); the diagrams live in [visual-patterns.md](visual-patterns.md).

## Focused Fix

```md
Drawers with long content overflow without scrolling, which makes it impossible to reach content below the fold on mobile.

Wrapping the rendered children in a `flex-1 overflow-y-auto` container fixes the layout. The drag handle keeps its natural height, and only the body becomes scrollable.
```

- **Pattern:** focused fix.
- **Why it works:** opens with the user-visible failure, gives the exact mechanical fix, adds no headings or test transcript.
- **Imitate when:** a narrow bug or UI correction that a reader can hold in their head.

## API Guide

````md
Workspace actions are now defined once and mounted by each runtime. The old shape forced the CLI and HTTP server to each describe their own command contract, so the schema, handler, and route names could drift.

## Define Actions

```ts
const actions = {
  posts: {
    create: defineMutation({
      input: type({ title: "string" }),
      handler: ({ title }) => client.tables.posts.create({ title }),
    }),
  },
};
```

The action map is runtime-neutral. The CLI turns it into commands, the server into routes:

```ts
const cli = createCLI(client, { actions });
const server = createServer(client, { actions });
```

## Inference

The handler input is derived from the runtime schema, so the implementation does not need a duplicate TypeScript type.

## Migration

Move per-runtime command definitions into the shared action map, then mount that map in each adapter.
````

- **Pattern:** API or feature guide with concept headings.
- **Why it works:** reads like a small guide, shows the call site before explaining inference, uses concept headings rather than `## Summary`.
- **Imitate when:** a PR adds or reshapes a public surface a reviewer cannot judge without seeing the call site.

## Refactor Or Architecture Guide

````md
The workspace encryption layer answered a question we stopped asking: can the relay read this data? A `@epicenter/encryption` package derived a per-owner keyring with HKDF, `/api/session` served that keyring on every sign-in, `createWorkspace` took it as a parameter, and an encrypted key-value wrapper ciphered every row on its way into Yjs. All of that protected workspace data from a relay we now trust.

The trusted-relay direction answers the question once, at the topology instead of per row: either Epicenter runs the relay and reads plaintext, or you run your own anchor and nobody else sees it. Client-side encryption stopped earning its place, so it comes out.

```ts
// Before: keyring threads from auth into construction
const workspace = createWorkspace({ id, keyring: signedIn.keyring, tables, kv });
```

```ts
// After: plaintext stores, no keyring to thread
const workspace = createWorkspace({ id, tables, kv });
```

The deletion cascades past the call site. The keyring no longer rides through `PersistedAuth`, `ApiSessionResponse`, or the `SignedIn` payload, and the encrypted-row read state goes with it.

```txt
Before: @epicenter/encryption
  |-- HKDF keyring derivation
  |-- /api/session keyring serving
  |-- createWorkspace({ keyring }) parameter
  `-- encrypted key-value wrapper + unreadable read state

After: (deleted)
  `-- createWorkspace({ id, tables, kv }) writes plaintext rows
```

The trade-off is explicit: workspace data now sits in plaintext wherever the relay stores it, so the privacy guarantee rests on who runs the anchor rather than on a key the client holds. That is the trusted-relay bet, written down. One simplification came along for the ride: table `scan()` drops from four buckets to three, because the `unreadable` bucket only ever modeled a row encrypted with a key this device lacked.

Net change across 44 files: about 1,000 lines deleted.
````

- **Pattern:** disproportionate complexity, before and after, composition tree, came along for the ride, casual closing stats.
- **Why it works:** opens by naming the question the machinery answered and why it stopped mattering, shows code before the prose gets abstract, names the trade-off instead of hiding it, subordinates the bonus, closes with scope after the story.
- **Imitate when:** a refactor or a deletion collapses machinery and the reader needs to know what guarantee changed.

## Feature PR

````md
The tab-manager extension needs to tell a browser extension to close tabs, open URLs, and list devices. Epicenter already syncs shared state between devices through a Durable Object relay, but sync is one-way: you can read shared state, you cannot ask another device to do something. That gap is what this PR fills.

Getting there required fixing a few things that were already slightly wrong, and the journey ends with the `sync-client` package collapsing into the workspace module.

---

**First, a correction: SYNC_STATUS was documented as a heartbeat but it is not one.**

Liveness is already handled by ping and pong. What SYNC_STATUS tracks is whether the client has local changes that have not reached the server yet, the "Saving" to "Saved" UX.

---

**Now the RPC protocol itself.**

The Durable Object is a dumb relay. It forwards a request to the target peer, or synthesizes a PeerOffline response if they are not connected:

```txt
REQUEST:  [101] [0=REQ] [requestId] [targetClientId] [action] [jsonInput]
RESPONSE: [101] [1=RES] [requestId] [requesterClientId]       [jsonResult]
```

```ts
const { data, error } = await workspace.collaboration.dispatch(
  "tabs_close",
  { tabIds: [1, 2] },
  { to: ext.connId, signal: AbortSignal.timeout(10_000) },
);
```

23 commits on top of the encryption branch. 61 files changed, +3571/-1048. Stacks on #1591; merge that first.
````

- **Pattern:** sequential journey, bold topic sentences with `---`, protocol notation, casual closing stats.
- **Why it works:** opens with the concrete need (tell an extension to close tabs), walks each prerequisite in build order, paces with bold topic sentences, shows the wire format and one dispatch call site, ends with scope and a stacking note.
- **Imitate when:** a multi-part PR builds on itself and the order is the story.

## Release Notes

````md
# 1.2.0

Advancing programmable runtime types.

## Contents

- With Keyword
- Dependent Types
- Breaking

## With Keyword

The `with` keyword assigns JSON Schema options to types.

```ts
const Email = Type.Script(`string with { format: "email" }`);
// { type: "string", format: "email" }
```

## Dependent Types

`Dependent` represents JSON Schema `if` / `then` / `else` conditionals.

```ts
const Response = Type.Script(`{ status: "success" | "error" } & (
  if { status: "success" } then { data: unknown }
  else { message: string, code: number }
)`);
```

## Breaking

### Options Generic In Script

The intrinsic `Options<T, Json>` generic is no longer supported in Script. Use `with` instead.

```ts
// Before
Type.Script("Options<string, { minLength: 10 }>");
// After
Type.Script(`string with { minLength: 10 }`);
```
````

- **Pattern:** release notes.
- **Why it works:** the version heading makes it a durable artifact, the contents list lets readers jump by concept, each feature starts with the smallest example, breaking changes carry old and new usage.
- **Imitate when:** the PR cuts a versioned release or the body will be reused as migration context.

## Bad Template Rewrite

Bad:

```md
## Summary
- Adds dependent types.
- Adds with keyword.
- Updates evaluation.

## Testing
Tests pass.
```

Better:

````md
Runtime scripting can now express JSON Schema constraints inline and model conditionally refined values.

## With Keyword

```ts
const Email = Type.Script(`string with { format: "email" }`);
```

## Breaking

`Options<T, Json>` is no longer intrinsic in Script. Use `with` syntax instead.
````

- **Pattern:** the structure should teach the public surface, not narrate process.
- **Why it works:** the better version drops the process headings and the test transcript, and every heading that remains names a real concept.
- **Imitate when:** you catch yourself reaching for `## Summary` and `## Testing`.
