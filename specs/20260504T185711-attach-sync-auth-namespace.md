# Collapse `attachSync` auth fields into a single `auth` namespace

**Date**: 2026-05-04
**Status**: Superseded by `specs/20260505T021500-collapse-syncauth-to-transport-function.md`
**Author**: AI-assisted (Claude)
**Branch**: codex/sync-create-auth

Historical note:
  This spec uses older "credential family" vocabulary. Current API code uses:
    public routes
    hosted auth routes
    app access token routes
  Do not use this spec as naming guidance for current API auth code.

## One-Sentence Test

Superseded note, 2026-05-05: Phase 6.A of the sign-out preservation spec
collapsed the old structural `SyncWebSocket` type into the DOM `WebSocket`
contract directly. Keep this file as historical context only.

Superseded note, 2026-05-05: `specs/20260505T021500-collapse-syncauth-to-transport-function.md`
removes `SyncAuth` and replaces it with `SyncTransport`.

`attachSync` requires an `auth: SyncAuth` capability and constructs sockets via a single property access; `webSocketImpl`, `WebSocketImpl`, `NoopWebSocket`, the duck-typed `requiresCredential` flag, the nullish-coalescing-ternary, and the unauthed-fallback branch no longer exist.

If `requiresCredential` still appears in `attach-sync.ts`, the work is not done.
If `webSocketImpl` or `WebSocketImpl` still appears anywhere outside historical specs, the work is not done.
If `NoopWebSocket` still exists, the work is not done.
If `attemptConnection` still has a ternary on `config.auth`, the work is not done.
If any consumer still passes `openWebSocket` and `onCredentialChange` as separate top-level config fields, the work is not done.

## Overview

`SyncAttachmentConfig` currently exposes two unrelated optional callbacks (`openWebSocket`, `onCredentialChange`) that conceptually form a single capability: "this is an authenticated transport." The two-field shape forces the supervisor to *infer* the capability via `requiresCredential = openWebSocket !== undefined`, which then has to feed a five-line nullish-coalescing-ternary inside `attemptConnection` to disambiguate "callback not provided" from "callback returned null."

This spec replaces the two top-level fields with one `auth: { openWebSocket, onChange }` namespace. The capability becomes a literal presence check. Every consumer call site collapses from two lines to one. `AuthClient` is structurally assignable to `SyncAuth`, so callers pass `auth` directly with no adapter object.

The `WebSocket | null` return on `openWebSocket` itself is **not** changing. It's the right shape (atomic credential check, no race, ecosystem-canonical) and is documented as "not an error condition." This spec is exclusively about the surrounding plumbing.

**Wave 7 addendum (2026-05-04)**: After wave 1 landed, audit found that the `auth?` optionality, the `webSocketImpl?` field, the `WebSocketImpl` exported type, and the `NoopWebSocket` test class are all paying for a flexibility no consumer uses. All 13 production callers pass `auth`; zero callers pass `webSocketImpl`; zero callers reference `NoopWebSocket`. Wave 7 makes `auth` required and deletes the unauthed branch end-to-end.

## Why this is its own spec

Per the cohesive-clean-breaks skill: the smell that surfaced ("the ternary feels extremely bad") is the visible symptom of a deeper coupling : *capability inferred from callback presence*. Going up a level, the fix is structural: name the capability. That's a single coherent change with a one-sentence thesis, ~13 consumer migrations, and zero behavior change. It deserves its own spec rather than being absorbed into a larger auth refactor.

The repo precedent: see `20260503T230000-auth-unified-client-two-factories.md` (split factories) and `20260504T030000-machine-auth-collapse-to-free-functions.md` (free functions). Each ships its own thesis-scoped spec even though they touch adjacent code.

## Motivation

### Current state

`packages/workspace/src/document/attach-sync.ts:222-230`:

