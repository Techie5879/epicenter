# 0046. A capability-free agent persists finished messages, not live doc streams

- **Status:** Superseded
- **Superseded by:** [ADR-0047](0047-the-agent-loop-runs-in-the-client-and-tools-are-dispatched-actions.md) (the client-state-plus-LWW-records shape this drew for capability-free agents becomes universal; tool agents run the same client loop, so the doc-streaming core is deleted rather than kept)
- **Date:** 2026-06-21
- **Relates:** [ADR-0043](0043-an-agent-answers-where-its-capability-lives.md) (the capability-free agent answers in the client), [ADR-0036](0036-answer-bodies-are-native-parts-arrays-streamed-into-y-text.md) (doc-streaming, scoped here to local-data/tool agents), [ADR-0033](0033-a-conversation-has-one-transport-and-two-triggers.md) (the metered inference stream the client consumes)

## Context

ADR-0043 settled that a capability-free agent (Vocab) answers in the client: the open tab calls the metered `/api/ai/chat` stream (ADR-0033) and renders. It still pictured the client writing answer parts into the synced conversation child doc, reusing the shared doc-streaming core (ADR-0036). But a capability-free agent's live answer needs nothing durable: a lost answer is re-asked at zero cost, which is the whole reason it can answer in the client at all. Streaming the live answer into the CRDT buys cross-device live view this agent does not need, and ADR-0036 itself rejected a last-write-wins key-value body. That rejection was specifically about overwrite-per-flush, a whole-body rewrite every token, which is quadratic. Persist-once-on-finish is linear and was never evaluated.

## Decision

**A capability-free agent streams its live turn in client state and persists only finished messages; it does not stream into the conversation doc.** The open tab consumes the metered stream's deltas directly into component `$state` (no chat-state binding, no second wire format), and writes each message into the conversation's child doc once, whole, the moment it is finished: the user turn on send, the assistant turn on a clean finish. The child doc is a last-write-wins store keyed by message id (one JSON blob per message via `attachRecords`), not a `Y.Array` of `Y.Map`s with per-token `Y.Text` (ADR-0036). On open, the client hydrates from the store and observes it, so a message finished on another device shows up.

**This scopes ADR-0036's doc-streaming to local-data and tool agents.** An agent whose worker runs on the daemon (Local Books, ADR-0042's loop) keeps streaming parts into `Y.Text`: its answer can run tools, take real time, and must survive a closed browser, so the synced doc is the right live transport. ADR-0036 holds there. It does not apply to the capability-free client answerer.

This un-unifies Vocab from the shared answer core (`@epicenter/workspace/ai`), which stays for the doc-streaming agents (opensidian today, Local Books next). Vocab no longer imports it.

## Consequences

- **Vocab's conversation engine is `createConversation` in client `$state`**, not `bindConversation` over the shared core. Live tokens never touch the CRDT, so there is no overwrite-per-flush and no quadratic growth; finished-message writes are linear in message count.
- **A stopped or failed turn persists nothing.** The partial answer lives only in component state and is dropped; the durable user turn is re-asked. The doc-streaming core's interrupted/stopped artifacts and the write-once `finish` marker do not exist for this agent.
- **Cross-device live view is gone for the capability-free agent.** A second device sees a turn only once it finishes and syncs. This is the accepted cost of not streaming into the doc; re-asking is free, so live mirroring was never load-bearing.
- **`attachRecords` is a new workspace child-doc layout** (a per-id LWW JSON store wrapping `YKeyValueLww`), reusable by any future agent whose document is a keyed bag of finished records rather than a streamed body.
- **The shared doc-streaming core is not deleted.** opensidian (a tool agent) still uses it through `attachChatConversation`, and Local Books will. The earlier "collapse the now-dead core" plan assumed Vocab was its only consumer; a monorepo trace showed it is not.

## Considered alternatives

- **Stream the live answer into the doc, client-side (ADR-0043's picture).** Rejected for the capability-free agent: it pays CRDT cost and the overwrite-per-flush problem for cross-device live view a re-askable answer does not need.
- **A whole-conversation LWW blob (one key per conversation).** Rejected: every finished message rewrites the entire transcript, the quadratic shape ADR-0036 named. One key per message id is linear.
- **A chat-state binding (`createChat` / `useChat`).** Rejected: it reintroduces a second store and wire format that fights the LWW persistence. Vocab already has the delta iterable; consuming it directly is the smaller surface.
