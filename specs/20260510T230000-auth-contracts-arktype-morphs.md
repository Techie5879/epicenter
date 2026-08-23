# Auth contracts: arktype morphs replace hand-rolled parsers

**Date**: 2026-05-10
**Status**: Draft
**Author**: AI-assisted (Claude)
**Backwards compatibility**: none. Internal-only refactor; the three public function names and signatures are preserved.

## One-sentence thesis

```txt
The auth contract boundary parses Better Auth responses through arktype morphs,
the same way every other contract boundary in this repo parses inputs.
```

If `contracts/auth-session.ts` still hand-rolls `readRecord` / `readString` / `normalizeDate` after this lands, the refactor is not done. If the public function signatures changed, the refactor scoped too wide.

## Overview

Replace `packages/auth/src/contracts/auth-session.ts` (115 lines of hand-rolled record readers plus a final `AuthUser.assert(...)` pass) with arktype schemas that morph Better Auth's response shape into the local `BearerSession` shape in one step. arktype is already a dependency. The three public entry points (`normalizeAuthUser`, `normalizeBearerSession`, `bearerSessionFromBetterAuthSessionResponse`) keep their names and signatures. Tests in `contracts/auth-session.test.ts` pass unchanged.

This is an internal style consolidation, not a bug fix. Nothing is broken today; the file just hand-rolls primitives that arktype already owns, and the manual layer goes stale every time `AuthUser` changes.

## Motivation

### Current state

`contracts/auth-session.ts` parses Better Auth's session response in two passes. First, hand-written readers normalize Date fields and pluck individual keys. Second, the result is fed through `AuthUser.assert(...)` to validate the shape.

```ts
function readRecord(value: unknown, label: string): Record<string, unknown> { ... }
function readString(record: Record<string, unknown>, key: string): string { ... }
function readBoolean(record: Record<string, unknown>, key: string): boolean { ... }
function normalizeDate(value: unknown, key: string): string { ... }
function normalizeOptionalString(record: Record<string, unknown>, key: string): string | null | undefined { ... }

export function normalizeAuthUser(value: unknown): AuthUser {
  const record = readRecord(value, 'user');
  return AuthUser.assert({
    id: readString(record, 'id'),
    name: readString(record, 'name'),
    email: readString(record, 'email'),
    emailVerified: readBoolean(record, 'emailVerified'),
    image: normalizeOptionalString(record, 'image'),
    createdAt: normalizeDate(record.createdAt, 'createdAt'),
    updatedAt: normalizeDate(record.updatedAt, 'updatedAt'),
  });
}
```

The manual layer exists because Better Auth sometimes hands client plugins live `Date` objects (before JSON serialization) but persisted app state needs ISO strings. arktype is then run AFTER the manual normalization to confirm the shape.

So we have two parsers stacked.

This creates problems:

1. **Two parsers for one shape**: the manual readers and arktype both validate; either can throw, with different error messages and different surfaces.
2. **Manual parser ignores the schema**: adding a field to `AuthUser` requires a parallel addition in `normalizeAuthUser`; arktype can't help and won't catch the omission.
3. **Bespoke error strings**: `Expected user to be an object`, `Expected ${key} to be a string`. arktype's errors are richer and uniform with the rest of the codebase.
4. **Style mismatch with the rest of the repo**: `@epicenter/encryption`, `apps/api/src/billing-contract.ts`, and every other contract boundary in this repo uses arktype directly. This one file is the outlier.

### Desired state

The file is ~40 lines. The boundary is expressed as arktype schemas:

```ts
const IsoDate = type('Date | string.date.parse').pipe((v) =>
  v instanceof Date ? v.toISOString() : v,
);

const BetterAuthUserSchema = type({
  id: 'string',
  name: 'string',
  email: 'string',
  emailVerified: 'boolean',
  'image?': 'string | null | undefined',
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

const BetterAuthSessionResponseSchema = type({
  user: BetterAuthUserSchema,
  session: { token: 'string', '+': 'ignore' },
  encryptionKeys: EncryptionKeys,
});
```

