# V2 Coding Worker: Sandbox and Harness

**Date**: 2026-06-17
**Status**: Draft
**Owner**: Braden
**Builds on**: `20260616T225034-always-on-workers-over-synced-docs.md` (the vision), `20260530T100000-ai-workflows-consolidated-design.md` (Model 1 / Model 2), `docs/adr/0021-actions-are-the-only-surface-that-crosses-a-process-boundary.md`, `docs/adr/0024-an-always-on-worker-runs-app-semantics-beside-the-app-blind-anchor.md`, `docs/adr/0025-agent-conversations-are-durable-child-docs-answered-by-workers.md`

This is the **V2.R** deliverable from `20260616T225034-workers-buildout.tracker.md`:
research only, no product code. It answers three questions the vision spec named
but deferred: what hosts the Model 2 coding worker, which agent harness it embeds,
and how local inference reaches the `startStream` seam. Every claim cites its
source. Nothing here is built until Braden says "build V2"; V2 is independent of
the V0/V1 build track and does not block it.

## One Sentence

The Model 2 coding worker is a backend-agnostic harness (pi, embedded in-process)
running inside a swappable sandbox (local subprocess on a trusted home box,
rootless Docker when remote or untrusted) that can reach **only** the daemon
action socket plus a read-only data mirror, with local inference injected through
the same `startStream(messages, signal) => AsyncIterable<StreamChunk>` contract the
chat worker already speaks.

## Scope and Non-Goals

- **In scope**: the architecture for Model 2 (arbitrary TypeScript, files, shell:
  the desktop coding agent, full trust, git-diff review, local subscription),
  per `20260530T100000-ai-workflows-consolidated-design.md`.
- **Not Model 1**: Model 1 (the app's typed actions, the bounded predicate-AST +
  transform engine) needs **no** OS sandbox; the action surface is already the
  capability boundary (ADR-0021). This spec does not touch it.
- **Not a decision to build**: this records the chosen shape so that when V2 starts
  it starts from a settled design, not a blank page.

## Decision 1: Sandbox is an OpenHands-style swappable workspace

**Choice**: define one stable interface (an action-execution endpoint reached over
a single mounted socket) with interchangeable backends. Default to a **local
process** for the trusted home box; escalate to **rootless Docker** automatically
when the run is remote, the box is shared, or the script is unreviewed. Reject
betting the foundation on any single managed-microVM vendor (E2B, Modal, Daytona).

**Why this and not a managed sandbox**: the spec's own constraint settles it. The
sandbox is a **capability ceiling**, not an adversarial-multi-tenant fortress.
Capability is defined by what gets mounted (the daemon action socket + a read-only
data mirror) and what gets denied (network). A free script's `import fs` resolves
to an empty namespace and `fetch` resolves to nothing regardless of the isolation
tech underneath, so the strongest argument for microVMs (cross-tenant kernel
isolation) is the weakest argument here: a user-trusted home box has no second
tenant. OpenHands already ships exactly this swap: one Action Execution Server REST
contract with `ProcessSandboxService` (local), `DockerSandboxService`, and
`RemoteSandboxService` (E2B/Modal/Daytona) behind a `SandboxService` base class,
selected by config. [1][2]

**The two backends**:

- **Local process (default, trusted home box)**: spawn the harness under the
  worker's uid, hand it the socket path and the read-only mirror by convention.
  Zero Docker/KVM/cloud dependency: the cloudless-anchor common case. This mirrors
  OpenHands' real default-when-Docker-absent and inherits its explicit warning:
  the local backend runs agent code with **full host filesystem access and no OS
  isolation**, so "only the socket is mounted" is a convention enforced by our
  runner, acceptable **only** because the box is single-user-trusted. [3]
