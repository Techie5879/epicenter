# The Relay Already Knew Who Was Connected

One of the biggest things we changed in Epicenter recently was moving cross-device action dispatch off our shared Yjs document and onto the server. The reason the move works is simple: the server can answer "is this device connected?" synchronously. There's no need to write a row and wait for it to sync. The relay already has the WebSocket open. It already knows.

```
caller R_laptop                relay (DO)                  recipient R_phone
─────────────                  ──────────                  ─────────────────
dispatch { id, to, action, input, expiresAt }
                                │
                                ├─ ctx.getWebSockets('R_phone')
                                │      → [ws_phone]   (or [] if offline)
                                │
                                │   if []:  dispatch_error: RecipientOffline
                                │   else:   forward as dispatch_inbound
                                │                              │
                                │                              ▼
                                │                          handler runs
              ◄── dispatch_response ◄── dispatch_response ────┘
```

Before this, every cross-device call was a row in the workspace doc. Phone tells laptop to open a note? Write a row. Laptop writes its response back to the same row. Yjs replicated it to every connected device. The right device picked it up; the others ignored it.

It worked. I almost shipped a polished version of it.

## How I almost shipped the wrong thing twice

The first design was straightforward. Calls live in `YKeyValueLww<Call>`. An orphan sweeper cleans up rows older than an hour.

```ts
// the old shape
calls.set(callId, {
  to: targetConnectionId,
  action: 'open_note',
  input: { ... },
  sent_at: Date.now(),
  response: null,
})
```

On a laptop with a persistent socket, you don't notice anything is off. Then we grilled it. Every Yjs row replicates to every connected device. Five devices on a workspace, a call addressed to one means four other devices receive frames they don't need. On a laptop, that's bytes. On a Chrome extension service worker, every replicated frame wakes V8. Same on a phone in background. The bytes are small; the wakeups are not.

My second instinct was to add an explicit TTL to the call rows so the protocol's intent would at least be honest. Make the data model cleaner. I got talked out of that one a couple rounds later. The data model wasn't the problem. The substrate was.

A Yjs document is for state that every replica should agree on. An RPC call is a message to one device that nobody else needs to see. Forcing one through the other meant building expiry sweeps, response-flip conventions, observer filters that drop everyone else's traffic, and an implicit trust contract that callers don't update their own call rows. All of it was fighting the data model instead of using it.

## The fix is admitting which kind of thing it is

We dropped the CRDT row entirely. A dispatch is now a regular WebSocket frame on the same socket the doc is already using for sync. The relay reads the `to` field, looks up that socket in its in-memory connections index, and forwards. If the recipient isn't connected, the relay sends `RecipientOffline` back to the caller synchronously.

The relay also stamps `from` on the inbound frame, because it knows authoritatively which socket sent the call. The recipient doesn't have to trust anything the caller said about itself.

```ts
collab.dispatch({
  to: installationId,                          // stable per install
  action: 'open_note',
  input: { ... },
  expiresAt: Date.now() + 30_000,
})
// → Promise<Result<T, DispatchError>>
```

The response reuses the same routing path. The recipient writes `dispatch_response { id, to: from, result }`. The relay forwards. The caller's pending promise, keyed by `id`, resolves. The server keeps no per-id state.

Per-non-addressee bandwidth from dispatch: zero. SQLite update log growth from dispatch: zero. The extension service worker stops waking up for messages addressed to other devices.

## What got cut

Most of the design work was saying no.

No `fire` / `send` / `job` taxonomy. Earlier drafts borrowed MQTT QoS levels for three call shapes. One verb turned out to be enough.

No offline queue. If the recipient isn't connected, the call fails. If it matters, the caller retries later. A queue at the relay would need claim leases, retries, dedup tables, and a separate primitive that wants exactly-once semantics. No real caller asks for that today, and when one does, it gets its own spec.

No `platform` field on devices. The only reason it existed was to predict which actions a device could handle, but each device already announces its actions directly. Strictly more useful, and one less thing to maintain.

No durable devices registry. Offline devices don't exist for the purpose of dispatch. Discovery is just one method on the relay-backed liveness view:

```ts
collab.devices.list()   // [{ installationId, displayName, actions }, ...]
```

Three fields per device. We had more. Each one we cut, the design got smaller.

## The trade I want to be honest about

The CRDT-based design had one thing the new one doesn't: dispatch could in principle work over any Yjs sync transport, including peer-to-peer ones. We've given that up. Dispatch now requires the relay to be reachable.

I went back and forth on this because Epicenter is local-first and "you need our server for this to work" doesn't sit comfortably with that. Here's where I landed.

Local-first is a promise about your data. Your notes, your workspace state, your settings, all of that is yours, it works offline, and Y.Doc sync stays generic Yjs. That promise is intact.

Live cross-device RPC is structurally different. You can't tell your phone to do something from your laptop unless something routes a message between them in real time. WebRTC is the only fully peer-to-peer option, and we ship to Chrome extension service workers and mobile background tasks, neither of which can do WebRTC. So a relay was always going to be required for this surface. The question was never "relay or no relay"; it was "what does the protocol on the relay look like." Targeted routing won over CRDT fan-out. The protocol is implementable on any WebSocket server. Cloudflare Durable Objects is what we run on; it isn't a requirement.

## Closing

The relay was always going to know who was connected, in real time, with no round trip. We just had to let it route. Spec lives at `specs/20260518T000000-live-device-dispatch.md` if you want the wire format, failure modes, and migration plan.
