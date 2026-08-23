# 0007. Local shortcuts sync, global shortcuts stay per-device

- **Status:** Accepted
- **Date:** 2026-06-15

## Context

Whispering has two kinds of keyboard shortcuts. In-app shortcuts fire while the app
is focused; global shortcuts fire system-wide. The question was where each is
stored, and whether they should sync across a user's machines. Global shortcuts
collide with OS-reserved keys and other apps differently on each machine, so a key
that works on one device may be unusable on another; in-app shortcuts have no such
per-machine variance.

## Decision

In-app (local) shortcuts live in the workspace key-value store and therefore sync
across devices. Global shortcuts live in `deviceConfig` and stay per-device. The
asymmetry is deliberate: app-world settings are uniform and want to sync;
machine-world settings face per-device collisions and OS keys and must not.

Push-to-talk is modeled as two stateless commands rather than one key with a
tap-or-hold classifier: `pushToTalk` (start on Pressed, stop on Released; default
Fn) and `toggleManualRecording` (toggle on tap; the button's home). No timing
classifier or phase machine exists.

## Consequences

- The settings UI shows one shortcut system per platform; there is no dual-group
  local-vs-global UI to reconcile across machines.
- A user's in-app shortcuts follow them between devices; their global shortcuts do
  not, which is correct given per-machine key availability.
- Push-to-talk and tap-to-toggle are independent, stateless, and separately
  bindable. There is no 300ms ambiguity window to tune.

## Considered alternatives

- **Sync global shortcuts too, with an override or resolver per device.** Rejected:
  narrow benefit, the defaults are already good, and it is purely additive later if
  ever needed, so it stays reversible by not building it now.
- **One push-to-talk key classified at runtime into tap-or-hold.** Rejected: the
  classifier added a tunable timing window and state for no gain over two explicit
  commands.
