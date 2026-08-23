# Adopt Better Auth Device Authorization Client

**Date**: 2026-05-04
**Status**: Proposed
**Author**: AI-assisted (Claude)
**Branch**: TBD (single PR; depends on `codex/sync-create-auth` landing)
**Depends on**: `specs/20260504T030000-machine-auth-collapse-to-free-functions.md` (shipped)
**Parallel sibling**: `specs/20260504T010000-drop-authclient-redirect-sign-in.md` (web environments adopting OAuth 2.1 PKCE; ships independently)

## One-Sentence Test

`packages/auth/src/node/machine-auth.ts` exports `loginWithDeviceCode`, `status`, `logout` as free functions that talk to a Better Auth client (with `deviceAuthorizationClient()` plugin), plus the unchanged `createMachineAuthClient` factory; the transport file, fetch injection, OAuth-shape arktype schemas, and the `DevicePollOutcome` discriminated union no longer exist.

If `createMachineAuthTransport` survives, the work is not done.
If a public function still accepts `{ fetch }`, the work is not done.
If `DeviceCodeResponse`, `DeviceTokenSuccess`, or `DeviceTokenErrorResponse` arktype schemas appear anywhere, the work is not done.
If `pending` or `slowDown` states are visible above the polling helper's body, the work is not done.
If `MachineAuthTransport` or `DevicePollOutcome` types are exported, the work is not done.

(`createMachineAuthClient` is unchanged: it constructs the post-login `AuthClient` via `createBearerAuth`. This spec does not touch it.)

## Overview

The shipped spec collapsed `createMachineAuth` into free functions and split the transport's wide error union by fault domain. This spec collapses the next layer: the transport itself.

`createMachineAuthTransport({ fetch })` hand-rolls four HTTP calls that Better Auth's `deviceAuthorizationClient()` plugin and built-in `getSession`/`signOut` already cover. The fetch-injection knob exists for tests and adds a parameter to every public coordinator. The arktype schemas re-state shapes Better Auth's plugin already types. The `DevicePollOutcome` discriminated union exposes pending/slow-down states no caller reacts to.

After this spec: three free functions, one private polling helper, one module-level Better Auth client. No transport. No fetch parameter. No network-response arktype. No exposed pending state.

## Why this is its own spec

The shipped spec's thesis was *"stateless orchestration is free functions, and error unions compose bottom-up at fault domains."* Distinct thesis here:

> *"Machine auth's HTTP layer is Better Auth's device-authorization client plus `getSession`; Epicenter owns only the polling reaction to OAuth error codes and the projection of session responses into `BearerSession`."*

Different code surface (transport vs coordinator), different motivating evidence (delegation vs decomposition), different consumers (none externally; tests internally). Per the `greenfield-clean-breaks` skill, distinct sentences earn distinct specs.

This spec is also the **CLI-side parallel** to `specs/20260504T010000-drop-authclient-redirect-sign-in.md`, which adopts OAuth 2.1 PKCE for web environments via the existing `oauthProvider()` plugin. Both specs land Better Auth primitives end-to-end for their respective environments. They are siblings, not predecessor/successor: each ships independently. See "Relationship to broader auth architecture" below for the cross-spec map.

## Relationship to broader auth architecture

The CLI is the reference case for the pattern that the parallel sibling spec adopts for all bearer environments: each app is an OAuth 2.1 client of `api.epicenter.so` using the grant type appropriate for its environment.

```
Environment              Grant type              Server plugin
──────────────────────   ──────────────────────  ──────────────────────
CLI (this spec)          device-flow (RFC 8628)  deviceAuthorization()
Browser SPA bearer       authorization + PKCE    oauthProvider()
Chrome extension MV3     authorization + PKCE    oauthProvider()
Tauri (future)           authorization + PKCE    oauthProvider()
                         via localhost loopback
```

This spec adopts Better Auth's `deviceAuthorizationClient()` for the CLI's client side. It does not change the CLI's grant choice or its server endpoints. The CLI continues hitting `deviceAuthorization()`'s `/auth/device/*` paths; the parallel sibling's web apps hit `oauthProvider()`'s `/auth/oauth2/*` paths. The two server plugins are intentionally separate; the parallel sibling's bearer/JWT compatibility verification (its P.1) tests `oauthProvider`-issued tokens, not `deviceAuthorization`-issued tokens. CLI tokens have been validated by `bearer()` in production for months and are unaffected.

Refresh tokens are out of scope for this spec. CLI users re-run `epicenter auth login` on expiry. Web apps inherit refresh from `oauth4webapi` internally per the parallel sibling. If `deviceAuthorization()` issues refresh tokens (verify in Wave 1.2), the CLI may gain refresh later as its own spec.

The CLI does not depend on the parallel sibling landing. Both specs ship independently.

