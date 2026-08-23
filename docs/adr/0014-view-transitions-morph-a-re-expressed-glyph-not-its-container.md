# 0014. View transitions morph a re-expressed glyph, not its container

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

`view-transition-name` connects an element across a navigation: when the same
name is present before and after, the browser tweens the old box into the new
one. Artifacts (a recording's `audio`, `transcript`, `transformationOutput`; a
`transformation`) are the clean case, the same object appears in two routes, so
the morph is literally true.

Controls are harder. The home page and the config topbar both express the same
capture choices: the selected recording mode (a mic for manual, an ear for vad),
the input device, and the transcription service. An earlier pass named the whole
control, so navigating home morphed the home hero's 56px bordered glyph box into
the config header's 36px ghost button. That looked like a glitch, and the reason
was diagnosed correctly: the button is persistent chrome, it does not relocate,
and morphing two differently-shaped containers animates a lie about lifecycle.
The over-correction was to forbid every control morph. That conflated two things:
the *container* is chrome, but the *glyph* inside it is a small token, identical
in both routes (the same Lucide icon at the same `size-4`), standing for the same
selected choice. Sliding that token between its two homes is honest about the
small true thing (this is the same choice, expressed here and there) without
claiming the button moved.

## Decision

A `view-transition-name` may bind to a re-expressed control's **glyph**, never to
its container. The glyph must be the same icon (the same Lucide shape) in both
routes, so the morph animates the continuity of a selected choice, not a
relocation of chrome. Size may differ when the change is itself meaningful:
because the shape is identical, scaling it reads as one control re-expressed at a
different scale, not as a glitch. What stays forbidden is morphing the
*container* (a bordered card box into a ghost button) and morphing two
*different* shapes into each other.

Concretely, the narrow `viewTransition` additions are:

- `recordingMode(trigger)` on the mode glyph: the home action card's glyph (the
  mic beside Start Recording, the ear beside Listen for Speech) and the topbar
  record button's icon, both **at rest**. Bound to the glyph, not the card box or
  button. The glyph is a 56px hero on the card and a compact `size-4` icon in the
  topbar; the morph flies the identical shape up into the toolbar, so the record
  control visibly compacts into chrome. The home mode tabs deliberately do **not**
  carry the name: both tabs render at once, so naming them would duplicate the
  active name (aborting the transition) and compete with the action card for the
  one allowed source. Once a recording is live the card and topbar swap to a stop
  or waveform glyph, a different object owned by a live state machine, which must
  not inherit the name. The action card owns this at-rest gate: it already knows
  whether it is `active`, so it suppresses the name whenever active and callers
  pass the mode name unconditionally. A live glyph can never morph by accident,
  and the rule lives with the state that defines "live" rather than being
  re-spelled at every call site.
- `pipeline.device` and `pipeline.transcription` on the device-selector mic glyph
  and the transcription-service brand glyph, which appear in both the home
  pipeline and the topbar. These are pure pipeline chrome: constant names (no id)
  that morph the home pipeline glyph into the topbar glyph, never co-rendered.
- The transformation stage is the odd one out, because it alone has a list page.
  Its glyph carries `transformation(id)`, the same name its row carries on
  `/transformations`, so the morph is the **artifact** one: the selected
  transformation's glyph flies into its row in the list. That name is opt-in per
  call site (an `iconViewTransitionName` prop, like the device and transcription
  selectors), and **only the home pipeline passes it**. The config topbar leaves
  its transformation selector unnamed, because the topbar overlays
  `/transformations` itself, where a topbar name would duplicate the row's name
  and abort the morph. So transformation morphs glyph-to-row rather than
  glyph-to-topbar; device and transcription, having no list page, morph
  glyph-to-topbar. All four selectors share the same opt-in prop shape.

Containers still never carry a shared name. The deleted `global.microphone`,
`global.cancel`, `global.header`, and `global.nav` stay deleted: those named the
whole control, the move this ADR still refuses.

## Consequences

- Home-to-config navigation flies the selected mode glyph from the home action
  card up into the topbar, compacting the hero record control into chrome, and
  slides the device and model glyphs from the home pipeline to the topbar (these
  stay `size-4` in both routes, so they morph without scaling). Each reinforces
  that the same choice persists across the move; the surrounding cards, buttons,
  and labels crossfade.
- The hard rule that prevents the original glitch is a uniqueness invariant: a
  given name may appear at most once in each document. The mode tabs avoid this
  by carrying distinct per-trigger names; the pipeline glyphs avoid it because
  the home pipeline and the topbar never render on the same page. Naming a shared
  control puts the burden of proving single-occurrence on the author, because a
  duplicate makes the browser animate neither and warn.
- The name binds to the glyph at rest only. A glyph owned by a live state machine
  (a stop square, a waveform) is a different object and is left unnamed, so the
  morph never tries to turn a mic into a square.
- The uniqueness invariant binds artifact names too, and two duplicates were
  found and removed:
  - On `/recordings`, the transcript and transformation-output names were carried
    both by their display column (the real artifact) and by a row-action copy
    button that merely acts on the same data. A copy control is a button, not the
    artifact, so the duplicate `recording(id).transcript` and
    `transformationOutput` aborted every home-to-`/recordings` transition. The
    copy buttons lost their names; the display column owns the artifact.
  - The transformation selector named its **container** (the trigger `<Button>`)
    unconditionally, so the shared config topbar carried `transformation(selId)`
    on every config page, including `/transformations`, where it duplicated the
    selected row and aborted the morph whenever a transformation was selected and
    visible. The name moved to the glyph and became opt-in (home pipeline only),
    which fixes both the container-naming violation and the duplicate.
  These were the same failure: a name applied twice in one document. The symptom
  is silent, because the browser aborts the whole transition rather than the one
  pair, so a working route (`/transformations` with nothing selected) and a
  broken one (the same route with a selection) look identical until you look for
  the duplicate.

## Considered alternatives

- **Forbid every control morph; only artifacts get names.** This was the prior
  decision. Rejected on revisit: it threw out the honest glyph-level morph along
  with the dishonest container-level one. The container is chrome, but an
  identical glyph standing for the same choice in two routes is a true, small
  thing to animate.
- **Morph the whole control (`global.microphone` and friends).** Still rejected.
  Morphing a 56px bordered card box into a 36px ghost button animates a lifecycle
  lie and looks like a glitch; the containers are different chrome that does not
  relocate. Naming only the glyph buys the continuity without the lie.
- **Bind `recordingMode` to the home mode tab instead of the action card.** The
  tab icon is already `size-4`, so it would morph to the topbar with no scale at
  all. Rejected: the tab is a small secondary selector, and morphing it
  understates the continuity. The action card is the primary control the user
  actually clicks to record, so flying it into the topbar is the meaningful
  morph, and the identical shape keeps the scale honest. Binding both the tab and
  the card would duplicate the name in one document and abort the transition, so
  only one may carry it; the card wins.
- **Name the shared glyph inside the component unconditionally.** Rejected: these
  selectors are reused (pipeline and standalone variants, dropdown list rows), so
  a baked-in name would appear many times in one document. The name is passed in
  per call site instead, so each occurrence is deliberate and unique.
