# Self-Host as a First-Class Deployment Target

**Date**: 2026-05-14
**Status**: Proposed
**Composes with**:
- `docs/articles/if-you-dont-trust-the-server-become-the-server.md` (the trust-model anchor)
- `specs/20260514T200000-api-me-three-field-token-bundle.md` (auth surface the self-hosted server must serve)
- `specs/20260514T120000-machine-auth-oob-clean-break.md` (OOB CLI flow that must point at the self-hosted instance)

## One Sentence

```
A self-hoster runs `bun install && bun run setup && bun run start`
against the same `apps/api` source tree and gets a working Epicenter
hub, because every Cloudflare binding is fronted by a tiny adapter
interface that swaps to a Bun-native implementation when
`EPICENTER_RUNTIME=bun` is set.
```

This is the cohesion sentence. The self-hosted build is the same source tree, the same `app.ts`, the same Hono routes, the same Better Auth, the same Drizzle schema. The only thing that differs is which adapter the runtime composition root selects at boot. No second binary, no second codebase, no compat layer that translates between them.

## Motivation

The hosted SaaS uses server-managed encryption: Epicenter holds `ENCRYPTION_SECRETS`, derives per-user keys, and ships them on sign-in. That trust boundary is convenient for users who don't want to run infrastructure. It is unsuitable for users who specifically distrust the operator. Path B (documented in the trust-model article) says: rather than re-introduce zero-knowledge encryption's permanent feature tax, give the second cohort a working self-host. They become the operator they trust.

"Working self-host" is the load-bearing phrase. It is not a tarball with `TODO` markers. It is not "you can hack on this." It is a documented deployment story a competent developer can complete in ~30 minutes, ending in a running `apps/api` they can sign into from a browser.

```
Hosted (today):       CF Workers + Hyperdrive + KV + R2 + Durable Objects
                      Epicenter holds ENCRYPTION_SECRETS

Self-hosted (v1):     One Bun process on a VPS or home server
                      Postgres on the same box (or RDS, or wherever)
                      Local filesystem for assets
                      Self-hoster holds ENCRYPTION_SECRETS
                      Same /api/me, same /rooms/:room, same OAuth dance
```

## Current State

The hub server (`apps/api`) is a Hono app married to Cloudflare Workers bindings. Concretely:

```
apps/api/src/app.ts
  - imports `pg` and constructs a per-request pg.Client
  - reads c.env.HYPERDRIVE.connectionString
  - reads c.env.ASSETS (Workers Static Assets binding)
  - reads c.env.SESSION_KV
  - reads c.env.ASSETS_BUCKET (R2)
  - calls c.env.ROOM.get(c.env.ROOM.idFromName(...)) (Durable Objects)
  - uses c.executionCtx.waitUntil() in finally blocks

apps/api/src/auth/create-auth.ts
  - secondaryStorage: { get/set/delete } -> env.SESSION_KV (CF KV)
  - drizzleAdapter(db, { provider: 'pg' })  (already Postgres)
  - email/password enabled in BASE_AUTH_CONFIG
  - Google OAuth keyed off env.GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET

apps/api/src/room.ts
  - `export class Room extends DurableObject`
  - SQLite-backed DO storage for the Yjs update log
  - Hibernation API (ctx.acceptWebSocket, webSocketMessage, webSocketClose)
  - `stub.sync()` and `stub.getDoc()` RPC entrypoints
  - `stub.fetch(request)` for WebSocket upgrades

apps/api/src/asset-routes.ts
  - reads/writes env.ASSETS_BUCKET (R2)
  - Drizzle row in `asset` table tracks every upload

apps/api/wrangler.jsonc
  - declares every binding the worker reads
  - "secrets" block lists required env vars
  - Smart Placement pinned to aws:eu-central-1

packages/constants/src/oauth.ts
  - EPICENTER_TRUSTED_OAUTH_CLIENTS is a hardcoded const array
  - clientIds, redirect URIs, runtimes all baked into the published constant
  - apps/api/src/auth/trusted-oauth-clients.ts upserts the array on every request
```