```ts
export type SyncAttachmentConfig = {
    url: string;
    waitFor?: WaitForBarrier;
    openWebSocket?: (
        url: string,
        protocols?: string | string[],
    ) => SyncWebSocket | null;
    onCredentialChange?: (handler: () => void) => () => void;
    webSocketImpl?: WebSocketImpl;
    log?: Logger;
    awareness?: AwarenessAttachment<AwarenessSchema>;
};
```

`packages/workspace/src/document/attach-sync.ts:309, 374`:

```ts
const openWebSocket = config.openWebSocket;
// ...
const requiresCredential = openWebSocket !== undefined;
```

`packages/workspace/src/document/attach-sync.ts:629-637` (inside `attemptConnection`):

```ts
const ws =
    openWebSocket?.(wsUrl, subprotocols) ??
    (requiresCredential
        ? null
        : new (config.webSocketImpl ??
                (globalThis.WebSocket as WebSocketImpl))(wsUrl, subprotocols));
if (ws === null) return 'no-credential';
```

`packages/workspace/src/document/attach-sync.ts:839-841`:

```ts
const unsubscribeCredentialChange = config.onCredentialChange?.(() => {
    queueMicrotask(reconnect);
});
```

Every consumer (13 call sites across 11 files) passes the two as separate fields:

```ts
attachSync(doc, {
    url: toWsUrl(`${APP_URLS.API}/workspaces/${doc.ydoc.guid}`),
    waitFor: idb,
    openWebSocket: auth.openWebSocket,
    onCredentialChange: auth.onChange,
    awareness,
});
```

### Problems

1. **Capability inferred, not declared.** `requiresCredential = openWebSocket !== undefined` reads "this connection requires auth" off the *presence of a callback*. That's duck-typing the policy from the capability. If a future caller wants authenticated sync via a different mechanism (pre-signed URL helper, signed cookie pre-warmer, etc.) without supplying `openWebSocket`, the heuristic silently breaks: the supervisor opens an unauthenticated raw WebSocket against an authed endpoint and hits 4401 every iteration.

2. **The ternary does two jobs in one expression.** It must distinguish (a) "callback not provided → use raw constructor" from (b) "callback returned null → defer." The disambiguation is forced by the field layout: with two separate optionals, the only signal that the auth path applies is the truthiness of the callback itself. Once the namespace exists, presence of `config.auth` answers (a) directly, and the ternary becomes a flat two-branch.

3. **The two callbacks always travel together.** Every one of 13 app consumers passes both or neither. There is no real configuration where one is set and the other isn't. The flat layout misrepresents the shape of the configuration space.

4. **Two-channel signaling is tolerated rather than structured.** "Are we signed out?" is answerable via both `auth.identity === null` and `openWebSocket(...) === null`. The contract says they agree, but nothing in the type system reflects that they're aspects of one capability. Bundling them clarifies their kinship.

### Desired state

```ts
// packages/workspace/src/document/attach-sync.ts

/**
 * Capability bundle for authenticated sync. Supplying `auth` declares that
 * the connection requires credentials; presence of the namespace replaces
 * the prior `requiresCredential = openWebSocket !== undefined` inference.
 */
export type SyncAuth = {
    /**
     * Open a WebSocket with this transport's credentials applied. Returns
     * `null` when no credentials are currently available; the supervisor
     * treats null as "stay offline until `onChange` fires."
     */
    openWebSocket(
        url: string,
        protocols?: string | string[],
    ): SyncWebSocket | null;
    /**
     * Subscribe to credential-state changes that should trigger a reconnect.
     * Returns an unsubscribe function. The handler is called with no arguments;
     * `AuthClient.onChange`'s identity argument is silently ignored
     * (TypeScript parameter-bivariance allows the assignment).
     */
    onChange(handler: () => void): () => void;
};

export type SyncAttachmentConfig = {
    url: string;
    waitFor?: WaitForBarrier;
    auth?: SyncAuth;
    webSocketImpl?: WebSocketImpl;
    log?: Logger;
    awareness?: AwarenessAttachment<AwarenessSchema>;
};
```

`attemptConnection` collapses to a flat ternary:

