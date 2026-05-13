---
name: indirection-audit
description: Audit code for unnecessary indirection and inlineable seams. Use when the user mentions inlining, reducing indirection, deps drilling, dependency objects, test-only seams, fake adapters, too many layers, pass-through helpers, or testing Hono/WinterCG request handlers directly.
---

# Indirection Audit

Use this skill when code feels indirect, adapter-heavy, or shaped around tests
instead of production readability.

The goal is not to delete every helper. The goal is to keep only the layers
that own a real invariant.

## Core Rule

```txt
Inject when the caller has a real alternate runtime to provide.
Inline when the dependency object just re-packages values already owned by the current layer.
```

Testing independence is not free. If a pure helper exists mainly so tests can
avoid the real boundary, question it. A small integration-shaped test is often
clearer than production code full of dependency bags.

## Audit Checklist

Start with call sites, not helper names.

```txt
1. Count callers for each helper, adapter, deps object, wrapper, and factory.
2. Inline the helper mentally into its call sites.
3. Ask what invariant disappears if the helper is deleted.
4. Ask whether the dependency object represents a real runtime swap.
5. Check whether tests are the only consumer of the extra seam.
6. Prefer testing the public boundary when the boundary is cheap and standards-shaped.
```

## Keep The Layer When

- It parses or validates unsafe input once.
- It owns a domain invariant with a name worth preserving.
- It hides platform-specific behavior from multiple real callers.
- It represents a real runtime capability swap, not just test mocking.
- It shortens several production call sites without hiding important control flow.
- It protects a public package contract.

## Inline The Layer When

- The caller already owns every value in the dependency object.
- The helper has one production caller and exists mostly for tests.
- The helper name is less clear than the code it hides.
- The wrapper immediately calls one method and returns the result.
- The abstraction preserves old boundaries after ownership moved.
- Tests can exercise the real request, command, or factory boundary cheaply.

## Hono And WinterCG Request Handlers

For Hono, Worker, and WinterCG-compatible request handlers, prefer testing the
request-facing resolver when the behavior is request policy:

```typescript
const { data, error } = await resolveRequestAppAccessTokenUser(c);
```

Avoid production-only dependency bags like this when they only replay Hono
context values:

```typescript
await resolveBearerUser({
	authorization,
	audience,
	issuer,
	jwksUrl,
	findUserById,
	verifyAccessToken,
});
```

The request owns `Authorization`. The app context owns `authBaseURL`. The
database context owns the user lookup. Keeping those together is usually easier
to read than drilling them through a resolver object.

## Test Shape

Use the thinnest test boundary that still matches production behavior.

```txt
Prefer:
  request-shaped fake context
  real Request/Response where cheap
  Hono app.request() for mounted middleware and routes

Question:
  test-only pure helpers
  single-use dependency bags
  fake service interfaces wider than the production need
  mocks that force production code to export internals
```

If the real boundary is expensive, nondeterministic, or network-bound, keep a
small injected capability. Name the capability in the caller's language.

## Output Shape

When reporting an audit, use this shape:

```txt
Inline candidates
file:line  helper/deps/wrapper
  why: what value it repackages or what branch every caller already knows
  change: what to inline into which caller
  tests: how to test the public boundary after inlining

Keep
file:line  helper/deps/wrapper
  why: the invariant or runtime swap it owns
```

For implementation, make one coherent simplification at a time. Update tests
to exercise the new public boundary, then remove stale docs and old names.
