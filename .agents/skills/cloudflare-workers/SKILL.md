---
name: cloudflare-workers
description: Cloudflare Workers patterns for Worker runtime APIs, Durable Objects, KV, R2, D1, Queues, WebSockets, streaming responses, bindings, wrangler configuration, and deployment limits. Use when users mention Cloudflare Workers, Durable Objects, KV, R2, D1, Queues, wrangler, or edge runtime behavior.
metadata:
  author: epicenter
  version: '1.0'
---

# Cloudflare Workers

## Reference Repositories

- [Cloudflare Docs](https://github.com/cloudflare/cloudflare-docs) - Workers, Durable Objects, KV, R2, D1, Queues, WebSockets, bindings, and deployment docs
- [Hono](https://github.com/honojs/hono) - TypeScript web framework commonly used on Workers

## Upstream Grounding

When Worker runtime behavior, bindings, Durable Objects, WebSockets, streaming, cache APIs, service bindings, compatibility dates, limits, or wrangler configuration affect correctness, ask DeepWiki a narrow question against `cloudflare/cloudflare-docs` before relying on memory. Use `honojs/hono` as the grounding repo when the question is about Hono on Workers.

Verify decisive details against local generated Worker types, source, or official Cloudflare docs before changing code. Skip DeepWiki for stable Web API basics and repo-local deployment patterns already visible in the code.

## Request Lifecycle Rules

- Every async side effect must be awaited, returned, or passed to `c.executionCtx.waitUntil(...)`. Floating promises are unsafe because the isolate can stop after the response.
- Call `waitUntil` as a method on `c.executionCtx`. Do not destructure it.
- Keep `waitUntil` work bounded and best-effort. Use Queues for guaranteed or long-running work.
- For Hyperdrive plus `pg`, create a fresh `pg.Client` per request and close it after all queued work that uses the client settles. Hyperdrive is the pool.
- Node-style database drivers require `nodejs_compat` in Worker configuration.
- Skip generic response-header middleware, including CORS, for WebSocket upgrade requests. The `101` response headers are immutable.
- Put stateful or long-lived WebSockets in Durable Objects. Prefer hibernation-aware APIs when the object owns many idle sockets.
- Trust generated Worker binding types such as `Cloudflare.Env`; regenerate them when bindings or `wrangler` config change.
