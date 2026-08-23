# 0084. Super Chat's shell is a Bun-hosted local server, not a bundled SPA

- **Status:** Accepted
- **Date:** 2026-06-30
- **Relates:** [ADR-0080](0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md) (the super app is a desktop host composing local surfaces), [ADR-0111](0111-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md) (Super Chat v1 exposes built-in Epicenter apps and supersedes this ADR's former tool-loading decision), [ADR-0066](0066-runtime-portability-is-per-concern-injection-not-a-runtime-object.md) (names the `bun build --compile` self-host binary plus Tauri sidecar shape this decision realizes)

## Context

ADR-0080 made Super Chat a desktop host: one local process composes app surfaces
and remote devices attach to that host session. That left a shell-packaging
question. Super Chat can either use Tauri's usual bundled `frontendDist` shape,
or it can spawn the same Bun server shape the rest of Epicenter already runs and
point the Tauri window at that loopback server.

This ADR originally also chose loose TypeScript tool loading. ADR-0111
supersedes that part: Super Chat v1 exposes built-in Epicenter apps and does not
scan or import arbitrary `.ts` tool files. The live decision here is only the
shell shape.

Tauri's default avoids serving app content over a localhost HTTP server, using
custom schemes instead. A production `WebviewWindow` can still navigate to a
runtime-determined `http://localhost:PORT`; sidecar port discovery can ride the
Tauri shell plugin's stdout events. Tauri does not authenticate that shape for
us, so the sidecar server must own the local-request boundary.

## Decision

Super Chat's shell is a Bun-hosted loopback server that serves both static assets
and the session HTTP/WebSocket surface from one origin. The Tauri window opens
that local server instead of a bundled `frontendDist`.

This shape carries a mandatory security consequence, not an optional hardening
pass:

- The sidecar binds `127.0.0.1` only (`Bun.serve({ hostname: "127.0.0.1", port: 0 })`), never a LAN-reachable interface. Port `0` lets the OS assign a free ephemeral port; Rust discovers it from the sidecar's stdout.
- Rust generates a fresh, random, per-launch token at each app start, never persisted to disk, and hands it to the sidecar over stdin, not argv.
- The window's initial URL carries the token once (`http://127.0.0.1:<port>/?token=<token>`). The SPA reads it into memory and attaches it to subsequent requests: an `Authorization: Bearer` header for `fetch` calls, and a query parameter or cookie for WebSocket connections.
- Every request without a valid token is rejected before any tool executes.

## Consequences

The desktop host has one runtime target: a Bun server that owns static serving,
HTTP routes, WebSockets, and the local token gate. Building that binary is
progress on both Super Chat and the self-host server artifact named by ADR-0066.

The loopback-plus-token pair must ship with the sidecar's first version. A
loopback bind alone stops other machines, not other same-user processes.

Super Chat diverges from Whispering / Matter / Fuji's current Tauri packaging
(`frontendDist`). This is a deliberate, scoped divergence for one app, not a
monorepo-wide shell migration.

## Considered alternatives

Use Tauri's default bundled `frontendDist` plus a separate local IPC channel to
the Bun sidecar: rejected. A static bundle plus bespoke IPC is two systems where
one token-gated Bun origin is enough.

Use Electrobun, or another Bun-native shell, instead of Tauri plus sidecar:
rejected. Bun does not need to own the window to run the server, and Tauri still
owns packaging, signing, and update infrastructure elsewhere in the repo.
