# Cloud UI

This package is the hosted API's browser UI. It owns the Svelte surfaces the API serves directly: hosted auth entry, OAuth consent, CLI callback, and the dashboard.

```
Browser route
  -> apps/api Worker serves fallback.html
  -> SvelteKit route renders the UI
  -> Hono and Better Auth keep owning auth policy and auth semantics
```

Auth pages live here because they are user-facing UI, not auth-server machinery. Hono still owns redirects, route ordering, session checks, OAuth metadata, and the Better Auth catch-all. Better Auth still owns sessions, social sign-in, OAuth consent, cookies, and token issuing.

The dashboard remains a pure API consumer. It has no workspace, CRDT, local sync layer, or local billing truth; it reads billing state from the hosted API and writes plan changes through the server.

## Development

Prerequisites: [Bun](https://bun.sh), local Postgres, and Infisical access for the hosted API Worker.

```bash
git clone https://github.com/EpicenterHQ/epicenter.git
cd epicenter
bun install
bun dev:api-dashboard
```

This starts the hosted API Worker on port 8787 and the dashboard UI on port 5178. The Vite dev server proxies `/api` and `/auth` to the local Worker. `bun dev:api-dashboard:ui` runs the UI without the Worker when you already have the API running.

```bash
bun run build
```

The static build writes to `apps/api/ui/build`. The Worker serves `fallback.html` for browser-owned routes and lets the assets binding serve hashed files.

## License

[AGPL-3.0](../../LICENSE). Code Epicenter ships or runs is AGPL-3.0; the MIT surface is the developer toolkit.