**One coordination point worth flagging back into the parallel sibling**, not blocking this spec: that spec adds `signInWithSocial({ provider })` to `AuthClient`, the surface produced by `createBearerAuth`. `createMachineAuthClient` returns an `AuthClient` from `createBearerAuth`, so the CLI inherits whatever shape the parallel sibling lands. Three honest options for the CLI's `signInWithSocial`: (a) throw "not supported in CLI environment"; (b) wrap `loginWithDeviceCode` and ignore the `provider` argument; (c) drop the method from CLI's `AuthClient` and accept that the unified-interface contract has an environment-specific exception. The parallel sibling owns that decision; this spec is unaffected because `createMachineAuthClient` is out of scope here.

## Problems we are actually solving

The CLI's authentication system exists for five problems:

1. **CLI user wants to authenticate as themselves.** OAuth device flow because the CLI cannot intercept browser redirects.
2. **CLI user wants to know if they are logged in.** Read keychain; verify remotely if online.
3. **CLI user wants to log out.** Revoke the server session and clear the keychain.
4. **CLI runtime needs to make authenticated API calls.** Pass the bearer token from the keychain through `createMachineAuthClient`.
5. **Keychain blob might be corrupted or schema-stale.** Validate at the storage boundary; treat invalid as signed-out.

Everything below either serves one of those problems, or it does not exist.

## Non-problems we are no longer solving

Three things the current code addresses that solve no problem:

1. **"Tests need to mock fetch at our public API."** Test mocking is real; exposing it as a public option is not. Tests can construct their own Better Auth client with `customFetchImpl: stubFetch` (or `customFetchImpl: app.request` for in-process integration). The injection point moves down one layer where it belongs.

2. **"Simple OAuth shapes (`DeviceCodeResponse`, `DeviceTokenSuccess`, `DeviceTokenErrorResponse`) need arktype validation."** These shapes are owned by `deviceAuthorizationClient()` upstream; Better Auth's plugin authors maintain them. Re-asserting them is duplicate static-contract code at our boundary. **Cross-package contracts are different**: `EncryptionKeys` is owned by `@epicenter/encryption`, and our server's `customSession` plugin response shape can degrade across the monorepo type boundary. Those keep their assertions. The asymmetry is ownership-based, not size-based: who owns the runtime contract for this field?

3. **"Callers need to observe pending and slow-down states."** No caller reacts to these. The polling helper handles `authorization_pending` (continue) and `slow_down` (continue + interval bump). Exposing them through a `DevicePollOutcome` union is leakage from polling internals to the public API.

## Motivation

### Current state

```ts
// packages/auth/src/node/machine-auth-transport.ts (~270 lines)

export const MachineAuthRequestError = defineErrors({
  RequestFailed: ({ cause }) => ({...}),
});
export const DeviceTokenError = defineErrors({
  DeviceCodeExpired:         () => ({...}),
  DeviceAccessDenied:        () => ({...}),
  DeviceAuthorizationFailed: ({ code, description }) => ({...}),
});

const DeviceCodeResponse        = type({...});  // arktype: 6 fields
const DeviceTokenSuccess        = type({...});  // arktype: 3 fields
const DeviceTokenErrorResponse  = type({...});  // arktype: 2 fields

export type DevicePollOutcome =
  | { status: 'pending' }
  | { status: 'slowDown' }
  | { status: 'success'; accessToken: string };

export function createMachineAuthTransport({ fetch = globalThis.fetch } = {}) {
  async function requestJson({ method, path, body, token }) {
    // 50 lines: fetch + status check + JSON.parse + error wrapping
  }
  return {
    async requestDeviceCode()                  { /* requestJson + arktype assert */ },
    async pollDeviceToken({ deviceCode })      { /* requestJson + 4-way switch */ },
    async fetchSession({ token })              { /* requestJson + normalizeBearerSession */ },
    async signOut({ token })                   { /* fetch */ },
  };
}
```

```ts
// packages/auth/src/node/machine-auth.ts

export async function loginWithDeviceCode({
  transport = createMachineAuthTransport(),
  sleep = Bun.sleep,
  backend = Bun.secrets,
  onDeviceCode,
}) {
  const { data: code, error } = await transport.requestDeviceCode();
  // ... polling loop reads { status: 'pending' | 'slowDown' | 'success' }
  // ... DeviceCodeExpired check on deadline
  const { data: remote } = await transport.fetchSession({ token: accessToken });
  await saveMachineSession(remote.session, { backend });
}

export async function status({ transport, backend, log }) { /* uses transport */ }
export async function logout({ transport, backend, log }) { /* uses transport */ }
```

### Why each piece dies

```
createMachineAuthTransport         factory closes only over fetch; fetch is a test knob
  ├── requestJson helper           Better Auth client owns request plumbing
  ├── DeviceCodeResponse  arktype  Better Auth plugin response type
  ├── DeviceTokenSuccess  arktype  Better Auth plugin response type
  ├── DeviceTokenErrorResponse     Better Auth surfaces error.error directly
  ├── EPICENTER_API_URL concat     authClient owns baseURL
  ├── { fetch } parameter          customFetchImpl is the right injection layer
  └── DevicePollOutcome union      pending/slowDown are loop-continues, not states

MachineAuthRequestError            kept (one-variant typed wrapper around BetterFetchError)
DeviceTokenError                   kept (the four genuine OAuth terminal failures)
loadMachineSession                 kept (storage boundary; arktype stays here)
saveMachineSession                 kept
MachineAuthStorageError            kept

normalizeBearerSession             kept; arktype assertion at the tail goes away
                                   (Better Auth's customSession plugin types
                                   already carry BetterAuthSessionResponse)
```