The three public functions become one-line calls into these schemas.

## Research Findings

### arktype morph support for `Date | string`

Verified via DeepWiki against `arktypeio/arktype`:

| API | Syntax | Notes |
| --- | --- | --- |
| Inline morph | `type('Date \| string.date.iso', '=>', (v) => v.toISOString())` | "args" form |
| Fluent morph | `type('Date \| string.date.iso').pipe((v) => v.toISOString())` | "pipe" form |
| Builtin keywords | `string.date.iso`, `string.date.parse` | Validate ISO 8601 / accept anything `Date.parse` accepts |
| `.assert()` runs morphs | yes | Returns transformed output, not raw input |

**Key finding**: arktype handles `Date | string -> ISO-string` natively. No third-party morph helper needed.

**Implication**: the entire `normalizeDate` plus `readRecord` cascade collapses to one schema definition.

### Comparison with other contracts in this repo

| Contract | Style |
| --- | --- |
| `@epicenter/encryption` `EncryptionKeys` | Pure arktype, no manual readers |
| `apps/api/src/billing-contract.ts` | Pure arktype with `sValidator` |
| `packages/workspace/.../*-contract.ts` | TypeBox, schema-first |
| `packages/auth/src/contracts/auth-session.ts` (today) | Manual readers plus final `.assert()` |

The auth contract is the lone outlier.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| arktype morph for `Date \| string` | 1 evidence | `type('Date \| string.date.parse').pipe(...)` | Verified upstream via DeepWiki |
| Preserve public function names | 3 taste | yes | Two call sites in `create-auth.ts` and one in tests; no caller benefit from renaming |
| Null/undefined short-circuit stays in `bearerSessionFromBetterAuthSessionResponse` | 2 coherence | yes | Current behavior; called by `useSession.subscribe` listener where signed-out state arrives as `null` |
| Keep `BetterAuthSessionResponse` type import from `better-auth` | 3 taste | keep | Documents the upstream shape we depend on; revisit if `customSession` plugin returns something else |
| Drop custom error messages | 2 coherence | drop in favor of arktype errors | Errors flow into `console.error('[auth] invalid Better Auth session response:', error)`; arktype's error carries enough context for that log |
| `string.date.parse` vs `string.date.iso` for `IsoDate` input | 1 evidence | `string.date.parse` | Matches today's `Date.parse` permissive behavior. Stricter ISO-only would be a behavior change, see Edge Cases |
| Where `IsoDate` lives | Deferred | inline in this file | Only one consumer today. Extract if a second contract needs it |

## Architecture

