# Epicenter Is a Local-First Creative Operating System

Epicenter is a local-first creative operating system.

That sentence is the center of the product vision. Epicenter is not just a transcription app, a text-polishing shortcut, a writing surface, or a publishing tool. Those are all apps inside the same operating model.

The operating model is simple:

```txt
Capture gets raw material in.
Refine makes small pieces usable.
Compose turns pieces into artifacts.
Publish sends artifacts into the world.
```

The earlier version of this idea was:

```txt
Capture -> Transform -> Deliver
```

That is still useful for small workflows. Whispering records audio, transcribes it, transforms the text, then copies or pastes the result somewhere. Polish grabs selected text, changes it, then replaces the selection.

But the larger ecosystem needs a stronger vocabulary. `Transform` is too broad because a sentence cleanup and a full article draft are both technically transformations. `Deliver` is too small because publishing is not just output. Publishing has accounts, previews, formats, destinations, external URLs, draft state, live state, retries, and updates.

The clearer model is:

```txt
Capture -> Refine -> Compose -> Publish
```

```txt
Epicenter Creative OS

+-------------+    +-------------+    +-------------+    +-------------+
|  Capture    | -> |   Refine    | -> |  Compose    | -> |  Publish    |
|             |    |             |    |             |    |             |
| raw inputs  |    | better      |    | finished    |    | external    |
| enter       |    | pieces      |    | artifacts   |    | outputs     |
+-------------+    +-------------+    +-------------+    +-------------+
```

## The Four Stages

Capture is how raw material enters Epicenter.

```txt
Capture
  Whispering     speech -> transcript
  Clipper        web page / quote / selection -> capture
  Importer       PDF / doc / file -> capture
  Inbox          quick note / pasted thought -> capture
```

Whispering belongs here, but Whispering should not be renamed to Capture. Capture is a stage. Whispering is a capture-heavy app.

Refine is how a small piece becomes clearer, cleaner, or more useful.

```txt
Refine
  Polish         selected text -> cleaner text
  Extract        transcript -> tasks / claims / quotes
  Rewrite        paragraph -> tone / length / audience
  Clean          dictated text -> readable prose
```

This is where the old transformation layer lives. The internal words can still be `recipe`, `run`, `step`, and `runner`, but the product stage should be Refine. Refine is broader than Polish and clearer than Shape.

Compose is how many pieces become a larger artifact.

```txt
Compose
  Fuji           captures + refined pieces -> article / essay / brief
  Outline        notes -> structure
  Draft          outline + sources -> draft
  Script         ideas + excerpts -> video / podcast script
```

Polish should not become the place where full articles are born. Polish improves local material. Fuji composes larger meaning.

Publish is how finished artifacts leave Epicenter.

```txt
Publish
  The Ark        artifact -> destinations
  Broadcast      artifact -> social / newsletter
  Sync           artifact -> Notion / GitHub / Linear / wiki
  Export         artifact -> Markdown / PDF / email / clipboard
```

Publishing is bigger than delivery. Delivery can be a primitive, like paste into focused app or copy to clipboard. Publish is the product stage that owns destinations, formats, accounts, previews, scheduled state, and live state.

## Apps Have Home Stages

The point is not to build one app per stage. The point is to give each app a home stage while letting it embed capabilities from the others.

```txt
                    Epicenter Workspace
          identity, local data, sync, permissions, history

+-----------------------------------------------------------------+
|                         Shared Core                             |
|                                                                 |
|  capture records   refine recipes   artifacts   publications    |
|  source refs        runs/history      sections    destinations   |
+-----------------------------------------------------------------+

        |                  |                  |                  |
        v                  v                  v                  v

+-------------+    +-------------+    +-------------+    +-------------+
| Whispering  |    |   Polish    |    |    Fuji     |    |  The Ark    |
| capture app |    | refine app  |    | compose app |    | publish app |
+-------------+    +-------------+    +-------------+    +-------------+
```

Whispering should feel like a complete app. It owns recording, audio files, transcription providers, transcript history, and voice-specific defaults. But once it has text, it should call the shared refine runtime.

```txt
Whispering
  record audio
    -> transcribe
    -> refine with "Clean dictated text"
    -> paste, copy, save, or send onward
```

Polish should feel like a complete app too. It owns the selected-text shortcut, the refine picker, previews, saved recipes, and recent runs. But it can read captures from Whispering and send finished pieces into Fuji.

```txt
Polish
  capture selected text
    -> run refine recipe
    -> replace selection

Polish
  open latest transcript
    -> extract tasks
    -> send to Fuji
```

Fuji owns composition. It should be where captures, excerpts, notes, outlines, and sections become artifacts.