- **Rootless Docker (remote / untrusted / shared)**: the constraint maps 1:1 to
  Docker primitives: read-only bind mount of the daemon action socket, `:ro` bind
  mount of the data mirror, `--network none`, `--cap-drop ALL`, seccomp. The
  script literally cannot see a filesystem or network it was not handed. [4][5]
  Caveat: plain Docker (runc) shares the host kernel; a runc/kernel CVE (e.g.
  CVE-2019-5736) can escape. [4] For a genuinely adversarial multi-tenant **hosted**
  tier (not a home box), slot gVisor/Kata/Firecracker under the same container
  backend, or add a `RemoteSandbox` variant, **without changing the worker**. That
  escalation is precisely what the swappable shape buys. **Never** bind the real
  `/var/run/docker.sock`; only the daemon's own narrow RPC action socket. [5]

**Adapter shape**: one interface, three operations.
`provision({ actionSocket, dataMirrorRoot }, { network: 'none', readOnly: true })
-> handle`; the workload speaks **only** to the action socket (an RPC mirror of the
same action surface Model 1 uses, per ADR-0021: actions are the only cross-process
surface), never a raw fs/net/Y.Doc handle; `dispose()`. Backends:
`LocalProcessSandbox`, `DockerSandbox`, and a deferred `RemoteSandbox`. Selection is
policy-driven, exactly like OpenHands' `RUNTIME` switch, so the coding-worker code
stays backend-agnostic.

**Sources**:
- [1] OpenHands abstracts runtimes behind one Action Execution Server REST
  contract; Process/Docker/Remote sandbox services behind a `SandboxService` base,
  selected by config: <https://deepwiki.com/All-Hands-AI/OpenHands>
- [2] The Action Execution Server is a REST API inside the sandbox; all runtimes
  swap behind it without agent-level code changes:
  <https://docs.openhands.dev/openhands/usage/architecture/runtime>
- [3] The local/process runtime runs agent code on the host with full filesystem
  access and no OS isolation; Docker is the recommended/default isolation:
  <https://github.com/All-Hands-AI/OpenHands/issues/7217>
- [4] Plain Docker is not a hard kernel boundary; runc escapes (CVE-2019-5736)
  exist; gVisor/Kata/Firecracker are stronger:
  <https://northflank.com/blog/firecracker-vs-gvisor>
- [5] Docker enforces the ceiling with `--network none`, `cap_drop ALL`, seccomp;
  never mount a writable docker socket:
  <https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html>

## Decision 2: Harness is pi in-process, with an ACP-shaped adapter contract

**Choice**: embed **pi** (`earendil-works/pi`) as the default harness via its
in-process TypeScript SDK (`@earendil-works/pi-coding-agent` AgentSession over
`pi-agent-core`). Define the worker adapter contract in **ACP's** shape so any
harness (Codex, Claude Code, Hermes/ACP) can be swapped in later as one binding.

**Why pi as the default**: the worker is already an in-process TypeScript daemon
body (`attachChatWorker` in `@epicenter/workspace/ai`, parameterized by a
`ChatStream`). pi is the only candidate that is (a) pure TypeScript, (b)
MIT-licensed (so it can be a real dependency of the workspace library, unlike
Claude Code's proprietary SDK), (c) embeddable in-process (unlike Codex's Rust
binary and ACP/Hermes, which are subprocess-only), and (d) multi-provider
including local backends (satisfying the "financial facts never leave the machine"
end state that Codex's and Claude Code's vendor lock cannot). [6][9][10]

**How the adapter maps the two seams**:

1. **Events to transcript**: subscribe to pi's typed event stream
   (`message_start`/`update`/`end` for assistant text; `tool_execution_start`/
   `update`/`end` for tool-call rows; `turn`/`agent` markers for boundaries) and
   append into the same conversation child-doc transcript the V0 loop writes
   (assistant `Y.Text` + structured tool-call rows). This reuses ADR-0025's
   append-to-`Y.Text`-is-the-wire model verbatim; no SSE. [7]
