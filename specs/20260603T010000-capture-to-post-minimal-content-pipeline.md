# Capture to post: the minimal content pipeline

Status: DRAFT, MVP-first. This is the thing to ACTUALLY build, because the stated goal
is "post videos and content." It is the buildable core of The Ark
(`20260602T235900`). The per-user platform (`20260602T233000`) is deferred; it does
not serve this goal.

Note 2026-06-08: the vault disk shape in
`/Users/braden/Code/vault/specs/20260605T193000-vault-publishing-layout.md`
supersedes the earlier one-file `status: ready` draft contract for
hand-authored publish artifacts. In `vault/publish/**`, a post records `page:`
and optional `published_at` / `url`; composing and published views are inferred
from linked post existence plus `published_at`.

Date: 2026-06-03

---

## Goal

Get content from your head to POSTED on IG/TikTok with the least friction.

Non-goals (on purpose):
- NOT the app-hosting platform, NOT a knowledge wiki, NOT a curation app.
- NOT hosting video (platforms host the upload).
- NOT auto-posting on day one (manual upload is fine to start).

A knowledge-wiki organizes thoughts; this PRODUCES posts. Different job. Build this one.

---

## The pipeline

```
  CAPTURE        DRAFT              RENDER                    POST
  Whispering     a .md file         Marp -> carousel images    upload to IG / TikTok
  (exists today) + frontmatter      Remotion -> video (later)  (manual first, API later)
                 (exists today)     ^^^^^ the ONLY new thing ^^^^^
```

Capture works (Whispering). Drafting works (write a markdown file anywhere). The only
missing piece, the bottleneck to the goal, is RENDER+POST. Build that.

---

## The post artifact contract (vault disk shape)

```markdown
# pages/why-local-first-wins.md
---
title: why local-first wins
status: refined          # captured | refined
tags: [local-first]
---
The source idea.
```

```markdown
# publish/instagram/bradencodes/posts/why-local-first-wins/post.md
---
page: why-local-first-wins
---
The platform caption.
```

The source note owns private editorial status. The publish artifact owns the
destination because of its folder path and links back with `page:`. Format is
derived from files in the post folder: `deck.marp.md` present means carousel or
video storyboard; no deck means text-only. After shipping, record concrete event
facts on `post.md`:

```yaml
published_at: 2026-06-08T12:00:00-05:00
url: https://instagram.com/...
```

There is no `status: draft` or `stage: ready` in the hand-authored vault shape
until a real queue, calendar, or automation consumes it.

The conceptual ramp is still captured -> refined -> composing -> published.
Only captured/refined are written on authored notes. Composing/published are
derived from linked publish artifacts.

---

## Render

```
  carousel  Marp CLI renders the slides -> one PNG per slide.   (build FIRST)
  video     Remotion composition: same content + voice -> MP4.  (build LATER)
            server-only + DISPOSABLE: re-render anytime from the markdown; never self-host the file.
```

Carousel first because it beats video on saves/shares (2026 data, per The Ark). Video
is a later renderer over the same source.

---

## Post

```
  v0 (this week)  render to a folder, you upload manually.  -> you are POSTING. done.
  v1              `epicenter post draft.md` renders + stages the files for upload.
  v2              platform APIs (IG/TikTok): auto-post + schedule.
```

---

## MVP, build this first (it is one script)

```
  epicenter post draft.md
    -> Marp renders draft.md  ->  out/slide-1.png ... slide-N.png
    -> you upload them.  that is the whole MVP.
```

Crude on purpose. It gets you posting THIS WEEK. Everything else is an increment on a
thing that already works.

---

## Increments, in order (stop anywhere; each is useful)

```
  1. Marp carousel render + manual upload          <- the MVP, do this now
  2. Whispering capture -> draft scaffold          (a voice note becomes a draft .md)
  3. Remotion video render (server-only, disposable)
  4. Platform APIs: auto-post + schedule
  5. LATER: the per-user platform / publish-to-web blog / app ecosystem (other spec)
```

---

## Where the money is (and isn't)

The PLATFORM (per-user instances, app ecosystem) has no clear revenue and real cost.
The CONTENT TOOL does: creators already pay for Descript / Opus / Buffer. So "where is
the money" redirects priority toward THIS pipeline, not the platform.

```
  FREE / cheap     capture (Whispering, BYO key), local drafts, manual export.
  SUBSCRIPTION     the END-TO-END workflow: hosted sync, auto-render, scheduling,
                   multi-platform post, analytics, custom-domain blog.
  METERED CREDITS  the expensive compute: AI transcribe/polish, Remotion VIDEO renders.
                   pay for what you burn (Autumn already meters this).
  SELF-HOST        the escape valve: run it yourself, own keys/compute. NOT lost revenue
                   (those users would not pay anyway) + goodwill + the privacy story.
```

Cost-alignment win: CAROUSEL is both the best-engagement format AND the cheapest to
render (images, not video). Lead with carousel = better product AND cheaper to serve.
Video is the cost center, so it MUST be metered or it bleeds money.

The wedge you ALREADY own: Whispering users record themselves daily. "Turn that into a
post" is a built-in funnel, you do not hunt for creators from scratch. The anti-slop /
amplify-the-human angle is differentiation in a slop-flooded market AND keeps render
cost low (no expensive gen-AI image/video).

Bill the WORKFLOW + COMPUTE, never the platform. Per-user instances are cheap substrate
(idle DOs ~free), not the product. People pay to POST EASILY, end to end.

## Grounding (from The Ark, `20260602T235900`)

- CAROUSEL is primary (beats video on saves/shares per 2026 data). Carousel first.
- Video is NEVER self-hosted; the platform hosts the upload. Remotion output is
  disposable, re-derive from the markdown.
- AI line: amplify the human, never fabricate. Voice-clone-your-own-voice + writing AI
  are allowed; image AI is BANNED; default-deny.
- Source of truth = the markdown (+ transcript + voice). Everything renders from it.

This spec is the execution core of The Ark. It deliberately ignores the platform so you
can post NOW; the platform waits until posting is a habit and you know what you need.
