# Everyone gets their own Epicenter

Status: OPEN DRAFT, vision. The settled shape of the long-term architecture. The
hard security details for UNTRUSTED third-party apps are deferred to the back and
compressed; they only matter once we open the registry to strangers.

Date: 2026-06-02

---

## The vision in one paragraph

Every user gets their own Epicenter: a cheap, private instance in the cloud that
holds their data, plus a UI made of small apps. Apps are static single-page bundles;
data lives in the user's own instance; you log in and your apps sync against your
data. Self-host is the exact same thing on your own machine. One product, two ways
to run it.

```
                       you open  braden.epicenter.so
                                 │
                                 ▼
                   ┌──────────────────────────┐
                   │   ROUTER  (one Worker)    │  checks who you are, sends you to
                   │   handle -> your instance │  YOUR instance. stateless. nothing else.
                   └──────────────────────────┘
                       │                    │
            static     │                    │ your live data
                       ▼                    ▼
     ┌─────────────────────────┐   ┌──────────────────────────────┐
     │  R2 / Static Assets     │   │  YOUR INSTANCE                │
     │  - app bundles (code)   │   │  = a Durable Object running   │
     │  - your big files       │   │    ONE Hono app + your SQLite │
     │    (audio, images)      │   │  + one DO per synced doc      │
     └─────────────────────────┘   │  sleeps when idle (~free)     │
                                    └──────────────────────────────┘
```

Three pieces, that is the whole system:
- ROUTER: one tiny stateless Worker. `braden.epicenter.so` -> Braden's instance.
- R2 / STATIC ASSETS: dumb files. App CODE + your big BLOBS. Free egress, edge-cached.
- INSTANCE: a Durable Object running the Hono app + your data. Your cloud machine.
  Idle instances hibernate to ~zero cost.

---

## Is this JAMstack? Yes, and that is the boring part.

Static SPA from a CDN (the M + J) + a dynamic API (the A) = textbook JAMstack. The
ONLY twist is the API is a per-user instance, not one shared backend. That twist is
why it scales cheaply (static = free egress, DO = scale-to-zero). But "it is JAMstack"
is just reassurance that the serving model is standard and proven. It is NOT the bet.
The bet is per-user instances + data-living-in-the-app. Do not mistake the boring
proven part for the interesting part.

---

## The taste discipline (READ THIS BEFORE BUILDING ANYTHING)

The danger of this whole document: it is ALL plumbing, and none of it is the product.
A writer does not want an "instance," a "workspace id," a "subdomain," or a
"capability token." They want to write, capture, and think, fast, and trust that their
words are theirs and never lost. The architecture earns its place ONLY by being
invisible.

```
  WHAT THE USER SEES                 WHAT THEY MUST NEVER SEE
  sign up, it just works             "instance" / "Durable Object"
  their stuff is there, everywhere   subdomain setup, workspace ids
  works offline, feels instant       capability tokens, custom protocols
  "my data is mine"  (a feeling)     registry, manifests, the #platform seam
  great apps (Whispering first)      any setup step, any plumbing word
```

If any plumbing word reaches the UI, we failed. Auto-assign the subdomain from their
name, create the default workspace silently, pre-install the flagship app. Zero setup.

The honest risk, stated plainly: this architecture is the EASY part and the cheap
part. The product is the APPS and how writing/capturing FEELS. Platform-building must
not displace product-building. The per-user instance + 1-3 genuinely great canonical
apps is the whole mainstream play. The registry / marketplace / installable shell /
untrusted third-party apps are an UNPROVEN ecosystem bet; they get zero engineering
until the core apps have pulled real users. Build the invisible instance, make
Whispering and the writing surface delightful, ship that. Everything else waits.

---

## Two kinds of URL (this is the part that confuses people)

The SUBDOMAIN decides whose DATA. The PATH decides which CODE.

```
  braden.epicenter.so                 = Braden's instance. Braden's data. Private to Braden.
  braden.epicenter.so/apps/whispering = Braden's data, viewed through the Whispering app.
  alice.epicenter.so/apps/whispering  = Alice's data,  same Whispering code.
  whispering.epicenter.so             = neutral app URL: routes EACH visitor to THEIR OWN instance.
```