2. **Per-tool approval to a durable record**: use pi's in-process
   `beforeToolCall(context, signal) => Promise<{ block, reason } | undefined>`.
   Inside that callback the adapter writes a durable approval-request record into
   the conversation doc (the V1.3 durable-approval shape, reconciled with the
   ai-workflows effect card), awaits its resolution via the same Yjs observer the
   worker already uses, then returns `undefined` (allow) or `{ block, reason }`
   (deny). Because the await happens inside an in-process callback, no wire
   round-trip is needed: this is pi's decisive advantage over the subprocess
   harnesses for the first cut. [8]

**The one sharp caveat to carry forward**: pi's approval gate is in-process only.
There is **no** server-initiated, wire-level permission request in pi's RPC mode;
gating over RPC must live in a pi extension loaded inside the pi process
(`pi.on('tool_call')` + `extension_ui_request`/`extension_ui_response`), not a
host-side interception. [8] This matters the moment Decision 1's sandbox runs pi
**out-of-process**: the durable-approval bridge then ships as a pi extension inside
the sandbox. In-process embedding is clean today; the sandboxed topology costs one
extension.

**Adapter contract (modeled on ACP so harness choice stays swappable)**: one
interface with (1) `prompt(turn)` / `cancel()` driving a session; (2)
`onEvent(harnessEvent)` to the transcript-write mapping; (3) `requestApproval(toolCall)
=> Promise<Decision>` where `Decision = { allow, updatedInput? } | { deny, reason }`.
pi binds `requestApproval` to `beforeToolCall`; a Codex adapter binds it to
`item/commandExecution/requestApproval` (accept/decline); a Claude Code adapter to
`canUseTool` (allow/deny with modified input); an ACP adapter to
`Client.requestPermission` (allow_once/allow_always/reject). Naming the contract in
ACP's vocabulary (`request_permission` with `persist: session | always`,
`session/update` for streaming, `session/cancel` for cancel, which matches the V0.4
durable cancel already built) makes "wrap any harness" become "implement the ACP
Client side once." Map `persist: 'always'` to an allow-always rule stored in the
doc and `persist: 'session'` to a per-conversation allowance, so durable
multi-device approval and the standing-policy case both fall out of one record
shape. [11][12][13][14][15]

**Sources**:
- [6] pi: RPC mode (JSONL over stdio) + in-process TypeScript SDK (AgentSession),
  CLI and library: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- [7] pi RPC events (`agent_*`, `turn_*`, `message_*`, `tool_execution_*`); no
  server-initiated tool-approval over the wire:
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- [8] pi tool-approval is the in-process `pi.on('tool_call')`/`beforeToolCall` hook;
  no host-driven permission request over the RPC wire:
  <https://deepwiki.com/search/in-rpc-mode-specifically-pi-mo_77b575a8-5af7-40e6-8cd2-40aaa2436f05>
- [9] pi `beforeToolCall(context, signal)` can `{ block, reason }`; MIT-licensed;
  Anthropic/OpenAI/Google + local providers via `@earendil-works/pi-ai`:
  <https://deepwiki.com/search/show-the-exact-agentsession-ag_1e4e54ba-00dd-4ab7-9bf6-ba067db48f6d>
- [10] pi `beforeToolCall` receives `{ toolCall, args, context }`, runs after
  argument parsing, `event.input` is mutable; pkg `@earendil-works/pi-coding-agent`:
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- [11] Codex app-server: Rust binary, JSON-RPC over JSONL stdio, server-initiated
  `item/commandExecution/requestApproval` (accept/decline/cancel); no official TS SDK:
  <https://developers.openai.com/codex/app-server>
- [12] Codex `item/permissions/requestApproval` with `persist: session | always`:
  <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- [13] Claude Agent SDK `canUseTool` (deny-with-message + allow-with-modified-input),
  `--permission-prompt-tool` MCP delegation, stream-json events:
  <https://code.claude.com/docs/en/sdk/sdk-permissions>