### Desired state

```ts
// packages/auth/src/node/machine-auth.ts (~140 lines down from ~180 + ~270)

import { createAuthClient } from 'better-auth/client';
import { deviceAuthorizationClient } from 'better-auth/client/plugins';

const defaultAuthClient = createAuthClient({
  baseURL: EPICENTER_API_URL,
  basePath: '/auth',
  plugins: [
    InferPlugin<EpicenterCustomSessionPlugin>(),
    deviceAuthorizationClient(),
  ],
});

type MachineAuthClient = typeof defaultAuthClient;
// Use one client type throughout. Narrow Pick aliases looked tidy during
// review, but tests construct the same Better Auth client either way, and the
// extra types obscure the simple contract: these functions accept the machine
// auth client.

export async function loginWithDeviceCode({
  authClient = defaultAuthClient,
  sleep = Bun.sleep,
  backend = Bun.secrets,
  onDeviceCode,
}: {
  authClient?: MachineAuthClient;
  sleep?: (ms: number) => Promise<void>;
  backend?: typeof Bun.secrets;
  onDeviceCode?: (device: { userCode: string; verificationUriComplete: string }) => void | Promise<void>;
} = {}) {
  const { data: code, error: codeError } = await authClient.device.code({
    client_id: EPICENTER_CLI_OAUTH_CLIENT_ID,
  });
  if (codeError) return Err(MachineAuthRequestError.RequestFailed({ cause: codeError }));

  const device = {
    userCode: code.user_code,
    verificationUriComplete: code.verification_uri_complete,
  };
  await onDeviceCode?.(device);

  const { data: accessToken, error: pollError } = await pollForAccessToken({
    authClient,
    deviceCode: code.device_code,
    intervalMs: code.interval * 1000,
    expiresInMs: code.expires_in * 1000,
    sleep,
  });
  if (pollError) return Err(pollError);

  const { data: bearerSession, error: sessionError } = await fetchBearerSession({
    authClient,
    accessToken,
  });
  if (sessionError) return Err(sessionError);

  const { error: saveError } = await saveMachineSession(bearerSession, { backend });
  if (saveError) return Err(saveError);

  return Ok({
    status: 'loggedIn' as const,
    session: sessionSummary(bearerSession),
    device,
  });
}

async function pollForAccessToken({
  authClient,
  deviceCode,
  intervalMs,
  expiresInMs,
  sleep,
}: {
  authClient: MachineAuthClient;
  deviceCode: string;
  intervalMs: number;
  expiresInMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<Result<string, DeviceTokenError | MachineAuthRequestError>> {
  const deadline = Date.now() + expiresInMs;
  let interval = intervalMs;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { data, error } = await authClient.device.token({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: EPICENTER_CLI_OAUTH_CLIENT_ID,
    });
    if (data) return Ok(data.access_token);
    if (!error) {
      return MachineAuthRequestError.RequestFailed({
        cause: new Error('device.token returned neither data nor error'),
      });
    }
    switch (error.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5_000;
        continue;
      case 'expired_token':
        return DeviceTokenError.DeviceCodeExpired();
      case 'access_denied':
        return DeviceTokenError.DeviceAccessDenied();
      default:
        return DeviceTokenError.DeviceAuthorizationFailed({
          code: error.error,
          description: error.error_description,
        });
    }
  }
  return DeviceTokenError.DeviceCodeExpired();
}

async function fetchBearerSession({
  authClient,
  accessToken,
}: {
  authClient: MachineAuthClient;
  accessToken: string;
}): Promise<Result<BearerSession, MachineAuthRequestError>> {
  let rotatedToken: string | null = null;
  const { data, error } = await authClient.getSession({
    fetchOptions: {
      headers: { Authorization: `Bearer ${accessToken}` },
      onSuccess: (ctx) => {
        rotatedToken = ctx.response.headers.get('set-auth-token');
      },
    },
  });
  if (error) return Err(MachineAuthRequestError.RequestFailed({ cause: error }));
  if (data === null) {
    return MachineAuthRequestError.RequestFailed({
      cause: new Error('getSession returned null after device-code login'),
    });
  }
  return Ok({
    token: rotatedToken ?? accessToken,
    user: normalizeAuthUser(data.user),
    encryptionKeys: EncryptionKeys.assert(data.encryptionKeys),
  });
}
```

`status` and `logout` follow the same shape: read keychain, call `authClient.getSession({ fetchOptions: { headers: { Authorization: \`Bearer ${session.token}\` } } })` or `authClient.signOut(...)`, persist.

