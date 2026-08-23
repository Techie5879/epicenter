# 0097. Super Chat tool modules receive a host API

- **Status:** Superseded
- **Date:** 2026-07-02
- **Superseded by:** [ADR-0111](0111-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md)
- **Relates:** [ADR-0084](0084-super-chat-shell-is-a-bun-hosted-local-server-not-a-bundled-spa.md), [ADR-0096](0096-local-workspace-persistence-is-environment-injected.md)

## Context

ADR-0084 settled the loader mechanism: trusted TypeScript files load through
Bun's native dynamic `import()`. It did not settle the module contract. That
contract matters because the Super Chat host is meant to ship as a compiled Bun
sidecar, while a vendored third-party `.ts` file may not have runtime access to
the host's `node_modules`. If the file imports runtime values such as
`defineQuery`, `defineMutation`, or TypeBox, it can fail to resolve packages or
create duplicate schema instances.

## Decision

A Super Chat tool module exports a default factory that receives its host API as
an argument. Tool files may import types from `@epicenter/super-chat`, but host
runtime values come from the injected `ToolHost`:

```ts
import type { ToolHost } from '@epicenter/super-chat';

export default function ({ defineQuery, Type, workspaces }: ToolHost) {
	return {
		weather_get: defineQuery({
			description: 'Current weather for a city',
			input: Type.Object({ city: Type.String() }),
			handler: async ({ city }) => `Weather for ${city}`,
		}),
	};
}
```

The injected API includes `defineQuery`, `defineMutation`, `Type`, and a scoped
`workspaces` bag containing the opened apps the host chooses to expose. A module
returns an action registry by default, or a complete `ToolCatalog` when it needs
a custom adapter.

Tool outcomes separate model-facing text from renderer-facing data:
`content` is what the model reads in the next step; `details` is optional
structured JSON for the UI. For action-registry modules, Super Chat derives that
outcome from the action's return value. For custom `ToolCatalog` modules, the
module returns the outcome directly.

## Consequences

Vendored tool files no longer need runtime imports from host packages. Type-only
imports still give authors editor help and erase at transpile time.

The host owns the runtime copies of TypeBox and action helpers, which avoids
dual-package schema hazards and keeps validation consistent with first-party
actions.

Cross-app composition has one deliberate entry point: the injected `workspaces`
scope. A tool can read from Todos and Honeycrisp because the host exposed those
handles, not because it reached into process-global state or imported app
singletons.

This ADR settled what a loaded module exported and what the host passed into it.
ADR-0111 later removed the loader from the v1 shape. Trust prompts,
installed-state tracking, and third-party delivery remain separate work.

## Considered alternatives

Let tool files import runtime helpers directly: rejected because compiled
sidecars and vendored source make module resolution brittle, and duplicate
TypeBox copies can make schema behavior drift.

Use Pi-style virtual modules: rejected. A later review of Pi itself grounded
this: Pi's own extension contract is a default-exported factory that receives a
host API object, which validates `ToolHost`-style injection as the author-facing
shape. What we decline is Pi's jiti/virtual-module loader machinery, because
this ADR intentionally keeps tool files free of ambient runtime imports; a
resolver that intercepts them would reintroduce exactly that surface. Revisit
only if Super Chat tools must run untrusted code or import arbitrary
third-party runtime packages.

Require every module to return a `ToolCatalog`: rejected because most tools are
ordinary actions. Returning an action registry keeps the common path small while
still allowing full catalogs for adapters.
