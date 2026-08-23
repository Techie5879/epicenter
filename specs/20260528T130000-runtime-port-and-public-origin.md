# Runtime port and public origin

Status: public-origin slice DONE (2026-05-28). Full runtime port: FUTURE WORK, not scheduled.

## Problem

`@epicenter/server` is Hono based and nominally portable, but `createServerApp()`
reads Cloudflare primitives straight off `c.env`: Hyperdrive, KV, R2, Durable
Objects, and `executionCtx.waitUntil`. The library cannot run on Node/Bun today
without rewriting those reads.

The first and smallest instance of that coupling was the **public origin**
(Better Auth `baseURL`, OAuth issuer, token audience). It was stored three ways
that could drift:

```
packages/constants/src/apps.ts   PRODUCTION_API_URL = 'https://api.epicenter.so'   source of truth
apps/api/wrangler.jsonc          vars.API_BASE_URL  = 'https://api.epicenter.so'   hand-copied duplicate
apps/api/scripts/dev.ts          API_BASE_URL       = 'http://localhost:8787'      hand-typed localhost
```

and the dev override initially leaned on `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`
plus an `rm .dev.vars` dance, because the flag is silently ignored when a
`.dev.vars` file exists.

## What shipped (public-origin slice)

The library stopped reaching for a shared `c.env` var name. Each deployable now
hands `createServerApp` a `resolveOrigin(env)` function, so the hosted cloud and
a self-host answer the origin question differently without the library branching:

```ts
// packages/server/src/server-app.ts
export type CreateServerAppOptions = {
  resolveOrigin: (env: Cloudflare.Env) => string;
};
export function createServerApp({ resolveOrigin }: CreateServerAppOptions): Hono<Env>

// apps/api (hosted): bake the constant, dev overrides
createServerApp({ resolveOrigin: (env) => env.API_PUBLIC_ORIGIN ?? PRODUCTION_API_URL });

// apps/self-host (self-hosted instance): operator config, required
createServerApp({ resolveOrigin: (env) => env.API_PUBLIC_ORIGIN });
```

Consequences:

- `API_BASE_URL` renamed to `API_PUBLIC_ORIGIN` everywhere (it drives cookies and
  asset URLs, not only auth, so `AUTH_*` would under-scope it).
- `apps/api/wrangler.jsonc` no longer carries the origin var at all. Production
  bakes `PRODUCTION_API_URL` from `@epicenter/constants`; `API_PUBLIC_ORIGIN` is a
  dev-only injected override (declared optional in `apps/api/api-public-origin.d.ts`).
- `dev.ts` passes `--var API_PUBLIC_ORIGIN:${localUrl(APPS.API)}`, derived from
  the same `APPS` source of truth the dashboard proxy and OAuth seed read. The
  port cannot drift. Infisical still supplies required secrets through
  `process.env`; Wrangler's `secrets.required` config loads those without the
  broad `CLOUDFLARE_INCLUDE_PROCESS_ENV` bridge.
- `localUrl` is now literal-typed: `localUrl(APPS.API)` infers
  `"http://localhost:8787"`. Consumers widen to `string` at the Better Auth
  `trustedOrigins` boundary on purpose (a `readonly` tuple leaks into the inferred
  `Auth` type and breaks the OAuth metadata helpers).

## Why `resolveOrigin` is a function, not a string

On Cloudflare Workers, `env` does not exist at module scope, so the origin must be
resolved per request inside middleware. The hosted constant and the self-host
config also genuinely differ. `resolveOrigin(env)` captures both: the library
stays origin-agnostic; each deployable owns its own answer.

## Future: the full runtime port

`resolveOrigin` is the first slice of a runtime port that would let the library
run on Node/Bun. The agreed shape:

```ts
type Runtime = {
  publicOrigin: string;            // already factored out as resolveOrigin
  db(): Database;                  // Hyperdrive client | pg pool
  sessionStore: SecondaryStorage;  // KV               | redis / memory
  assets: BlobStore;               // R2               | s3 / fs
  rooms: Rooms;                    // Durable Objects  | in-process
  afterResponse(p: Promise<unknown>): void; // waitUntil | awaited queue
};
createServerApp(runtime: Runtime) // library depends on Runtime, not Cloudflare.Env
```

The codebase already half-imagines this: `server-app.ts` notes "a future Bun
backend wires its own in-process Rooms here," and `EPICENTER_API_URL` in constants
already does the `process.env ?? PRODUCTION_API_URL` dance for Node consumers.

Do NOT build the rest of the port now. There is no Node host, and `apps/self-host`
is also Cloudflare. Build it when a second runtime is real; each deployable
constructs its own `Runtime` at the `apps/*` edge and `packages/server` only
consumes the port.

## Out of scope (investigated, deliberately not done)

- **`dev.ts` to a package.json one-liner.** The Infisical login pre-check and
  cross-platform env injection justify the small script. The SPA `mkdir` is one
  line; the script is not bloated by SPA hosting.
- **Native SPA fallback (`not_found_handling: single-page-application`).** Does
  not cleanly serve the nested `/dashboard/index.html` base path; the six-line
  manual `ASSETS.fetch` handler in `worker/index.ts` is the correct workaround.
  Leave it.
- **Generating `.dev.vars`.** Would write Infisical secrets to disk; the current
  process.env plus `wrangler dev --var` path is better hygiene.
```