The Drizzle schema is already vanilla Postgres (`drizzle-orm/pg-core`); the Better Auth adapter is already `'pg'`. The Yjs protocol is runtime-agnostic. The pieces that resist a Bun lift are exactly five: Hyperdrive (drop, use plain pg), SESSION_KV (drop, sessions in Postgres directly), R2 (replace with local filesystem), Workers Static Assets (replace with Hono's `serveStatic` from `@hono/node-server` or `Bun.file`), and Durable Objects (replace with a single in-process Map<doName, Y.Doc>).

## Problems

```
P1. Hyperdrive is a Cloudflare-only binding.
    apps/api/src/app.ts:138 reads c.env.HYPERDRIVE.connectionString.
    Without Hyperdrive on Bun, this throws.

P2. SESSION_KV is a Cloudflare-only binding.
    apps/api/src/auth/create-auth.ts:158-164 reads env.SESSION_KV.
    A self-hoster has no KV. Better Auth supports running without
    secondaryStorage, but the code path is hardcoded to require it.

P3. ASSETS_BUCKET is R2 (S3-shaped, CF-specific access).
    apps/api/src/asset-routes.ts uses env.ASSETS_BUCKET.put/get/delete.
    A self-hoster has no R2.

P4. ASSETS is the CF Workers Static Assets binding.
    apps/api/src/app.ts:394-405 reads c.env.ASSETS.fetch(...).
    A self-hoster needs a static-file server for /dashboard/*.

P5. ROOM is a Durable Object namespace.
    apps/api/src/app.ts:455-464 calls c.env.ROOM.get(c.env.ROOM.idFromName()).
    apps/api/src/room.ts:123 is `class Room extends DurableObject` with
    `ctx.storage.sql`, `ctx.acceptWebSocket`, `ctx.storage.setAlarm`.
    None of these exist on Bun.

P6. Trusted OAuth clients are hardcoded to production.
    packages/constants/src/oauth.ts lists redirect URIs pinned to
    https://api.epicenter.so/dashboard/auth/callback (and friends).
    A self-hoster at https://epi.alice.example needs the redirect URIs
    rewritten or a different mechanism for client registration.

P7. There is no "self-host" entrypoint.
    `bun run dev` runs `wrangler dev`. There is no `bun run start`.
    package.json has no Bun-based serve script.

P8. There is no setup script.
    A new self-hoster has to figure out: which env vars are required,
    how to generate ENCRYPTION_SECRETS, how to run migrations, how
    to seed the trusted OAuth clients, how to choose a port.

P9. The OOB CLI flow defaults to production.
    packages/auth/src/create-oauth-app-auth.ts:73 defaults
    `baseURL = EPICENTER_API_URL` (= 'https://api.epicenter.so').
    A self-hoster running `epicenter auth login` lands on the
    hosted portal, not their own instance.

P10. The README does not document any of this.
     apps/api/README.md (if it exists) is silent on self-hosting.
     The trust-model article makes a promise the codebase does not keep.
```

## Desired State

```
$ git clone https://github.com/EpicenterHQ/epicenter
$ cd epicenter
$ bun install

$ cat apps/api/.env.example      # commit a template that lists every var
DATABASE_URL=postgres://...
ENCRYPTION_SECRETS=1:...         # openssl rand -base64 32, then "1:<value>"
BETTER_AUTH_SECRET=...           # openssl rand -base64 32
PORT=8787
PUBLIC_BASE_URL=http://localhost:8787
ASSETS_DIR=./assets-storage      # local filesystem path
# Optional. If unset, only email/password works.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

$ cp apps/api/.env.example apps/api/.env
$ vim apps/api/.env               # fill in DATABASE_URL etc

$ bun run --cwd apps/api setup    # one command, idempotent:
                                  #   runs drizzle-kit migrate
                                  #   seeds trusted OAuth clients
                                  #   verifies ENCRYPTION_SECRETS shape
                                  #   creates ASSETS_DIR if missing
                                  #   prints next-step hint

$ bun run --cwd apps/api start    # boots the Bun server on PORT
> [api] listening on http://localhost:8787
> [api] runtime: bun
> [api] auth: email/password + (google: disabled)
> [api] assets: local filesystem (./assets-storage)
> [api] rooms: in-process (1 process, no replication)

$ open http://localhost:8787/sign-in
# Sign up with email/password. /api/me returns your user record.
# /rooms/:room sync works over HTTP and WebSocket.
```

The 30-minute setup target includes installing Postgres (or pointing at an existing one) and copying-pasting four secrets into `.env`. The remaining steps are the four commands above.

For the CLI:

```
$ EPICENTER_API_URL=http://localhost:8787 epicenter auth login
# OR
$ epicenter auth login --base-url http://localhost:8787
# Browser opens against the self-hosted portal, OOB code lands locally.
```

For other apps (whispering, fuji, honeycrisp, opensidian, zhongwen, tab-manager): out of scope for v1. The promise we are making in v1 is "the hub works on Bun." The browser-side apps already configure `EPICENTER_API_URL` per build; pointing them at a self-host is a build-time concern, not a runtime feature.

## Architecture

### The five adapters

```
adapter           today (Cloudflare)               self-host (Bun)
--------------------------------------------------------------------
Database          HYPERDRIVE -> new pg.Client      DATABASE_URL -> pg.Pool
Session storage   KV secondaryStorage              none (Postgres directly)
Asset storage     R2 (ASSETS_BUCKET)               local filesystem
Static assets     ASSETS binding (.fetch)          @hono/node-server serveStatic
Yjs rooms         Room Durable Object              in-process Map<doName, Y.Doc>
```

Each adapter has a TypeScript interface and two implementations. The composition root (`apps/api/src/runtime/index.ts`, new) reads `EPICENTER_RUNTIME` and picks one.

### File layout

The split lives under `apps/api/src/runtime/`. Everything outside that directory stays runtime-agnostic.

```
apps/api/src/
  app.ts                          (unchanged shape; reads from c.var, not c.env directly)
  runtime/
    index.ts                      composition root; picks adapters by EPICENTER_RUNTIME
    types.ts                      Adapter interfaces (DbAdapter, AssetAdapter, RoomAdapter, ...)
    cloudflare/
      entry.ts                    `export default app` for `wrangler deploy`
      db.ts                       CF Hyperdrive -> pg.Client
      assets.ts                   R2 (ASSETS_BUCKET) wrapper
      static.ts                   Workers Static Assets wrapper
      rooms.ts                    `getRoom(doName)` -> DO stub wrapper
    bun/
      entry.ts                    `Bun.serve()` driver; reads .env, runs app
      db.ts                       pg.Pool with DATABASE_URL
      assets.ts                   local filesystem (read/write/delete)
      static.ts                   `serveStatic` (or Bun.file) for /dashboard
      rooms.ts                    InProcessRoomRegistry: Map<doName, Y.Doc>
                                    (See "Room adapter contract" below.
                                     Implementation lives in a follow-up spec.)
  room.ts                         the existing DO class (kept for cloudflare/rooms.ts;
                                  bun/rooms.ts does NOT import this file)
```

The split is intentional: `room.ts` continues to subclass `DurableObject` and use `ctx.storage.sql`. The Bun side has a parallel registry that satisfies the same `RoomAdapter` contract without inheriting from `DurableObject`. They share the wire-level Yjs protocol via `@epicenter/sync`, which is already runtime-agnostic.

### Adapter interfaces

```ts
// apps/api/src/runtime/types.ts

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';

/**
 * Per-request DB handle. Cloudflare creates a fresh pg.Client backed by
 * Hyperdrive; Bun checks a pooled connection out of pg.Pool. Both yield
 * the same Drizzle handle shape so app.ts is identical downstream.
 */
export type DbAdapter = {
  /** Acquire a DB handle for the lifetime of one request. */
  acquire(): Promise<{
    db: NodePgDatabase<typeof schema>;
    /** Release MUST be called in a finally block; Cloudflare closes the
     *  client, Bun returns the connection to the pool. */
    release(): Promise<void>;
  }>;
};

export type AssetAdapter = {
  put(key: string, body: ReadableStream | Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the key does not exist (not a thrown error). */
  get(key: string): Promise<{ body: ReadableStream; contentType: string; sizeBytes: number } | null>;
  delete(keys: string[]): Promise<void>;
};

export type StaticAdapter = {
  /** Fetch a static file for /dashboard/*. Returns a Response or null. */
  fetch(request: Request): Promise<Response | null>;
};

/**
 * Yjs room adapter. The contract abstracts over Durable Objects and the
 * in-process registry. See "Room adapter contract" below for semantics.
 */
export type RoomAdapter = {
  /** RPC: full doc snapshot for HTTP bootstrap. */
  getDoc(doName: string): Promise<{ data: Uint8Array; storageBytes: number }>;
  /** RPC: apply client SYNC, return diff if any. */
  sync(doName: string, body: Uint8Array): Promise<{ diff: Uint8Array | null; storageBytes: number }>;
  /** WebSocket upgrade: returns the Response with the upgraded socket. */
  upgrade(doName: string, request: Request): Promise<Response>;
};

export type SessionStorageAdapter =
  | null
  | { get(k: string): Promise<string | null>; set(k: string, v: string, ttl?: number): Promise<void>; delete(k: string): Promise<void> };

export type Runtime = {
  name: 'cloudflare' | 'bun';
  db: DbAdapter;
  assets: AssetAdapter;
  static: StaticAdapter;
  rooms: RoomAdapter;
  /** null on Bun: Better Auth's secondaryStorage is omitted entirely. */
  sessionStorage: SessionStorageAdapter;
  /** Where this server lives. Used everywhere `baseURL` is constructed today. */
  baseURL: string;
  /** Secrets bag; same shape as `Cloudflare.Env`'s secret fields plus PUBLIC_BASE_URL. */
  secrets: {
    BETTER_AUTH_SECRET: string;
    ENCRYPTION_SECRETS: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    AUTUMN_SECRET_KEY?: string;
  };
};
```

The `Cloudflare.Env` type stays. The Bun side constructs an object that satisfies the secret-bag shape from `process.env`. `c.env` is still readable in CF-only code paths; everything else moves to `c.var.runtime`.

### Hono env type

```ts
// apps/api/src/app.ts

export type Env = {
  Bindings: Cloudflare.Env;     // still typed; null at runtime on Bun
  Variables: {
    db: NodePgDatabase<typeof schema>;
    auth: Auth;
    authBaseURL: string;
    user: WorkspaceIdentity['user'];
    afterResponse: AfterResponseQueue;
    planId: string | undefined;
    runtime: Runtime;            // NEW: every adapter call goes through here
  };
};
```

Route handlers stop reaching for `c.env.HYPERDRIVE`, `c.env.ASSETS_BUCKET`, `c.env.ASSETS`, and `c.env.ROOM`. They reach for `c.var.runtime.db`, `c.var.runtime.assets`, `c.var.runtime.static`, `c.var.runtime.rooms` instead. The factory's `initApp` block populates `c.var.runtime` from a module-level `getRuntime()` call.

### Runtime selection

```ts
// apps/api/src/runtime/index.ts

let cached: Runtime | null = null;

export function getRuntime(): Runtime {
  if (cached) return cached;
  const which = process.env.EPICENTER_RUNTIME ?? 'cloudflare';
  cached = which === 'bun' ? createBunRuntime() : createCloudflareRuntime();
  return cached;
}
```

On Cloudflare, `EPICENTER_RUNTIME` is unset; the default branch fires. On Bun, the start script sets `EPICENTER_RUNTIME=bun` before `Bun.serve()`. The middleware that sets `c.var.runtime` reads `getRuntime()` once and reuses the singleton.

### Bun entry point

```ts
// apps/api/src/runtime/bun/entry.ts

import app from '../../app';
import { getRuntime } from '../index';

const runtime = getRuntime();   // 'bun' branch

const port = Number(process.env.PORT ?? 8787);

Bun.serve({
  port,
  fetch(request, server) {
    // Bun.serve does not auto-promote WebSockets; we read the Upgrade
    // header and call `server.upgrade(request, { data: { url } })`.
    // The rooms adapter consumes server.upgrade() via the Bun-side
    // RoomAdapter.upgrade() implementation.
    return app.fetch(request, /* env */ {} as Cloudflare.Env, {
      // executionCtx shim: waitUntil becomes a no-op in single-process
      // Bun (the process stays alive between requests; promises run to
      // completion naturally). We log unhandled rejections.
      waitUntil(p: Promise<unknown>) {
        p.catch((e) => console.error('[waitUntil]', e));
      },
      passThroughOnException() {},
    });
  },
  websocket: {
    /** Bun WebSocket lifecycle delegates to the Bun rooms registry. */
    open(ws) { runtime.rooms /* @ts-expect-error: bun rooms exposes */.onOpen(ws); },
    message(ws, data) { runtime.rooms /* @ts-expect-error */.onMessage(ws, data); },
    close(ws, code, reason) { runtime.rooms /* @ts-expect-error */.onClose(ws, code, reason); },
  },
});

console.log(`[api] listening on http://localhost:${port}`);
console.log(`[api] runtime: bun`);
```

The `@ts-expect-error` annotations indicate that the Bun rooms adapter extends `RoomAdapter` with three Bun-WebSocket lifecycle hooks. The CF adapter does not expose those (its upgrade path returns a Response with `webSocket: clientHalf`); only the Bun side needs them. We will narrow this type once `bun/rooms.ts` lands in the follow-up.

### CF entry point (kept for `wrangler deploy`)

```ts
// apps/api/src/runtime/cloudflare/entry.ts
export { Room } from '../../room';
export { default } from '../../app';
```

`wrangler.jsonc` keeps `"main": "src/runtime/cloudflare/entry.ts"`. The Bun side does not import this file, so `wrangler deploy` and `bun run start` cannot collide.

### Room adapter contract

The Bun-side implementation (`apps/api/src/runtime/bun/rooms.ts`) is OUT OF SCOPE for this spec. The contract it must satisfy is in scope and documented here so consumers can write tests without waiting for the implementation:

```
Contract (RoomAdapter on Bun):
  storage          one row per Y.Doc in Postgres, table `room_doc_log`
                   (room_name TEXT, seq BIGSERIAL, update_v2 BYTEA, created_at)
                   cold-load: SELECT update_v2 ORDER BY seq for room_name
                   compaction: rewrite to single row after gc
                   (port the logic from apps/api/src/room.ts:compactUpdateLog)

  liveness         in-process Map<doName, { doc, websockets, refCount }>
                   evict from memory when refCount === 0 and idle for >5 min;
                   next access re-loads from Postgres

  presence         server-stamped PRESENCE_KEY writes use the same
                   YKeyValueLww<PresenceEntry> wrapper as the DO; the
                   updateTouchesPresence guard is shared from sync-handlers.ts

  WebSocket        Bun.serve() websocket handler; the upgrade(request)
                   method calls server.upgrade(request, { data: { doName, connId, replicaId } });
                   onOpen/onMessage/onClose are the lifecycle hooks
                   wired up in runtime/bun/entry.ts above

  RPC              getDoc(doName) and sync(doName, body) are plain
                   methods on the registry; HTTP routes call them
                   the same way they call stub.getDoc() today

  single-node      one Bun process serves all rooms. No horizontal
                   scaling, no replica fan-out, no DO-style id sharding.
                   A self-hoster who outgrows one box is the trigger
                   to write a v2.
```

The DO and the Bun registry share the wire protocol (`@epicenter/sync`), the presence semantics (`@epicenter/workspace/document/keys`), and the compaction logic (port `compactUpdateLog` verbatim, swap SQLite for Postgres). They diverge on storage substrate, eviction policy, and WebSocket plumbing. That divergence is intrinsic, not a layering accident: Cloudflare Durable Objects are a different operational shape than a long-lived Bun process.

### Static assets on Bun

```ts
// apps/api/src/runtime/bun/static.ts

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DASHBOARD_BUILD = join(import.meta.dir, '../../../../dashboard/build');

export const bunStaticAdapter: StaticAdapter = {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/dashboard/')) return null;
    const relative = url.pathname.slice('/dashboard/'.length);
    const candidate = join(DASHBOARD_BUILD, 'dashboard', relative);
    if (existsSync(candidate)) {
      return new Response(Bun.file(candidate));
    }
    // SPA fallback: serve index.html for client-side routes
    const indexPath = join(DASHBOARD_BUILD, 'dashboard/index.html');
    if (existsSync(indexPath)) {
      return new Response(Bun.file(indexPath), {
        headers: { 'content-type': 'text/html' },
      });
    }
    return null;
  },
};
```

`app.ts` routes for `/dashboard` and `/dashboard/*` change from `c.env.ASSETS.fetch(...)` to `c.var.runtime.static.fetch(c.req.raw)`. The CF adapter's `fetch` wraps `c.env.ASSETS.fetch` and is functionally identical to today's behavior.

### Asset storage on Bun

```ts
// apps/api/src/runtime/bun/assets.ts

import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { lookup } from 'node:dns/promises'; // unused; for example only

const ROOT = process.env.ASSETS_DIR ?? './assets-storage';

export const bunAssetAdapter: AssetAdapter = {
  async put(key, body, contentType) {
    const path = join(ROOT, key);
    mkdirSync(dirname(path), { recursive: true });
    const buf = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    await writeFile(path, buf);
    // contentType is persisted in the `asset` Postgres row, not on disk.
  },
  async get(key) {
    const path = join(ROOT, key);
    if (!existsSync(path)) return null;
    const s = await stat(path);
    return {
      body: Bun.file(path).stream(),
      contentType: 'application/octet-stream', // route handler reads from Postgres
      sizeBytes: s.size,
    };
  },
  async delete(keys) {
    await Promise.all(keys.map((k) => unlink(join(ROOT, k)).catch(() => undefined)));
  },
};
```

The `contentType` for reads comes from the `asset` table, not from the filesystem; the adapter returns a placeholder. `asset-routes.ts` already reads the content type out of Postgres before serving (verify during implementation), so this is non-breaking. R2 stores content-type as object metadata, which the CF adapter preserves end-to-end; the Bun adapter ignores that metadata because the Postgres row is authoritative anyway.

### Database adapter

```ts
// apps/api/src/runtime/bun/db.ts

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../db/schema';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const bunDbAdapter: DbAdapter = {
  async acquire() {
    const client = await pool.connect();
    return {
      db: drizzle(client, { schema }),
      async release() { client.release(); },
    };
  },
};
```

The CF adapter keeps the existing "create a fresh pg.Client per request, end() it on completion" pattern; Bun uses a pool because the process is long-lived. The factory's DB middleware swaps from `new pg.Client(... HYPERDRIVE ...)` to `c.var.runtime.db.acquire()`.

### Better Auth secondaryStorage handling

```ts
// apps/api/src/auth/create-auth.ts (excerpt of the change)

export function createAuth({ db, env, baseURL, runtime }: {
  db: Db;
  env: Cloudflare.Env;
  baseURL: string;
  runtime: Runtime;
}) {
  const authOptionsBase = {
    ...BASE_AUTH_CONFIG,
    database: drizzleAdapter(db, { provider: 'pg' }),
    baseURL,
    secret: runtime.secrets.BETTER_AUTH_SECRET,
    // ... existing config ...
    socialProviders: runtime.secrets.GOOGLE_CLIENT_ID && runtime.secrets.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: runtime.secrets.GOOGLE_CLIENT_ID, clientSecret: runtime.secrets.GOOGLE_CLIENT_SECRET } }
      : undefined,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      storeSessionInDatabase: true,
      cookieCache: { enabled: true, maxAge: 60 * 5, strategy: 'jwe' },
    },
    advanced: createCookieAdvancedConfig(baseURL),
    databaseHooks: { /* unchanged */ },
    trustedOrigins: runtime.name === 'bun'
      ? [baseURL, ...TRUSTED_ORIGINS]
      : TRUSTED_ORIGINS,
    // SecondaryStorage is conditional: present on Cloudflare, omitted on Bun.
    // When omitted, Better Auth reads/writes sessions directly to Postgres,
    // which is fine for single-node deployments.
    ...(runtime.sessionStorage
      ? {
          secondaryStorage: runtime.sessionStorage,
          verification: { storeInDatabase: true },
        }
      : {}),
  };

  return betterAuth({ ...authOptionsBase, plugins: [/* unchanged */] });
}
```

Two behavioral changes:

1. `socialProviders` is `undefined` when Google credentials are absent. Better Auth's email/password remains the always-available default (already enabled in `BASE_AUTH_CONFIG`).
2. `secondaryStorage` is omitted entirely when `runtime.sessionStorage` is null. Sessions then live only in Postgres; cookie cache (5 min) cushions the lookup.

### Trusted OAuth clients on self-host

Today, `EPICENTER_TRUSTED_OAUTH_CLIENTS` is a hardcoded constant with production redirect URIs. Self-hosters need either:

```
Option A (chosen):  config file at apps/api/oauth-clients.local.ts
                    (gitignored), exporting an array shaped identically
                    to EPICENTER_TRUSTED_OAUTH_CLIENTS. The seed function
                    reads this file when EPICENTER_RUNTIME=bun and falls
                    back to the production constant otherwise.