So you do NOT hand out your personal subdomain for other people to get their own
data. You PUBLISH an app (the code); each person runs it on THEIR instance and sees
THEIR data. The instance subdomain is always "whose data," never shared.

Naming rules:
- Use the handle subdomain `braden.epicenter.so`, never the raw `<userId>.epicenter.so`.
- The handle is a chosen alias; internally it maps to a permanent userId, so renaming
  the handle never breaks the data.
- Subdomain beats a path because each instance gets its own browser ORIGIN for free
  (matters the moment you load someone else's app).
- Custom domains (`braden.com`) = later add-on: a CNAME the router resolves
  `domain -> userId`. Same machinery.

---

## Whose instance can you open? (private by default)

```
  you are Braden, you open ...

  braden.epicenter.so/...   -> your instance. allowed. it's yours.
  alice.epicenter.so/...    -> Alice's instance. DENIED by default.
                               (bounce to "request access", or to your own instance.)
  whispering.epicenter.so   -> neutral. routes YOU to YOUR instance. (a convenience
                               launch link; same destination as braden.epicenter.so/apps/whispering)
```

The rule that avoids over-engineering: an instance is PRIVATE by default. Hitting
someone else's subdomain gets you nothing unless they explicitly shared. We do NOT
build automatic cross-user access (that is a security hole, not a feature). "Natural
sharing" is real but OPT-IN and LATER: Alice can share specific docs/apps with
specific people or publicly. So:

```
  default            your instance is private to you
  opt-in (later)     share a doc/app with named people or publicly
  neutral app URL    just a login-redirect convenience to "run this app on MY data"
```

The neutral URL is not a third thing to build; it is a shareable link that, after
login, lands you on your own instance. v1 can skip it: log in -> your instance ->
open apps there.

---

## The registry, and how an app actually loads

A REGISTRY is just: built bundles in R2 + a manifest table (name, version, content
hash, entry file). The BUILD runs once at publish time; you publish a BUILT bundle
(a `dist/` zip), never source. Nobody builds at install time.

```
  author:   vite build -> dist/      (build runs HERE, once)
  publish:  upload dist/ zip to R2  +  add a manifest row {name, version, hash}
  REGISTRY = R2 (the bundle bytes) + manifest table (what exists)
```

Two ways the same bundle loads, web vs desktop:

```
  WEB (online):
    open braden.epicenter.so/apps/whispering
      -> Worker streams the bundle's files straight from R2 (free egress, edge-cached)
      -> SPA boots in the browser, logs into your instance, syncs. nothing stored.

  DESKTOP (offline-capable):
    "install" in the Tauri shell:
      1. download the bundle zip from R2
      2. extract to local disk: appDataDir/apps/<id>/<version>/   (PERMANENT, not temp)
      3. serve it to the webview via a custom protocol -> stable origin app://<id>/
      4. boot it; it talks to the LOCAL instance for data
    => works fully offline (code on disk + data on disk); the stable per-app origin
       means its IndexedDB persists across launches.
```

So on the web nothing is stored (load-from-R2 each time, always latest). On desktop
"install" = download + extract to disk + serve locally (kept until you uninstall).
Canonical / first-party apps can be SHIPPED inside the desktop binary so they work
on first launch offline; everything else downloads on demand.

Default apps: every new instance ships with a SMALL default set pre-installed (the
flagship, e.g. Whispering) so it is not empty on day one. Everything else is opt-in
from the catalog, and pre-installed ones are removable. Not all canonical apps for
everyone (clutter); not empty (cold start). Pre-install 1-3, the rest is choice.

---

## Workspace identity and sharing (how app and data decompose)

An app is CODE. A workspace is DATA. They are DECOUPLED: an app opens one or more
workspaces by a LOGICAL id, and the same workspace can be opened by many apps.

```
  logical id            what it is                       example
  <appId>               the app's default workspace       epicenter.whispering
  <appId>/<name>        more app-private workspaces        epicenter.whispering/transcripts
  shared/<name>         platform-shared, well-known        shared/contacts, the wiki
```

App-id format = `<publisherHandle>.<app>` (reverse-DNS-ish), e.g. `epicenter.whispering`,
`braden.cooldash`. Why publisher-scoped and not bare `whispering`: the handle namespace
is ALREADY globally unique (it is the instance subdomain), so `<handle>.<app>` is
collision-free WITHOUT a second registry, and a third party in Phase 3 can mint
`braden.notes` without fighting Epicenter's `epicenter.notes`. The handle does double
duty: instance address AND app-publisher namespace. One unique namespace, two jobs.
Pay the tiny verbosity now (it is the storage id, the UI shows a friendly name); it
avoids a painful retrofit when Phase 3 opens. Bare `whispering` is just UI shorthand
for `epicenter.whispering`.

Guaranteeing publisher uniqueness: you do NOT build a new system. You already enforce
unique HANDLES at signup (for the subdomain). That same check IS the publisher
registry, `<handle>.<app>` is unique because `<handle>` is. Within your own handle you
name your apps freely. Do NOT build domain-verification reverse-DNS (`com.example`);
that is overkill the handle already solves.

Under the hood the Yjs doc guid is DERIVED: `guid = hash(ownerUuid, logicalId)`.
- deterministic: same logical id always resolves to the same doc (re-open = same data)
- per-instance unique: same app in two users' instances -> different guids -> isolated
- no manual GUIDs, no central GUID service. (matches the existing derived-guid pattern.)

Sharing is a FEATURE, not an accident:
- two apps opening the SAME logical id share the SAME doc and auto-sync. That is the
  whole point (a dashboard reading `whispering/transcripts`, capture apps writing the wiki).
- accidental collision is impossible because every app's defaults live under its
  registry-unique `<appId>`. You touch another app's data ONLY by naming its id.

Collision authority is CENTRALIZED at the REGISTRY: app ids are globally unique there
(like npm names), so `<appId>/...` is collision-free by construction. v1 = Epicenter
assigns ids.

Caveat, cross-INSTANCE collaboration: a guid derived from one owner's uuid cannot be
shared across owners. A workspace Alice + Bob both edit needs a MINTED guid recorded
in a shared room. That is the explicit-sharing case; defer it (it is the only place
you need a real GUID instead of a derived one).

---

## Desktop = one shell = self-host on your laptop

There is ONE Epicenter desktop app (Tauri). It is not one-app-per-binary. It is a
shell that INSTALLS SPA bundles locally and runs your instance on your machine.

```
  Epicenter desktop (Tauri)
    ├─ installs SPA bundles to disk, serves each from a stable origin (app://<id>/)
    ├─ runs your INSTANCE locally = the daemon: the SAME Hono app as a bundled
    │  sidecar (Bun) + local SQLite. apps talk to it over localhost.
    └─ native powers for apps that need them (mic, files, hotkeys)
  => fully OFFLINE: app code on disk + data in the local daemon; syncs to your
     cloud instance when reconnected.
```

How the local instance runs (RESOLVED by grilling, de-scoped):
- v1 desktop = the WEB APP IN A TAURI WINDOW + a native bridge for Whispering. It
  uses the SAME browser data layer the web already uses (y-indexeddb + sync to your
  cloud instance). NO sidecar. This is what already works today; the desktop is just
  a window with native powers.
- LATER (offline-authoritative on device): ship the Hono daemon as a Bun SIDECAR so
  the laptop holds the authoritative local instance + local SQLite. Cost: bundle Bun
  (~tens of MB) + sidecar lifecycle (spawn/kill/restart, pick a free port, sign the
  binary). Only needed when "fully works offline against a local source of truth"
  becomes a requirement. Do not build it for v1.

Grilled details to honor when it IS built:
- Installed apps need distinct, STABLE ORIGINS for isolation + persistent IndexedDB:
  use a custom scheme with per-app HOSTNAMES (app://<id>.localhost/), NOT shared
  paths under one origin. Verify storage partitioning per-OS (macOS vs Win/Linux
  custom-scheme origin handling differs). A localhost HTTP server is the fallback.
- Hash-pin + sign bundles: the manifest records each bundle's content hash and is
  signed; the shell verifies the download before extract/run, so a compromised CDN
  cannot serve malicious code. True even for first-party.
- The custom-protocol origin contains an app from OTHER apps' data and the web, but
  NOT from the native bridge: gate native commands PER-APP, never expose them globally.

This is the offline story, and it doubles as self-host: the desktop app IS a
self-hosted instance on your laptop with a UI to install and launch apps. One shell
hosting many apps beats bundling one app per binary (fewer binaries, independent
updates, real offline).

Whispering-class apps that need deep OS hooks (system audio, global hotkeys) either
get those via the shell's native bridge or, if that is not enough, ship as their own
dedicated Tauri build that still syncs against the same instance.

---

## Self-host maps 1:1

```
  MANAGED                          SELF-HOST
  your DO running the Hono app  ↔  the SAME Hono app as a local process
  R2 (app code + big files)     ↔  a local folder (or your own object store)
  router Worker -> your DO       ↔  not needed (you ARE the only instance)
  braden.epicenter.so           ↔  localhost or your own domain
  install = upload to R2         ↔  install = drop the bundle in your apps folder
```

User story (install an app, open it, it syncs) is identical. Only "where the files
live" differs, behind one storage seam. Epicenter already has this seam: `#platform/*`
subpath-import platform DI. That is why managed and self-host are one product.

---

## Grounded facts (verified against Cloudflare + Hono docs)

```
  R2 egress              FREE. static-asset serving free + unlimited + edge-cached.
                         -> serving SPA bundles this way is among the cheapest possible.
  Durable Object         10 GB SQLite | 128 MB mem | 30s CPU/req (up to 5min) | UNLIMITED instances
  one-DO-per-user        an officially recommended pattern (per-entity / per-user data)
  Hono inside a DO       works; construct the app once in the DO constructor, reuse per request
  idle instances         hibernate to ~zero compute; you pay storage (+ R2 for blobs, free egress)
```

Two things a DO is NOT, so do not ask it to be them:
- NOT a CDN: serve static from R2 / Static Assets, never from the DO.
- NOT a compute box: heavy work (transcription, embeddings) runs client-side or in
  the AI proxy / a Container, never in the DO. Keep WebSocket Hibernation ON so idle
  synced clients do not pin the DO in memory.

---

## Deferred: opening the registry to UNTRUSTED third-party apps

Everything above assumes your own / first-party apps (you trust what you install,
like apps on your computer). When you let strangers publish apps that run against
your data, the hard part activates. Compressed, because it is later:

```
  - untrusted apps load from an ASSIGNED, content-addressed sandbox origin
    (<hash>.usercontent.epicenter.so, the googleusercontent pattern), NOT your instance origin
  - they get a SCOPED pass (OAuth 2.1 + PKCE; a read cap IS a leak cap, so also a CSP
    egress lock so the app can only talk to your relay)
  - they write only their OWN docs; promotion into canonical data goes through a
    trusted transform you approve
  - native powers (mic/files/hotkeys) are first-party / installed-and-signed only
```

This is real work and real risk, and it serves ONE unproven feature (a third-party
app ecosystem). Build the trusted-app vision first; flip this on only if demand shows.

---

## Relationship to prior specs (reconciled, not contradicted)

- `20260601T121456` portable-SPA same-origin ("serve apps at one origin, cookie auth,
  NOT branded subdomains, OAuth only for cross-origin"): RECONCILED. The per-user
  subdomain is the INSTANCE origin; within it, v1 first-party apps still share that
  one origin with cookie auth, exactly as that spec wants. Separate per-app origins
  return only for UNTRUSTED apps (deferred). So this extends it, it does not reverse it.
- `cloud ownership` ("an org is a separate deployment, not an in-app entity"): HOLDS.
  per-user instance = a partition framed as "your machine"; org / self-host = a real
  deployment. Same seam (`personal()` / `shared({admit})`).
- `vault read-only projection` (`20260602T200000`): unchanged; the vault is still a
  read-only markdown projection of the instance's Yjs.

## App structure and composition (the maintenance-burden answer)

The maintenance burden is mostly self-inflicted: each app is treated as a full
project (its own sync, auth, build, data shape). That is N x the work. The asymmetric
win is FAT SUBSTRATE, THIN APPS.

```
  SUBSTRATE (maintained ONCE)   instance + sync + storage + auth + offline +
                                materialization + a shared UI kit + the app manifest
  AN APP (cheap, ~a few files)  a SCHEMA (defineTable/defineKv)
                                + ACTIONS (the validated mutation API)
                                + a UI (Svelte, on the shared kit)
                                + a manifest (id, name, which workspaces)
```

If adding an app is four files, you can have many. If adding an app is a project, you
drown. So: refuse per-app substrate; force every app onto the shared one. That single
rule is the maintenance win.

Composition = a PIPELINE over the one data format (the format is the bus):

```
  CAPTURE            ORGANIZE              PUBLISH
  Whispering   ->    wiki / writing app -> The Ark
  tab-manager        (edit/curate)         (share/distribute)
        \_______________ one data format _______________/
        every stage is a thin view/transform; none reimplements another's job.
```

So Whispering is not "the main app and that is it." It is the CAPTURE wedge (voice ->
text, the mainstream entry). The writing/wiki surface is the ORGANIZE middle and
should be GENERIC (serves you and others, and is what other apps build on), not a
Braden-specific tool. The Ark is the PUBLISH stage: it composes via the format but is
a SEPARATE product bet (social), do not conflate building it with building the
platform. They share the data bus; they are not one app.

The canonical-vs-personal gradient (the key product principle):

```
  CAPTURE ---------- REFINE ---------- CURATE/ORGANIZE ---------- PUBLISH
  universal          mostly universal   DEEPLY PERSONAL            varies
  (voice->text)      (clean up)         (your way of thinking)
  -> build CANONICAL                    -> do NOT build "the one true note app"
```

The closer to capture, the more universal and canonical. The closer to curation, the
more personal, and nobody agrees on it. So build capture+refine canonical (the wedge),
and for curation either (a) be the LAYER UNDER existing markdown tools (your data
materializes to markdown; curate in Obsidian/whatever; you build no note app), or
(b) ship a FLEXIBLE curation system (the wiki/types model) where your personal setup
is just a config and others bring their own. "Note-taking is personal" is the argument
AGAINST a canonical note app and FOR being the layer beneath it.

Viable product NOW is the front of the pipeline, NOT the platform: Whispering capture
that PERSISTS, syncs, and materializes to markdown. No SPA-hosting, no registry, no
marketplace. Capture-that-lasts is the product; the platform is Phase 3.

The app lineup, by pipeline stage:
```
  CAPTURE (canonical, named, default-installed)
    Whispering = voice -> text       Clip = browser/web capture (the extension)
    Polish     = refine/clean transform (a STAGE/action, may not be a standalone app)
  EDIT / CURATE (personal, alternatives, you pick, all write to markdown)
    Honeycrisp, OpenSidian, your own note apps. NOT "one canonical note app", they are
    interchangeable surfaces over the same format. Ship 1-2, let the open format invite more.
  PUBLISH (below)
```

## Publishing: one marked source, two kinds of destination

Publishing is the pipeline's end, and ONE contract drives it: a note in the format
marked publishable via frontmatter/trait (the existing `publishable` trait), carrying
its destinations. One source, two DESTINATION KINDS:

```
  OWNED (we host it)        a blog/site: marked markdown -> static HTML -> served from
                           R2 at <handle>.epicenter.so (or a custom domain). Effortless:
                           mark a note -> it is live. Cheap (free egress). The ONE thing
                           that gets a real public URL. YES host their blog, it is the
                           natural OUTPUT of a second brain.

  BORROWED (platforms host) social: the SAME marked content -> RENDERED into platform
                           formats (Marp -> carousel, Remotion -> video) -> pushed/handed
                           to IG / TikTok / etc. We do NOT host video; the platform does
                           (matches The Ark). A render+export pipeline. Bigger, LATER.
```

Same source, different renderers: the blog is a static render (easy, build soon);
social is a Marp/Remotion render (hard, The Ark's domain, build later). You never build
"a blog app" and "a social app" with separate content models, both consume the same
marked markdown.

The tight viable loop: CAPTURE (Whispering) -> persists as markdown -> PUBLISH a blog
(mark -> live). Capture-to-blog is a complete, shippable story using only cheap pieces
(Whispering + markdown + static hosting). Polish, Clip, alternative note apps, and
social export all hang off this loop later.

## Two DIFFERENT goals, do not conflate them

```
  GOAL A: build a PRODUCT for users   -> capture-to-blog wedge first; platform is Phase 3.
  GOAL B: Braden POSTS videos/content  -> a knowledge-wiki does NOTHING for this.
          the bottleneck is the RENDER+POST step (markdown draft -> Marp carousel /
          Remotion video -> IG/TikTok). capture + drafting already work TODAY.
```

A knowledge-WIKI (organize your thoughts) is NOT a content-STUDIO (produce posts). For
Goal B the only new thing worth building is the render+post pipeline (= The Ark). A
curation/wiki app is a distraction from posting. If the goal is to post, build the step
that gets content OUT THE DOOR, not the app that organizes notes.

Honest pruning note: there are too many apps to maintain as full projects (Whispering,
Fuji, Honeycrisp, tab-manager, wiki, Ark, zhongwen, opensidian...). Pick the pipeline
(capture -> organize -> publish), make those thin on the substrate, and demote the
rest to reference apps/templates or cut them. Sprawl is the burden; thin-apps-on-one-
substrate is the cure.

## The keystone (the one thing to design first)

The single most underspecified piece that blocks v1 is the STORAGE + SYNC SEAM: the
interface that lets the SAME Hono instance run in a Durable Object (managed), in a
browser/window (y-indexeddb), and standalone (bun:sqlite). Define this port (extend
the existing `#platform/*` DI) and the instance becomes write-once, run-three-ways.
Everything else (router, R2 serving, app loading) is mechanical by comparison. Design
this interface before writing the instance.

## Roadmap: product first, app-hosting later, ONE data format the whole way

The through-line that makes "all-in on product now" and "open app-hosting later"
the SAME effort (not a rewrite) is the open, materializable DATA FORMAT. If every app
you build now reads/writes that format, opening it to other people's apps later is
just "let non-first-party code touch the format you already have." Product work is
never thrown away; it becomes the reference apps and the proof the format works.

```
  PHASE 1 - PRODUCT (now)
    invisible per-user instance + a few GREAT canonical apps (Whispering first).
    every app stores in the OPEN format (Yjs truth -> markdown + SQLite projection).
    zero setup. obsess over how writing/capture FEELS. nothing about apps-as-a-platform.

  PHASE 2 - SELF-HOST (same code, different deployment)
    personal = your instance, we host it (invisible).
    self-host = the same instance on your box.
    instance = one pinned partition (instance()); data syncs down + materializes
               to markdown folders. falls out of the storage/sync seam, not a
               rewrite.

  PHASE 3 - APP HOSTING (only after Phase 1 pulls real users)
    open the workspace API + a registry so people write their OWN SPAs / React
    dashboards ON TOP of their (or a shared) database. data always syncs downward and
    materializes to markdown. THIS is where the sandbox + capability + OAuth machinery
    finally activates, and ONLY for untrusted third-party code.
```

The keystone for all three is one interface: the STORAGE/SYNC SEAM (same instance in
a DO | browser | standalone). Design it once; Phases 1-2 use it directly, Phase 3
adds a sandboxed door in front of it.

Already shipped: per-user DOs, `personal()`/`shared({admit})`, offline (y-indexeddb +
relay), the markdown projection, the `#platform/*` seam. Net-new: the router, the
registry/install path, the desktop shell. The scary security is Phase 3, and only 3.

---

## Canonical apps: the mainstream wedge vs reference apps (and naming)

Not every canonical app is a mainstream bet, and that is fine, they serve two roles:

```
  MAINSTREAM WEDGE   Whispering. solves a clear job, evokes what it does, pulls users.
                     this is where product energy goes.
  REFERENCE APPS     Fuji, Honeycrisp. they prove the data format works and become
                     fork-able TEMPLATES when Phase 3 opens. also your dogfooding tools.
```

The honest test for each app (apply it before investing in polish): say in ONE
sentence what it does and who-other-than-Braden wants it. If you cannot, it is a
reference/dogfood app, not a mainstream one, so do not over-polish it for an audience
that may not exist, but DO keep it as a clean template.

Naming: codenames (Fuji, Honeycrisp) are fine INTERNALLY (packages, repos). A
USER-FACING app must be named by what it does, "Fuji" tells a stranger nothing. So
keep the codename internally and give the user-facing surface a functional name when/
if it graduates from reference app to mainstream. Whispering already passes; the apple
names do not, which is the signal they are reference apps today.
