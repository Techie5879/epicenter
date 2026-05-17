# Hosted Apps With Optional Daemon Extensions

**Date**: 2026-05-16
**Status**: Draft
**Author**: Braden + AI-assisted
**Supersedes**: `20260515T160000-folder-routed-daemon-workspaces-clean-break.md`

## One Sentence

Epicenter apps are hosted UIs that talk to a local core daemon; only apps that need app-specific local work install a daemon extension.

## Overview

This spec pivots app distribution away from source-installed SPAs as the default. A normal user installs Epicenter core once, opens a hosted app, and that app talks to the local core daemon for identity, workspace state, sync, actions, and storage. Source-installed app folders remain as a developer and advanced-user path.

The important split:

```txt
Default:
  hosted app UI
  local core daemon
  no local app source checkout
  no local app build

Advanced:
  source-installed app
  optional daemon extension
  explicit install and upgrade
```

## Product Sentence

Install core once, open a hosted app, keep the workspace runtime local, and install a local extension only when an app needs powers core does not provide.

## Motivation

The previous folder-routed app plan made a full local source package the primary install unit:

```txt
workspaces/fuji/
  daemon.ts
  workspace.ts
  src/
  build/
```

That shape is useful, but it is too heavy as the default user path. It turns app usage into package management: dependency installs, framework-specific builds, build failures, jsrepo registry drift, and support for every app's local toolchain.

The hosted-app model keeps the hard problem in the right place:

```txt
Hosted Fuji UI
  -> local core daemon
  -> local workspace data
  -> hosted sync relay when signed in
```

The hard problem becomes secure hosted-to-local communication. That is product-critical and reusable. Local app builds are still available, but they should not be the main story.

## Vocabulary

```txt
Hosted app
  A static or server-hosted browser UI served by Epicenter Cloud or another app host.
  It owns presentation, navigation, and product workflow.

Core daemon
  The local Epicenter runtime installed on the user's machine.
  It owns local identity, workspace documents, encryption attachment, storage,
  sync, generic actions, the local socket or HTTP bridge, and lifecycle.

Daemon extension
  Optional app-specific local runtime code loaded by the core daemon.
  It owns privileged or long-running work that cannot live in a hosted SPA
  or generic core.

Source-installed app
  A local app package checked out or copied into the project for development,
  internal use, audit, customization, or offline UI serving.
```

## Architecture

Default path:

```txt
┌─────────────────────────────────────────┐
│ Hosted App: Fuji                        │
│ UI, routes, view state, product flows   │
└──────────────────────┬──────────────────┘
                       │ local bridge
                       ▼
┌─────────────────────────────────────────┐
│ Core Daemon                             │
│ identity, workspace docs, storage, sync │
│ generic workspace actions, capabilities │
└──────────────────────┬──────────────────┘
                       │ optional
                       ▼
┌─────────────────────────────────────────┐
│ Fuji Daemon Extension                   │
│ app-specific local jobs, materializers  │
│ privileged effects, local integrations  │
└─────────────────────────────────────────┘
```

Development and advanced path:

```txt
source-installed app
  SPA source served by Vite or built locally
  optional daemon extension loaded by core
  same local daemon protocol as hosted app
```

The hosted app and source-installed app are two UI delivery modes. They should talk to the same core protocol.

## Ownership

```txt
hosted SPA          owns  UI, routing, product workflow
core daemon         owns  local identity, workspace docs, storage, sync, lifecycle
daemon extension    owns  app-specific local background or privileged work
source app package  owns  development source, customization, private apps
hosted sync API     owns  remote relay, auth resource server, account services
```

The app does not expose a daemon. The daemon exposes local capabilities. An app may request an extension when it needs app-specific local capabilities.

## Decision Rules

Put it in core when:

```txt
many apps need it
it belongs to local-first storage, sync, auth, encryption, or lifecycle
the API can be stable and generic
```

Put it in a daemon extension when:

```txt
it does app-specific background work
it touches app-specific local files or materializers
it needs local secrets, local binaries, OS integrations, or long-running workers
it would be unsafe or impossible in a hosted browser UI
```

