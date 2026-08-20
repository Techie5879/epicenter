# Codex subscription transformations

**Date**: 2026-08-20
**Status**: In Progress
**Implementation checkpoint**: `5f00ba03be6d82e67c69201ebeb9d6f1fb4e6f27`
**Owner**: Whispering

## One sentence

Whispering connects one device-local ChatGPT subscription to its global Text provider, activates that session safely, and sends Polish or Recipe prompts directly to Codex Responses.

## User goal

A person with a ChatGPT subscription can connect it directly in Whispering, select `gpt-5.3-codex-spark`, and run fast text transformations without the Codex CLI, OpenCode, or another runtime intermediary.

## Current upstream shape

The upstream rebase changed transformations before this work landed. Whispering now has one global Text AI provider and model shared by Polish and every Recipe. This implementation adds Codex to that global provider. It does not rebuild the old branch's per-step or per-recipe provider fields.

The fixed Codex catalog is ordered as follows:

1. `gpt-5.3-codex-spark`
2. `gpt-5.4-mini`
3. `gpt-5.4`
4. `gpt-5.5`

Selecting Codex always selects Spark. Existing and new settings keep Google's existing default until the person switches providers.

## Architecture

```txt
CompletionRuntimeConfig and shared ChatGPT account control
  -> workspace settings: completionProvider and completionModel
  -> device config: auth.codex
  -> typed #platform/tauri Codex OAuth command
  -> Epicenter localhost OAuth callback
  -> injected, UI-free Codex protocol service
  -> completeWithGlobalDefault activation and storage ownership guard
  -> direct ChatGPT Responses SSE request
  -> transformed text returned to Polish or the invoking Recipe
```

`auth.codex` stores the access token, refresh token, expiry, and optional account identity on the device. It does not enter workspace KV or the string API-key facade. The account control shows email, then account ID, then `Connected`; it never reads or displays a token.

## Native OAuth callback

Epicenter exposes one generated, typed `completeCodexOauthLogin` command to the Whispering window. The command:

- validates the exact HTTPS OpenAI authorization endpoint, exact localhost redirect URI, and one matching non-empty state before opening the browser;
- binds `127.0.0.1:1455` before opening the authorization URL;
- accepts only the expected callback path and state, limits request size, applies a per-connection read timeout, and ignores stray or stalled connections;
- stops after five minutes if no valid callback arrives;
- cancels an older attempt when a newer login starts, prioritizes cancellation if callback and cancellation become ready together, drops the old listener, and retries the new bind while the port is released.

This cancel and rebind lifecycle prevents an abandoned login from completing alongside its replacement.

## Codex service and completion invariants

- Authorization uses PKCE S256 with a fresh verifier and state.
- Token exchange and refresh validate response shapes. Errors never include raw token bodies or backend response bodies.
- Account identity follows the pinned claim precedence: ID token before access token; direct account claim, namespaced account claim, then first organization ID within each token.
- Residency is derived for each request from the active access token only. `no_constraint` omits the residency header.
- `ensureActiveSession` applies the 60-second refresh window once at the completion operation boundary.
- Refresh work is keyed by the old refresh token. Concurrent callers for one account share work, distinct accounts remain isolated, settled rotation chains remain reusable, failures are evicted, cycles return sanitized errors, and disconnect clears the cache explicitly.
- `complete` accepts an already-active session and never refreshes it. It parses LF or CRLF SSE, multiline `data:` fields, output deltas, and requires `response.completed` before returning text.
- The completion operation captures `auth.codex`, activates it once, then rereads storage before Responses. It persists a valid rotation when storage still holds the captured refresh token, proceeds without overwrite when another same-account caller already persisted the active refresh token, and aborts on disconnect or account replacement.
- Rotated credentials persist before the Responses call, so a downstream generation failure does not discard a valid session.
- The Polish `AbortSignal` reaches the Responses fetch. Token and Responses requests have no feature-specific outbound deadline.

## Security and tradeoffs

This integration follows a private ChatGPT backend contract, not a documented public API. A future server change may require a client update.

The refresh token lives in Whispering's localStorage-backed device configuration rather than an OS keychain. This matches the current device-config architecture but gives the browser storage boundary responsibility for the session. The native callback has a five-minute deadline; outbound token and Responses calls rely on the host transport and caller cancellation instead of feature-specific timeouts.

## Verification record

At `5f00ba03be6d82e67c69201ebeb9d6f1fb4e6f27`:

- [x] Focused Codex, routing, target, and device-config tests: 59 passed.
- [x] Full Whispering package tests: 163 passed.
- [x] Whispering browser and desktop typechecks: 0 errors and 0 warnings.
- [x] Whispering browser and Epicenter-hosted production builds passed.
- [x] Native OAuth callback tests: 13 passed.
- [x] `cargo check` passed.
- [x] Touched-file Biome passed. It reported six existing generated-binding `any` warnings.
- [x] `git diff --check`, changed callback `rustfmt --check`, and forbidden dash scan passed.
- [ ] Complete a live ChatGPT subscription login.
- [ ] Run a real `gpt-5.3-codex-spark` transformation.

These live checks keep this spec in progress.

The broader Rust library run had 137 passing tests and one unrelated pre-existing failure in `one_verb_opens_compiled_and_admitted_applications_alike`. The base commit contains the same contradictory `"0-"` fixture and edge validator.

## Review history

The cumulative implementation at `5f00ba03be6d82e67c69201ebeb9d6f1fb4e6f27` passed review after the native cancellation and rebind fixes and the current-upstream service reachability integration. That review found no blockers or non-blockers. This SHA remains the implementation checkpoint recorded above.

A later review of `c6dae1caa9256d3ff817b2aeb3d98712fb642793` found that account-operation ownership ended too early and that the spec status was terminal while live checks remained. The current branch includes the lifecycle ownership fix and keeps this document in progress until those live checks pass.

## Deviation from the old branch

The pre-rebase branch attached provider and model choices to individual transformation steps. Current Whispering has one global Text provider shared by Polish and every Recipe, so the port uses that setting and one shared account control instead of restoring obsolete per-step configuration.

## Protocol references

- [OpenCode Codex integration at `e2505d434a6d78904ecfe546c4a1980d26bd8cd1`](https://github.com/anomalyco/opencode/blob/e2505d434a6d78904ecfe546c4a1980d26bd8cd1/packages/opencode/src/plugin/openai/codex.ts)
- [OpenAI Codex tree at `3b45c29062ff0e76e71c91b6753290400e7fa8da`](https://github.com/openai/codex/tree/3b45c29062ff0e76e71c91b6753290400e7fa8da)