Option B:           admin endpoint POST /api/admin/oauth-clients.
                    Rejected for v1: admin auth, RBAC, and UI cost
                    multiple days to do safely. v2 can add this.

Option C:           env-var-driven shape (TRUSTED_OAUTH_CLIENTS_JSON).
                    Rejected: nested JSON in env is a footgun and the
                    redirect URI list is the kind of thing you want
                    in source control.
```

Concretely:

```ts
// apps/api/src/auth/trusted-oauth-clients.ts (excerpt)

import { EPICENTER_TRUSTED_OAUTH_CLIENTS } from '@epicenter/constants/oauth';
import { getRuntime } from '../runtime';

async function loadTrustedOAuthClients() {
  const runtime = getRuntime();
  if (runtime.name === 'bun') {
    // Lazy dynamic import so the file is optional. Missing file -> CLI client only.
    try {
      const mod = await import('../../oauth-clients.local');
      return mod.EPICENTER_TRUSTED_OAUTH_CLIENTS_SELFHOST;
    } catch {
      // Default: only the CLI client, with redirect URI rewritten to PUBLIC_BASE_URL.
      return [{
        clientId: 'epicenter-cli',
        name: 'Epicenter CLI',
        runtime: 'native',
        redirectUris: [`${runtime.baseURL}/auth/cli-callback`],
      }] as const;
    }
  }
  return EPICENTER_TRUSTED_OAUTH_CLIENTS;
}
```

The setup script creates `apps/api/oauth-clients.local.ts` from a template if it does not exist:

```ts
// apps/api/oauth-clients.local.example.ts (checked in)

