# 0042. The agent loop is the worker's, over the doc as the message array

- **Status:** Superseded
- **Superseded by:** [ADR-0047](0047-the-agent-loop-runs-in-the-client-and-tools-are-dispatched-actions.md) (the loop runs in the client, not the worker; the daemon provides data via dispatched actions and runs durable work as async jobs, never inference)
- **Date:** 2026-06-20
<!-- doc-path-check: ignore-next-line -->
- **Note (2026-06-20), per [ADR-0043](0043-an-agent-answers-where-its-capability-lives.md):** the worker that owns this loop is the **daemon** (an agent answers where its capability lives); ADR-0041's hosted worker is not built, so the "hibernating hosted worker" framing below is the daemon, on-demand while you use the agent. The first real consumer is **Local Books** (`specs/20260620T180000-local-books-agent-over-sql.md`), not opensidian / tab-manager as written below: it has local-data tools that bind the worker to the machine holding the data. The design (worker-owned loop over the doc-as-message-array, durable doc-mediated approval) is unchanged.
- **Relates:** [ADR-0043](0043-an-agent-answers-where-its-capability-lives.md) (the worker that owns the loop is the daemon), [ADR-0041](0041-every-answerer-is-a-worker-the-browser-never-answers.md) (superseded; original "worker owns the loop" framing), [ADR-0033](0033-a-conversation-has-one-transport-and-two-triggers.md) (the engine stays a pure token source), [ADR-0025](0025-agent-conversations-are-durable-child-docs-driven-by-an-observing-worker.md) (approval is a durable doc record), [ADR-0021](0021-actions-are-the-only-surface-that-crosses-a-process-boundary.md) (tools are published actions), [ADR-0031](0031-collaboration-is-addressed-single-writer-regions-in-a-child-doc.md) (the single-writer region the approval is written into), [ADR-0036](0036-answer-bodies-are-native-parts-arrays-streamed-into-y-text.md) (the parts body the loop writes)

## Context

Today a `ChatStream` is single-shot text: `(messages, signal) => AsyncIterable<textChunk>`, drained once by `attachChatWorker`. Tools (workspace actions, ADR-0021) are the waiting seam: `AgentConfig.tools` is `[]`, and `chat-doc.ts` already models `tool-call` / `tool-result` parts ("Phase 1 writes only text"). The agentic tool loop and its approval flow need a home that does not contradict the rest of the system.

Grounding the blessed frameworks (TanStack AI, Vercel AI SDK) surfaced the real constraint. Both run the multi-step loop (model → tool-call → execute → re-prompt) in a **request handler** — TanStack's server `chat()`, Vercel's `streamText`/`useChat` — with loop state in process or client memory. Epicenter's cloud is not a loop host (the relay/anchor is blind, ADR-0041/0033) and its approval must be durable and multi-device (ADR-0025), which an in-memory suspension cannot satisfy. But Vercel's own primitive states the escape: **the loop is a pure function of the messages array** — persist the messages (including tool-call/result parts) after each step and resume by re-calling with the saved messages; `stopWhen` halts the loop at an approval boundary.

## Decision

**The agent loop is a pure function of the message array, and the message array is the synced conversation child doc.** The **worker** owns the loop (the hosted or daemon worker of ADR-0041), generalizing the existing single-shot worker so there is **one answering path**: text-only is the zero-tool path (the loop runs once, no tool-calls).

- **The engine stays a pure single model-invocation token source** (ADR-0033): `(messages, signal) => AsyncIterable<chunk>` where a chunk is a text-delta, a tool-call request, or a finish reason. One model call. It never executes a tool and never reads the doc.
- **The worker drives the multi-step loop:** drain the engine → write text and tool-call parts into the doc → if the finish reason is `tool-calls`, run the tools, append tool-result parts, re-prompt with the augmented messages → repeat until a text finish. Tool execution lives in the worker, where the doc and the actions already are (ADR-0021).
- **Tools are workspace actions via `tool-bridge`** (already built): list action keys on `AgentConfig.tools`; queries auto-run; mutations need approval.
- **Approval is a durable doc record** (ADR-0025): the worker writes a `tool-call` with state `awaiting-approval` and **stops, releasing all memory** — so the pause survives a restart, a hibernation, or a different approving device. Any device writes the decision into a **client-owned single-writer region** (exactly the `cancelRequestedAt` pattern, ADR-0031); the assistant message stays worker-owned. The worker resumes by re-reading the doc. On a hibernating hosted worker (ADR-0041) the pause costs nothing.

**Build is deferred until a real tool consumer exists.** Vocab has no actions and rides the unified path with `tools: []` for free, so it gains nothing user-visible from the loop. The first consumer is an app that has actions and wants durable, multi-device, approval-gated tools (opensidian / tab-manager), never Vocab. Recording the design now gives the `chat-doc.ts` tool-call parts a destination and fixes the contract the engine and the worker must speak.

## Consequences

- One answering path; single-shot is a special case of agentic, not a separate code path.
- The engine seam stays narrow (a new engine implements one model call), so BYOK / local / metered all stay simple.
- The CRDT-specific work is bounded to one thing: the approval as a single-writer region, a pattern already shipped for the cancel field.
- `tool-bridge`'s in-memory TanStack approval (as used by tab-manager today) and this doc-mediated approval are different mechanisms; the consumer migration is the moment to converge them.

## Open question (decided when F is built)

The **loop engine** is left open and is engine-agnostic to this decision (the doc-as-message-store is the same either way):

- **Hand-roll a thin loop over the existing TanStack adapters** in `@epicenter/ai-adapters` (no new framework; reuse provider tool-call normalization; own the small doc-coupled loop). Current lean.
- **Vercel AI SDK `streamText` + `stopWhen`** in the worker (most blessed loop primitive; durable approval and resume-from-messages are first-class; cost: a second AI framework + a doc↔UIMessage boundary).
- **Roll our own over raw provider SDKs** (zero framework impedance; cost: own per-provider tool-call streaming).

## Considered alternatives

- **The engine owns the loop** (model ↔ tool ↔ model inside the `ChatStream`). Rejected: it forces the engine to hold the actions and read the doc for approval, breaking the pure-token-source seam (ADR-0033); and an in-memory suspended generator cannot survive a restart or a cross-device approval (ADR-0025), so it collapses back into the worker-owned loop the moment approval must be durable.
- **TanStack server `chat()` / a Vercel route as the loop host.** Rejected: the cloud is not a loop host (ADR-0041); the loop runs in the worker.
- **Grow Vocab a tool to act as the tracer.** Rejected: it adds a table + action beyond the answering stack for a save that needs no daemon; the honest tracer is an app that already has actions.