## Architecture

### Before

```
┌─────────────────────────────────────────────────────────┐
│ machine-auth.ts                                         │
│   loginWithDeviceCode  status  logout                   │
│              │            │       │                     │
│              ▼            ▼       ▼                     │
│   ┌──────────────────────────────────────────────────┐  │
│   │ MachineAuthTransport (factory closure)           │  │
│   │   requestDeviceCode                              │  │
│   │   pollDeviceToken     → DevicePollOutcome union  │  │
│   │   fetchSession                                   │  │
│   │   signOut                                        │  │
│   │                                                  │  │
│   │   requestJson helper                             │  │
│   │   arktype: DeviceCodeResponse                    │  │
│   │   arktype: DeviceTokenSuccess                    │  │
│   │   arktype: DeviceTokenErrorResponse              │  │
│   └──────────────────────────────────────────────────┘  │
│                            │                            │
│                            ▼                            │
│                       fetchImpl                         │
└─────────────────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────────────────┐
│ machine-auth.ts                                         │
│   loginWithDeviceCode  status  logout                   │
│              │            │       │                     │
│              └────────────┼───────┘                     │
│                           │                             │
│                           ▼                             │
│   ┌──────────────────────────────────────────────────┐  │
│   │ MachineAuthClient (Better Auth client)           │  │
│   │   .device.code()                                 │  │
│   │   .device.token()    typed { error: { error }}   │  │
│   │   .getSession()      typed customSession         │  │
│   │   .signOut()                                     │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   pollForAccessToken (private)                          │
│     pending/slowDown stay inside the loop               │
│     terminal errors leave as DeviceTokenError           │
│                                                         │
│   fetchBearerSession (private)                          │
│     captures set-auth-token via onSuccess               │
│     projects to BearerSession                           │
└─────────────────────────────────────────────────────────┘
```

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| HTTP layer | Better Auth's `deviceAuthorizationClient()` + `getSession` + `signOut` | Already implements every endpoint we hand-roll today. |
| Transport factory | Delete | Closed only over `fetch`; tests inject at a lower layer instead. |
| `MachineAuthTransport` exported type | Delete | Internal seam, not a contract anyone consumes. |
| `MachineAuthRequestError` typed wrapper | Keep (open question 2) | One-variant wrapper consistent with codebase typed-error discipline. **Honest framing**: no current caller branches on its discriminator (CLI reads `.message` only). Justification is API stability and codebase consistency, not consumer need. Worth re-evaluating if the typed-error pattern is challenged elsewhere. |
| `DeviceTokenError` | Keep | Three terminal OAuth states; we still construct them, now from a typed source. |
| `DevicePollOutcome` union | Delete | Pending/slow-down are polling internals. Caller gets `Result<accessToken, DeviceTokenError>`. |
| Polling helper visibility | Private (module-internal) | Only `loginWithDeviceCode` polls. Public exposure invented states no caller reacts to. |
| `fetch` parameter on public functions | Delete | Tests construct their own auth client with `customFetchImpl`. |
| `{ authClient }` parameter on public functions | Keep, optional | Stable injection point for tests. Default is module-level singleton. Mirrors how `transport` was used. |
| Network-response arktype schemas | Delete (`DeviceCodeResponse`, `DeviceTokenSuccess`, `DeviceTokenErrorResponse`) | Better Auth plugin types are the contract. Re-validating duplicates the type. |
| `BearerSession.assert` in `normalizeBearerSession` | Delete | Better Auth's `customSession` plugin types already carry `BetterAuthSessionResponse`. |
| Storage arktype (`BearerSession.assert` in `loadMachineSession`/`saveMachineSession`) | Keep | Untyped JSON blob from disk; nothing else owns this contract. |
| `set-auth-token` rotation | Capture via `fetchOptions.onSuccess` callback | Better Auth client does not auto-rotate. Documented and supported pattern. |
| Auth-client construction site | Module-level singleton | Measured ~1.5 ms first-create, ~0.06 ms subsequent (Better Auth 1.5.6 + better-fetch 1.1.21). Per-CLI-invocation cost is ~1-2 ms after Better Auth's already-paid ~81 ms import cost. Tests build their own and pass via `{ authClient }`. |
| Client capability types | Single `MachineAuthClient` type | The narrow `Pick<MachineAuthClient, ...>` aliases were decorative. Tests construct one Better Auth client with `customFetchImpl` either way; keeping one type makes the contract easier to read. |
| Per-request `Authorization: Bearer` header | Pass via `fetchOptions.headers` per call | Matches Better Auth's official Node CLI example. Avoids global token state inside the auth client. |
| `EPICENTER_API_URL` | Auth client's `baseURL` | Single source of truth. |
| Test strategy | Build a Better Auth client with `customFetchImpl: stubFetch` per test | Same control as today, expressed at the right layer. Optional: integration tests via `customFetchImpl: app.request` against a real Hono app. |
| Migration of stored keychain blobs | None | `BearerSession { token, user, encryptionKeys }` shape unchanged. |

