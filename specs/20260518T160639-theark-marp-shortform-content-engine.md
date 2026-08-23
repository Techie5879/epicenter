# The Ark Marp Shortform Content Engine

**Date**: 2026-05-18
**Status**: Draft
**Author**: AI assisted
**Revised in part by**: `specs/20260602T235900-the-ark-anti-slop-doctrine.md` (demotes video from the default unit to an optional export; the carousel is now the primary external unit)
**Related**:

- `specs/20260413T120000-server-authoritative-apps-wager-social.md`
- `specs/20260512T150000-cloud-modules-and-networks.md`
- `docs/articles/one-function-call-why-marp-won.md`
- `docs/articles/prs-are-searchable-artifacts.md`

## One Sentence

The Ark should use a Marp-based shortform content engine to turn founder narratives into repeatable TikTok, Reels, and Shorts videos with slides, pictures, captions, and Braden's voice.

## Overview

This spec externalizes The Ark's growth content pipeline from the core product plan. The Ark app remains a server-authoritative social Cloud App; the shortform content engine is a separate publishing workflow that turns narrative ideas into vertical slideshow videos for audience discovery.

## Motivation

### Current State

The Ark product plan lives in a historical app spec:

```txt
specs/20260413T120000-server-authoritative-apps-wager-social.md
  Phase 4: The Ark API Layer
  Phase 5: The Ark Frontend
```

That spec is partially superseded by the Cloud App model:

```txt
specs/20260512T150000-cloud-modules-and-networks.md
  Cloud App package: routes, schema, scopes, policy
  Instance host: ark.epicenter.so or theark.so
```

The Marp rendering research lives separately:

```txt
docs/articles/one-function-call-why-marp-won.md
docs/articles/prs-are-searchable-artifacts.md
```

The missing plan is the growth bridge:

```txt
The Ark product narrative
  -> shortform story
  -> rendered slides
  -> pictures and screenshots
  -> voiceover
  -> captions
  -> published TikTok, Reels, Shorts
```

This creates problems:

1. **Product and growth are conflated**: The Ark implementation spec defines app schema, routes, and frontend screens. It does not define how people discover the product.
2. **Marp is documented as a rendering proof, not a publishing pipeline**: The repo proves Marp can render quickly, but does not say how that capability becomes a repeatable social content workflow.
3. **TikTok strategy is implicit**: Previous launch docs mention visual platforms, but they do not define a reusable format for founder-led, narrative-driven content.

### Desired State

Keep the surfaces separate:

```txt
The Ark product spec:
  What the app is and how it works.

Cloud Apps spec:
  How Ark is mounted, scoped, and hosted.

This spec:
  How Ark narratives become shortform videos at high volume.
```

The content engine should produce many variants quickly while preserving the trust of a human narrator.

## Research Findings

### TikTok Creative Constraints

TikTok's current business guidance emphasizes native vertical creative, sound, visible people where possible, a clear hook in the first seconds, text overlays, transitions, graphics, and ongoing testing of multiple creative variants.

