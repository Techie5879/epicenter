# Always-On Workers Over Synced Docs

**Date**: 2026-06-16
**Status**: Draft
**Owner**: Braden
**Builds on**: `20260616T185740-cloudless-home-anchor-direction.md`, `20260530T100000-ai-workflows-consolidated-design.md`, `docs/adr/0024-an-always-on-worker-runs-app-semantics-beside-the-app-blind-anchor.md`, `docs/adr/0025-agent-conversations-are-durable-child-docs-driven-by-an-observing-worker.md`, `docs/adr/0021-actions-are-the-only-surface-that-crosses-a-process-boundary.md`

## One Sentence

A thin client does work by writing a durable turn into a shared workspace document;
an always-on, app-aware worker observes the document, runs the work locally (the
app's actions, inference, queries against its own read models), and streams the
result back into the same document; custody and transport of that document stay
app-blind, served by a hosted relay or a user-owned anchor.

## What Is Already Decided (Do Not Re-Litigate)

This spec stitches existing decisions together; it does not replace them.

- **The capability surface and the two lanes are already canonical** in
  `20260530T100000-ai-workflows-consolidated-design.md`:
  - **Model 1**: the app's typed actions. The AI calls them as tools, or emits a
    bounded program (a predicate-AST selection plus a typed transform) that a fixed
    engine dry-runs on a forked Y.Doc to a concrete effect you approve. No arbitrary
    code. Runs on every device. The action surface is the capability boundary, so
    Model 1 needs no OS sandbox.
  - **Model 2**: arbitrary TypeScript, files, and shell. The desktop coding agent,
    full trust, git-diff review, run on a local Claude/Codex subscription. The line
    between Model 1 and Model 2 is the local binary, filesystem, and shell, not
    SQLite.
  - Refused there and still refused: raw SQL as an input, a per-row call-the-model
    binding, a third model, and a durable-execution engine.
- **ADR-0021**: actions are the only surface that crosses a process boundary;
  `tables`/`kv` are in-process; the SQLite reader is a read-only bulk escape hatch.
- **ADR-0004**: the relay is trusted; privacy is a property of who runs the anchor.

## What This Spec Adds

Three things the documents above do not cover, because they assume hosted inference
and a human present on the same device:

1. **The role split** (ADR-0024): an app-blind **anchor**/**relay** for custody and
   transport, and an app-aware **worker** for semantics, running beside it. Epicenter
   Cloud is a relay plus optional managed workers; a user-owned box is an anchor plus
   per-app workers.
2. **Doc-as-wire driven by an observing worker** (ADR-0025): the agent turn is a
   durable doc record, not an HTTP request. The worker observes, streams into a
   `Y.Text`, honors a durable cancel, writes a write-once `finish`. It answers as
   one agent (`AgentId`); the conversation row's immutable `agent` is what binds a
   turn to it, so there is no claim.
3. **Durable, multi-device approval**: because the worker and the approver may be on
   different devices, an approval is a durable record in the doc that any device
   resolves, not the in-app, single-device prompt of
   `20260318T155243-tool-approval-architecture.md`.

## The Shape

```txt
thin client (phone, browser)
  opens the synced app workspace
  appends a user turn into a conversation child doc
  observes assistant text streaming into the Y.Text
  resolves approval records when asked

sync transport (app-blind, ADR-0024)
  hosted:    Epicenter Cloud relay (Durable Object)
  cloudless: Rust/Iroh sidecar to the user's anchor

worker (app-aware, ADR-0024/0025), beside the anchor
  syncs the same rooms; holds live replicas
  answers as a fixed agent; its loop hosts only conversations bound to that agent
  observes the unanswered turn and answers it (no claim; idempotent id dedupes)
  runs the app's actions as tools; runs inference (hosted or local)
  queries its own SQLite/read models locally
  writes assistant tokens into the transcript Y.Text
  writes a durable approval record when a tool needs it
  writes finish / cancelled / failed durably

app UI
  renders from the doc only
```

No server-to-client SSE exists in this picture. The worker appends each token to the
`Y.Text` and Yjs sync carries it to every replica; the UI is a doc observer. The
only token stream is model-to-worker, and with local inference that is in-process.
The contract to standardize is the one `doc-generation.ts` already has:
`startStream(messages) => AsyncIterable<StreamChunk>`, so a cloud adapter and a
local backend (Ollama / llama.cpp / MLX) look identical to the append loop.
`startStream` is the streaming-dialogue member of a model-access family, not the
whole of it: structured one-shot completion (classify, extract) and embeddings are
sibling capabilities an `onChange` may call directly. The worker runtime is agnostic
to which one a body's behavior uses, so non-chat work reaches the model without
fabricating a `messages` array (ADR-0024).

## V0 / V1 / V2 Are a Build Order Across Model 1 and Model 2

These are not a new taxonomy. They are the order in which the worker + doc-as-wire
layer lights up the already-decided lanes.

```txt
V0  read-only Q&A            Model 1, query tools only. No mutation, no approval,
                             no sandbox. Worker streams prose into the transcript.
                             Proves observe -> claim -> stream -> finish.

V1  bounded mutations        Model 1 + writes. Typed action tool calls and bounded
                             programs (dry-run on a fork, approve the effect). New
                             piece: the approval is a DURABLE, multi-device doc
                             record. Still no sandbox, still no coding-agent harness.

V2  authored workflows       Model 2 exactly: arbitrary TypeScript, full trust,
                             git-diff review, local Claude/Codex (or pi) as the
                             worker. New pieces vs the ai-workflows doc: drive it from
                             any device over doc-as-wire, and wrap any harness behind
                             the worker adapter. Needs OS isolation; deferred + opt-in.
```

V0 and V1 need no new infrastructure beyond the worker (the daemon body plus an
observe loop) and the durable-approval record. V2 is the only tier that introduces a
sandbox, and it is opt-in.

## Worked Example: Local Books

QuickBooks facts live in a local SQLite/provider cache (read-only, re-pullable). The
private overlay (notes, reviewed flags, triage) is a Yjs syncable margin written
only through typed actions.

```txt
TOOLS THE LOCAL BOOKS WORKER EXPOSES

READ (auto-approve; cannot mutate)
  books_sql_query({ sql })     read-only SQL on the LOCAL mirror, bounded results.
                               This is the case ADR-0021 named as the reconsider
                               trigger: a remote peer reading materialized data it
                               cannot open as a file. The phone never gets the SQL
                               pipe; the worker runs it locally and returns bounded
                               rows or prose.
  books_list_charges({...})    typed query action for the common path (cheaper).

WRITE (per-action approval -> durable record)
  mark_reviewed({ ids })       writes the overlay.
  add_note({ qbId, note })     writes the overlay.

DEFERRED (V2; sandboxed + approve-the-script)
  run_workflow({ typescript }) bulk/computational pass too chatty as tool calls.
                               Runs in a sandbox that mounts ONLY the daemon socket
                               and the read-only mirror, so the script cannot exceed
                               the action surface even though it is free code.

NEVER
  bash, writeFile, write-SQL, raw Y.Doc handle.
```

The payoff: you ask your phone "which Acme charges are unreviewed?"; the phone
appends a turn and (optionally) nudges your desktop; the desktop worker runs the model
and the SQL locally and streams the answer back. Financial facts never leave the
machine. Mutations land as durable approval records you confirm from any device, and
the conversation is the audit log of what the agent did.

## Build Order (Working Backwards)

```txt
PROVE (hosted sync, no Iroh, extend Zhongwen)
  1. Move the request identity (generationId) from the POST body into the turn.
  2. Build the observer: a local worker reads the conversations table, opens and
     observes each transcript child doc whose row is bound to its agent, and
     answers an unanswered turn. It is the sole answerer by construction (the loop
     filters by the row's immutable `agent`, ADR-0025), not by claiming. This is
     the core new capability (child-doc observe loop).
     Hosting is schema-driven, symmetric with the browser opener: `mount({ workers })`
     derives the table, guid, and layout from the table's `docDecls` (the same the
     browser `connect()` reads), so the app registers behavior only, a per-body
     factory keyed by table and field. See ADR-0024.
  3. Stream a fake deterministic response into the assistant Y.Text; write finish.
     Proves observe -> claim -> stream -> finish with no HTTP and no duplicate.   [V0]
  4. Durable cancel: client writes cancelRequestedAt; worker (observing mid-gen)
     stops and writes finish: cancelled. Proves the read-back departure.
  5. Real provider/local inference behind startStream(); now the hosted AI route is
     unnecessary for Zhongwen-on-worker.                                            [V0]

THEN (Model 1 writes)
  6. Typed action tools + bounded programs (reuse the ai-workflows engine): dry-run
     on a fork, approve the effect, with the approval as a DURABLE doc record any
     device resolves.                                                              [V1]

LATER (transport + Model 2)
  7. Move the same rooms over the Iroh sidecar (the cloudless spec's job).
  8. V2 research: sandbox choice and the coding-agent harness wrap (separate track,
     below).
```

## V2 Research Track (Parallel, Does Not Block V0/V1)

Open questions to investigate while V0/V1 build:

- **Sandbox**: OpenHands-style swappable workspace (local default, container when
  remote/untrusted) vs E2B / Modal / Daytona managed microVMs vs Docker. The
  capability ceiling stays "actions + read-only mirror" because that is all the
  sandbox mounts; the sandbox exists to neutralize the `import fs` a free script
  could write, not to grant capability.
- **Harness**: pi (`earendil-works/pi`, TypeScript, RPC mode, `tool_call` approval
  hook) as the embeddable default; Codex app, Claude Code, and Hermes (ACP) behind
  the same worker adapter. The adapter maps harness events to the transcript and the
  harness approval hook to the durable approval record.
- **Inference**: local model backends behind the uniform `startStream` contract.

## What We Refuse

```txt
- An "anchor runtime" that fuses custody and semantics (ADR-0024).
- An HTTP kickoff, a generation_requests table, a CRDT claim field (ADR-0025).
- Server-to-client SSE for doc-as-wire (the doc is the wire).
- A new model taxonomy; V0/V1/V2 are a build order over Model 1 / Model 2.
- Chat as the worker's only interface: synthesizing a human-addressed turn (a fake
  user message like "system task: classify these 400 rows") to drive autonomous
  work. The transcript is for real human<->agent dialogue; autonomous work observes
  its own target (rows, cells, a schedule) and writes typed results. Conversations
  are one durable interface to a worker, not its only one (ADR-0024).
- For Model 1: any shell, file, write-SQL, or raw-doc tool (the action surface is
  the sandbox; adding one re-introduces arbitrary execution).
- Everything the ai-workflows consolidated design already refuses (raw SQL input,
  per-row call-the-model, durable-execution engine, a third model).
```

## Open Questions (Ranked by Load-Bearing Risk)

```txt
1. RESOLVED (ADR-0025, 2026-06-17): binding is data, not a race. The conversation
   row carries an immutable `agent: AgentId` (the durable address, set once at
   creation, not a per-install node id). Each worker's observe loop hosts a live
   replica only of the conversations whose `agent` equals the agent it answers as,
   so it answers only those. Whole-conversation grain; the binding lives on the
   row, the transcript stays portable content. No claim and no duplicate streams,
   by construction. (Build deferred until a second worker exists; V0 has one agent.)
2. The child-doc observe loop: enumerate active conversations, open + observe each
   transcript, dispose idle ones. The real new runtime capability.
3. The read-back departure: confirm single-writer-per-field holds end to end.
4. Durable approval record shape: how it reconciles with the ai-workflows effect
   card and the existing (in-app) tool-approval work.
5. V2 sandbox + harness choice (research track; does not block V0/V1).
```