```ts
const ws = config.auth
    ? config.auth.openWebSocket(wsUrl, subprotocols)
    : new (config.webSocketImpl ?? (globalThis.WebSocket as WebSocketImpl))(
            wsUrl,
            subprotocols,
        );
if (ws === null) return 'no-credential';
```

`requiresCredential` and the local `openWebSocket = config.openWebSocket` extraction both vanish.

The credential-change wiring re-roots:

```ts
const unsubscribeCredentialChange = config.auth?.onChange(() => {
    queueMicrotask(reconnect);
});
```

Every call site collapses:

```ts
// Before
attachSync(doc, {
    url: ...,
    waitFor: idb,
    openWebSocket: auth.openWebSocket,
    onCredentialChange: auth.onChange,
    awareness,
});

// After
attachSync(doc, {
    url: ...,
    waitFor: idb,
    auth,
    awareness,
});
```

`AuthClient` already exposes `openWebSocket` + `onChange`, so it satisfies `SyncAuth` structurally. No wrapper, no adapter, no rename.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bundle shape | Single optional `auth` namespace | The two callbacks always travel together; presence of the namespace = "authenticated transport." |
| Sub-field name for the unsubscribe-style sub | `onChange` (not `onCredentialChange`) | `AuthClient.onChange` already exists with the right signature shape. Renaming inside `SyncAuth` would force every consumer to write `{ openWebSocket: auth.openWebSocket, onChange: auth.onChange }` instead of just `auth`. The semantic ("auth state changed, restart sync") is unchanged. |
| Return type of `openWebSocket` | Keep `SyncWebSocket \| null` | Documented as "not an error condition." Atomic : no race against `auth.identity`. Canonical in browser API (`querySelector`, `Map.get`). Hono docs literally describe "no credentials → don't initiate" as the recommended pattern. |
| `webSocketImpl` placement (wave 1) | ~~Stays at top level~~ → **deleted in wave 7** | Wave 1 kept it on the assumption the unauthed branch was real. Audit showed zero callers in `apps/`, `packages/`, `examples/`, or `playground/`. Tests use `globalThis.WebSocket` swap instead. The injection point that survives is `auth.openWebSocket`. |
| `auth` optionality (wave 7) | **Required** | All 13 production callers pass `auth`. The 4 internal tests that pass `{ url }` only do so to test sync mechanics, not to exercise an unauthed feature. Optionality misrepresents the configuration space. |
| `WebSocketImpl` exported type (wave 7) | **Deleted** | Sole consumers were `webSocketImpl` (deleted) and `NoopWebSocket` (deleted). No external consumer. |
| `NoopWebSocket` (wave 7) | **Deleted** | Zero callers. Only documentation reference was an aspirational SKILL note. |
| Migration shape for callers | Pass `AuthClient` directly as `auth` | Structural compatibility eliminates adapter ceremony. Consumers go from 4 fields to 3 with no new imports. |
| `AuthClient` interface change | None | This spec touches only `attachSync` config. The auth package's public surface is unchanged. |
| Backwards compatibility shim | None | Per CLAUDE.md ("avoid backwards-compatibility hacks"). All consumers live in this monorepo; migrate atomically in one PR. |
| Behavior change | None | Pure refactor. Same supervisor states, same close-code handling, same reconnect semantics. |

## Architecture

```
Before                                         After
──────                                         ─────

SyncAttachmentConfig                           SyncAttachmentConfig
├── url                                        ├── url
├── waitFor?                                   ├── waitFor?
├── openWebSocket?  ──┐                        ├── auth? ──┐
├── onCredentialChange? ──┐                    │          ├── openWebSocket
├── webSocketImpl?       ├─ infer capability   │          └── onChange
├── log?                 │                     ├── webSocketImpl?
└── awareness?           │                     ├── log?
                         │                     └── awareness?
                         ▼
                   requiresCredential = openWebSocket !== undefined
                         │
                         ▼
                   ternary disambiguates:
                   - undefined ?? (false ? null : new WS())
                   - null      ?? (true  ? null : ...)
                   - WebSocket
                                                      │
                                                      ▼
                                                config.auth ? auth.openWebSocket() : new WS()
```