import type { EPICENTER_TRUSTED_OAUTH_CLIENTS } from '@epicenter/constants/oauth';

/**
 * Self-hosted trusted OAuth clients. Copy to oauth-clients.local.ts
 * and edit; the .local file is gitignored.
 *
 * Redirect URIs must match what each consumer hits at runtime. For a
 * self-host at https://epi.alice.example, that's the dashboard URL
 * served by THIS process (typically `${PUBLIC_BASE_URL}/dashboard/auth/callback`)
 * plus the CLI callback path.
 */
export const EPICENTER_TRUSTED_OAUTH_CLIENTS_SELFHOST: typeof EPICENTER_TRUSTED_OAUTH_CLIENTS = [
  {
    clientId: 'epicenter-dashboard',
    name: 'Self-hosted Dashboard',
    runtime: 'browser',
    redirectUris: ['https://epi.alice.example/dashboard/auth/callback'],
  },
  {
    clientId: 'epicenter-cli',
    name: 'Epicenter CLI',
    runtime: 'native',
    redirectUris: ['https://epi.alice.example/auth/cli-callback'],
  },
];
```

The redirect URI list deliberately stays in source. Self-hosters editing this file is the same workflow as editing `wrangler.jsonc` on the hosted side: declarative, reviewable, version-controlled.

### Pointing the CLI at a self-host

`packages/auth/src/create-oauth-app-auth.ts` defaults `baseURL` to `EPICENTER_API_URL`. The CLI's `epicenter auth login` is the consumer that today pipes the production URL through that default.

Three layers, in order of precedence:

```
1. CLI flag:           --base-url https://epi.alice.example
2. Environment:        EPICENTER_API_URL=https://epi.alice.example
3. Build default:      'https://api.epicenter.so' (production)
```

The flag wins over the env, which wins over the default. The flag is parsed in `packages/cli/src/commands/auth.ts`; the env read happens in the CLI bin shim (`packages/cli/src/bin.ts`) which exports a single `baseURL` value into the command. The auth package itself does NOT read `process.env.EPICENTER_API_URL` directly: env reads are a CLI concern, not a library concern.

This change is small: a `--base-url` option plumbed into `epicenter auth login`, `epicenter auth status`, and `epicenter auth logout`. The auth package already accepts `baseURL` as a parameter; nothing inside the package changes.

Persisted auth remains in the env-paths machine auth file keyed by API host. If a user switches their CLI between hosted and self-hosted, host-specific files keep the cells separate; the same-user guard at `/api/me` response time still wipes a mismatched cell if an operator reuses a host with a different identity.

### Encryption secrets on self-host

The self-hoster generates and holds `ENCRYPTION_SECRETS`. The format is unchanged: `"1:<base64>"` (or `"2:newer,1:older"` for rotation). The setup script will:

1. Refuse to run if `ENCRYPTION_SECRETS` is unset.
2. Refuse to run if `ENCRYPTION_SECRETS` does not parse cleanly via `parseEncryptionSecrets` from `@epicenter/encryption`.
3. Print the `openssl rand -base64 32` command in the failure message.

This is the same guard `apps/api/src/auth/encryption.ts:13-16` already runs at module load. The setup script triggers it earlier, before the first user signs up.

## Implementation Plan

The work is three waves, each commit-shippable on its own. Wave 1 makes the source tree adapter-shaped without changing CF behavior. Wave 2 fills in the Bun adapters. Wave 3 ships the setup story.

### Wave 1: Adapter scaffolding (no behavior change)

```
NEW    apps/api/src/runtime/types.ts
NEW    apps/api/src/runtime/index.ts                 getRuntime() with cloudflare branch only
NEW    apps/api/src/runtime/cloudflare/entry.ts      moves `export { Room }; export default app`
NEW    apps/api/src/runtime/cloudflare/db.ts         wraps the per-request pg.Client pattern
NEW    apps/api/src/runtime/cloudflare/assets.ts     wraps env.ASSETS_BUCKET
NEW    apps/api/src/runtime/cloudflare/static.ts     wraps env.ASSETS.fetch
NEW    apps/api/src/runtime/cloudflare/rooms.ts      wraps env.ROOM.get(idFromName)
EDIT   apps/api/src/app.ts                           reads c.var.runtime instead of c.env.*
EDIT   apps/api/src/auth/create-auth.ts              accepts runtime param; conditional secondaryStorage
EDIT   apps/api/src/asset-routes.ts                  uses c.var.runtime.assets
EDIT   apps/api/wrangler.jsonc                       main -> src/runtime/cloudflare/entry.ts

