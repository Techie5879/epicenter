# 0113. Super Chat session commands are host-owned; transports only frame them

- **Status:** Accepted
- **Date:** 2026-07-07
- **Relates:** [ADR-0080](0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md), [ADR-0084](0084-super-chat-shell-is-a-bun-hosted-local-server-not-a-bundled-spa.md), [ADR-0111](0111-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md), [ADR-0112](0112-the-cli-watcher-is-not-a-callable-action-server.md)

## Context

Super Chat is gaining an operator surface over the same composed catalog that
chat uses: visible commands, approval prompts, and direct invocation records. The
tempting shape is a new command route such as `POST /api/direct-command/run`,
but the host already has a live session channel for chat turns, snapshots, and
remote attach. Adding a second command transport would force route schemas,
request correlation, proxy-timeout behavior, and a second place to explain
approval policy.

The deeper boundary is not HTTP versus WebSocket. The host owns the session:
transcript state, the composed tool catalog, pending approvals, session-scoped
grants, direct invocation records, and command semantics. Transports deliver
frames and render snapshots.

## Decision

Super Chat has one live command surface: the host-owned session. Chat sends,
stops, retries, direct invocations, approval answers, and later palette or voice
commands enter the host session through one command vocabulary. The current
browser transport is the token-gated loopback session WebSocket from ADR-0084;
that WebSocket is an adapter, not the owner of command semantics.

The host must own pending approvals and direct invocation records in memory and
include them in session hydration and pushed session state. A reconnecting
window or a second attached client should re-render the same pending approval
from host state instead of relying on the socket that first saw it.

Super Chat must not add a generic HTTP command route, a Tauri IPC command path,
a stdio command protocol for the browser UI, a generic synced command table, or
a transport-neutral adapter framework until a named second consumer earns it.
Async work that can run later belongs to app-owned synced domain rows, per the
observe pattern, not to the live Super Chat session.

## Consequences

`server.ts` should shrink toward transport glue: token gate, JSON frame parsing,
WebSocket upgrade, hydration, and fan-out. The command vocabulary and command
state belong with the host session, beside the composed catalog and
conversation.

The operator plane and chat share one approval gate through
`resolveApprovedToolCall`. A direct command cannot become a privileged bypass
around mutation approval, and an approval prompt does not need to correlate a
held-open HTTP request with a separate WebSocket prompt.

The trade-off is deliberate: there is no `curl` or external-script route for
running arbitrary Super Chat commands. A script runner can return later as a
named tool provider or app-specific command, not as a generic action endpoint on
the host.

This also keeps ADR-0112's deletion whole. The CLI watcher is not callable, and
Super Chat does not reintroduce a machine-local named-action HTTP surface under
another name. Session commands are live interaction with the one session a human
has attached to.

## Considered alternatives

Add `POST /api/direct-command/run`: rejected. Approval prompts still require a
push channel, so the route would add a second command transport and a
cross-transport correlation problem.

Use synced rows for every command: rejected. A direct command click is urgent
live session work. Synced rows are for non-urgent app-owned observe work, and
tool results may be sensitive data that must not move onto an operator-readable
hosted sync plane by accident.

Use Tauri IPC or stdio as the primary command protocol: rejected. The primary UI
is a browser page served from the host origin, and remote attach must reach the
same session from another browser over the user's overlay. Tauri IPC and stdio
would either vanish remotely or require a second browser protocol.

Build a transport-neutral adapter framework now: rejected. `SuperChatHost` and
`ConversationHandle` are already the session core. A framework earns itself only
when a real second adapter cannot use the existing session WebSocket.