```txt
Fuji
  gather captures
    -> arrange excerpts
    -> write outline
    -> draft artifact
    -> send to The Ark
```

The Ark owns publishing. It should not be a separate app for every destination. It should be a publish surface with connector-style destinations.

```txt
The Ark
  publication manager

  destinations:
    Substack
    Medium
    Ghost
    Webflow
    Markdown
    PDF
    Email
    GitHub
    Notion
```

## Monolithic UX, Composable Core

The right split is not one giant super app and not dozens of tiny apps.

The rule:

```txt
Data model: composable
Runtime: composable
User experience: focused apps
Integrations: plugins inside the app that owns the workflow
```

That gives Epicenter focused surfaces:

```txt
Whispering -> capture speech
Polish     -> refine text
Fuji       -> compose artifacts
The Ark    -> publish artifacts
```

And it gives the system shared objects:

```txt
CaptureRecord
RefineRecipe
RefineRun
Artifact
Publication
Destination
```

The core should be extremely composable. The apps should not feel like primitives. A user should open Whispering and understand that it is for voice. They should open Polish and understand that it is for selected text and small-unit refinement. They should open Fuji and understand that it is where bigger pieces get assembled. They should open The Ark and understand that it is where finished work goes live.

The internals can compose freely.

```txt
Whispering lives in Capture
  but embeds Refine to clean transcripts
  and embeds Publish primitives to paste or export

Polish lives in Refine
  but embeds Capture to grab selected text
  and embeds Publish primitives to replace selection

Fuji lives in Compose
  but embeds Refine for paragraph-level editing
  and reads from Capture history

The Ark lives in Publish
  but may embed Compose to generate destination-specific variants
```

## The Ark Boundary

The name `The Ark` can work if the app is about carrying finished artifacts safely into multiple destinations. The metaphor is good for a publisher: collect the finished thing, preserve it, and send it out.

But the boundary matters. A social-media-only app and a publish-everywhere app are not the same product.

If The Ark is social only, it should own:

```txt
social accounts
threads
post variants
scheduling
engagement status
```

If The Ark is publish everywhere, it should own:

```txt
publication records
destination connectors
format conversion
previews
draft vs live state
canonical URLs
sync status
failed publish retries
updates to existing posts
```

Those two can share a lot of infrastructure, but the stronger long-term boundary is publish everywhere. Social is one destination family inside The Ark, not the whole app.

```txt
                     The Ark

+----------------------------------------------+
| Publish Queue                                |
| Drafts, scheduled posts, live status, errors |
+----------------------------------------------+
                     |
                     v
+----------+----------+----------+----------+----------+
|Substack  | Medium   | Social   | Webflow  | Markdown |
|connector |connector |connector |connector |exporter  |
+----------+----------+----------+----------+----------+
```

Separate destination apps would duplicate too much. Substack, Medium, Ghost, Webflow, Markdown, and social posting all need the same basic publish lifecycle: preview, account, format, schedule, send, retry, update, record external URL.

The better shape is:

```txt
The Ark is the app.
Destinations are connectors.
Social is a connector family.
```

If social later becomes rich enough to deserve its own focused surface, it can become a sibling app that still uses the same publish core. Start with The Ark as the publish app because the shared lifecycle is the stronger abstraction.

## Data Boundaries

Because Epicenter is local-first, the sync boundary matters. A single giant document would maximize visibility, but it would also make every app hydrate history it may not need.

The better split is one owner per kind of data, with references across boundaries.

```txt
workspace root doc
  app registry
  shared commands
  lightweight links

capture docs
  capture records
  source metadata
  transcript refs

refine doc
  recipes
  steps
  runs

compose docs
  artifacts
  outlines
  sections
  source refs

publish docs
  publications
  destinations
  external state
```

Composition happens through IDs and references, not by loading everything into every app.

```txt
RefineRun
  id
  recipeId
  inputRef
    doc: capture
    table: transcripts
    id: transcript_123
  outputText
  createdAt

ArtifactSection
  id
  artifactId
  sourceRef
    doc: refine
    table: runs
    id: run_456
```

The durable rule:

```txt
If users need to browse it across apps, it can live in a shared doc.
If one app owns it, keep it in that app doc.
If another app only needs to point at it, use a reference.
```

## The Vision

Epicenter is a local-first creative operating system.

Capture gets raw material in. Refine makes small pieces usable. Compose turns pieces into artifacts. Publish sends artifacts into the world.

Whispering is not the whole system. It is the first capture app. Polish is not the whole system. It is the first refine app. Fuji is the composition surface. The Ark is the publishing surface.

The product should feel like a small set of focused apps. The platform underneath should be made of composable primitives. That is the balance: monolithic enough to feel understandable, composable enough that every app can borrow the others when the workflow calls for it.