```txt
┌───────────────────────────────────────────────┐
│ Better Auth useSession.subscribe(data)        │
│   data: { user: BAUser, session: BASess, ... }│ <- has Date OR ISO depending on path
└───────────────┬───────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────┐
│ contracts/auth-session.ts                     │
│ ───────────────────────────────────────────── │
│ IsoDate                = Date | string.date   │
│                          .parse -> ISO string │
│ BetterAuthUserSchema   = { ..., IsoDate, ... }│
│ BetterAuthSessionResponseSchema =             │
│   { user, session: { token }, encryptionKeys }│
│                                               │
│ bearerSessionFromBetterAuthSessionResponse    │
│   (null|undefined) -> null                    │
│   (record)         -> BearerSession (parsed)  │
└───────────────┬───────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────┐
│ create-auth.ts                                │
│   applyBearerSession   (bearer factory)       │
│   handleBetterAuthSession (cookie factory)    │
└───────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Build the new schemas

- [ ] **1.1** In `packages/auth/src/contracts/auth-session.ts`, define `IsoDate = type('Date | string.date.parse').pipe((v) => v instanceof Date ? v.toISOString() : v)`. Verify that `.assert(new Date())` returns an ISO string and `.assert('2026-01-01T00:00:00.000Z')` returns the same string.
- [ ] **1.2** Define `BetterAuthUserSchema` arktype mirroring the Better Auth User shape. Use `IsoDate` for `createdAt` / `updatedAt`. Use `'string'`, `'boolean'`, `'string | null | undefined'` (optional `image`). Confirm the inferred output type is structurally assignable to `AuthUser` (from `auth-types.ts`).
- [ ] **1.3** Define `BetterAuthSessionResponseSchema` wrapping `user: BetterAuthUserSchema`, `session: { token: 'string' }` (other session fields ignored), and `encryptionKeys: EncryptionKeys`.
- [ ] **1.4** Decide undeclared-key policy: arktype defaults to ignoring extras, which matches today's manual parser. Confirm no schema-level `onUndeclaredKey('reject')` is set.

### Phase 2: Switch the public functions

- [ ] **2.1** Rewrite `normalizeAuthUser(value)` as a one-liner: `return BetterAuthUserSchema.assert(value);`.
- [ ] **2.2** Rewrite `normalizeBearerSession(value, { token })` to call `BetterAuthSessionResponseSchema.assert(...)` and project to `BearerSession` (overwrite the schema's token with the caller-supplied token, since the caller knows which token authorized the request).
- [ ] **2.3** Rewrite `bearerSessionFromBetterAuthSessionResponse(value)` to short-circuit on null/undefined, otherwise call `BetterAuthSessionResponseSchema.assert(value)` and return a `BearerSession` using `value.session.token` as the bearer token.
- [ ] **2.4** Preserve the file-level JSDoc explaining why this exists (Better Auth Date semantics, monorepo type bridge); move it next to `IsoDate` since that's where the load-bearing decision now lives.

### Phase 3: Prove

- [ ] **3.1** Run `bun test packages/auth/src/contracts/auth-session.test.ts`. All three existing tests (Date normalization, null/undefined handling, missing-encryption-keys throw) should pass unchanged.
- [ ] **3.2** Run the full `bun test` from `packages/auth/`. All 31 tests should remain green.
- [ ] **3.3** Run `bun run typecheck` in `apps/fuji` (representative cookie consumer) and any one bearer consumer (e.g., `apps/tab-manager`). No signature drift expected.

### Phase 4: Remove

- [ ] **4.1** Delete the unused helpers: `readRecord`, `readString`, `readBoolean`, `normalizeDate`, `normalizeOptionalString`.
- [ ] **4.2** Confirm file length drops from 115 lines to ~40.
- [ ] **4.3** Commit as one change: `refactor(auth): collapse contracts/auth-session.ts onto arktype morphs`.

## Edge Cases

### Better Auth adds a new User field

1. Better Auth ships an upgrade that adds `lastSignInAt` to the User payload.
2. With the manual parser today: silent. `normalizeAuthUser` ignores unknown keys; `AuthUser.assert(...)` ignores them by default.
3. With arktype default: also silent. arktype's default `onUndeclaredKey` is forgiving.
4. **Expected**: same behavior as today. Picking up the new field is a deliberate `auth-types.ts` change, not an accidental shape leak.

### `session.token` is missing or non-string

1. Better Auth returns a session response without `session.token`.
2. Manual parser today: throws `Expected token to be a string.`
3. arktype: throws an arktype error.
4. **Expected**: caller in `create-auth.ts` (`applyBearerSession`) catches the throw and logs `[auth] invalid Better Auth session response`. Either error shape satisfies the log.

### `image` field is `null` vs `undefined`

1. Better Auth allows `image?: string | null`.
2. Manual parser: `normalizeOptionalString` passes through `null` or `undefined` unchanged.
3. arktype: `'image?': 'string | null | undefined'` passes through unchanged.
4. **Expected**: behavior preserved.

### Non-ISO date string from Better Auth

1. Better Auth hands `createdAt: '2026/01/01'` (slashes; not ISO).
2. Manual parser: `Date.parse('2026/01/01')` returns a valid date on most engines; output becomes ISO.
3. arktype with `string.date.parse`: matches `Date.parse` semantics, also accepts and morphs.
4. arktype with `string.date.iso`: rejects.
5. **Expected**: pick `string.date.parse` to match today exactly. Documented as the choice in the Decisions table. Open Question 1 lets the reviewer override if they prefer the stricter form.

### `EncryptionKeys` validation fails

1. Better Auth returns a session response but the custom plugin's encryptionKeys field is malformed.
2. Manual parser today: `EncryptionKeys.assert(record.encryptionKeys)` throws.
3. arktype: same throw, same surface.
4. **Expected**: behavior preserved. The existing test `'throws when custom session response omits encryption keys'` continues to pass.

## Open Questions

1. **Strict ISO input vs permissive string input for `IsoDate`?**
   - Options: (a) `Date | string.date.iso`: strict ISO; rejects `2026/01/01`. (b) `Date | string`: most permissive. (c) `Date | string.date.parse`: matches today's `Date.parse` behavior.
   - **Recommendation**: (c). Preserves current behavior exactly. If Better Auth ever drifts to a non-ISO string format on this field, the boundary still works.

2. **Should `BetterAuthSessionResponse` type alias survive?**
   - Today it's imported from `better-auth` and re-exported as a static-types convenience for the custom-session plugin's `InferPlugin` bridge in `create-auth.ts`.
   - The new schema would produce a structurally compatible inferred type via `typeof BetterAuthSessionResponseSchema.infer`.
   - **Recommendation**: keep the BA import for documentation purposes; do not add a third type alias. The schema validates at runtime; the BA import documents what we depend on.

3. **Schema-level `onUndeclaredKey('reject')` for stricter boundary?**
   - Today's manual parser silently ignores extras. arktype default matches this.
   - A stricter setting would surface Better Auth shape drift loudly.
   - **Recommendation**: keep default-forgiving. Tighter validation is a separate spec; this one preserves behavior.

4. **Where should `IsoDate` live if other contracts want to reuse it?**
   - Today: nowhere. Each contract hand-rolls or pipes its own Date handling.
   - **Recommendation**: defer. Inline it in `auth-session.ts`. If a second consumer appears, lift to a shared module (`@epicenter/auth/contracts` index or a `@epicenter/constants/arktype` shared schemas module). Premature now.

## Decisions Log

- Keep `BetterAuthSessionResponse` type import from `better-auth`: documents the upstream shape we depend on.
  Revisit when: the `customSession` plugin returns a structurally different shape, or Better Auth removes the export.

- Keep default `onUndeclaredKey` (forgiving) on the new schemas: matches today's manual parser behavior.
  Revisit when: a Better Auth upgrade silently breaks a downstream consumer because an added field went unnoticed at the boundary.

## Success Criteria

- [ ] `contracts/auth-session.ts` is ~40 lines (down from 115).
- [ ] No manual `readRecord` / `readString` / `readBoolean` / `normalizeDate` / `normalizeOptionalString` helpers remain in the file.
- [ ] All 31 tests in `packages/auth/` pass.
- [ ] The three public function names and signatures are unchanged: `normalizeAuthUser(value)`, `normalizeBearerSession(value, { token })`, `bearerSessionFromBetterAuthSessionResponse(value)`.
- [ ] `apps/fuji` typecheck passes (representative cookie consumer).
- [ ] `apps/tab-manager` typecheck passes (representative bearer consumer).

## References

- `packages/auth/src/contracts/auth-session.ts` (target file)
- `packages/auth/src/contracts/auth-session.test.ts` (pinning tests, expected to pass unchanged)
- `packages/auth/src/auth-types.ts` (`AuthUser`, `BearerSession` arktype schemas the output must satisfy)
- `packages/auth/src/create-auth.ts:138-155` (bearer call site: `applyBearerSession`)
- `packages/auth/src/create-auth.ts:230-244` (cookie call site: `handleBetterAuthSession`)
- `packages/encryption/src/...` (example of pure-arktype contract style; `EncryptionKeys` schema is imported by the new schema)
- `apps/api/src/auth/create-auth.ts:26-28` (server-side `customSession` plugin shape that produces what this contract parses)
- arktype docs / DeepWiki (`type('Date | string.date.parse').pipe(...)` syntax, verified)