Keep it in the hosted SPA when:

```txt
it is UI state
it is presentation or navigation
it is client-side transformation over data the browser already has
it does not need local privileged effects
```

Refuse as a default promise:

```txt
every app has a daemon
every app is installed from source
every app must be locally built before use
the core daemon serves every app UI in normal operation
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Default app delivery | 2 coherence | Hosted app UI | Users should not need jsrepo, package installs, or local builds to open an app. |
| Local runtime | 2 coherence | Core daemon | Local-first data, identity, sync, and storage need one installed local runtime. |
| App-specific local code | 2 coherence | Optional daemon extension | Some apps need local powers, but making every app install one would overbuild the common path. |
| Source-installed apps | 2 coherence | Advanced and development path | Source install is valuable for authors, internal apps, audit, customization, and offline UI, but not for normal app use. |
| Daemon static serving | 2 coherence | Remove from the current cleanup | Static serving may return as explicit source-app tooling, but keeping it now leaves the product path ambiguous. |
| `epicenter app build` | 2 coherence | Remove from the current cleanup | Building local app source is developer tooling. It should come back only with an explicit source-app spec. |
| Folder-routed discovery | 2 coherence | Defer | Local extension discovery is still useful, but it needs install, consent, upgrade, and explicit loading rules first. |
| Capability discovery | 2 coherence | Core daemon reports capabilities and extensions | Hosted apps need to know what local abilities exist before enabling app-specific features. |
| Hosted-to-local bridge | Deferred | Needs a dedicated security spec | The bridge is now the important hard problem and should be specified with auth, origin, permissions, and CSRF in view. |

## Capability Flow

Hosted apps should start by asking the local daemon what is available.

```txt
Hosted Fuji loads
  |
  v
connect to local core daemon
  |
  v
GET capabilities
  |
  +-- core supports Fuji workspace type
  |     render normal workspace UI
  |
  +-- Fuji extension installed
  |     enable extension-backed features
  |
  +-- Fuji extension missing
        show install/enable path only for features that need it
```

The capability response should distinguish core capabilities from extension capabilities.

```ts
type LocalCapabilities = {
  core: {
    workspaceDocuments: true;
    encryptedStorage: true;
    sync: true;
    actions: true;
  };
  extensions: Array<{
    id: string;
    version: string;
    routes: string[];
    capabilities: string[];
  }>;
};
```

This shape is illustrative. The implementation should reuse existing daemon list and action manifest concepts where they still fit.

## What Changes From The Superseded Spec

```txt
Before:
  install app source folder
  build SPA locally
  daemon serves /apps/<route>/
  daemon.ts required for every workspace app

After:
  install core once
  open hosted app
  hosted app talks to local core
  daemon extension is optional
  source app folders are advanced tooling