## Surface map

### Public API churn (`packages/auth/src/node.ts`)

```diff
 export {
   createMachineAuthClient,
   loginWithDeviceCode,
   status,
   logout,
 } from './node/machine-auth.js';

-export type {
-  DeviceCodeResponse,
-  DevicePollOutcome,
-  MachineAuthTransport,
-} from './node/machine-auth-transport.js';
-export {
-  MachineAuthRequestError,
-  type MachineAuthRequestError,
-  DeviceTokenError,
-  type DeviceTokenError,
-} from './node/machine-auth-transport.js';
+export {
+  MachineAuthRequestError,
+  type MachineAuthRequestError,
+  DeviceTokenError,
+  type DeviceTokenError,
+} from './node/machine-auth.js';

 export {
   loadMachineSession,
   saveMachineSession,
   MachineAuthStorageError,
   type MachineAuthStorageError,
 } from './node/machine-session-store.js';
```

`MachineAuthRequestError` and `DeviceTokenError` move to live next to the only file that constructs them. The transport file is deleted.

### Test surface

```ts
// BEFORE (machine-auth.test.ts:191)
const result = await loginWithDeviceCode({
  transport: createMachineAuthTransport({ fetch: fetchImpl }),
  backend,
  sleep: async () => {},
});

// AFTER
const authClient = createAuthClient({
  baseURL: EPICENTER_API_URL,
  basePath: '/auth',
  plugins: [
    InferPlugin<EpicenterCustomSessionPlugin>(),
    deviceAuthorizationClient(),
  ],
  fetchOptions: { customFetchImpl: fetchImpl },
});
const result = await loginWithDeviceCode({
  authClient,
  backend,
  sleep: async () => {},
});
```

The stub `fetchImpl` itself is unchanged. Test setup adds a few lines to construct the auth client; in exchange, the production API stops carrying a fetch parameter forever.

### Consumer impact

```
packages/cli/src/commands/auth.ts          no change       calls machineAuth.{login,status,logout}()
apps/fuji/src/lib/fuji/script.ts           no change       calls loadMachineSession() (storage layer untouched)
apps/{opensidian,honeycrisp,zhongwen}/...  no change       calls createMachineAuthClient() (post-login factory untouched)
examples/notes-cross-peer/notes.ts         no change       calls createMachineAuthClient()
packages/auth/src/node/machine-auth.test   rewrite setup   transport stub → makeTestAuthClient(fetch) helper
```

The only files that change are `machine-auth.ts` (grows), `machine-auth-transport.ts` (deleted), `node.ts` (export diff), and the test file.

## Implementation plan

Single PR. Waves are sequential.

### Wave 1: Build the device-aware auth client

- [ ] **1.1** Add `deviceAuthorizationClient` import and a module-level `defaultAuthClient` to `packages/auth/src/node/machine-auth.ts`. Plugins: `InferPlugin<EpicenterCustomSessionPlugin>()`, `deviceAuthorizationClient()`. `basePath: '/auth'`. `baseURL: EPICENTER_API_URL`.
- [ ] **1.2** Define the `MachineAuthClient` type alias as `typeof defaultAuthClient`. Verify on hover that `.device.code`, `.device.token`, `.getSession`, `.signOut` are all present and that `device.token` error has `.error` and `.error_description` typed.

### Wave 2: Move error definitions to machine-auth.ts

- [ ] **2.1** Move `MachineAuthRequestError` and `DeviceTokenError` `defineErrors` blocks from `machine-auth-transport.ts` into `machine-auth.ts`. Keep variant shapes identical.
- [ ] **2.2** Re-export from `node.ts` per the diff above.

### Wave 3: Implement private helpers

- [ ] **3.1** Add `pollForAccessToken({ authClient, deviceCode, intervalMs, expiresInMs, sleep })` as a non-exported function in `machine-auth.ts`. Returns `Result<string, DeviceTokenError | MachineAuthRequestError>`. The `pending`/`slowDown` cases stay inside the loop. The `slow_down` case adds 5000ms to `interval`.
- [ ] **3.2** Add `fetchBearerSession({ authClient, accessToken })` as a non-exported function. Returns `Result<BearerSession, MachineAuthRequestError>`. Captures `set-auth-token` via `fetchOptions.onSuccess`. Projects `data.user`/`data.encryptionKeys` into `BearerSession`. Uses `rotatedToken ?? accessToken` for the persisted token.
- [ ] **3.3** No public exports for either helper.

### Wave 4: Rewrite the three coordinators