Verification:
  - bun run typecheck passes
  - bunx wrangler dev still serves /sign-in, /api/me, /rooms/:room
  - apps/api/src/api-me.test.ts still passes
  - apps/api/src/sync-handlers.test.ts still passes
```

The shape of the diff: every `c.env.X.method(...)` call in `app.ts` and `asset-routes.ts` becomes `c.var.runtime.X.method(...)`. The route bodies stay otherwise identical. `create-auth.ts` gains one parameter (`runtime`) and gains the `socialProviders ?? undefined` + conditional `secondaryStorage` branch.

### Wave 2: Bun adapters + entry point

```
NEW    apps/api/src/runtime/bun/entry.ts             Bun.serve() driver
NEW    apps/api/src/runtime/bun/db.ts                pg.Pool
NEW    apps/api/src/runtime/bun/assets.ts            local filesystem
NEW    apps/api/src/runtime/bun/static.ts            Bun.file + SPA fallback
STUB   apps/api/src/runtime/bun/rooms.ts             throws "not yet implemented"
                                                     until follow-up spec lands
EDIT   apps/api/src/runtime/index.ts                 add `bun` branch
EDIT   apps/api/src/auth/trusted-oauth-clients.ts    loadTrustedOAuthClients() with
                                                     self-host config file fallback
