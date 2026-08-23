# The Ark: Anti-Slop Doctrine and Carousel-Native Content Model

**Date**: 2026-06-02
**Status**: Draft
**Owner**: Braden
**Related**:

- `specs/20260518T160639-theark-marp-shortform-content-engine.md` (growth pipeline this revises)
- `specs/20260413T120000-server-authoritative-apps-wager-social.md` (historical Ark product research)
- `specs/20260512T150000-cloud-modules-and-networks.md` (Cloud App hosting model)

## One Sentence

The Ark is a low-dopamine, anti-slop social app whose native content unit is the static text slideshow rendered from a Marp-slides-plus-transcript source, where AI may amplify the author's authentic voice and writing but may never fabricate images.

## How to Read This Spec

```txt
Read first:
  One Sentence
  The Doctrine
  Content Model

Read if shaping the product:
  Design Decisions
  Open Questions   (the product shape is deliberately not closed yet)
```

## Overview

This spec captures a product-direction crystallization for The Ark: a clear AI
policy ("amplify the human, never fabricate"), a low-dopamine anti-slop ethos,
and a content architecture where the source of truth is Marp slides plus a
transcript, materialized into a carousel by default, a client-side replay inside
the Ark, and a baked video only as an external export adapter.

## Motivation

### Current State

Two adjacent specs exist, and neither states what The Ark *is* as an experience:

```txt
20260413T120000 (historical)  → The Ark is "a social media platform" on theark.so,
                                 server-authoritative Postgres. Defines DATA authority,
                                 not the content unit or the product ethos.

20260518T160639 (growth)      → Marp shortform content ENGINE. Defaults to
                                 "Marp slideshow + voice + burned-in captions" as a
                                 VIDEO format, with a face-hook video as best-expected.
                                 Treats video as the output.
```

This creates problems:

1. **The product ethos is undocumented.** "Social app" says nothing about what makes the Ark different from the slop feeds it reacts against.
2. **The content engine assumes the output is a video.** Recent reach data (below) shows that for thoughtful text content the carousel is the stronger native unit, and that assumption was never tested.
3. **There is no stated AI policy**, even though the author has a strong, specific stance that is itself a differentiator.

### Desired State

The Ark has a written doctrine (what it refuses, what it allows) and a content
model where the heavy artifact (video) is a disposable export, not the source.

## Research Findings

### Carousel vs Video for Thoughtful Text Content

Investigated current (2026) reach mechanics for static-slide content on the
short-form surfaces.

| Format | Reach / engagement signal | Animation | Effort |
| --- | --- | --- | --- |
| Instagram carousel | ~1.92% engagement, highest of any IG format; ~1.4x reach of static posts (Mosseri) | Minimal by design | Low |
| TikTok carousel (photo mode) | 2-5x the SAVE rate of a comparable video; saves + shares weighted heavily | Minimal by design | Low |
| Instagram Reels | ~0.50% engagement | High | High |
| Single static image | ~0.45% engagement | None | Low |

**Key finding**: For thoughtful, educational, list-structured content, the
carousel of static text slides is not a weaker substitute for video; it often
*outperforms* video on the exact signals (saves, shares) the algorithms reward,
while being the lowest-effort and lowest-animation format.

**Implication**: The carousel and the Ark's anti-slop, low-dopamine ethos are
the same shape. Marp already produces static slides. The native content unit
should be the carousel, with video demoted to an optional export.

### Short-Form Retention Priors (from companion research)

Hook in the first ~2 seconds, retention/completion as the core metric, faces are
not an algorithmic requirement (engagement is). Recorded in
`20260518T160639` open-question follow-ups. The carousel finding above does not
contradict this; it routes thoughtful content to the surface where a static
hook-slide plus saves wins without manufactured motion.

## The Doctrine

### The AI Line: Amplify the Human, Never Fabricate

```txt
ALLOWED:
  - Voice cloning of the author's own voice   (amplifies an authentic speaker)
  - Thoughtful AI assistance in WRITING        (amplifies an authentic writer)

BANNED:
  - AI-generated images / image slop           (fabricates what was never real)
  - (default-deny) anything not on the allow list
```

