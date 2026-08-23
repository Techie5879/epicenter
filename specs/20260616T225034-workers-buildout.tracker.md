# Always-On Workers Buildout: Tracker

**Date**: 2026-06-16
**Status**: In Progress
**Owner**: Braden

The living state for building toward the vision in
`20260616T225034-always-on-workers-over-synced-docs.md`. The driver prompt (below)
reads this file every run, does one slice, commits, ticks a box, and stops. This
file is STATE; the specs and ADRs are TRUTH. When they disagree, the ADRs win.

Read for invariants every slice:
- `specs/20260616T225034-always-on-workers-over-synced-docs.md` (the vision)
- `docs/adr/0025-...observing-worker.md`, `docs/adr/0024-...app-blind-anchor.md`, `docs/adr/0021-...process-boundary.md`
- `specs/20260530T100000-ai-workflows-consolidated-design.md` (CANONICAL; Model 1 / Model 2)

## Dependency Rules

```txt
V0 (build)  strictly ordered slices; do the lowest unchecked one.
V1 (build)  starts only after every V0 box is ticked. Stacks on V0.
V2 (research only) independent; advance it whenever the build track is blocked on
            my review. Writes a spec, never product code.

Invariants (never violate, every slice):
  single writer per field (client owns turn + cancel, worker owns finish)
  generationId is the idempotent assistant message id
  dispatch is at most a wake nudge, never the durable queue
  no server-to-client SSE (the worker appends to Y.Text; Yjs sync is the wire)
  tools are published actions only (no bash / file / write-SQL / raw Y.Doc)
  V2 stays research-only until I explicitly say "build V2"
```

## Slices

### V0: the observing worker (hosted sync, no Iroh, extend Zhongwen)

