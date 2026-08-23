# Decision: refuse server/local deletion reclaim for zhongwen conversations

Status: Refused (deferred). Date: 2026-06-12.
Supersedes: closed PR #1934 (`feat(zhongwen): delete a conversation's local doc and server room`).

## Context

A zhongwen conversation is a row in the `conversations` table (the parent
workspace doc, a CRDT). Each conversation's transcript is a separate child
Y.Doc with two durable homes the row delete does not touch: a local encrypted
IndexedDB database, and a server room (one Cloudflare Durable Object, embedded
SQLite `updates` table). PR #1934 proposed reclaiming both on delete via a
durable per-room tombstone (`room_tombstone` table), refuse-everything guards on
every room method, a `room-gone` (4410) WebSocket close code, a sync-supervisor
`gone` state, and an `EMPTY_DOC_SNAPSHOT`.

## Decision

Do not build server-side or local-side reclaim right now. Deletion stays exactly
what it already is: `conversations.delete(id)`, a CRDT row tombstone that is the
source of truth and removes the conversation everywhere it is visible, on every
device, for free. Dormant child-doc storage is left to be reclaimed lazily, if
ever.

## Why (grounded)

- Cost is decision-irrelevant. A SQLite-backed Durable Object that is idle and
  evicted bills only stored bytes: a ~12 KB empty-DB floor plus a tens-of-KB
  transcript, on the order of $0.0001 per conversation per month. The owner is
  happy to pay storage; the only driver for the feature priced out near zero.
- The tombstone premise was false and counterproductive. A Durable Object *can*
  be truly deleted: `ctx.storage.deleteAll()` + `ctx.storage.deleteAlarm()`
  empties it, and an empty-on-evict DO ceases to exist (Cloudflare docs).
  Writing a `room_tombstone` row does the opposite of the goal: it keeps the DO
  permanently non-empty, hence permanently billable, plus a row-read on every
  cold boot.
- The parent-doc CRDT tombstone left by each row delete is not a growth problem:
  with `gc: true` (set in `createRoomCore`), deleted entries become tiny,
  mergeable GC structs (`{id, length}`), so `encodeStateAsUpdateV2` growth is
  bounded per delete.
- `EMPTY_DOC_SNAPSHOT` constructed a `Y.Doc` at module scope, which the Workers
  runtime forbids (random clientID/guid in global scope); it crashed the worker
  on boot. That bug was a symptom: it only existed because `destroy()` left the
  in-memory doc populated and then guarded every read path instead of clearing
  it.
- The maintenance surface (686 lines across 4 packages, a multi-device
  convergence protocol, a platform-fighting tombstone) is not worth a cents-level
  saving. Convergence was already guaranteed by the per-device cleanup observer,
  not by the tombstone; the tombstone only closed a transient few-second
  re-upload window for a straggler tab on the owner's own devices.

## The cheap path, if revisited

- Server reclaim: a ~3-line `Room.destroy()` (`deleteAll()` + `deleteAlarm()`,
  true deletion, accept that re-requesting a deleted room yields a fresh empty
  room) plus a personal-mode `DELETE` route. No tombstone, no guards, no close
  code, no empty-doc snapshot.
- Local reclaim: `clearLocalStorageForDoc` + a `whenReleased` dispose-before-
  clear on the doc cache, behind a row-gone observer. Note it is IndexedDB-
  specific and does not generalize to a native (Tauri) persistence backend, and
  local storage is already fully wiped on sign-out (`wipeLocalStorage`).

## Triggers to revisit

1. Durable Object storage shows up as a real line item on the bill.
2. We make an explicit "delete purges the data from the server" product promise.
3. A heavy-deleter reports browser-storage pressure between sign-outs.
4. Room deletion is exposed in shared mode (multi-user partition, untrusted
   peers, the root doc at stake). There the permanent-refusal semantics the
   tombstone provided may actually be earned; the cents-level personal-mode case
   never earned them.
