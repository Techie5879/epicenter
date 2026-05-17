# @epicenter/cli

> Introspect and invoke `defineQuery` / `defineMutation` actions exposed by folder-routed daemon extensions, locally or on a peer that's online right now.

Each verb is a one-line shell shortcut for one workspace primitive:

```
                 +--------+---------------------------------------------+
                 | Verb   | Workspace primitive                         |
                 +--------+---------------------------------------------+
   Enumerate     | list   | Object.entries(collaboration.actions)       |
   Invoke        | run    | actions[key](input) or dispatch(peer, ...)  |
   Presence      | peers  | collaboration.peers.list()                  |
                 +--------+---------------------------------------------+

 Supporting systems: auth (machine session), daemon (process lifecycle)
```

## Commands

`epicenter daemon up` opens every `workspaces/<route>/daemon.ts` extension for the project. `list`, `run`, and `peers` dispatch to that local daemon over the project socket.

```bash
epicenter auth login

epicenter daemon up -C ~/vault
epicenter daemon ps
epicenter daemon logs -C ~/vault
epicenter daemon down -C ~/vault

epicenter list -C ~/vault
epicenter list fuji.entries_update -C ~/vault

epicenter run fuji.entries_update '{"id":"entry_1","tags":["triaged"]}' -C ~/vault
epicenter run fuji.entries_update '{"id":"entry_1","tags":["triaged"]}' --peer user-1 -C ~/vault

epicenter peers -C ~/vault
```

`-C` is a start directory for project discovery. Discovery walks upward until it finds `workspaces/` or `.epicenter/`.

## Daemon Extensions

One folder is one route:

```
my-vault/
├── workspaces/
│   └── fuji/
│       ├── daemon.ts
│       └── workspace.ts
└── .epicenter/
```

`workspaces/fuji/daemon.ts` default-exports a daemon workspace module:

```ts
import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';

export default defineDaemonWorkspace({
	async open({ auth, projectDir, route }) {
		// Open the long-lived local runtime.
		// Return { collaboration, [Symbol.asyncDispose] }.
	},
});
```

The folder name is the CLI route prefix. `workspaces/fuji/daemon.ts` exposes actions as `fuji.<action_key>`.

## Scripting

Use scripts for anything beyond one-shot CLI calls:

```ts
import { connectDaemonActions } from '@epicenter/workspace/node';
import type { createFujiActions } from '@epicenter/fuji';

const fuji = await connectDaemonActions<ReturnType<typeof createFujiActions>>({
	route: 'fuji',
});

await fuji.entries_update({ id, tags: ['triaged'] });
```

Scripts get normal TypeScript control flow. The CLI stays small: list, run, peers, and daemon lifecycle.

## Public API

```ts
import { createCLI } from '@epicenter/cli';
```
