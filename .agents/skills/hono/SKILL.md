---
name: hono
description: Hono patterns for TypeScript API routes, middleware, request and response typing, streaming, WebSockets, and Cloudflare Workers deployment. Use when users mention Hono, honojs, Cloudflare Worker handlers, Hono middleware, or Hono route typing.
metadata:
  author: epicenter
  version: '1.0'
---

# Hono

## Reference Repositories

- [Hono](https://github.com/honojs/hono) - TypeScript web framework for edge runtimes and Cloudflare Workers
- [Cloudflare Docs](https://github.com/cloudflare/cloudflare-docs) - Workers, Durable Objects, WebSockets, KV, R2, and deployment docs

## Upstream Grounding

When Hono route typing, middleware order, context variables, response helpers, streaming, WebSockets, or Cloudflare Worker runtime behavior affects correctness, ask DeepWiki a narrow question against `honojs/hono` or `cloudflare/cloudflare-docs` before relying on memory. Use it to orient, then verify decisive details against local installed types, source, or official docs before changing code.

Skip DeepWiki for stable HTTP basics and repo-local API conventions already visible in the code.

## Middleware And Context

- Middleware is onion-style and order-sensitive. Resource setup belongs before auth; auth belongs before protected routes.
- Use `createFactory<Env>()` and `Env['Variables']` to type `c.var` and `c.set()`.
- Middleware that continues must `await next()`. Middleware that rejects or redirects should return the response and skip `next()`.
- Handlers should return Hono response helpers such as `c.json()`, `c.text()`, `c.html()`, or a `Response`.
- On Cloudflare Workers, read bindings from `c.env` and request lifecycle APIs from `c.executionCtx`.
- Register CORS before auth routes when cookie auth or credentialed cross-origin frontend calls are involved.
- Test route behavior with `app.request()` or `testClient` plus mocked bindings and execution context before reaching for a network server.
- Keep WebSocket upgrade detection explicit whenever generic middleware might mutate response headers.