NEW    apps/api/oauth-clients.local.example.ts       template
EDIT   apps/api/.gitignore                           ignore oauth-clients.local.ts
                                                     ignore assets-storage/
                                                     ignore .env
EDIT   apps/api/package.json                         add "start": "EPICENTER_RUNTIME=bun bun run src/runtime/bun/entry.ts"

Verification:
  - bun run --cwd apps/api start boots with DATABASE_URL=postgres://localhost/epicenter
  - GET http://localhost:8787/ returns { mode: 'hub', runtime: 'bun' }
  - GET http://localhost:8787/sign-in serves the sign-in page
  - POST /auth/sign-up/email creates a user (email/password)
  - GET /api/me with a fresh access token returns { user, encryptionKeys }
  - Asset upload writes a file under ASSETS_DIR; asset read serves it back
  - /rooms/:room throws "Bun room registry not implemented yet"
    (planned: the follow-up spec ships the registry)

  Test coverage:
    NEW   apps/api/src/runtime/bun/db.test.ts        round-trip a Drizzle query
    NEW   apps/api/src/runtime/bun/assets.test.ts    put/get/delete a small blob
    NEW   apps/api/src/runtime/bun/static.test.ts    SPA fallback returns index.html
```

The room-registry stub is the conscious cut. v1 ships a working hub for auth, identity, billing, assets, and AI chat. Sync coordination requires the registry, which is its own spec.

### Wave 3: Setup script and documentation

```
NEW    apps/api/scripts/setup.ts                     idempotent setup runner
EDIT   apps/api/package.json                         add "setup": "bun run scripts/setup.ts"
NEW    apps/api/.env.example                         every required and optional var
NEW    apps/api/SELF_HOST.md                         the 30-minute walkthrough
EDIT   apps/api/README.md                            link to SELF_HOST.md
EDIT   packages/cli/src/bin.ts                       read EPICENTER_API_URL env;
                                                     forward to commands as baseURL default
EDIT   packages/cli/src/commands/auth.ts             accept --base-url flag
EDIT   packages/cli/README.md                        document EPICENTER_API_URL +
                                                     --base-url for self-hosters

Verification:
  - On a fresh clone: bun install && cp apps/api/.env.example apps/api/.env
    + fill in DATABASE_URL + BETTER_AUTH_SECRET + ENCRYPTION_SECRETS
  - bun run --cwd apps/api setup runs migrations, seeds clients, exits 0
  - bun run --cwd apps/api start boots
  - epicenter auth login --base-url http://localhost:8787 completes the OOB
    dance against the self-hosted server
  - epicenter auth status against the same base URL returns the user

  NEW   apps/api/scripts/setup.test.ts               smoke-test setup steps in isolation
```

#### Setup script shape

```ts
// apps/api/scripts/setup.ts

/**
 * Idempotent self-host setup. Safe to re-run.
 *
 * Steps (each prints a line, each is independent):
 *   1. Validate ENCRYPTION_SECRETS parses (parseEncryptionSecrets).
 *   2. Validate BETTER_AUTH_SECRET is set and >= 32 bytes base64.
 *   3. Validate DATABASE_URL is set and Postgres reachable.
 *   4. Run drizzle-kit migrate.
 *   5. Seed trusted OAuth clients (loadTrustedOAuthClients() + upsert).
 *   6. mkdir -p ASSETS_DIR.
 *   7. If oauth-clients.local.ts is missing, copy from .example with a note.
 *   8. Print next-step hint: `bun run start`.
 *
 * Each step that fails prints a fix hint (e.g. "Generate a secret with: ...")
 * and exits non-zero. Successful steps print a green check.
 */
```

The script does not start the server. The split keeps `start` runnable in containers without re-running migrations on every boot.

#### .env.example

```
# Required
DATABASE_URL=postgres://user:pass@localhost:5432/epicenter
BETTER_AUTH_SECRET=          # openssl rand -base64 32
ENCRYPTION_SECRETS=          # "1:$(openssl rand -base64 32)"

# Self-host runtime
PORT=8787
PUBLIC_BASE_URL=http://localhost:8787
ASSETS_DIR=./assets-storage

# Optional: Google OAuth (email/password works without this)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional: AI providers (AI chat routes 503 without these)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Optional: Autumn billing (billing routes 503 without this)
AUTUMN_SECRET_KEY=
```

`PUBLIC_BASE_URL` exists so the server knows what URL to put in OAuth metadata, OOB redirect URIs, and CORS allowlists. The setup script writes a derived `TRUSTED_ORIGINS` list (PUBLIC_BASE_URL plus the dashboard origin, which on self-host is typically the same host).

## Verification

```
V1. bun run --cwd apps/api typecheck passes after Wave 1.
    No new `any`, no `// @ts-ignore`, no broken downstream imports.

V2. Wrangler-side regression: bunx wrangler dev still serves /sign-in,
    /api/me, /api/health, /rooms/:room, asset upload/read, and the
    dashboard at /dashboard/. apps/api/src/api-me.test.ts, sync-handlers.test.ts,
    asset-reconciliation tests still pass.

V3. Bun-side smoke: with EPICENTER_RUNTIME=bun and a minimal .env, the
    server binds PORT, responds to GET / with { runtime: 'bun' },
    serves /sign-in HTML, completes an email/password sign-up via
    POST /auth/sign-up/email, returns { user, encryptionKeys } from
    /api/me with the resulting access token.

V4. Asset CRUD on Bun: POST /api/assets uploads a 1KB PNG; GET /api/assets/:id
    returns the bytes; DELETE removes the file from ASSETS_DIR and the
    asset row from Postgres.