Capability declared, not inferred. One branch decides the path; the second branch (`ws === null`) is the deferred-credential signal. Two distinct concerns, two distinct lines.

## Surface map

### `attach-sync.ts` internal changes

| Location | Change |
|---|---|
| `attach-sync.ts:222-230` | `SyncAttachmentConfig`: replace `openWebSocket?` and `onCredentialChange?` with `auth?: SyncAuth`. |
| `attach-sync.ts` (new) | Add exported `type SyncAuth = { openWebSocket(...): SyncWebSocket \| null; onChange(...): () => void; }`. |
| `attach-sync.ts:309` | Delete `const openWebSocket = config.openWebSocket;`. |
| `attach-sync.ts:374` | Delete `const requiresCredential = openWebSocket !== undefined;` and the surrounding JSDoc block. |
| `attach-sync.ts:629-637` | Rewrite the WebSocket-construction expression as a flat two-branch ternary keyed on `config.auth`. |
| `attach-sync.ts:839-841` | `config.onCredentialChange?.(...)` → `config.auth?.onChange(...)`. |

### Consumer call sites (13)

| File | Line | Migration |
|---|---|---|
| `apps/honeycrisp/src/lib/honeycrisp/browser.ts` | 63-64 | replace 2 lines with `auth,` |
| `apps/honeycrisp/src/lib/honeycrisp/browser.ts` | 105-106 | replace 2 lines with `auth,` |
| `apps/honeycrisp/src/lib/honeycrisp/daemon.ts` | 43-44 | replace 2 lines with `auth,` |
| `apps/honeycrisp/src/lib/honeycrisp/script.ts` | 26-27 | replace 2 lines with `auth,` |
| `apps/opensidian/src/lib/opensidian/browser.ts` | 110-111 | replace 2 lines with `auth,` |
| `apps/opensidian/src/lib/opensidian/daemon.ts` | 43-44 | replace 2 lines with `auth,` |
| `apps/opensidian/src/lib/opensidian/script.ts` | 26-27 | replace 2 lines with `auth,` |
| `apps/fuji/src/lib/fuji/browser.ts` | 63-64 | replace 2 lines with `auth,` |
| `apps/fuji/src/lib/fuji/browser.ts` | 105-106 | replace 2 lines with `auth,` |
| `apps/fuji/src/lib/fuji/daemon.ts` | 57-58 | replace 2 lines with `auth,` |
| `apps/zhongwen/src/lib/zhongwen/daemon.ts` | 43-44 | replace 2 lines with `auth,` |
| `apps/zhongwen/src/lib/zhongwen/script.ts` | 26-27 | replace 2 lines with `auth,` |
| `apps/tab-manager/src/lib/tab-manager/extension.ts` | 54-55 | replace 2 lines with `auth,` |

### Test sites

| File | Lines | Migration |
|---|---|---|
| `packages/workspace/src/document/attach-sync.test.ts` | ~103-120 | `createCredentialSource` returns `{ openWebSocket, onCredentialChange }` today. Rename the second field to `onChange` so callers can spread the source as `auth: source`. |
| `packages/workspace/src/document/attach-sync.test.ts` | 296, 323, 341, 364 | replace inline `openWebSocket: ...` + (implicit) `onCredentialChange: ...` pairs with `auth: credentials.source`. |

### Documentation

| File | Change |
|---|---|
| `packages/workspace/src/index.ts` JSDoc (~line 34) | Update the `attachSync` example to use `auth:` form. |
| `packages/workspace/README.md` | Update any `attachSync` examples that show the old shape. Verify and patch. |
| `apps/fuji/README.md` | Same. |
| `docs/architecture.md` | Same. |
| `docs/guides/consuming-epicenter-api.md` | Same. |
| `.agents/skills/auth/SKILL.md` | Update if it documents the old field names. |

### Public API churn

`packages/workspace/src/index.ts`: add `type SyncAuth` to the existing export of `attach-sync`'s public types. Other exports unchanged.