- [ ] **4.1** `loginWithDeviceCode`: replace `transport.requestDeviceCode()` with `authClient.device.code({ client_id })`; wrap the error in `MachineAuthRequestError.RequestFailed({ cause })`. Replace the polling loop body with `pollForAccessToken(...)`. Replace `transport.fetchSession(...)` with `fetchBearerSession(...)`. Drop `transport` parameter; add optional `authClient` parameter.
- [ ] **4.2** `status`: drop `transport`; add `authClient`. Build the bearer fetch by calling `fetchBearerSession({ authClient, accessToken: session.token })`. Network errors continue to fold into `Ok({ status: 'unverified', ... })`.
- [ ] **4.3** `logout`: drop `transport`; add `authClient`. Replace `transport.signOut({ token })` with `authClient.signOut({ fetchOptions: { headers: { Authorization: \`Bearer ${session.token}\` } } })`. Wrap any error in `MachineAuthRequestError.RequestFailed({ cause })` for the warn log; behavior unchanged otherwise.

### Wave 5: Stop importing the transport

- [ ] **5.1** Remove all imports of `machine-auth-transport.ts` across the codebase (coordinators, public exports, test).
- [ ] **5.2** The transport file remains on disk, unused, until Wave 9. This keeps rollback to a one-line revert if Wave 8 finds a behavior gap.

### Wave 6: Drop arktype on the Better Auth boundary

