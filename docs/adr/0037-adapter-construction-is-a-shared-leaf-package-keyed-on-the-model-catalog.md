# 0037. Adapter construction is a shared leaf package keyed on the model catalog

- **Status:** Superseded
- **Superseded by:** [ADR-0050](0050-the-inference-contract-is-openai-compatible.md) (the inference seam is OpenAI-compatible Chat Completions, not an SDK adapter keyed on the catalog). The adapter leaf is not deleted: it survives as the backend for tab-manager's device-local `createChat` loop ([ADR-0048](0048-a-conversations-loop-is-chosen-by-whether-its-transcript-syncs.md)) until that loop converges.
- **Date:** 2026-06-19

## Context

`MODELS_BY_ID` (`@epicenter/constants/ai-providers`) single-owns the model ->
provider catalog, but the *construction* of a TanStack text adapter from a model
was duplicated: `resolveAdapter` in the hosted route (`@epicenter/server`) and a
gemini-only inline switch in the zhongwen daemon. The catalog's executable twin
had no home. Putting it in `@epicenter/constants` was rejected: the browser
imports that package at 6+ surfaces, so a runtime `createGeminiChat` /
`createOpenaiChat` import there would pull provider SDKs into browser bundles.

ADR-0033 names `ChatStream` as the one sink-facing waist every inference backend
necks down to; this ADR refines *how* the adapter feeding that waist is built.

## Decision

The model -> provider adapter construction lives in `@epicenter/ai-adapters`, a
leaf package exporting a single `createAdapterForModel(model, apiKey)`. It is the
executable twin of the catalog: the catalog owns the data, this owns turning a
model into a live adapter. The hosted route and the daemon both source their
adapter through it, each keeping its own key policy (BYOK vs house key, which env
var to read, what an absent key means). The browser never imports it.

The browser's cloud path keeps its own hand-rolled SSE-response parser. TanStack
ai-client (0.16.3) exposes no standalone SSE parser; its only SSE consumer,
`fetchServerSentEvents`, is a full AG-UI connection adapter that POSTs a
`RunAgentInput` envelope our custom `/api/ai/chat` contract does not speak.
Adopting it to delete the parser would add coupling, not remove it, so the
hand-roll stays.

## Consequences

- `@epicenter/constants` stays pure: the provider SDKs remain type-only devDeps,
  and no provider SDK enters any browser bundle, guaranteed by the package DAG
  (`constants/ai-providers` <- `@epicenter/ai-adapters` <- {server, daemon}), not
  by a third-party `sideEffects` flag.
- Swapping the daemon (or a route) to a new provider is a catalog + env-key
  change with no construction code edit. An exhaustive provider switch makes an
  unhandled provider a compile error, not a silent wrong key.
<!-- doc-path-check: ignore-next-line -->
- A second copy of the construction is foreclosed, except the deliberately standalone one in `examples/doc-as-wire-chat/src/inference.ts` (zero-dep pedagogy, left alone on purpose).
- The browser SSE parser is not collapsed onto TanStack. Revisit only if TanStack
  exposes a standalone response parser, or our endpoint adopts the AG-UI request
  shape.