V5. Conditional secondaryStorage: Better Auth on Bun creates a session row
    in Postgres on sign-in; sign-out deletes it; cookie cache works (no
    Postgres hit on a freshly-set cookie within 5 minutes).

V6. Setup script idempotence: running `bun run setup` twice in a row
    is a no-op on the second run (migrations skip, OAuth client upserts
    no-op, dir mkdir is idempotent).

V7. Trusted-OAuth-clients selection: with oauth-clients.local.ts absent,
    only the epicenter-cli client is seeded, with redirect URI rewritten
    to `${PUBLIC_BASE_URL}/auth/cli-callback`. With the file present,
    its export wins. The production constant is unused.

V8. CLI base URL override: `epicenter auth login --base-url http://localhost:8787`
    opens the browser at `http://localhost:8787/auth/oauth2/authorize`,
    completes the OOB dance against the self-hosted server, and writes
    an env-paths machine auth file whose `accessToken` validates against the
    self-hosted /api/health endpoint.

V9. Missing optional secret graceful: with GOOGLE_CLIENT_ID unset, the
    sign-in page renders without a "Sign in with Google" button and
    email/password works. With OPENAI_API_KEY unset, POST /ai/chat
    returns a 503 (or a specific "AI provider not configured" message)
    rather than crashing the worker.

V10. /rooms/:room on Bun returns 501 in v1 with a clear message pointing
     to the follow-up spec for the in-process room registry. (This is a
     deliberate cut; the spec is honest about it.)
```

## Out of Scope (v1)

```
O1. Bun-side Yjs room registry implementation.
    The RoomAdapter contract is specified here. The actual
    apps/api/src/runtime/bun/rooms.ts that satisfies it is a follow-up.
    Spec file: TBD; expected path
    specs/<date>-bun-room-registry.md.

O2. SQLite as a Postgres alternative.
    Drizzle's pg dialect is the only one wired up. SQLite support
    would require a parallel schema (Drizzle's sqlite-core types are
    not interchangeable with pg-core), a separate Better Auth adapter,
    and a path for Yjs storage. Deferred to v2.

O3. S3-compatible asset storage on the self-host side.
    The AssetAdapter contract already abstracts over R2 and local FS;
    an S3 backend would slot in as a third implementation. v1 ships
    only the local FS adapter. A self-hoster who needs S3 can write
    the adapter against the documented contract.

O4. Multi-tenant self-hosting.
    A single deployment serves a single Epicenter "instance." There
    is no admin UI for tenant management, no per-tenant routing, no
    isolation primitives beyond what already exists at the user level.

O5. Federation between hosted and self-hosted.
    A user on hosted Epicenter cannot share a room with a user on a
    self-hosted instance. The OAuth issuer is per-deployment. This
    is intentional and aligns with the trust-model: federation across
    trust boundaries is its own design problem.

O6. Other Epicenter apps pointed at self-host out of the box.
    Whispering, Fuji, Honeycrisp, Opensidian, Zhongwen, Tab Manager
    all currently build against EPICENTER_API_URL at compile time.
    A self-hoster building these from source can override the constant,
    but there is no runtime configuration for the browser apps in v1.

O7. Production deployment guides for specific environments.
    The SELF_HOST.md walkthrough describes running on a generic Linux
    VPS with Bun + Postgres. We do not ship a Dockerfile, a systemd
    unit, an nginx config, or a TLS-with-Caddy snippet. The community
    can contribute these.

O8. Automated migrations between hosted and self-hosted.
    Exporting your data from hosted Epicenter and importing it into
    a self-host is not in scope. v1 self-host is for users who want
    to start fresh on their own infrastructure.

O9. Background job runner.
    The hosted side uses `c.executionCtx.waitUntil()` for fire-and-forget
    work (DO instance upserts, Autumn balance zeroing). On Bun the
    shim is "let the promise run; log unhandled rejections." That's
    fine for the current workload. A proper job queue (BullMQ etc)
    is not in v1.

O10. Horizontal scaling.
     One Bun process. Period. A self-hoster who outgrows one box
     should adopt the hosted product or wait for v2.
```

## Open Questions

```
Q1. Should `EPICENTER_RUNTIME` be inferred rather than explicit?
    The presence of `Bun` global vs. CF's `caches`/`fetch` differences
    could auto-detect the runtime. Recommendation: keep it explicit.
    Magic auto-detection in a composition root is exactly where you
    want a boring conditional that grep finds.

Q2. Should the Bun build use Hono's `node-server` adapter instead of
    Bun.serve()?
    @hono/node-server is more battle-tested for Hono + WebSocket
    upgrades; Bun.serve() is faster and gives us native WebSockets
    without the polyfill. Recommendation: Bun.serve() for v1. The
    Hono routing layer is the same either way; only the entry point
    changes if we revisit.

Q3. Where does the `runtime.baseURL` middleware lookup happen for
    `wrangler dev` localhost (where APPS.API.urls[0] is the prod URL
    and we currently rewrite to localhost in app.ts:167-177)?
    Recommendation: the CF adapter handles this rewrite as it does
    today; the Bun adapter reads PUBLIC_BASE_URL directly. The two
    paths converge on a string before reaching create-auth.ts.

Q4. Should the setup script create the Postgres database itself
    (CREATE DATABASE), or assume the operator has done it?
    Recommendation: assume. CREATE DATABASE requires superuser
    privileges, which we should not ask for. The .env.example
    points DATABASE_URL at an already-existing database; the
    script runs DDL inside it via drizzle-kit migrate.

Q5. Drizzle migration paths: the existing apps/api/drizzle/ directory
    contains CF-tested migrations. Are they pure-pg-compatible, or do
    any of them reference Hyperdrive-specific extensions?
    Recommendation: spot-check 0000_equal_thor_girl.sql and
    0001_delete_old_sync_rooms.sql during Wave 1; if pure SQL,
    they apply unchanged on a self-hosted Postgres. Risk is low;
    the schema is plain Drizzle.

Q6. Asset content-type round trip on Bun.
    R2 stores content-type as object metadata; local FS does not.
    asset-routes.ts already persists content-type in the `asset`
    Postgres row at upload time. If any code path reads content-type
    only from the object (not the row), the Bun adapter regresses.
    Recommendation: verify during Wave 2; if the code already reads
    from Postgres, no change. If not, switch it to the row.