- [ ] **6.1** In `packages/auth/src/contracts/auth-session.ts`, drop the trailing `BearerSession.assert` in `normalizeBearerSession` and `bearerSessionFromBetterAuthSessionResponse`. Better Auth's `customSession` plugin types carry the contract.
- [ ] **6.2** Keep validation of the *encryption keys* shape (`EncryptionKeys.assert(record.encryptionKeys)`). Encryption keys are critical to data integrity; a delayed failure here would corrupt the keychain. If Better Auth's customSession plugin typing degrades on this field across the package boundary, this assertion is the last defense.
- [ ] **6.3** `loadMachineSession`/`saveMachineSession` keep their `BearerSession.assert` calls. The storage boundary keeps its arktype because nothing else owns the contract for "JSON blob from disk."
- [ ] **6.4** Drop the manual `readRecord`/`readString`/`readBoolean`/`normalizeOptionalString` helpers in `auth-session.ts` only after Wave 6.1 confirms no remaining caller needs them. (They were defensive parsers for untyped network responses; with Better Auth's plugin types in scope, they may collapse.)

### Wave 7: Rewrite tests

- [ ] **7.1** In `machine-auth.test.ts`, hoist a `makeTestAuthClient(fetch: typeof globalThis.fetch)` helper that returns `createAuthClient({ baseURL: EPICENTER_API_URL, basePath: '/auth', plugins: [InferPlugin<EpicenterCustomSessionPlugin>(), deviceAuthorizationClient()], fetchOptions: { customFetchImpl: fetch } })`. Each test uses `authClient: makeTestAuthClient(fetchImpl)` instead of `transport: createMachineAuthTransport({ fetch: fetchImpl })`. Net: roughly the same setup volume per test, with the construction cost amortized into one helper.
- [ ] **7.2** Update the type-level expectation tests to match the new inferred error sets:
  - `loginWithDeviceCode`: `MachineAuthRequestError | DeviceTokenError | MachineAuthStorageError` (unchanged)
  - `status`: `MachineAuthStorageError` (unchanged)
  - `logout`: `MachineAuthStorageError` (unchanged)
- [ ] **7.3** The `DeviceCodeExpired` test path now hits the `device.token` error response with `error.error === 'expired_token'`. The stub fetch returns the same `400 + { error: 'expired_token' }` JSON; Better Auth's client surfaces it through the same shape we switch on.

### Wave 8: Verification (transport file still on disk, unused)

- [ ] **8.1** `bun run --filter @epicenter/auth typecheck` passes.
- [ ] **8.2** `bun run --filter @epicenter/auth test` passes.
- [ ] **8.3** Smoke test: `epicenter auth login` against the staging API; `status`; `logout`. All three round-trip correctly. If any fails, revert is a one-line import flip back to the transport.

### Wave 9: Delete the transport module (cleanup)

- [ ] **9.1** Delete `packages/auth/src/node/machine-auth-transport.ts`.
- [ ] **9.2** Grep audit (excluding `specs/` and `docs/`): zero references to deleted names. Patterns to check: `MachineAuthTransport`, `createMachineAuthTransport`, `DevicePollOutcome`, `requestJson`, `DeviceCodeResponse`, `DeviceTokenSuccess`, `DeviceTokenErrorResponse`. Avoid grepping bare `fetch`; that is too noisy. Instead grep `fetch?:\s*typeof globalThis.fetch` and `fetch:\s*fetchImpl`.
- [ ] **9.3** Final typecheck and test pass to confirm no stale reference survived the delete.

## Acceptance criteria

- [ ] `packages/auth/src/node/machine-auth-transport.ts` does not exist.
- [ ] `createMachineAuthTransport` does not exist anywhere in the codebase.
- [ ] `MachineAuthTransport` type does not exist.
- [ ] `DevicePollOutcome` does not exist.
- [ ] `DeviceCodeResponse`, `DeviceTokenSuccess`, `DeviceTokenErrorResponse` arktype schemas do not exist.
- [ ] No public function in `node.ts` accepts a `fetch` parameter.
- [ ] `MachineAuthRequestError` and `DeviceTokenError` are exported from `machine-auth.ts`.
- [ ] `loginWithDeviceCode`, `status`, `logout` accept optional `{ authClient }`, no `{ transport }`.
- [ ] `pollForAccessToken` is private (no export).
- [ ] `fetchBearerSession` is private (no export).
- [ ] Tests construct an auth client with `customFetchImpl` and pass via `{ authClient }`.
- [ ] `bun run --filter @epicenter/auth typecheck` and `test` pass.
- [ ] CLI smoke test against staging passes.

## Things I grilled myself on

### Q: Is the polling loop really necessary, or can we eliminate it entirely?

OAuth 2.0 device authorization grant is a polling protocol (RFC 8628 section 3.4). Better Auth's server endpoint requires polling. There is no SSE or WebSocket alternative in the spec. The only ways to escape polling are to abandon device flow (use magic link or manual code paste) or wait for an upstream protocol change.

The user-visible alternative for CLI auth is magic-link or browser-paste. Both have worse UX than device flow. Polling stays.

What we *can* do is hide it. Today the polling loop lives inside `loginWithDeviceCode` and reads a `DevicePollOutcome` discriminated union from the transport. After this spec, polling lives inside a private helper and returns only terminal results. The discriminated union dies. That is the realistic clean break, not "delete the loop".

### Q: The switch on `error.error` with two pending cases and two terminal cases. Is that actually a smell, or is the smell that pending states leaked above the polling helper?

Latter. The switch is fine inside the polling loop because both `continue` and `return` are natural reactions to terminal vs in-progress states. The smell was that the polling helper used to *return* a discriminated union including pending/slow-down, forcing the caller to re-react. After this spec the helper handles both internally; the caller sees `Result<accessToken, DeviceTokenError>`. The two-and-two switch becomes purely structural.

### Q: Drop `fetch` injection entirely versus keep `customFetchImpl` somewhere?

Drop it from our public API. Keep `customFetchImpl` accessible at the layer where it actually belongs: Better Auth's auth client construction. Tests build their own auth client with a stubbed `customFetchImpl`. Production never sets it. The injection is one layer down, in the test setup function, not threaded through every coordinator.

### Q: What if Better Auth's plugin types degrade to `unknown` across our monorepo boundary?

Concrete check during Wave 1.2. If `data.user` or `error.error` typecheck as `unknown`, fall back to one of:
- Register a custom client plugin schema that mirrors the server response.
- Cast at the boundary inside `fetchBearerSession`/`pollForAccessToken` with an `// trusted: typed by Better Auth plugin` comment.
- Reintroduce a single arktype shape just for the field that broke.

This is a verification concern, not a design concern. The spec stands.

### Q: What about offline mode for `status`?

Today `status` folds network errors from `transport.fetchSession` into `Ok({ status: 'unverified', ... })`. Same behavior here: when `fetchBearerSession` returns `Err(MachineAuthRequestError)`, `status` returns the unverified status with the error attached. The user keeps seeing their cached identity offline.

### Q: `set-auth-token` rotation via `onSuccess` callback. Fragile?

Verified at Better Auth 1.5.6 and `@better-fetch/fetch` 1.1.21: the client proxy awaits the per-call `options.onSuccess`, and `@better-fetch/fetch` awaits success hooks before resolving. The closure-variable read after `await authClient.getSession(...)` is timing-safe, not hand-wavy.

If `onSuccess` semantics change in a future major version, that is one method-level edit (look for `set-auth-token`) and is detectable on upgrade.

### Q: Why keep `MachineAuthRequestError` if Better Auth has `BetterFetchError`?

One reason: consistent typed-error discipline across the codebase (every fault domain has a `defineErrors` block, even one-variant ones).

Honest framing (verified during external grill): no current caller branches on the discriminator. CLI reads `.message` only. The wrapper exists for codebase pattern consistency, not because consumers need the discriminator. Worth re-evaluating consciously rather than reaffirming by inertia. See open question 2.

### Q: Module-level singleton `defaultAuthClient`. What happens in tests that need a different `baseURL`?

They construct their own. The singleton is the production default; tests pass `{ authClient }` explicitly. There is no global mutation, no `setAuthClient(...)` test hook, no module-mocking required.

### Q: Migration of existing keychain blobs?

None. `BearerSession { token, user, encryptionKeys }` shape unchanged. The storage layer's arktype validation still runs.

### Q: Bundle size in the CLI?

`createMachineAuthClient` already pulls `better-auth/client` via `createBearerAuth`. Adding `deviceAuthorizationClient()` is one plugin import on an already-loaded package.

### Q: Is "delete the transport" actually safe given the spec's recently-shipped error decomposition?

The error decomposition (`MachineAuthRequestError`, `DeviceTokenError`) is what makes the deletion safe. Each error type has a clear new owner inside `machine-auth.ts`. Both are constructed from typed Better Auth responses instead of raw HTTP status codes. The shipped spec did the bottom-up error work; this spec collects the dividend.

## Open questions

1. **Should `pollForAccessToken` and `fetchBearerSession` live in `machine-auth.ts` or in a sibling file?**
   - (a) Same file, private. (b) Sibling files, exported only within the package.
   - **Recommendation**: (a). They are not reused. Keeping them next to their only caller is cohesive.

2. **Should we drop `MachineAuthRequestError` entirely and surface `BetterFetchError` to consumers?**
   - (a) Keep our typed wrapper. (b) Re-export Better Auth's error type. (c) Drop the wrapper and let `BetterFetchError` flow through.
   - Verified during external grill: zero current callers branch on the discriminator. CLI reads `.message`. The keep-rationale is API stability and codebase consistency, not consumer need.
   - **Recommendation**: (a) for now. The implementer should consciously evaluate (c) before the typed-error pattern gets reaffirmed by inertia. If choosing (c), the test file's type-level expectations become `BetterFetchError | DeviceTokenError | MachineAuthStorageError`.

3. **Should tests run real integration via `customFetchImpl: app.request` against an in-process Hono app?**
   - (a) Stub fetch (current style). (b) In-process Hono app via `customFetchImpl`. (c) Hybrid: stub for unit cases, Hono for happy-path.
   - **Recommendation**: Out of scope for this spec. Wave 7 keeps stub fetch; integration migration is its own follow-up.

4. **Should `defaultAuthClient` accept `baseURL` overrides via env, or is `EPICENTER_API_URL` enough?**
   - **Recommendation**: `EPICENTER_API_URL` only, until a real consumer needs the override. Adding env knobs without a caller is feature creep.

5. **Does `authClient.signOut()` accept `fetchOptions: { headers: { Authorization } }` cleanly, or do we need a different shape?**
   - **Resolved**: Better Auth 1.5.6 supports this call shape. The dynamic client proxy merges `arg.fetchOptions` into the request, `/sign-out` is registered as `POST`, and `@better-fetch/fetch` applies the headers. Use `authClient.signOut({ fetchOptions: { headers: { Authorization: \`Bearer ${session.token}\` } } })` in Wave 4.3. Keep `$fetch('/sign-out', ...)` only as a fallback if local typecheck contradicts the installed package.

6. **Should `loginWithDeviceCode` accept an `onPoll({ attempt, elapsedMs, nextIntervalMs })` callback for CLI progress UI?**
   - Distinct from the deleted `DevicePollOutcome` union. That was transport vocabulary; this would be UI policy.
   - **Recommendation**: Defer. No CLI feature today renders progress during polling (the verification URL itself is the UX). Add the callback when a real consumer asks for it. Documented here so a future implementer doesn't reach for `DevicePollOutcome` again.

## Out of scope

- The `createMachineAuthClient` (post-login `AuthClient` factory). It already uses Better Auth via `createBearerAuth`. No change here. Whatever surface changes the parallel sibling spec lands on `AuthClient` (e.g., adding `signInWithSocial`) are that spec's problem to solve for the CLI environment; this spec does not touch it.
- `createBearerAuth` and `createCookieAuth` themselves. Different layer; modified by the parallel sibling spec, not this one.
- Refresh-token handling. CLI users re-run `epicenter auth login` on expiry. Adding refresh would be its own spec once `deviceAuthorization()`'s refresh capability is verified.
- Integration test infrastructure (Wave 7 keeps stub-fetch unit tests).
- Bundle-size measurement and tree-shaking analysis.
- The playground configs that already reference removed methods. Out of scope per the shipped spec; still out of scope here.

## References

- `packages/auth/src/node/machine-auth-transport.ts` (the file to delete)
- `packages/auth/src/node/machine-auth.ts` (the file to grow)
- `packages/auth/src/node/machine-auth.test.ts` (test setup to rewrite)
- `packages/auth/src/create-auth.ts:122-203` (`createBearerAuth`, established Better Auth + `customSession` typing pattern)
- `packages/auth/src/contracts/auth-session.ts` (`normalizeBearerSession`, `bearerSessionFromBetterAuthSessionResponse`)
- `specs/20260504T030000-machine-auth-collapse-to-free-functions.md` (shipped predecessor)
- `specs/20260504T010000-drop-authclient-redirect-sign-in.md` (parallel sibling: web environments adopt OAuth 2.1 PKCE via the same Better-Auth-primitives-end-to-end thesis)
- `specs/20260503T230000-auth-unified-client-two-factories.md` (split factories spec; sets the greenfield-clean-breaks precedent)
- Better Auth docs: device authorization (`https://better-auth.com/docs/plugins/device-authorization`), bearer plugin (`https://better-auth.com/docs/plugins/bearer`)
- Skills: `greenfield-clean-breaks`, `one-sentence-test`, `auth`, `better-auth-best-practices`, `error-handling`, `factory-function-composition`, `logging`