Source: [TikTok Business Help Center, Creative best practices for performance ads](https://ads.tiktok.com/help/article/creative-best-practices?lang=en&trk=article-ssr-frontend-pulse_little-text-block), last updated June 2025.

**Key finding**: Face-to-camera is useful because it adds trust and pattern interruption, but the repeatable advantage comes from fast hook testing and creative variation.

**Implication**: The best initial format is not pure slideshow or pure talking head. It is a hybrid pipeline where a founder voice anchors the video, and Marp supplies repeatable visual structure.

### Existing Marp Research

The Marp proof showed this core shape:

```typescript
import { Marp } from '@marp-team/marp-core';

const marp = new Marp({ script: false, math: false });
const { html, css } = marp.render(markdownString);
```

The important property is not that Marp makes presentations. The important property is that it turns markdown into rendered HTML and CSS with a small integration surface.

```txt
Narrative markdown
  -> marp.render()
  -> slide HTML/CSS
  -> vertical frames
  -> video assets
```

**Key finding**: Marp is a good fit for programmatic content generation because it avoids a project directory, dev server, and browser-first build pipeline.

**Implication**: Marp can become the rendering layer for shortform creative variants, while captions, images, voiceover, and export remain separate pipeline stages.

### Format Comparison

| Format | Viral ceiling | Trust | Throughput | Fit for The Ark |
| --- | --- | --- | --- | --- |
| Face and mic only | Highest | Highest | Low | Best when the founder's emotion, charisma, or authority is the product |
| Marp slideshow, pictures, Braden voice | High | Medium high | High | Best default for repeatable narrative testing |
| Hybrid face hook, then Marp slideshow | Highest | High | Medium | Best likely winner after the basic pipeline works |
| Text-only slideshow | Medium | Low medium | Very high | Useful for cheap hook tests, but easy to commoditize |
| Description-first narrative | Low | Low | High | Support channel only, not the primary story |

**Key finding**: Marp plus pictures plus Braden's voice is asymmetric because it combines adequate trust with much higher output volume than face-only production.

**Implication**: Treat the format as a testing engine, not as one perfect video template.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Planning boundary | 2 coherence | Separate this spec from The Ark product spec | Growth content has different ownership, cadence, and success metrics than schema, routes, and frontend work. |
| Default format | 3 taste | Marp slideshow, pictures, Braden voice, burned-in captions | This maximizes iteration speed while retaining a human voice. |
| Best expected format | 3 taste | Face hook for 1 to 2 seconds, then Marp slideshow | The face supplies trust and pattern interruption; slides supply visual pacing and variant speed. |
| Description role | 2 coherence | Support metadata, not the narrative container | The viewer should understand the story from the video itself. |
| Rendering layer | 1 evidence | Marp | Existing repo research proves the simple markdown-to-rendered-output path. |
| Product dependency | 2 coherence | Content engine can launch before The Ark app is complete | The goal is to build audience and language before the product is fully available. |
| Analytics loop | Deferred | Manual first | Automating performance ingestion should wait until the format shows signal. |

## Architecture

```txt
+------------------------------------------+
| Narrative Brief                          |
| - thesis                                 |
| - target viewer                          |
| - desired reaction                       |
| - proof points                           |
+------------------------------------------+
                    |
                    v
+------------------------------------------+
| Script Variant Set                       |
| - hook A, B, C                           |
| - 20 to 45 second voiceover              |
| - slide-by-slide beats                   |
+------------------------------------------+
                    |
                    v
+------------------------------------------+
| Marp Markdown                            |
| - vertical theme                         |
| - one idea per slide                     |
| - image slots                            |
| - caption-safe layout                    |
+------------------------------------------+
                    |
                    v
+------------------------------------------+
| Rendered Assets                          |
| - slide frames                           |
| - screenshots or generated images        |
| - Braden voiceover                       |
| - burned-in captions                     |
+------------------------------------------+
                    |
                    v
+------------------------------------------+
| Published Creative                       |
| - TikTok                                 |
| - Instagram Reels                        |
| - YouTube Shorts                         |
| - description and CTA                    |
+------------------------------------------+
                    |
                    v
+------------------------------------------+
| Performance Notes                        |
| - hook retention                         |
| - comments                               |
| - saves and shares                       |
| - profile clicks                         |
| - next variant                           |
+------------------------------------------+
```

## Content Model

Each video should be generated from a small structured brief:

```typescript
type ShortformBrief = {
  product: 'theark';
  viewer: string;
  thesis: string;
  tension: string;
  proofPoints: string[];
  desiredReaction: 'curious' | 'argument' | 'signup' | 'share';
  callToAction: string;
};
```

The brief becomes a script with explicit timing:

```txt
0.0s to 1.5s:
  Face hook or first slide hook.

1.5s to 8.0s:
  The problem or contradiction.

8.0s to 25.0s:
  Evidence, screenshots, examples, or diagrams.

25.0s to 40.0s:
  The Ark angle and CTA.
```

## Video Templates

### Template A: Pure Marp With Voice

```txt
Slide 1: Hook
Slide 2: Problem
Slide 3: Concrete example
Slide 4: Why existing apps fail
Slide 5: The Ark mechanic
Slide 6: Why it matters
Slide 7: CTA or question
```

Use when the idea is conceptual, technical, or visually explainable.

### Template B: Face Hook Into Marp

```txt
0.0s: Braden on camera says the hook.
1.5s: Cut to slide 1.
2.0s: Voiceover continues over slides.
Final slide: CTA or unresolved question.
```

Use when trust matters, or when the hook benefits from human delivery.

### Template C: Screenshot Essay

```txt
Slide 1: Claim
Slide 2: Screenshot
Slide 3: Annotation
Slide 4: Pattern
Slide 5: The Ark response
Slide 6: Question for comments
```

Use when comparing social products, feeds, communities, or interaction patterns.

## Narrative Lanes

Initial content should test a few lanes instead of one broad brand message:

| Lane | Example hook | Why it fits |
| --- | --- | --- |
| Social apps feel broken | "Your group chat is already a social network." | Starts from a familiar pain. |
| Build in public | "I am building a social app because feeds stopped feeling social." | Makes the founder visible. |
| Product mechanics | "The smallest social feature is not the post. It is the audience." | Gives repeatable educational content. |
| Internet culture | "The internet did not get less social. It got less situated." | Creates comment-worthy opinions. |
| Epicenter architecture | "Local-first is wrong for a public feed, and that is the point." | Connects product philosophy to implementation. |

## Implementation Plan

### Phase 1: Manual Pilot

- [ ] **1.1** Write 10 The Ark narrative briefs across the lanes above.
- [ ] **1.2** Turn 3 briefs into Marp markdown scripts.
- [ ] **1.3** Create one vertical Marp theme optimized for phone screens.
- [ ] **1.4** Export still frames manually.
- [ ] **1.5** Record Braden voiceover for each script.
- [ ] **1.6** Assemble 3 videos manually in the fastest available editor.
- [ ] **1.7** Publish with distinct hooks and record performance notes.

### Phase 2: Repeatable Renderer

- [ ] **2.1** Add a small local script or app route that renders vertical Marp slides from markdown.
- [ ] **2.2** Add image slot conventions for screenshots and generated pictures.
- [ ] **2.3** Add a caption-safe layout contract.
- [ ] **2.4** Produce slide frame exports that can be assembled into video.

### Phase 3: Voice And Caption Workflow

- [ ] **3.1** Define the source of truth for voiceover scripts.
- [ ] **3.2** Add timestamped caption generation or a manual caption import format.
- [ ] **3.3** Burn captions into the video so the story works without sound.
- [ ] **3.4** Keep Braden's real voice as the default narrator.

### Phase 4: Variant Testing

- [ ] **4.1** Generate 3 hook variants for each narrative.
- [ ] **4.2** Generate face-hook and pure-slide variants for the same script.
- [ ] **4.3** Record performance notes in a simple table.
- [ ] **4.4** Promote winning hooks into new scripts.

### Phase 5: Product Integration

- [ ] **5.1** Decide whether this remains an internal launch workflow or becomes a user-facing Ark publishing feature.
- [ ] **5.2** If user-facing, write a separate product spec for "publish a narrative as a shortform slideshow."
- [ ] **5.3** Keep publishing permissions separate from Ark social posting permissions.

## Non-Goals

- This spec does not define The Ark schema, routes, or UI.
- This spec does not require automated posting to TikTok, Instagram, or YouTube.
- This spec does not require AI voice.
- This spec does not require video editing automation before the manual pilot proves signal.
- This spec does not make descriptions carry the main story.

## Open Questions

1. Should the first videos use `theark.so`, `ark.epicenter.so`, or a waitlist link as the CTA?
2. Should the first public story be about The Ark directly, or about why social software feels broken?
3. Should the pilot use real screenshots, generated images, or abstract diagrams?
4. What is the minimum performance signal that justifies automating export?
5. Should the face hook be recorded once per video, or should it be a reusable intro pattern?

## Review

Created this spec to externalize the Marp shortform content engine from The Ark's core product implementation plan. The spec keeps The Ark product work, Cloud App architecture, Marp rendering research, and TikTok growth workflow as separate surfaces with explicit links between them.