The allow/deny list is not arbitrary; it encodes one principle: **AI may amplify
a real person's authentic expression; it may not manufacture or fabricate.**
Voice and writing are the author speaking; generated imagery is invention. The
list is default-deny: a new AI use is banned until it is shown to amplify rather
than fabricate.

### Low Dopamine by Design

The Ark deliberately refuses engagement-maximizing slop. The product's reason to
exist is to be the place that *escapes* slop, not another feed optimized for time
spent. Concrete mechanics (feed ordering, metrics, scroll model) are Open
Questions, but the constraint is fixed: **if a mechanic exists only to maximize
dopamine or time-on-app, it does not belong in the Ark.**

### Honest Over Polished

Content should read as honest and human, not as a manufactured production. Not
"super-polished long-form video." The aesthetic ceiling is intentionally capped
to keep the bar low enough that real people post real things.

## Content Model

The source of truth is small and structured. Heavy artifacts are derived.

```txt
SOURCE (truth, lives in the workspace / Postgres-authoritative as the product needs)
  - Marp slides (markdown)
  - transcript / captions (text)
  - audio track (author's voice; an attachment blob)
        |
        |  materialize
        v
  +-- CAROUSEL  (static slides, swipe)    PRIMARY external unit. IG / TikTok photo mode.
  |                                        cheapest, lowest animation, on-brand.
  |
  +-- CLIENT-SIDE REPLAY (inside the Ark)  Marp HTML/CSS + transcript + audio,
  |                                        reconstituted in the browser. No video file.
  |                                        ~zero egress; editable; searchable.
  |
  +-- VIDEO (Remotion, SERVER-SIDE only)   OPTIONAL export adapter, for surfaces that
                                           demand motion/sound (full Reels/Shorts).
                                           Transient: bake, upload to the platform
                                           (they host it), discard or cold-store master.
```

Key properties:

- **Remotion is never in the browser.** It is a server-side export step, used only
  when a baked video is required. The Ark itself renders from source client-side.
- **The video is disposable.** External platforms (TikTok/IG/YT) host and deliver
  the uploaded mp4 for free; the Ark stores the cheap source, not the heavy output.
- **This mirrors the vault read-only projection model**: the rendered artifact is a
  one-way projection of the source, never the source itself.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Carousel role | 1 evidence | RETENTION surface (saves/shares among existing followers) | 2026 data: carousels win per-post engagement/saves, NOT reach to new people |