```

Keep from the superseded spec:

```txt
defineDaemonWorkspace or successor for local runtime modules
explicit daemon startup and disposal boundaries
shared workspace openers that browser UI and daemon extensions can compose
folder route validation only if local extensions still use folders
```

Challenge from the superseded spec:

```txt
workspaces/ presence automatically switches daemon mode
daemon serving built SPAs as the main distribution mechanism
daemon.ts required for every app
jsrepo copies whole first-party app folders for normal users
deleting config-as-registry before the hosted app bridge exists
```

## Implementation Plan

### Phase 1: Stop Treating Source Apps As The Default

- [x] **1.1** Update the folder-routed spec status to superseded by this spec.
- [x] **1.2** Rename docs and comments that describe `workspaces/<route>/` as the primary app install path.
  > Current cleanup: reworded retained daemon extension comments and marked the folder-routed spec as historical. Broader docs can be updated when the bridge spec lands.
- [x] **1.3** Remove `epicenter app build` from the current diff instead of reclassifying it.
  > Local app builds are not load-bearing for the hosted default path. Bring this command back only inside an explicit source-app developer workflow.
- [x] **1.4** Do not make `workspaces/` presence automatically replace legacy config until the extension/source-app story is decided.
  > Current cleanup removed the workspace-app discovery and daemon static-app server code rather than wiring it into `epicenter up`.
- [ ] **1.5** Do not delete config-as-registry solely to support the source-app model.

### Phase 2: Specify The Hosted-To-Local Bridge

- [ ] **2.1** Write a dedicated bridge spec covering local origin, auth, allowed hosted origins, CSRF, token lifetime, and user consent.
- [ ] **2.2** Define how hosted apps discover and connect to the local core daemon.
- [ ] **2.3** Define the minimum local capability manifest a hosted app can request.
- [ ] **2.4** Decide whether the bridge uses Unix socket proxying, loopback HTTP, browser extension mediation, custom protocol, or a small local web server.

### Phase 3: Define Core Capabilities

- [ ] **3.1** List the generic workspace APIs hosted apps can rely on without an app extension.
- [ ] **3.2** Decide which existing app-specific actions should become core primitives.
- [ ] **3.3** Keep app-specific materializers, local file importers, and privileged jobs out of core unless at least two apps need the same primitive.
- [ ] **3.4** Add tests around capability discovery and permission failure paths.

### Phase 4: Reframe Daemon Extensions

- [ ] **4.1** Decide whether the current `defineDaemonWorkspace` shape is the right extension contract or whether it needs a clearer name.
- [ ] **4.2** Define extension install, upgrade, and removal semantics.
- [ ] **4.3** Define how an extension declares capabilities without pretending to sandbox arbitrary local code.
- [ ] **4.4** Keep extension loading explicit. `epicenter up` should not silently run new code just because a folder appeared.

### Phase 5: Preserve Source App Development

- [ ] **5.1** Keep a dev loop where app authors can run the SPA locally against the same core daemon protocol.
- [ ] **5.2** Reconsider static serving only inside a source-app developer workflow spec.
- [ ] **5.3** Update packaging only for author/internal workflows, not as the normal app install story.
- [ ] **5.4** Document that source-installed apps are trusted local code and may run arbitrary TypeScript in the user's project.

## Validation

```bash
# Specs and docs no longer teach source install as the default app path.
rg "default.*workspaces/<route>|primary.*jsrepo|primary.*source-installed" specs docs README.md packages apps

# Source-app tooling is still allowed, but named as advanced or dev tooling.
rg "epicenter app build|source-installed|daemon extension|hosted app" specs docs packages apps

# Existing tests still cover any retained extension behavior.
bun test packages/workspace/src/daemon
bun test packages/cli
```

## Open Questions

1. **What is the hosted-to-local bridge?**

   This is the next real spec. The answer determines the security model, browser support, and how much setup a hosted app needs before it can talk to local core.

2. **Should `defineDaemonWorkspace` be renamed?**

   Maybe. If the product word becomes "extension", then `defineDaemonExtension` may be clearer. Do not rename until the extension contract is firm.

3. **Can core expose enough generic workspace API for Fuji without a Fuji extension?**

   That is the first useful test. If Fuji only needs generic document/table/sync primitives, then the default hosted app story is strong. If Fuji needs local Markdown/SQLite materializers immediately, those become optional extension features.

4. **What should happen when an extension is missing?**

   The hosted UI should still load. Features that need the extension can be disabled or show an install path. Missing extension should not make the whole app unusable unless the app truly has no core-only mode.

5. **Do private apps use hosted UI or source-installed UI?**

   Both are valid. Private teams may self-host the UI and extension registry, or source-install the full app. The default public path should stay hosted UI over local core.

## Completion Checklist

- [ ] The default app story is hosted UI plus local core daemon.
- [x] Source-installed apps are documented as advanced, private, or developer workflow.
- [x] Daemon extensions are optional and app-specific.
- [ ] Core owns local identity, workspace docs, encryption, storage, sync, lifecycle, and generic actions.
- [ ] Hosted apps can discover local core and its capabilities.
- [ ] Hosted apps can run without a local app source checkout.
- [x] `epicenter up` does not become an implicit package installer, build runner, or extension loader.
- [x] The old folder-routed source app spec is clearly marked superseded.
