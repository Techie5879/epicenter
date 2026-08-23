# `as*` Helpers Are the Third Part of the Branded-ID Pattern

When a branded ID flows through an arktype schema and into trusted internal call sites, the canonical shape is three exports: the validator, the inferred type, and an `as*` helper that is syntactic sugar for the assertion.

```typescript
import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';

// 1. VALIDATOR: declared first, single source of truth.
export const PrincipalId = type('string').as<string & Brand<'PrincipalId'>>();

// 2. TYPE: derived from the validator.
export type PrincipalId = typeof PrincipalId.infer;

// 3. AS HELPER: syntactic sugar for `value as PrincipalId`.
export const asPrincipalId = (value: string): PrincipalId =>
	value as PrincipalId;
```

That is it. The helper is optional: generators like `generateSavedTabId()` cover the "minted fresh" case, and the validator's `.assert(unknown)` covers the network-boundary case. Reach for the `as*` helper when external typed strings flow in (Better Auth user ids, route params, DB columns) and you want a single named cast site.

## What the Helper Earns

The arktype validator is callable, but its signature is `(value: unknown) => T | ArkErrors`. At a trusted call site that already holds a `string`, you do not want to thread an error result through. The `as*` helper does one thing:

```typescript
export const asPrincipalId = (value: string): PrincipalId =>
	value as PrincipalId;
```

- **Constrained input**: `value: string` rejects accidental `unknown` widenings at compile time.
- **One assertion**: the function body is the only `as PrincipalId` in the codebase.
- **Grep-friendly**: `asPrincipalId(` finds every brand-cast site.
- **Cheap rename**: change the brand or the underlying primitive in the validator and the helper signature follows.

## Where the Helper Fits

```typescript
// Trusted string from another typed source
const principalId = asPrincipalId(c.var.principal.id);

// Test fixture
const cell = {
  principalId: asPrincipalId('user-1'),
  // ...
} satisfies PersistedAuth;

// Schema validation throws: use the validator, not the helper
const parsed = PersistedAuth.assert(JSON.parse(rawCellJson));
```

## What Not to Do

```typescript
// Bad: scattered raw casts
const principalId = c.var.principal.id as PrincipalId;
const another = processString(data as PrincipalId);

// Bad: calling the validator at a trusted site (returns PrincipalId | ArkErrors)
const principalId = PrincipalId(c.var.principal.id); // type is `PrincipalId | type.errors`
```

## JSDoc Convention

Always include a JSDoc above the helper that calls it out as syntactic sugar. The reader should know at a glance that this is a typed cast, not a runtime validator:

```typescript
/**
 * Syntactic sugar for `value as PrincipalId`. The function body is a single typed
 * cast; the constrained `string` parameter is what earns it over a raw `as`
 * (callers can't accidentally widen to `unknown`). The only place in the
 * codebase where `as PrincipalId` appears.
 */
export const asPrincipalId = (value: string): PrincipalId =>
	value as PrincipalId;
```

## When You Do Not Need the Helper

Skip it when:

- The ID is minted fresh in this code: use `generateXxxId()` instead. See [Three Parts, One ID](../articles/three-part-branded-id-pattern.md).
- The branded type is only ever consumed from an arktype-validated schema: `id: PrincipalId` in the schema body already produces a branded value.
- Path-style types that flow through a single `path.resolve()` choke point: cast there once. See [Absolute Path Type Safety](../articles/absolute-path-type-safety.md).

## Naming

`as` + the type name, camelCased: `asPrincipalId`, `asFileId`, `asSavedTabId`. The `as` prefix mirrors the runtime assertion and reads naturally: `asPrincipalId(str)` says "treat this string as a PrincipalId."

## Summary

1. **Declare the validator first**: `export const PrincipalId = type('string').as<string & Brand<'PrincipalId'>>()`
2. **Derive the type**: `export type PrincipalId = typeof PrincipalId.infer`
3. **Add `asXxx` if external strings flow in**: `export const asPrincipalId = (value: string): PrincipalId => value as PrincipalId`
4. **Document it as syntactic sugar** in the JSDoc

The `as*` helper is the third optional part of the canonical branded-ID pattern. It is the only place `as PrincipalId` appears in the codebase; everywhere else is the helper, the validator, or `.assert(...)`.