| Video role | 1 evidence | DISCOVERY surface, co-equal export (NOT demoted) | 2026 data: video reaches ~36% more new people; recommended mix 60-70% video; refusing it forfeits launch-phase reach |
| Export model | 2 coherence | All exports first-class from one Marp+transcript source | Adversarial grill: demoting video reintroduces the platform dependency the source model was meant to escape |
| In-app rendering | 2 coherence | Client-side reconstitution from Marp + transcript | Source-is-truth; no video storage/egress for in-ecosystem viewing |
| Image AI | 3 taste | Banned | Doctrine: fabrication is slop; the Ark exists to escape it |
| Voice cloning | 3 taste | Allowed (author's own voice) | Doctrine: amplifies an authentic speaker |
| Writing AI | 3 taste | Allowed, thoughtful use | Doctrine: amplifies an authentic writer |
| AI policy default | 2 coherence | Default-deny | New AI uses banned until shown to amplify, not fabricate |
| Dopamine-maximizing mechanics | 3 taste | Refused | Low-dopamine is the product's reason to exist |

This adds the **carousel** as a co-equal external unit alongside video; both are
exports of one Marp+transcript source. Carousel and video are NOT ranked against
each other (an earlier draft demoted video; the adversarial grill below refuted
that on the evidence). They serve different jobs: video for discovery/reach,
carousel for retention/saves.

## Adversarial Grill (2026-06-02)

Three independent fresh-context critics attacked the doctrine. They converged:
**strong as identity/community/retention, weak-to-fatal as a growth engine, as a
principled enforceable AI line, and as a "social media app" at scale.**

Load-bearing findings:

1. **Carousel-beats-video was a misread.** Carousels win per-post engagement and
   saves among EXISTING followers; video wins reach to NEW people (~+36%),
   recommended mix is 60-70% video, and TikTok carousels get ~33% fewer shares
   (shares = top discovery signal). Carousel-native optimizes for the audience
   phase the Ark is not in at launch. Decisions table corrected above.
   Sources: Socialinsider/Buffer/TheSecondBrain 2026 benchmarks.
2. **The voice/image asymmetry is backwards.** Cloning a voice synthesizes speech
   that never happened (identity-bearing, deepfake-shaped); a labeled image
   fabricates no one's identity. "Amplify vs fabricate," applied honestly, does
   not yield the allow-list. The policy is unenforceable at the artifact level
   (no reliable AI-image detector) and survives only as a community TASTE NORM,
   not a principled line. Reframe the doctrine as curated-community taste.
3. **The category is a graveyard.** Ello, Vero, Path, Cohost: dead or frozen, all
   on no revenue. BeReal collapsed 73.5M -> 16M. Substack Notes survived by
   becoming Twitter. "Low-dopamine social app" removes the only retention engine
   social apps have. Honest reframe: a small, invite-seeded, subscription-funded
   honest-writing COMMUNITY (ceiling in thousands), charged from day one.

## Open Questions

0. **THE FORK (blocks everything): community or venture-scale social app?**
   - Path A: small, invite-seeded, subscription-funded honest community. Ceiling
     ~thousands. Coherent; survives the graveyard. A craft/lifestyle business.
   - Path B: venture-scale social app. Requires the dopamine loop and video-first
     growth the doctrine bans, i.e. abandoning the doctrine.
   - **Recommendation**: the evidence says you cannot have manifesto purity AND
     social-media reach. Pick A or B explicitly; do not straddle. Open until the
     owner decides. Every downstream decision (carousel-vs-video, YouTube, the AI
     line, feed mechanics) resolves once this is set.

1. **Is the Ark a publishing platform or a social feed?**
   - The phrasing "Substack but with no content-creation engine and no AI slot,
     more of a social media app" mixes two product shapes: a publishing surface
     (you ship essays/posts to an audience) and a social surface (a feed of
     updates and interaction).
   - Options: (a) publishing-first (posts/essays as the core object), (b)
     social-first (feed + interaction), (c) a hybrid where a "post" is a
     carousel/slideshow object that can be both read and reacted to.
   - **Recommendation**: lean (c) with the carousel/slideshow as the core object,
     but this is genuinely open and should be resolved before product build.

2. **What does "no content-creation engine / no AI slot" mean concretely?**
   - Does it mean users bring their own content (the app does not generate it), or
     that there is simply no in-app AI generation surface?
   - **Recommendation**: read it as "the Ark does not generate content for you;"
     authoring happens elsewhere (e.g., the Marp engine), the Ark hosts and
     distributes. Confirm.

3. **What concretely makes the feed low-dopamine?**
   - Candidates: chronological (no algorithmic ranking), no vanity metrics (hidden
     like counts), no infinite scroll, daily-digest cadence, post limits.
   - **Recommendation**: pick 2-3 enforceable mechanics rather than a vibe; defer
     until the publishing-vs-social question (1) is resolved.

4. **Voice cloning: author-only, or any voice?**
   - The "amplify a real person" principle implies the speaker's *own* voice.
     Cloning someone else's voice would be fabrication, contradicting the image-AI
     ban.
   - **Recommendation**: restrict to the author's own voice; treat arbitrary voice
     cloning as banned under the same fabrication principle. Confirm.

## Adjacent Work

- Carousel export adapter (Marp slides -> 1080x1920 image set): not required to
  settle the doctrine; the first concrete build step once the product shape is set.
- Remotion server-side video adapter: deferred until a surface is proven to need
  motion that the carousel cannot satisfy.

## Success Criteria

- [ ] The doctrine (AI line, low-dopamine, honest-over-polished) is referenced by
      the Ark product spec rather than re-litigated.
- [ ] The content model (source-of-truth + carousel-primary + disposable video)
      is the shared mental model for both the product and the growth engine.
- [ ] Open Question 1 (publishing vs social) is resolved before product build.

## References

- `specs/20260518T160639-theark-marp-shortform-content-engine.md` - growth engine this revises (format decisions, open questions)
- `specs/20260413T120000-server-authoritative-apps-wager-social.md` - historical Ark data-authority research
- `specs/20260512T150000-cloud-modules-and-networks.md` - Cloud App hosting shape for theark.so