Q7. `c.executionCtx.waitUntil()` on Bun.
    The shim above ("let the promise run; log unhandled rejections")
    works because Bun processes don't terminate between requests.
    But fire-and-forget promises whose error handling matters
    (Autumn balance updates) need an explicit logging path. The
    after-response queue's `.catch` block already handles this;
    confirm during Wave 1.

Q8. Should we ship a Dockerfile in v1?
    Recommendation: no, but make it easy to write. The Bun entry
    point reads everything from process.env; the runtime is one
    Bun binary + one Postgres URL. A two-stage Dockerfile is
    ~20 lines. Ship after community feedback.

Q9. License clarity.
    apps/api/package.json says "license": "AGPL-3.0". The trust-model
    article frames self-hosting as a first-class story. AGPL is the
    right answer here, but the README should call this out so
    self-hosters know what running this commits them to.
```

## References

```
Trust model:
  docs/articles/if-you-dont-trust-the-server-become-the-server.md
  docs/articles/let-the-server-handle-encryption.md

Today's hub server (the surface we are lifting):
  apps/api/src/app.ts                            Hono app + per-request DB + room routes
  apps/api/src/room.ts                           Room Durable Object class
  apps/api/src/asset-routes.ts                   R2-backed asset upload/read
  apps/api/src/auth/create-auth.ts               Better Auth + Drizzle + KV secondaryStorage
  apps/api/src/auth/trusted-oauth-clients.ts     ensureTrustedOAuthClients on every request
  apps/api/src/auth/encryption.ts                deriveUserEncryptionKeys + parseEncryptionSecrets
  apps/api/wrangler.jsonc                        all the bindings being replaced
  apps/api/src/db/schema.ts                      pg-shaped Drizzle schema (already portable)
  apps/api/env.ts                                LOCAL_DATABASE_URL parser

OAuth + auth surface:
  packages/constants/src/oauth.ts                EPICENTER_TRUSTED_OAUTH_CLIENTS
  packages/constants/src/apps.ts                 APPS.API.urls[0] = production URL
  packages/auth/src/create-oauth-app-auth.ts     baseURL defaults to EPICENTER_API_URL
  packages/cli/src/bin.ts                        CLI entry; reads env, forwards to commands
  packages/cli/src/commands/auth.ts              `epicenter auth login` etc.

Composes-with specs:
  specs/20260514T200000-api-me-three-field-token-bundle.md  /api/me contract
  specs/20260514T120000-machine-auth-oob-clean-break.md     OOB CLI flow

Yjs sync wire protocol (runtime-agnostic; reused as-is):
  packages/sync/                                 encode/decode/dispatch helpers
  apps/api/src/sync-handlers.ts                  applyMessage, registerConnection,
                                                 teardownConnection, updateTouchesPresence
```

## Decisions log

1. **Adapter interfaces in `apps/api/src/runtime/types.ts`; CF and Bun implementations in sibling directories.** Rejects "compile-time conditional imports" and "two separate apps." The composition root picks one adapter set; everything else is shared. Grep finds every CF-only and Bun-only path by directory.

2. **`EPICENTER_RUNTIME=bun` is an explicit environment variable, not auto-detected.** Magic auto-detection in a composition root is hostile to grep. The CF deploy never sets the variable; the Bun start script always sets it. One conditional, one place.

3. **Postgres required on self-host. No SQLite path in v1.** SQLite would mean a parallel Drizzle schema, a different Better Auth adapter, and a different Yjs storage backend. Each is a multi-day expansion of scope. Self-hosters who want SQLite get v2.

4. **No KV / secondaryStorage on self-host. Sessions in Postgres only.** The cookie cache (5 min) cushions session reads; for a single-node deployment, the round-trip to local Postgres is not the bottleneck. Removing KV simplifies the setup story.

5. **Local filesystem for assets. No S3 abstraction in v1.** The AssetAdapter interface accommodates an S3 backend later, but v1 ships only local FS. The interface is the forward-compat headroom.

6. **Bun-side Yjs room registry is OUT OF SCOPE for this spec.** The RoomAdapter contract is in scope; the implementation is a separate spec because the design space (storage, eviction, presence semantics, WebSocket lifecycle) is large enough to deserve its own document.

7. **Trusted OAuth clients are a config FILE (oauth-clients.local.ts), not an env var or an admin endpoint.** The redirect URI list belongs in source control. The admin endpoint deserves its own auth + RBAC + UI design; pushing it to v2 keeps v1 small.

8. **Email/password is the default auth on self-host. Google OAuth is opt-in.** A self-hoster should not have to register a Google OAuth client to get their server working. `BASE_AUTH_CONFIG.emailAndPassword.enabled` is already true; we only need to make `socialProviders.google` conditional.

9. **The CLI's `--base-url` flag (and `EPICENTER_API_URL` env var) point at the self-host. The auth package itself does NOT read process.env.** The CLI bin layer is where environment reads belong. The auth library accepts `baseURL` as a parameter, full stop.

10. **Single-node only. No horizontal scaling, no replica fan-out.** A self-hoster who outgrows one box is in a different category than v1's target user. v1 says "Path B is a working escape hatch"; it does not say "Path B scales to 100k MAU."

11. **The setup script does NOT create the Postgres database.** CREATE DATABASE requires superuser privileges; we will not ask for them. The operator points DATABASE_URL at an existing database; we run DDL inside it.

12. **No Dockerfile in v1.** Bun + Postgres URL is the runtime; the Bun binary is portable; a community-contributed Dockerfile lands when there is demand. v1 prioritizes the source-tree story; ops packaging is a follow-up.

## Done when (spec is watertight)

```
[x] Five adapters named (DB, AssetStorage, Static, Rooms, SessionStorage)
[x] File layout for runtime/ specified
[x] Adapter interfaces typed in TypeScript
[x] Composition root behavior specified (getRuntime singleton)
[x] Bun entry point shape specified (Bun.serve + WebSocket hooks)
[x] CF entry point shape specified (kept for wrangler deploy)
[x] Room adapter contract specified; implementation deferred to follow-up
[x] Trusted OAuth client loading mechanism specified (config file + fallback)
[x] CLI base URL override mechanism specified (flag > env > default)
[x] Setup script steps enumerated
[x] .env.example contents specified
[x] Three implementation waves with explicit file lists and verification
[x] Out-of-scope items explicit, with v2 home for each
[x] Open questions listed with leaning recommendations
[x] No em or en dashes in spec body (verified by grep)
```

After Braden sign-off, this spec moves from Proposed to Accepted and Wave 1 begins.
