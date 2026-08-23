# The Definition Travels; Open Is Where It Lands

A workspace definition is connection-free on purpose. `defineWorkspace({ id, tables, kv, actions })` names the tables, the KV slots, and the actions that need nothing but those. No IndexedDB, no WebSocket, no browser filesystem, no `signedIn` session. That is what lets one file be imported by the browser, the daemon, and the test runner without dragging any of their code along. The definition is the part that travels.

`.open(connection, compose)` is where it lands in one environment. Connection data (`signedIn`, `nodeId`) only exists at runtime. A browser has a Yjs filesystem and `just-bash`; the daemon has `better-sqlite3` and a disk; a test has neither. The split between define and open is the isomorphism boundary drawn in time: define happens at build time and travels everywhere, open happens at runtime and commits to one place. You cannot merge them, because merging would force connection data, and the environment's imports, into the file everyone shares.

Two files make this concrete. The definition imports nothing environmental:

```ts
// opensidian.ts  (imported by browser, daemon, and tests)
export const opensidianWorkspace = defineWorkspace({
  id: OPENSIDIAN_ID,
  tables: { files, conversations, chatMessages, toolTrust },
  kv: {},
  actions: () => defineActions({}),   // the isomorphic action set
});
```

The browser opener imports the browser:

```ts
// opensidian.browser.ts  (imported only by the browser entry)
export function openOpensidianBrowser({ signedIn, nodeId }) {
  return opensidianWorkspace.open({ ...signedIn, nodeId }, (workspace) => {
    const fs   = attachYjsFileSystem(workspace.ydoc, workspace.tables.files, ...);
    const bash = new Bash({ fs, cwd: '/' });
    const actions = defineActions({
      ...workspace.actions,                        // keep the isomorphic set
      files_search: defineQuery({ handler: ({ query }) => fs.search(query) }),
      bash_exec:    defineMutation({ handler: ({ command }) => bash.exec(command) }),
    });
    return { fs, bash, actions };
  });
}
```

## Actions come in three tiers, and the tier decides where it lives

The thing that makes this layout earn itself is that actions form a dependency lattice. An action lives wherever its dependencies can live.

```txt
Tier 1  isomorphic      needs only tables/kv      runs anywhere      defineWorkspace
Tier 2  env-capability  needs fs/bash/sqlite       one environment    the open() composer
Tier 3  infrastructure  pure ydoc -> disk          not an action      after open() returns
```

Tier 1 is fuji's `entries_get`, whose handler is `tables.entries.get(id)`. It touches nothing but the table API, which exists in every environment, so it goes in the definition and the daemon serves it the same as the browser.

Tier 2 is opensidian's `files_search`, whose handler calls `fs.search(query)`. That `fs` is a browser Yjs filesystem. The definition file is imported by the daemon and by tests, so it cannot name `files_search` without pulling browser code into a daemon process. Tier 2 has to enter later, in a file only the browser imports.

Tier 3 is a materializer like `attachMarkdownExport`: it listens to the Y.Doc and writes `.md` files. Nothing dispatches it, so it is not an action at all. It attaches after `open()` returns, wrapping the workspace, and never enters the composer.

## Why environment actions arrive as a callback, not a method

The obvious alternative is to put the environment on the definition: `opensidianWorkspace.openBrowser()` and `opensidianWorkspace.openNode()`. It dies immediately. For the definition object to expose `.openNode()`, `opensidian.ts` has to import the Node opener, which puts `better-sqlite3` in the browser bundle. The whole point of the isomorphic file is that it imports nothing environmental. A method that names an environment breaks that on the first character.

The callback inverts the dependency the right way. `opensidian.browser.ts` imports the browser, builds `fs` and `bash`, and hands a closure *in* to a definition that still imports nothing. The environment code stays in the environment file. The definition stays clean.

There is a second reason the callback has to run *inside* `open()` rather than after it. `open()` is the construction point for the final runtime bundle: it builds the base workspace, lets the environment add its handles and actions, then wires storage and collaboration around that result. A Tier 2 action that is not present by then is not part of the runtime's local registry. So the registry has to be final before `open()` returns, which is exactly when the composer runs. The composer is not decoration on top of `open()`; it is the one window where an environment can add a served action before the runtime closes.

## You cannot statically read what you cannot import

This layout has a consequence worth stating plainly, because it looks like a limitation and is actually a law. You can enumerate Tier 1 actions anywhere: build a throwaway workspace, call the isomorphic builder, read the metadata. You cannot enumerate Tier 2 actions from a process that does not import their environment. Reading opensidian's `files_search` from a Node script would require loading the browser filesystem in Node, which is the precise thing isomorphism forbids.

So there is no static, cross-environment list of every action. There cannot be. What there is instead is the runtime registry: each node, in its own environment, can project its live actions to metadata (`toActionMeta`). The daemon `/list` route, AI tool discovery, and CLI flag generation all read that local registry, and they all run in the environment that has the actions. Every introspection need that physically can be served is served. The one that cannot be served is the one that would require importing two environments at once.

## Does open() earn the wrapper around it?

It is fair to look at `openOpensidianBrowser` calling `opensidianWorkspace.open` and ask why there are two layers. They are different jobs. `.open()` is the engine: build the Y.Doc, connect each child-doc cache, run the composer, wire IndexedDB and collaboration, order the dispose chain, build `wipe()`. That sequence is identical for every app, and getting the dispose order wrong is a real bug, so it belongs in one place. The wrapper is the adapter: translate this app's auth shape into a connection, and add this environment's handles and actions.

The wrapper's weight is proportional to the work. Opensidian's is 150 lines because the browser composition is real. Fuji's is three:

```ts
export function openFujiBrowser({ signedIn, nodeId }) {
  return fujiWorkspace.open({ ...signedIn, nodeId });
}
```

Fuji has no Tier 2 actions, so its wrapper is almost pure convention: a named mount point, a type export, an auth-shape adapter. You could inline it at the single call site and lose nothing today. It stays for uniformity, and because the seam is already in place the day fuji grows a browser-only action. There is no fixed ceremony tax; a thin wrapper means the app has little environment-specific work, which is the honest signal to send.

## The rule

```txt
Where does it go?

Needs only tables/kv (Tier 1)?
  -> defineWorkspace. It travels. Every environment serves it.

Needs an environment handle, and something dispatches it (Tier 2)?
  -> the open() composer. The environment file owns the import;
     the composer is the window before collaboration wires.

A side-effect projection nothing dispatches (Tier 3)?
  -> after open() returns. It never enters the cycle.
```

The definition holds what is true in every environment. `open()` is where one environment walks in and adds what only it can offer. Keep the definition connection-free and it stays importable everywhere; that property is the whole reason the rest of the system composes.