- [x] **V0.1** Move `generationId` from the chatDoc POST body into the pending turn in the transcript doc. `commit: 86f5730ad`
- [x] **V0.2** Child-doc observe loop in the mount runtime: worker reads the conversations table, opens + observes each transcript child doc via the bound `.docs` accessor, disposes idle ones. (Core new capability; `mount-runtime.ts` hosts only the root doc today.) `commit: 73789f93a` then refactored schema-driven (`commit: c13060107`): `mount({ workers })` derives table+guid+layout from the schema like the browser `connect()`; the app registers behavior only via a per-body factory; layout/guid can no longer disagree with the schema; only observable layouts qualify.
- [x] **V0.3** Worker claims an unanswered user turn as the SOLE designated worker and streams a FAKE deterministic response into the assistant `Y.Text`, then writes `finish`. No HTTP, no duplicate stream. Fill the per-body factory's `onChange` seam in `apps/zhongwen/mount.ts` (`workers.conversations.messages`): build per-conversation generation state in the factory body, claim on the idempotent `generationId` (existence check, not a lock), stream via `appendAssistantMessage`. Port the claim/finish logic from `packages/server/src/ai/doc-generation.ts` minus HTTP. `commit: 7acc1043e` Departures from `doc-generation.ts`: no `room.sync` update-forwarding/`drain` (the connected body persists and syncs itself, so the worker writes the live `ydoc` directly) and no `signal`/`waitUntil` (no HTTP request to outlive). The doc is the lock: existence of the assistant map keyed to `generationId` is the claim and short-circuits the worker's own streaming writes; `findActiveChatDocGeneration` serialises a turn that arrives mid-stream until the finish write wakes `onChange`. The only in-memory state is an `AbortController` so teardown stops the loop before the body is destroyed (and is the seam V0.4's durable cancel reuses). CORRECTION (2026-06-17, adversarial review): "no duplicate stream" holds only per-replica within the worker. While `ConversationView` still fires the HTTP kickoff AND a daemon worker observes the same room, BOTH transports claim on their own replica and the CRDT merge keeps two assistant maps: a real cross-transport double-answer. The single-worker guarantee depends on the `agent` designation (R), which is decided but unbuilt; closing it is tracked as D3 and is the gate before a daemon ships real inference (V0.5).
- [x] **V0.4** Durable cancel: client writes `cancelRequestedAt`; worker observes mid-generation and writes `finish: cancelled`. (The read-back departure from `doc-generation.ts`.) `commit: 9400820bf` The field is client-owned on the user turn (single writer per field, the worker still owns the assistant finish). The worker honors two timings: mid-stream (abort + finish cancelled, checked BEFORE the answer path so it is reached even while the existence-claim would short-circuit) and pre-stream (claimed-then-finished-cancelled without streaming). `remintGeneration` clears the stale cancel so a retry is not born cancelled. `ConversationView` Stop now writes the durable cancel beside the transitional HTTP abort. Rode C1 (below). Worker behavior test deferred to C2 per the documented V0.3 precedent (the fake stream is still inline/un-injectable); the data-layer primitives (`findUnansweredTurn`, `requestCancel`, remint-clear) are fully tested in `chat-doc.test.ts`.
- [x] **V0.5** Real inference behind `startStream(messages) => AsyncIterable<StreamChunk>`. Audit that supported model adapters (TanStack AI cloud + a local backend slot) all expose text deltas through this contract, so the append loop is backend-agnostic. `commit: 5a2631569` C2 (`2ca8ddddc`) landed the backend-agnostic seam (worker -> `@epicenter/workspace/ai` as `attachChatWorker`, parameterized by a `ChatStream`); C3 (`4ae29e402`) gave the worker the flush policy. The real-provider swap now lands: Zhongwen's mount resolves a Gemini adapter from `GEMINI_API_KEY` and drives it with the same `chat()` call the hosted route makes (D2 option (b)), under the shared `ZHONGWEN_SYSTEM_PROMPT`, falling back to the placeholder + a warn when no key (the explicit "real inference not wired on this host" boundary). DeepWiki-verified the two facts the swap rests on: `chat()` streams `AsyncIterable<StreamChunk>` and a `createGeminiChat` adapter is stateless/safe to share across concurrent generations (built once, each generation its own `AbortController`). NO new test: this is provider glue on the same untested boundary as `routes/ai.ts` (whose real `chat()` call is likewise untested); the designation/single-answerer/cancel behavior is already proven at the `ChatStream` seam by `worker-over-room-sync.test.ts`. The LIVE two-device real-inference exit additionally needs the daemon to actually run (no `epicenter.config.ts` for Zhongwen yet) and a node picker to designate a conversation to it; both are deferred (see C4).

V0 done when: a phone and a desktop see the same streamed reply over hosted sync, cancel works after a disconnect, 0 duplicate streams, `bun run typecheck` + workspace tests green.

### V1: Model 1 writes + durable multi-device approval (stacks on V0)

- [ ] **V1.1** Wire the app's typed actions as agent tools (action manifest -> tool defs). Read-only `books`/query tools first. `commit:`
- [ ] **V1.2** Reuse the ai-workflows engine for bounded programs: predicate-AST selection + typed transform + dry-run on a forked Y.Doc + approve the effect. Do NOT re-derive the trust model. `commit:`
- [ ] **V1.3** Durable approval record in the conversation doc that ANY device resolves. Reconcile with `20260318T155243-tool-approval-architecture.md` (in-app, single-device); do not duplicate it. `commit:`

V1 done when: a phone requests a mutation, the worker proposes the effect, the phone approves, the mutation lands through a typed action, and the approval record survives a reconnect.

### V2: research only (parallel; does not block V0/V1)

- [x] **V2.R** Write `specs/<new-ts>-v2-coding-worker-sandbox-and-harness.md`. No product code. Use WebSearch + DeepWiki and cite every claim. Answer: (1) sandbox choice (OpenHands swappable-workspace vs E2B/Modal/Daytona vs Docker; must mount ONLY the daemon socket + read-only mirror); (2) harness (verify pi / Codex / Claude Code / Hermes RPC + per-tool approval hook; recommend the embeddable default + adapter shape); (3) local inference behind the `startStream` contract. `commit:` written as `specs/20260617T235900-v2-coding-worker-sandbox-and-harness.md` from the completed workflow research (the synthesis agent 529'd, so the spec was authored from the three research blocks directly, every claim cited). Decisions: (1) OpenHands-style swappable sandbox = local process default + rootless Docker, managed microVMs rejected as the foundation; (2) pi embedded in-process as the default harness, adapter contract named in ACP's shape so Codex/Claude Code/Hermes are each one binding; (3) Ollama first via `@tanstack/ai-ollama`, `openaiCompatible({ baseURL })` the universal fallback. 8 open questions recorded, O1 (does the action surface have a socket transport yet) flagged as the linchpin.

## Collapse Ledger (greenfield collapses; each rides the slice that touches its surface)

Not a separate work queue. Each entry is consumed by the build slice that already
edits that surface, so no big-bang refactor. North star: the worker model deletes
the HTTP generation path, and the doc is the only wire and the only lock.

```txt
C1  Collapse the duplicated answer predicate.  DONE (9400820bf, rode V0.4)
    doc-generation.ts (server) and apps/zhongwen/mount.ts (worker) both inline
    findLatestUserTurn -> generationId guard -> existence check -> active check.
    Extract ONE pure `findUnansweredTurn(messages, now): AnswerableTurn |
    undefined` into chat-doc.ts, beside its sibling readers (the module that owns
    the transcript shape). Both call sites collapse to `const turn =
    findUnansweredTurn(read(), now); if (!turn) return;`. NO reason-union: the
    skip reasons were the server's HTTP error taxonomy (400 vs 409) leaking into
    the worker, which only needs turn-or-nothing. The server keeps that taxonomy
    in its own HTTP wrapper while that wrapper still lives (C4 deletes it).

C2  Inject startStream; the fake becomes a fixture.  DONE (2ca8ddddc, rides V0.5)
    createChatWorker's streamFakeReply is a test fixture compiled into production.
    The vision already names the seam: startStream(messages) =>
    AsyncIterable<StreamChunk>. Parameterise the worker by it; V0.3's fake is the
    injected instance, V0.5's real provider is a one-line swap. Move the worker to
    @epicenter/workspace/ai (attachChatWorker) beside attachChatTranscript. This
    is also what makes the claim -> stream -> finish path testable: inject a 2-
    chunk fake, assert the doc ends [user, assistant(text, finish:completed)],
    assert a re-fire is a no-op. V0.3 shipped with no such test BY CONSTRUCTION
    (the stream was inline + un-injectable); C2 fixes the fake and the test gap
    together (they are the same defect).

C3  Give the worker the flush policy.  DONE (4ae29e402, rode V0.5)
    Taken GREENFIELD instead of the original "extract one shared core both the
    server and worker call". The only thing the worker lacked was the flush policy
    (FLUSH_INTERVAL_MS / FLUSH_MAX_CHARS); a chatty real provider would otherwise
    emit one sync update per token. So the policy went straight into the worker's
    streamReply (buffer + interval/size flush + tail-on-finish), and
    doc-generation.ts was left UNTOUCHED. Rationale: the HTTP path is slated for
    deletion (C4), so building a shared seam across the server<->workspace
    boundary now only to half-dismantle it at C4 is the opposite of a clean break
    (server touched twice vs once). The abort disposition also genuinely differs
    (server-abort writes `cancelled`; worker-abort writes nothing), which is the
    tell that the "sharing" was thin. The constants live in two files during the
    coexistence window; that duplication is resolved by DELETION at C4, not by a
    cross-boundary abstraction. The teardown invariant stays where it is owned
    (the worker's Symbol.dispose), so nothing was centralised that had to be.

C4  Delete the HTTP generation route.                       V1+ (R landed; unblocked)
    The vision says it: once every room has a worker (home daemon or a cloud
    managed worker running this same loop as a sync peer), runDocGeneration + the
    room.sync forwarding + the drain retry are dead code. Biggest deletion on the
    board. WAS gated on R; R landed (the designation gate now keeps the daemon and
    the HTTP path on disjoint conversations), and V0.5 landed real daemon inference.
    Still deferred, now on ONE unbuilt piece, NOT on inference code:
      (1) the daemon does not actually run for Zhongwen (no epicenter.config.ts
          wiring zhongwen({ agentId }) into `epicenter up`), so no room has a live
          worker, so a conversation bound to the home-daemon agent waits unanswered.
    Gate (2) is RESOLVED: the agent picker landed (scoped-redesign slice 2), so a
    conversation can be bound at creation to the `zhongwen-home` daemon agent
    instead of the cloud agent (`mount.ts` already forwards `agentId` into the
    observe-loop filter). What remains is purely runtime: a daemon process that
    answers as `zhongwen-home`. Until (1) lands, every answered conversation is
    still cloud-bound and deleting runDocGeneration would strand any
    daemon-bound one. The "co-deploy a live daemon" slice is what closes (1).
    Trigger to delete C4: a daemon runs real inference for a daemon-bound
    conversation end to end AND cloud-bound conversations keep the always-available
    cloud agent (whose runtime IS this route, so C4 deletes the null-as-cloud
    handling and the transitional kickoff, not the cloud answerer).

R   Reframe: "claim" -> "reconcile a targeted turn."  DONE (agent designation)
    (DECIDED in ADR-0025, resolves OQ#1; BUILT 2026-06-17)
    "Claim" imported a contention model the single-worker design does not have. The
    worker is a RECONCILER (observe -> compute the missing answer -> produce it),
    like the materializers. Designation is DATA, not a race or a global config: the
    conversation ROW carries a target `agent` (written by the client that
    creates/re-points it = single writer), the durable analogue of dispatch's `to`.
    The worker's observe loop filters rows to its own node. Dispatch is the doorbell
    (ephemeral nudge), the doc is the mailbox (durable, answered on reconnect even if
    the nudge is lost).
    GRAIN = whole conversation, never per-message (an answer needs the thread's
    accumulated context/capability).
    PRIMITIVE = the binding lives on the ROW, not in the transcript. The transcript
    child doc stays pure portable content (no node identity); the row carries the
    routing. That existing row/child-doc split IS the portability seam, so the three
    operations fall out: DIRECT (write agent), REASSIGN between turns (another
    write, rewrites no history), FORK (snapshot the transcript into a new row bound
    to a different node). NOT a separate routing table (doc is the only control
    plane; no parallel source of truth).
    DEPENDS ON a node roster/picker (presence/awareness) so a client can name the
    target. FUTURE refinement: target a capability (the node with the SQLite mirror)
    over a concrete node id, resolved through that roster.
    BUILD timing: model decided now; the agent field + loop filter + picker
    are load-bearing only once a second worker exists, so execution defers (V0 has one
    node; the race is theoretical). C4 (delete the HTTP route) unblocks once this lands.
```

## Decisions Needed (agent appends here instead of guessing)

```txt
D1 (V0.2, non-blocking, confirm when convenient)
   "dispose idle ones" landed as dispose-on-row-removal + shutdown, NOT a
   timeout evictor. Reason: an idle conversation can still receive a new user
   turn later; evicting its replica on a timer means the worker stops syncing
   that room and would miss the turn. Re-opening an evicted room without that
   gap needs a signal (the dispatch wake-nudge the spec names), which is not
   built yet. So a timed evictor is correct only once the wake-nudge exists.
   Steady-state memory is currently bounded by conversation count. If that is
   too loose before the wake-nudge lands, say so and I will add an LRU cap
   (evict the least-recently-changed body past a max-open count; a capped set
   cannot miss turns the way a per-room timer can).

D2 (V0.5) RESOLVED 2026-06-17: (b) the daemon holds a provider key and calls
   TanStack `chat()` directly (the same call the server route makes). (a) cloud
   route rejected (circular for hosted Zhongwen + fights C4); (c) local backend
   is the privacy end state, wired AFTER the V0 proof. So the V0.5 swap is:
   replace Zhongwen's `fakeChatStream` with a `chat({ adapter, messages })`
   ChatStream built from a daemon-side provider key, then the V0 exit holds.
   Original options below for the record.

   How does the always-on worker obtain real inference behind the now-existing
   `ChatStream` seam? The app's mount factory closes over its own `startStream`,
   so this is purely "what instance does Zhongwen's daemon inject in production".
   Three candidates, none pinned by the specs/ADRs:
     (a) the daemon calls the hosted /api/ai/chat SSE route via an authenticated
         daemon fetch, parsing SSE back into StreamChunks. Reuses the route,
         billing, and BYOK/house keys, BUT it is circular for hosted Zhongwen
         (the daemon would call the cloud to write a doc it then syncs to the
         cloud) and it keeps alive the very route C4 wants to delete.
     (b) the daemon holds a provider key and calls TanStack `chat()` directly
         (same call the server route makes). Simplest text path; needs a key in
         the daemon's environment and a billing answer for hosted.
     (c) a local backend (Ollama / llama.cpp / MLX) behind the same `ChatStream`.
         The end state the vision wants ("financial facts never leave the
         machine"), but needs a local runtime present.
   The seam makes all three a one-argument swap; the question is which Zhongwen
   ships first for the V0 exit ("a phone and a desktop see the same streamed
   reply over hosted sync"). Recommendation to confirm: (b) for the V0 proof
   (direct `chat()` with a daemon key), then (c) as the privacy end state; treat
   (a) as a non-goal since it fights C4. Does that hold?

D3 (V0.5 GATE) RESOLVED 2026-06-17 by R (option (i)): the daemon now answers only
   conversations designated to its node (`agent === selfNodeId`) and the
   browser skips the HTTP kickoff whenever `agent` is set, so exactly one of
   {HTTP server worker, daemon worker} reconciles any conversation. The
   worker-over-room test that asserted the two-map bug now asserts ONE map. Original
   options kept below for the record.

   The dual-transport double-answer must be closed BEFORE a daemon ships real
   inference, or one turn gets two real replies. Today `ConversationView` fires
   the HTTP kickoff (-> server `runDocGeneration`) AND the daemon worker answers
   the same room; the existence-based claim cannot serialise across two replicas,
   so the merge keeps two assistant maps. The worker-local hardening (commit
   0f188d4f4) fixes only the SINGLE-worker duplicate paths (in-flight guard +
   orphan supersession); it does NOT touch the cross-transport race. Options to
   sequence: (i) land R's `agent` designation so exactly one of {HTTP
   server worker, daemon worker} reconciles a conversation; (ii) bring C4 forward
   and stop firing the HTTP kickoff for daemon-targeted conversations; (iii)
   keep the daemon and the HTTP path on DISJOINT conversation sets during the
   transition (today they are de facto disjoint: no production daemon runs yet,
   so only the HTTP path answers). Recommendation: rely on (iii) for the local
   V0.5 proof (run the daemon only against rooms the browser does NOT kickoff),
   and treat (i)/(ii) as the real fix that must precede any co-deployed daemon.
   Which sequencing do you want?
```

## Log (agent appends one line per run)

```txt
2026-06-16  tracker created; V0/V1/V2 slices defined.
2026-06-16  V0.1 (86f5730ad): generationId now rides the user turn in the doc;
            worker derives it (findLatestUserTurn), POST body drops it; retry
            re-mints via handle.remintGeneration. 525 workspace + 19 server
            tests green, server typecheck clean.
2026-06-16  V0.2 (73789f93a): the daemon child-doc observe loop. New
            attachChildDocWorker (transport-agnostic loop: enumerate rows, open +
            observe each transcript via the field guid deriver, dispose on
            row-removal, flush on root destroy) + attachMountChildDocWorker (the
            node-only per-body connector: clientID + disk log + cloud join,
            drain-enrolled), wired into the Zhongwen mount. onChange is the V0.3
            claim->stream->finish seam. DECISION recorded below: timeout-based
            idle eviction deferred (needs the dispatch wake-nudge to re-open
            without missing a turn). 530 workspace tests green, workspace +
            zhongwen typecheck clean.
2026-06-17  V0.2 reshaped schema-driven (c13060107) after a design grill: the
            first cut hand-wired the loop in Zhongwen's compose, re-passing
            table+guid+layout+rootDoc (all schema-owned) and letting layout and
            guid disagree silently. Now mount({ workers }) derives them from the
            schema like the browser connect(); app registers behavior only (a
            per-body factory, the V0.3 onChange seam); node connector injected
            via nodeMountRuntime().connectChildDoc; loop moved to
            document/child-doc-worker.ts. ADR-0024/0025 updated. 531 tests green.
2026-06-17  V0.3 (7acc1043e): filled the conversations.messages worker seam with
            the claim -> stream -> finish loop. onChange reads the transcript,
            claims the unanswered user turn on its idempotent generationId by
            existence (the appended assistant map IS the claim, not a lock),
            streams a deterministic placeholder reply one token-append per word,
            writes a write-once completed finish. Dropped doc-generation.ts's
            room.sync forwarding + drain (connected body self-syncs) and its
            signal/waitUntil (no HTTP). findActiveChatDocGeneration serialises
            concurrent turns; the only in-memory state is the in-flight abort
            (teardown stop + V0.4's cancel seam). zhongwen + workspace typecheck
            clean, 531 workspace tests green.
2026-06-17  V0.4 (9400820bf) + C1: durable cancel. Client owns
            cancelRequestedAt on its user turn; worker reads it back and writes
            finish: cancelled (mid-stream abort, checked before the answer path;
            and pre-stream claimed-then-cancelled). remintGeneration clears the
            stale cancel on retry. ConversationView Stop writes the durable
            cancel beside the HTTP abort. C1 rode along: extracted
            findUnansweredTurn(messages, now) to chat-doc.ts (turn-or-nothing,
            no reason-union); the worker collapsed its inline predicate to one
            call; the server keeps its 400/409 taxonomy until C4. Worker behavior
            test deferred to C2 (fake stream still inline); data-layer
            primitives fully tested. workspace + zhongwen + server typecheck
            clean, 539 workspace tests green.
2026-06-17  V0.5 IN PROGRESS / C2 (2ca8ddddc): backend-agnostic chat worker.
            Moved the per-conversation worker out of Zhongwen's mount into
            @epicenter/workspace/ai as attachChatWorker, parameterized by a
            ChatStream (startStream(messages) => AsyncIterable<StreamChunk>).
            V0.3 shipped the stream inline + un-injectable so the claim ->
            stream -> finish path and the V0.4 cancel had no test BY
            CONSTRUCTION; with startStream parameterized the fake is a fixture
            (mount injects fakeChatStream) and chat-worker.test.ts now covers
            completed, re-fire no-op, RUN_ERROR -> failed, mid-stream cancel,
            pre-stream cancel, and teardown-no-finish (6 tests). Extracted
            chatDocToPrompt into chat-doc.ts. Did NOT touch the server (C3 does
            that). Appended D2: how the daemon obtains real inference (blocks
            the real-provider swap; recommendation = direct chat() with a daemon
            key for the V0 proof, local backend as the end state, NOT the cloud
            route since it fights C4). workspace + zhongwen + server typecheck
            clean, 545 workspace tests green. V0.5 stays UNTICKED: C3 + the real
            swap remain. Per the Dependency Rules the build track is now blocked
            on D2, so V2.R (research-only) is the track to advance next.
2026-06-17  D2 RESOLVED (e3596518b): daemon uses direct chat() with a provider
            key for the V0 proof; local backend is the end state; cloud route
            rejected (fights C4).
2026-06-17  Orchestrated a background workflow (verify shipped code + V2.R
            research + synthesis). Verify + research succeeded; the synthesis
            agent died on a transient 529 (plan/V2.R-spec draft not produced).
            Verify found real bugs in the C2/V0.4 worker: (high) the worker
            ignored its own in-flight state so a generation outliving the 2-min
            active window could be double-streamed by a retry/second turn;
            (high) a retry re-minted the generationId and orphaned the prior
            stream; (high) ChatStream had no abort signal so cancel/teardown
            never stopped the provider; plus a misleading re-entrancy comment.
            Also (BLOCKER, transitional) the dual-transport double-answer ->
            recorded as D3 and corrected the V0.3 "no duplicate stream" claim.
2026-06-17  Hardening wave (0f188d4f4): worker never runs two streams at once
            (in-flight guard, so the createdAt window cannot trick a live
            worker); a re-pointed/removed turn finishes its orphan cancelled then
            the new turn is claimed; ChatStream is now (messages, signal) and the
            worker aborts the provider on cancel/teardown; reworded the claim
            comment. 4 new tests (no concurrent stream, retry supersedes,
            provider signal aborts, late cancel inert). workspace + zhongwen
            typecheck clean, 549 workspace tests green. STILL OPEN: V2.R spec
            (write from the completed research, synthesis 529'd), C3, D3
            sequencing, then the V0.5 real-provider swap.
2026-06-17  C3 (4ae29e402): gave the worker the flush policy directly. Buffer
            deltas in streamReply, flush at most once per FLUSH_INTERVAL_MS (or
            sooner past FLUSH_MAX_CHARS), ride the tail on the finish write;
            lastFlushAt starts at 0 so the first delta is live at once. Done
            GREENFIELD per the user's call: doc-generation.ts left UNTOUCHED
            rather than sharing one core with it (the HTTP path dies at C4;
            coupling the worker to a route slated for deletion is not a clean
            break, and the abort disposition differs server vs worker). Constants
            duplicated for the coexistence window, resolved by deletion at C4.
            Also fixed the stale one-argument ChatStream comments (it is
            (messages, signal)) in chat-worker.ts + mount.ts. New flush test (8
            rapid deltas -> < 8 transactions, text intact). workspace 550 +
            zhongwen + server typecheck clean; server doc-generation 11 tests
            still pass (untouched). V0.5 stays UNTICKED: the real-provider swap
            (D2-resolved: direct chat() with a daemon key) and D3 sequencing
            remain.
2026-06-17  Post-C3 review collapse (af2f00930): re-reading C3, the chat worker
            took both a `handle` view and the `ydoc` it wraps, reading through
            the handle but writing through the raw doc. It is a doc-level writer
            like the server, not a layout consumer, so it now takes only `ydoc`
            and reads with readChatDocMessages(ydoc); dropped the redundant param
            and the ChatTranscriptReader one-method type. Also merged the
            byte-identical mid-stream-cancel and superseded-orphan guards into one
            (turn === undefined || cancelRequestedAt !== undefined). workspace +
            zhongwen typecheck clean, worker suite green.
2026-06-17  Model validated over a REAL room (6ae96a124):
            packages/server/src/ai/worker-over-room-sync.test.ts. Every prior
            worker test drove onChange by hand over a lone in-memory Y.Doc; this
            is the first proof the always-on worker works as a SYNC PEER. A daemon
            peer runs attachChatWorker over a body synced through a live
            createRoomCore; a separate client peer reads the answer back. 3 green:
            (1) the daemon answers a turn written by another peer and the streamed
            reply syncs back (the V0 exit, worker path); (2) a durable cancel from
            another peer stops the answer mid-stream over sync; (3) THE D3 HAZARD
            IS REAL AND DETERMINISTIC: daemon worker + HTTP runDocGeneration both
            answer one turn -> the merge keeps TWO assistant maps. Test 3 asserts
            the bug EXISTS today; R must flip it to assert ONE map (red-by-design
            gate, exactly what the verify workflow asked for). FINDING that pins
            the next step: zhongwen has NO epicenter.config.ts and no daemon entry
            (epicenter up loads a mount from epicenter.config.ts; zhongwen() returns
            one; nothing wires them), so the daemon has never actually run for
            zhongwen, and running it today would reproduce test 3's double-answer.
            So the real two-browser e2e is gated on (a) daemon config wiring +
            (b) R. Evidence-backed next step is therefore R (agent), now
            justified by a concrete failing-intent test, not a theoretical race.
2026-06-17  V2.R DONE: wrote specs/20260617T235900-v2-coding-worker-sandbox-and-
            harness.md from the completed workflow research (synthesis 529'd, so
            authored from the three research blocks, every claim cited). Sandbox =
            OpenHands swappable (local default + rootless Docker; managed microVMs
            rejected as the foundation). Harness = pi in-process default, adapter
            contract in ACP's shape. Inference = Ollama via @tanstack/ai-ollama
            first, openaiCompatible({ baseURL }) the universal fallback. 8 open
            questions; O1 (action-surface socket transport) is the linchpin. No
            product code. doc-hygiene clean.
2026-06-17  R DONE (agent designation): closed D3, the dual-transport
            double-answer. Added `agent: nullable(field.string<NodeId>())` to
            the conversations row (null = cloud-default, the HTTP path answers). The
            generic child-doc worker context now carries the daemon's `selfNodeId`
            and a reactive `readRow()` onto the parent row (designation lives on the
            row, never in the transcript child doc); the chat worker gained an
            `isDesignated` gate (default always-on for unit callers) and the Zhongwen
            mount builds it as `() => readRow()?.agent === selfNodeId`.
            ConversationView skips its HTTP kickoff when `agent` is set, so a
            designated conversation is answered only by its daemon and a cloud-
            default one only by the HTTP path. Flipped the worker-over-room D3 test:
            an undesignated daemon abstains and the HTTP path is the sole answerer
            (one assistant map, asserted to be the HTTP reply); added unit coverage
            (undesignated worker never claims; a designation that flips on is honored
            next observe) and a child-doc-worker context test (selfNodeId + reactive
            readRow). workspace + zhongwen + server typecheck clean; workspace 553 +
            server ai 14 green. C4 now unblocked (still deferred to V0.5 inference).
2026-06-17  R greenfield correction: moved designation from a worker-level gate to
            the LOOP filter the R decision actually names ("the worker's observe loop
            filters rows to its own node"). The first cut had the child-doc loop host
            EVERY row and the chat worker abstain via an isDesignated thunk, which made
            the app-aware worker do the app-blind anchor's availability job in one code
            path (ADR-0024 forbids exactly this) and duplicated the agent ===
            selfNodeId contract into every app's factory. Now: the loop takes one
            isDesignated(rowId) predicate and reconciles only its node's rows (re-
            designation opens/closes a body reactively, since the loop already
            observes the table); connectMountWorkers composes the contract once (the
            single owner); attachChatWorker is pure {ydoc, startStream} again with no
            designation concept; the worker context dropped selfNodeId/readRow/TRow.
            The D3 proof moved with the mechanism: the over-room suite is back to its
            two sync proofs (answer, cancel), and the daemon half of D3 is proven at
            the loop unit (hosts only designated rows; opens/closes on re-designation)
            plus the mount coordinator (cloud-default row not hosted). Browser kickoff-
            skip unchanged. workspace 552 + server ai 13 + zhongwen typecheck green
            (5 server requireBearerPrincipal failures are pre-existing, not mine).
2026-06-17  V0.5 DONE (5a2631569): real Gemini inference behind the ChatStream.
            Zhongwen's mount resolves a Gemini adapter from GEMINI_API_KEY and
            drives it with the same chat() call routes/ai.ts makes (D2 option b),
            under ZHONGWEN_SYSTEM_PROMPT; no key -> placeholder + warn (the explicit
            boundary). Per-generation signal forwarded onto chat()'s AbortController;
            adapter built once and shared (DeepWiki-verified stateless + concurrent-
            safe). Moved ZHONGWEN_SYSTEM_PROMPT out of the route folder into
            zhongwen.ts so the node daemon can read it without browser code; added
            @tanstack/ai + @tanstack/ai-gemini deps. NO new test by design: provider
            glue on the same untested boundary as routes/ai.ts (its real chat() call
            is untested too); the seam behavior is already proven by
            worker-over-room-sync.test.ts. Considered and rejected: a chat-injection
            seam (indirection the system doesn't need) and an e2e through real
            chat() (no public mock adapter ships, so it would mean hand-rolling a
            TextAdapter or a flaky network call). zhongwen typecheck + server ai 13
            green, doc-hygiene clean. DEFERRED to a "co-deploy a live daemon" slice
            (and re-gating C4): epicenter.config.ts so the daemon runs, and a node
            picker so a conversation can be designated to it.
2026-06-17  Scoped-redesign slice 1 (agent binding): after an adversarial greenfield
            grill, collapsed designation from a per-conversation target node into one
            immutable `agent: AgentId` on the conversation row. AgentId = the stable,
            config-authored address of an answering agent (cloud = `epicenter-cloud`,
            a daemon = its configured id), resolved to a live node through presence;
            NOT the per-install nodeId or the Yjs clientID. Reversed the review's
            per-turn `addressedTo`/`answeredBy` proposal: the collapse makes the
            binding whole-conversation and immutable (switch = fork), which buys a
            privacy invariant (content only ever reaches the one bound agent) and
            free truthful attribution (the bound agent is who was addressed and who
            answered, so no per-message author field and the transcript stays portable
            with no agent identity). This AFFIRMS ADR-0025's whole-conversation binding
            and its "transcript holds no node identity" seam; what changed is the
            address type (node id -> AgentId) and killing `agent: null`. Changes:
            new AgentId brand + asAgentId (workspace, exported); MountOptions.agentId
            injects the daemon's agent identity (app/config policy, not threaded through
            MountContext); connectMountWorkers filters `row.agent === selfAgentId`
            (undefined selfAgentId designates nothing); zhongwen schema agent ->
            agent (non-null, CLOUD_AGENT_ID default at creation); +page binds new convos
            to CLOUD_AGENT_ID; ConversationView kickoffUnlessDaemonOwned -> nudgeBoundAgent
            (nudge route iff agent === CLOUD_AGENT_ID). chat-doc/chat-worker/doc-generation
            schemas UNCHANGED (attribution is the row's agent), the tell the collapse was
            real. ADR-0025 Decision + alternatives updated (per-message rejection now
            grounded in the privacy/DM-model rationale). workspace 552 + server ai 13 green;
            workspace + zhongwen + server typecheck clean. Zhongwen mount sets no agentId
            yet (no configured agent), so the daemon hosts nothing and cloud answers every
            conversation; the agent-id config + picker is the next slice.
2026-06-17  Scoped-redesign slice 2 (agent config + picker): made a non-cloud agent
            bindable. Added a config-owned agent catalog `ZHONGWEN_AGENTS` (AgentConfig
            = id/label/model/tools/runtime) with two entries: the always-available
            `epicenter-cloud` (runtime 'cloud') and a `zhongwen-home` daemon agent
            (runtime 'daemon'). DECISION (asked): the picker lists CONFIGURED agents,
            not presence-live ones; binding to a configured-but-offline daemon is
            allowed because the conversation doc is a durable mailbox (the turn waits
            until the daemon wakes), so presence is only ever a live/offline hint, never
            a gate. `runtime` is the routing fork: ConversationView.nudgeBoundAgent now
            nudges the HTTP route iff `agentConfig(agent)?.runtime === 'cloud'` (replaces
            the hardcoded `=== CLOUD_AGENT_ID`), so the cloud/daemon split is catalog-
            driven, not name-checked. Picker UI = a DropdownMenu caret beside "New
            Conversation" (primary click stays one-click cloud via DEFAULT_AGENT_ID, the
            caret lists every catalog agent); onCreate now takes the chosen AgentId and
            `createConversationRow` binds it (still the ONE place `agent` is written).
            mount.ts forwards `agentId` into `workspace.mount({ agentId })`, so the
            daemon co-deploy slice is a config call, not new wiring. NO write guard
            (DECISION: document-only): `agent` is written once via `set` at creation and
            `update` (partial merge) never touches it, so immutability holds structurally
            with no machinery for a reassign path that does not exist. NEW test
            apps/zhongwen/src/agents.test.ts pins the catalog routing invariants (cloud
            entry stays cloud-runtime, default resolves to cloud, home is daemon, unknown
            id -> undefined-never-nudged, ids unique): 5 green. workspace + zhongwen +
            server typecheck clean; 17 focused tests green; doc-hygiene clean. C4 gate (2)
            (no picker) RESOLVED; C4 now waits only on gate (1), the daemon actually
            running (epicenter.config.ts), which is the co-deploy slice.
```
