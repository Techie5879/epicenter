# Reach Is Computed, Not Chosen

A keyboard shortcut in a dictation app has to answer one question: does it fire only when you are looking at the app, or from anywhere on your machine? Whispering used to answer that question four separate times, and one of those times it asked the user. The four answers were always the same fact, and that fact is already decided the moment you pick a key.

The four were scope (focused or system), tier (chord or hold), backend (in-app keydown or native tap), and storage format. Each one was secretly re-reading the physical shape of the keystroke. A bare letter forces focused, forces the in-app backend, forces the synced store. A chord unlocks system-wide, the plugin, the per-device store. You answer one question, then write it down four times. And the settings UI put the worst version of it in front of the user: a "system vs in-app" toggle, a choice they already made when they chose the key.

## The core idea: reach is computed, not chosen

The whole change collapses those four axes into one fact per command and one formula.

The one fact is reach: does this command even make sense outside the app? "Start recording" does, so it's global. "Open settings" doesn't (there's nothing to open settings into from another app), so it's focused. That's the only thing a human declares, and it's declared by the programmer in the catalog, once, not by the end user.

Everything else falls out of this formula:

```ts
realizedReach = min(
  command.reach,        // can this command be global at all?
  keyCapability,        // can this KEY be global?      bare -> no, chord -> yes, hold -> yes-with-permission
  platformCapability,   // can this PLATFORM be global? web -> no, desktop -> yes
)
```

It's a minimum of three ceilings. The most restrictive one wins. Walk through it:

You bind Space to "start recording" on the web. The command would love to be global, but the key is bare (caps at focused) and the platform is web (caps at focused). min(global, focused, focused) = focused. Works in-app. The badge says "Works in Whispering."

You bind Cmd+Shift+Space to "start recording" on desktop. Command wants global, the chord allows global, desktop allows global. min(global, global, global) = global. Works everywhere, no permission. Badge says "Works everywhere."

You bind Cmd+, to "open settings" on desktop. The chord could go global, the platform could go global, but the command is intrinsically focused (settings is meaningless from another app). min(focused, global, global) = focused. The command's nature is the floor that stops a perfectly capable chord from rudely grabbing Cmd+, system-wide. Badge says "Works in Whispering."

So the user never picks a scope. They pick a key, and a live badge tells them how far it reaches. The system teaches instead of asking.

## Reach is a ceiling, so preference can only ever clamp down

The natural question is whether the user has lost a preference here. They haven't; the preference just moved into the key. Picking the key is how you express how far you want a command to reach. Want it everywhere on desktop? Pick a chord. Happy with in-app only? Pick a bare letter. The badge is honest feedback on the choice you already made, not a second dial.

The one thing the formula refuses is an upgrade past physics. You cannot make a bare letter global, because it would eat that key in every app on your machine. So every ceiling in the `min` only ever clamps reach down, never up. The badge shows the realized floor, and any preference a user has is a downward clamp expressed through the key.

That leaves exactly one preference the pure model can't express: "I picked a global-capable chord, but I want it confined to the focused window anyway." There is no downgrade lever for that, on purpose. Adding one would reintroduce a smaller version of the scope toggle this whole change deleted, so it stays out of v1. If real users hit it, it returns as an explicit per-binding clamp, never as a default and never as an upgrade.

## Storage routes by reach, and the user never names a map

Bindings live in two maps, routed by the reach the key realized, not by anything the user labels. Focused bindings go to synced storage, because an in-app key never collides with another app, so it can roam across your devices. Global bindings go to per-device storage, because a system-wide key collides machine by machine, so it stays local.

```ts
type Keybindings = {
  focused: Partial<Record<CommandId, KeyBinding | null>>;  // synced workspace KV: in-app keys roam
  global:  Partial<Record<CommandId, KeyBinding | null>>;  // per-device device-config: global keys stay local
};
```

The user picks a key, the formula computes its reach, and the reach decides which map the write lands in. The two stores already exist in Whispering, split today by platform; the change is to route by reach instead, so desktop can finally hold both an in-app `Cmd+,` and a system-wide `Cmd+Shift+Space` at once.

The payoff is a settings page with no scope toggle and no platform branch: one flat list of commands, each with a key and a badge that says exactly how far it reaches. The model also becomes the spine everything later hangs off, since a command palette, a voice trigger, and a deep link are all just other ways to run a command by id.