## Implementation plan

Single PR. Waves are sequential; each wave leaves the workspace in a typecheckable state.

### Wave 1: introduce `SyncAuth` and rewrite `attach-sync.ts` internals

- [x] **1.1** Add the `SyncAuth` type to `packages/workspace/src/document/attach-sync.ts`. Export it alongside `SyncAttachmentConfig`.
- [x] **1.2** Replace the two flat fields in `SyncAttachmentConfig` with `auth?: SyncAuth`.
- [x] **1.3** Delete `const openWebSocket = config.openWebSocket;` (line 309) and `const requiresCredential = openWebSocket !== undefined;` (line 374) plus its JSDoc block.
- [x] **1.4** Rewrite the WebSocket-construction expression in `attemptConnection` as a flat two-branch ternary keyed on `config.auth`.
- [x] **1.5** Update the `unsubscribeCredentialChange` line (839) to `config.auth?.onChange(...)`.
- [x] **1.6** Re-read the file end-to-end. Confirm no remaining reference to `openWebSocket` (the local variable), `onCredentialChange`, or `requiresCredential`. Confirm the supervisor's `'no-credential'` branch still fires when `config.auth.openWebSocket(...)` returns null.

### Wave 2: re-export from workspace package

- [x] **2.1** Add `SyncAuth` to `packages/workspace/src/index.ts` re-exports (alongside the existing `attachSync`, `toWsUrl`, etc.).
- [x] **2.2** Update the JSDoc example in `index.ts` (~line 34) to use the new `auth:` form.

### Wave 3: migrate workspace tests

- [x] **3.1** Update `createCredentialSource` in `attach-sync.test.ts` so the returned object matches `SyncAuth`: rename `onCredentialChange` to `onChange`. Keep the `calls`/`listeners` instrumentation untouched.
- [x] **3.2** Update each `attachSync(doc, { ... })` call (lines 296, 323, 341, 364) to pass `auth: credentials.source` instead of the two flat fields. Verify no test references `onCredentialChange` by name.
- [x] **3.3** Run `bun run --filter @epicenter/workspace test` and confirm all sync tests pass.

### Wave 4: migrate app consumers

- [x] **4.1** For each of the 13 call sites in the surface map, replace the two-line pair with `auth,` (object property shorthand). Where `auth` is not the local variable name, use `auth: <name>`.
- [x] **4.2** Confirm no app file imports `SyncAttachmentConfig` directly with the old field names; if any do, update the type usage.

### Wave 5: documentation

- [x] **5.1** Grep for `openWebSocket: auth.openWebSocket` and `onCredentialChange: auth.onChange` across `docs/`, `packages/*/README.md`, `apps/*/README.md`, `.agents/skills/`. Update every example.
- [x] **5.2** Update `docs/guides/consuming-epicenter-api.md` if it documents the old shape.
- [x] **5.3** Update the auth skill (`.agents/skills/auth/SKILL.md`) if it shows the old call form.

### Wave 6: verification

- [x] **6.1** `bun run --filter @epicenter/workspace typecheck` passes.
- [x] **6.2** `bun run --filter @epicenter/workspace test` passes.
- [ ] **6.3** `bun run typecheck` (workspace-wide) passes : every consumer migrated.
- [x] **6.4** Workspace-wide grep confirms zero remaining occurrences of `openWebSocket: auth.openWebSocket`, `onCredentialChange:`, or `requiresCredential` in any non-spec, non-historical-doc file.
- [ ] **6.5** Spot-check at least one app smoke path (e.g., open Honeycrisp in the browser, observe sync connects with cookie auth, sign out, observe `phase: 'offline'` transition, sign in, observe reconnect).

> **Verification note**: `bun typecheck` is still blocked by existing diagnostics outside this spec, including `packages/svelte-utils/src/from-table.svelte.ts`, `packages/ui/src/sonner/toast-on-error.ts`, multiple `#/utils` alias errors in `packages/ui`, and app-local Svelte errors. The touched workspace package and auth package typechecks pass, and `@epicenter/workspace` tests pass.