- [14] `@anthropic-ai/claude-agent-sdk` spawns the native Claude Code binary as a
  subprocess since v0.2.113; proprietary license:
  <https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk>
- [15] ACP: JSON-RPC over stdio, server-initiated `session/request_permission`
  (allow_once/allow_always/reject), `sessionUpdate` streaming, TS SDK
  `AgentSideConnection`:
  <https://agentclientprotocol.github.io/typescript-sdk/classes/AgentSideConnection.html>

## Decision 3: Local inference is Ollama first, openaiCompatible the universal fallback

**Choice**: wire **Ollama** first, via the first-party `@tanstack/ai-ollama`
(`ollamaText`) adapter, injected as one `ChatStream` instance into the C2 seam.
Document `openaiCompatible({ baseURL })` (from `@tanstack/ai-openai/compatible`) as
the universal fallback that absorbs llama.cpp, MLX, and LM Studio with no
per-backend adapter code.

**Why Ollama first**: every backend surveyed can emit incremental text deltas
mappable to a TanStack-AI `StreamChunk` `TEXT_MESSAGE_CONTENT` event; none is
non-streaming. The differentiator is adapter and ops cost, not capability. Ollama
is the only local backend with a first-party TanStack adapter, so its
`message.content` / `delta.content` stream normalizes to `TEXT_MESSAGE_CONTENT`
with **zero custom mapping code**, and it is the lowest-friction always-on runtime
(single daemon, one-command model pull, cross-platform). [16][17][18] That makes it
the cleanest one-argument instance for the C2 `ChatStream` seam and the most direct
path to D2 candidate (c), the privacy end state, while keeping the worker's append
loop backend-agnostic.

**The uniform contract is satisfied two ways**: (1) first-party adapters (Ollama,
and the cloud OpenAI/Anthropic/Gemini paths) emit AG-UI events directly; (2) every
other local backend (llama.cpp `llama-server`, `mlx_lm.server`, LM Studio,
vllm-mlx) speaks OpenAI-compatible `/v1/chat/completions` with
`choices[0].delta.content`, which `openaiCompatible({ baseURL })` normalizes into
the same `TEXT_MESSAGE_CONTENT` chunks. So the **second** local backend is a
`baseURL` change, not new adapter code. [19][20][21][22] The one integration
wrinkle: MLX's fastest path is the in-process Python `stream_generate()`, which a
TypeScript daemon cannot consume without the HTTP-server bridge (`mlx_lm.server`,
LM Studio's MLX engine, or vllm-mlx). That is an integration constraint, not a
streaming-capability gap. [23][24]

This is consistent with the tracker's resolved **D2** (direct `chat()` with a
daemon key for the V0 proof; local backend as the end state). V0.5 is text-only, so
`TEXT_MESSAGE_CONTENT` is the only chunk the flush/append loop must handle now; see
open question O6 for reasoning/tool-call chunks.

**Sources**:
- [16] Ollama native `/api/chat` streams `message.content`; OpenAI-compat `/v1`
  streams `choices[0].delta.content`:
  <https://deepwiki.com/ollama/ollama/3.2-generation-and-chat-api>
- [17] Ollama OpenAI-compatible streaming returns `choices[0].delta.content`:
  <https://docs.ollama.com/api/openai-compatibility>
- [18] First-party `@tanstack/ai-ollama` (`ollamaText`):
  <https://www.npmjs.com/package/@tanstack/ai-ollama>
- [19] TanStack AI adapters (OpenAI/Anthropic/Gemini/Ollama/xAI/Groq) +
  `openaiCompatible({ baseURL })` from `@tanstack/ai-openai/compatible` normalizing
  `delta.content` to `TEXT_MESSAGE_CONTENT`:
  <https://deepwiki.com/search/what-model-adapters-does-tanst_cb92ea59-7e18-4e8e-befe-000d6d68e58b>
