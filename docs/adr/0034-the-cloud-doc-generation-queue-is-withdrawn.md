# 0034. The cloud doc-generation queue is withdrawn (the cloud is a metered inference stream, not a doc writer)

- **Status:** Superseded by [ADR-0033](0033-a-conversation-has-one-transport-and-two-triggers.md) (revised)
- **Date:** 2026-06-18
- **Relates:** [ADR-0035](0035-durable-storage-is-one-per-person-coordination-box.md), [ADR-0030](0030-agents-are-immutable-capability-bundles.md), [ADR-0036](0036-answer-bodies-are-native-parts-arrays-streamed-into-y-text.md)

## What this ADR proposed, and why it is withdrawn

This ADR proposed making the **server** a doc writer for cloud chat, but moving it
off a held-open HTTP request onto a **Cloudflare Queue** with an ephemeral
consumer Worker, to buy a *durable mailbox* (a cloud answer that survives the tab
closing) without paying Durable Object resident duration. It carried a kickoff
that reserved credits and enqueued a `GenerationJob`; the consumer ran
`runDocGeneration` and reconciled billing across the two invocations.

It is withdrawn after grilling, because it solved a problem the product does not
have. The argument, in one chain:

1. **Cost was a red herring.** The DO-duration it optimized away is ~$0.0002 per
   generation, well under 1% of the inference bill it rides on. Per-generation
   execution cost does not justify a queue.
2. **The durable, background, always-on answerer already exists: the daemon**
   (ADR-0035's worker spoke), which gets durability for free on the owner's
   hardware. The *cloud* answer is the **interactive** case where the user is
   watching; it does not need to outlive the client.
3. **The synchronous-402 boundary the kickoff existed to provide already exists**
   on the `/api/ai/chat` SSE endpoint (`chargeAiCreditsWithAutumn` reserves before
   streaming). A separate server kickoff was redundant.
4. **ADR-0035 forbids the box thinking; the worker is a peer spoke.** The
   cleanest answerer is therefore an in-process peer, and one already shipped:
   opensidian answers cloud conversations in the browser via the Epicenter
   provider (`attachChatBrowserAnswerer` + `createEpicenterProviderChatStream`),
   with no kickoff and no server doc writer.

So the server is **not** a doc writer at all. The cloud is a blind sync network
plus a stateless metered inference stream (`/api/ai/chat`); an in-process peer (a
browser tab or a daemon) is the only thing that writes a conversation doc. The
queue, the consumer, the cross-invocation billing, and `runDocGeneration` itself
are deleted. The live decision is the revised [ADR-0033](0033-a-conversation-has-one-transport-and-two-triggers.md).

This record is kept so the queue is not re-proposed without first answering: *which
answerer needs to be durable and client-independent without a daemon?* If a future
"managed background agent" genuinely needs that, it is a server-side worker in
the Model-2 sandbox lane (ADR-0030), not a general server-writes-every-doc path.