### Wave 7: make `auth` required, delete the unauthed branch

- [ ] **7.1** In `attach-sync.ts`, change `auth?: SyncAuth` to `auth: SyncAuth` on `SyncAttachmentConfig`.
- [ ] **7.2** Delete the `webSocketImpl?: WebSocketImpl` field on `SyncAttachmentConfig` and its JSDoc.
- [ ] **7.3** Delete the `WebSocketImpl` exported type definition (lines 200-203).
- [ ] **7.4** Replace the ternary in `attemptConnection` with a single property access: `const ws = config.auth.openWebSocket(wsUrl, subprotocols);` followed by the existing `if (ws === null) return 'no-credential';` line.
- [ ] **7.5** Update the `SyncAuth` JSDoc to drop the "absence means the supervisor opens an unauthenticated WebSocket" wording.
- [ ] **7.6** Remove `type WebSocketImpl` from `packages/workspace/src/index.ts` re-exports.
- [ ] **7.7** Delete the `NoopWebSocket` class from `packages/workspace/src/shared/test-utils.ts` (keep `mintTestProjectDir`).
- [ ] **7.8** Update `attach-sync.test.ts`: add a `fakeAuth()` helper that returns `{ openWebSocket: (url, protocols) => new FakeWebSocket(url, protocols), onChange: () => () => {} }`. Migrate the 4 `attachSync(ydoc, { url: ... })` invocations (around lines 135, 159, 207, 280) to pass `auth: fakeAuth()`.
- [ ] **7.9** Update `.agents/skills/workspace-app-layout/SKILL.md`: drop the `webSocketImpl?: WebSocketImpl` parameter from daemon and script factory examples, drop the "is injectable for tests" bullets, drop the "Pass `NoopWebSocket` through `webSocketImpl`" line at the end of the Tests section.
- [ ] **7.10** Verify: `bun run --filter @epicenter/workspace typecheck` and `test` pass. Workspace-wide grep confirms zero remaining `webSocketImpl`, `WebSocketImpl`, or `NoopWebSocket` references in non-spec, non-historical-doc files.

## Acceptance criteria

- [x] `requiresCredential` does not exist anywhere in `attach-sync.ts`.
- [x] The five-line nullish-coalescing-ternary at the old `attemptConnection:629-637` is replaced by a flat two-branch ternary keyed on `config.auth`.
- [x] `SyncAttachmentConfig` has `auth?: SyncAuth` and no longer has `openWebSocket?` or `onCredentialChange?` at the top level.
- [x] `SyncAuth` is exported from `@epicenter/workspace`.
- [x] Every app consumer passes `auth,` (or `auth: <name>,`) : never the two flat fields.
- [x] Every test consumer passes `auth: ...` : never the two flat fields.
- [x] All documentation examples use the new shape.
- [ ] `bun run typecheck` and workspace tests pass.
- [ ] (wave 7) `auth` is required on `SyncAttachmentConfig` (no `?`).
- [ ] (wave 7) `webSocketImpl` and `WebSocketImpl` do not exist anywhere outside historical specs.
- [ ] (wave 7) `NoopWebSocket` does not exist.
- [ ] (wave 7) `attemptConnection` opens the socket via a single `config.auth.openWebSocket(...)` call (no ternary).
- [ ] (wave 7) `workspace-app-layout/SKILL.md` no longer references `webSocketImpl` or `NoopWebSocket`.

## Open questions

1. **Should `SyncAuth` live in `attach-sync.ts` or its own file?**
   - Options: (a) inline in `attach-sync.ts` next to `SyncAttachmentConfig`; (b) extract to `packages/workspace/src/document/sync-auth.ts`.
   - **Recommendation**: (a). The type is small, used only by `attachSync`, and lives in the same file as the only function that consumes it. Extraction earns its keep when there's a second consumer.