- [20] `TEXT_MESSAGE_CONTENT` AG-UI event; handlers read `chunk.delta`:
  <https://tanstack.com/ai/latest/docs/protocol/chunk-definitions>
- [21] `StreamChunk` is a type alias for `AGUIEvent`:
  <https://tanstack.com/ai/latest/docs/reference/type-aliases/StreamChunk>
- [22] llama.cpp `llama-server` OpenAI-compatible SSE, `delta.content` per token:
  <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
- [23] `mlx_lm.server` is OpenAI-compatible, streams `choices[0].delta.content`:
  <https://deepwiki.com/ml-explore/mlx-lm/3.3-http-server>
- [24] mlx-lm streams token-by-token in Python via `stream_generate()`:
  <https://deepwiki.com/ml-explore/mlx-lm/3.2-python-api>
- LM Studio local server is OpenAI-compatible (`:1234/v1`), `delta.content`, hosts
  GGUF + MLX: <https://lmstudio.ai/docs/app/api/endpoints/openai>

## Open Questions (resolve before building V2)

These are load-bearing; the build cannot start clean until they are answered.

- **O1 (the linchpin)**: does the daemon expose a socket-friendly RPC mirror of the
  action surface today, or does ADR-0021's action boundary need a new transport
  (Unix socket / named pipe) so a sandboxed process can reach it without a raw
  Y.Doc/SQLite handle? "Mount only the socket" presumes the socket exists.
- **O2**: for the local-process backend, how is "only socket + ro mirror" actually
  enforced (it is a convention, not OS-enforced)? Options: dedicated low-priv uid,
  per-run chroot/landlock, or simply accept it because the home box is
  single-user-trusted. Decide the floor.
- **O3**: what concrete predicate flips the policy local -> container? Proposed
  triggers: remote worker, shared/multi-user box, or an unreviewed script.
  "Untrusted" is doing a lot of work; pin the predicate.
- **O4**: is a hosted managed-worker tier (cloud) in scope for V2 at all? If yes,
  that is the only case justifying a `RemoteSandbox` (E2B/Modal/Daytona) adapter and
  gVisor/Firecracker-grade isolation; if no, ship local + Docker and defer the
  remote variant entirely.
- **O5**: data-mirror mechanics: directory bind-mount (`:ro`) or FUSE/overlay view?
  If the coding worker needs scratch space, give it a tmpfs discarded on dispose;
  scratch is fine, but persistence must go through actions.
- **O6**: does C3's shared stream/flush/finish concern constrain the `StreamChunk`
  subset local backends must emit? V0.5 is text-only, but if reasoning/tool-call
  chunks flow later, confirm the worker's append loop handles `REASONING_*` and
  `TOOL_CALL_*` AG-UI events from local backends. (Note: per the buildout's C3, the
  worker owns its own flush loop; the server copy dies at C4, so this is the worker's
  call alone.)
- **O7**: does the worker assume an externally-running Ollama/llama-server, or
  spawn/supervise the local runtime itself (model load/unload, health, port)? This
  is the real ops surface, separate from the streaming contract.
- **O8**: first-party adapter per local backend, or standardize on
  `openaiCompatible({ baseURL })` for **all** local backends (Ollama included) so
  there is exactly one local mapping path? The latter trades Ollama's curated
  adapter for uniformity; a deliberate call.

## Relationship to the build track

V2 is parallel and independent. It depends on **none** of V0/V1 landing, but two of
its seams reuse V0/V1 primitives rather than reinventing them: the harness writes
into the **same** conversation child-doc transcript (ADR-0025, the V0 append loop),
and the per-tool approval reuses the **V1.3 durable approval record** the doc
already carries. The sandbox's action socket is the RPC face of the **ADR-0021**
action surface Model 1 already uses. So when V2 is greenlit, it composes onto
settled primitives instead of forking new ones.
