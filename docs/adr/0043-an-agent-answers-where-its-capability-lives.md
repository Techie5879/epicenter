# 0043. An agent answers where its capability lives

- **Status:** Superseded
- **Superseded by:** [ADR-0047](0047-the-agent-loop-runs-in-the-client-and-tools-are-dispatched-actions.md) (every agent answers in the client; the daemon is reached by dispatched actions, not by running the loop). What carries forward: Epicenter runs no hosted answering worker, and the blind box plus metered stream is the floor.
- **Date:** 2026-06-20
- **Supersedes:** [ADR-0041](0041-every-answerer-is-a-worker-the-browser-never-answers.md)
- **Relates:** [ADR-0035](0035-durable-storage-is-one-per-person-coordination-box.md) (the blind box a worker syncs through), [ADR-0033](0033-a-conversation-has-one-transport-and-two-triggers.md) (the metered inference stream), [ADR-0042](0042-the-agent-loop-is-the-workers-over-the-doc-as-the-message-array.md) (the worker's agent loop), [ADR-0030](0030-agents-are-immutable-capability-bundles.md) (the capability bundle that names where an agent answers), [ADR-0036](0036-answer-bodies-are-native-parts-arrays-streamed-into-y-text.md) (the parts body every answer writes), [ADR-0038](0038-a-daemon-answers-through-the-first-inference-backend-it-can-satisfy.md) (the backend a worker resolves)

## Context

ADR-0041 deleted the browser answerer and committed the managed agent to an Epicenter-hosted, on-demand Durable Object, to win close-browser durability for a cloud conversation. A use-case pass against the two apps that actually motivate the answering stack showed that quadrant is a phantom. Vocab is stateless question-answering: a lost answer is re-asked at zero cost, so a client that calls metered inference and renders is already the correct and cheapest shape, with nothing to make durable. Local Books is the opposite: its worker reads a local SQLite mirror of your books, so it must run on the machine that holds the data; an Epicenter-hosted worker would mean uploading your books, the one thing a local-first books product exists to avoid. The hosted managed worker served neither app, and "the browser never answers" was the wrong general rule.

## Decision

**An agent answers where its capability lives, not in a fixed runtime.** Who answers follows the agent's immutable capability bundle (ADR-0030), and falls into exactly two cases:

```txt
capability-free agent (pure inference, e.g. Vocab)
    -> answers in the CLIENT: the browser runs the shared answer core
       (ADR-0036) fed by the metered /api/ai/chat stream (ADR-0033),
       sinking parts into the conversation child doc.

local-data / tool agent (e.g. Local Books)
    -> answers on the DAEMON where its data and tools are; the answer
       streams into the same synced conversation doc (ADR-0042's loop).
```

**Epicenter runs no per-user answering worker.** It is the blind coordination box (relay + anchor, ADR-0035) plus a metered, stateless inference stream (ADR-0033). The conversation substrate (table row to child doc to parts, ADR-0025/0036) and the one shared answer core stay; only the answer's *origin* differs. An always-on private worker that Epicenter hosts for you (a hosted daemon) is a paid premium, never the free default; a transient serverless answer-pass for the narrow "answer while I have zero devices online" cell is deferred until that cell is a real ask, not built now.

This overturns the two ADR-0041 claims that depended on the phantom quadrant: "the browser never answers" (it does, for the capability-free agent) and "the managed answerer is an Epicenter-hosted on-demand Durable Object" (there is no hosted answering worker). What ADR-0041 got right carries forward: every answer is a worker writing into the doc, blindness is per-agent, the doc is the durable transport, and existence-is-the-claim is the only double-answer guard.

## Consequences

<!-- doc-path-check: ignore-next-line -->
- **Wave 3 of `specs/20260620T000000-vocab-answerer-collapse.md` is not built.** The hosted Durable Object, the queue, the wake route, the internal-RPC child-doc connector, and the keepAlive / alarm machinery are deleted from the plan.
- **Vocab is a client-side chat over the metered SSE endpoint** (`@tanstack/ai-svelte` `createChat` + `fetchServerSentEvents`), writing answer parts into the conversation child doc. The browser-answerer deletion ADR-0041 planned is reversed for capability-free agents; what is still deleted is the `owner` routing fork and the hosted-worker apparatus, not client answering.
<!-- doc-path-check: ignore-next-line -->
- **Local Books becomes the first real worker consumer and un-defers ADR-0042** (the agent loop): the daemon runs SQL locally and streams tool-call, tool-result, and text parts into the synced conversation. See `specs/20260620T180000-local-books-agent-over-sql.md`.
- **Close-browser durability for stateless chat is a non-goal.** Durable async work belongs to the daemon, on-demand while you use that agent, with the anchor catching up a sleeping device. Epicenter never pays for a free always-on thinker.
- **The economic floor is two blind things plus metered tokens:** the box never reads your data, the inference stream is pay-per-call with zero idle, and nothing per-user thinks-while-idle for free.

## Considered alternatives

- **Keep ADR-0041's hosted managed worker (Durable Object or queue).** Rejected: it serves a phantom cell. Vocab needs no worker; Local Books cannot use a hosted one without uploading the data its whole value is keeping local.
- **One shared multi-tenant answer daemon.** Rejected as the default: a cross-tenant peer plus a per-user always-on cost, to answer what the client already answers for free.
- **A transient serverless answer-pass as the default managed path.** Rejected for now: it is a cost optimization for one narrow cell (zero-box stateless chat, answered while you have no device online) that neither real app needs. Revisit only if that cell becomes a real product ask; the box and the metered stream already exist to host it cheaply then.