2. **Should `onChange` in `SyncAuth` get a typed argument matching `AuthClient.onChange`'s identity payload?**
   - Today `AuthClient.onChange` is `(fn: (identity: AuthIdentity \| null) => void) => () => void`, and `attachSync` discards the identity. Defining `SyncAuth.onChange` with `() => void` keeps workspace from importing `AuthIdentity` from `@epicenter/auth`.
   - **Recommendation**: `() => void`. TypeScript parameter-bivariance lets `AuthClient.onChange` satisfy the narrower shape. Keeps the workspace package free of an auth-specific type leak.

3. **Should the `SyncAuth` `openWebSocket` field accept `URL` in addition to `string`?**
   - `AuthClient.openWebSocket` takes `string | URL`. `attachSync` passes `string`. Narrowing in `SyncAuth` doesn't break assignability (function param is contravariant).
   - **Recommendation**: keep `SyncAuth.openWebSocket` typed with `string` (matching what `attachSync` actually passes). Wider input type on the implementation is fine and keeps the spec's surface honest.

4. **Should `webSocketImpl` move under `auth` for symmetry?** _(resolved in wave 7)_
   - **Resolution**: delete `webSocketImpl` outright. Zero callers; tests use `globalThis.WebSocket` swap; the only "production" injection point is `auth.openWebSocket`. The unauthed branch the field served was paying for nothing.

5. **Anything to do about `AuthClient.openWebSocket` returning `WebSocket` vs `SyncWebSocket`?**
   - `WebSocket` is a strict superset of `SyncWebSocket` (workspace's structural minimum). Assignment works. No change.

## Out of scope

- Changing the `WebSocket | null` return shape of `openWebSocket`. Confirmed sound (see Design decisions).
- The `singleCredential` middleware, the 4401 close-code path, or any other API-side auth plumbing.
- The auth package's public surface (`AuthClient`, `createBearerAuth`, `createCookieAuth`). This spec does not modify them.
- `attachSync`'s reconnect semantics, supervisor loop, backoff, or status emitter. All unchanged.
- Renaming `onChange` → `onAuthChange` (or similar) on `AuthClient`. If desired, that's its own naming spec; doing it here would force every consumer to write an adapter.

## References

- `packages/workspace/src/document/attach-sync.ts` : file under refactor
- `packages/workspace/src/document/attach-sync.test.ts` : test file under migration
- `packages/auth/src/create-auth.ts:91-103, 195-201, 241-244, 375-377` : `AuthClient.openWebSocket` + `onChange` definitions (the structural target)
- `packages/auth/src/contract.test.ts` : confirms both factories return the same `AuthClient` shape
- `apps/api/src/app.ts:288-298` : the 4401 close-code path that justifies `null` as a deferred-credential signal
- `specs/20260503T230000-auth-unified-client-two-factories.md` : established the `AuthClient` contract
- `specs/20260504T030000-machine-auth-collapse-to-free-functions.md` : house-style spec template
- DeepWiki findings (Better Auth, Hono, Cloudflare): no library ships a WebSocket auth helper; "don't initiate when no credentials" is the ecosystem norm; 4xxx close codes are in-spec but unprescribed
- Skills referenced: `cohesive-clean-breaks`, `one-sentence-test`, `simplify`, `factory-function-composition`, `specification-writing`

## Review

**Completed**: 2026-05-04
**Branch**: codex/sync-create-auth

### Summary

`attachSync` now exposes an explicit `auth?: SyncAuth` namespace and branches on that namespace when opening sockets. Tests, app consumers, public exports, current docs, and the auth skill now use the direct `auth` shape.

### Deviations from Spec

- `packages/auth/src/create-auth.ts` also needed a source comment update because it still described `onCredentialChange` as current API language.
- `bun typecheck` could not be completed because existing Svelte and UI package diagnostics block the monorepo check. Targeted workspace and auth package checks pass.
- Browser smoke testing was not run in this pass.

### Follow-up Work

- Clear the existing `@epicenter/svelte`, `@epicenter/ui`, and app Svelte diagnostics so workspace-wide typecheck can become a reliable acceptance gate again.
