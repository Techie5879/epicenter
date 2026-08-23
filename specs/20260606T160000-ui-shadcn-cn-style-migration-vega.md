# @epicenter/ui Migration to shadcn-svelte 1.x cn-* Style System (Vega)

**Date**: 2026-06-06
**Status**: In Progress
**Owner**: Braden
**Branch**: braden-w/lahore-v2

## One Sentence

Move `@epicenter/ui` from inline-Tailwind component styling to shadcn-svelte 1.x semantic `cn-*` classes backed by the vendored Vega style sheet, so component markup matches upstream and is trackable again, while Epicenter customizations move into a single overlay layer.

## How to read this spec

```
Read first:        One Sentence, Current State, Target Shape, Implementation Plan, QA Checklist
Read for model:    Research Findings, Design Decisions, Architecture
Read when stuck:   Edge Cases, Open Questions
Track progress:    Implementation Plan checkboxes, Deferred Cosmetic Ledger
```

## Overview

`@epicenter/ui` is a hand-maintained fork frozen at the pre-1.0 inline-Tailwind generation of shadcn-svelte (with bits-ui v2 and the new-components wave backported). Upstream 1.x relocated all component styling out of the markup into per-style CSS files (`style-vega.css`, `style-luma.css`, etc.) where components carry semantic hook classes (`cn-button-variant-default`). This spec adopts that base, picks Vega (the classic-shadcn preset, `rounded-md`), and isolates every Epicenter customization into one overlay file so future upstream pulls touch markup only.

## Motivation

### Current State

Components carry inline Tailwind. Example (`packages/ui/src/button/button.svelte:13`):

```svelte
variant: {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  destructive: 'bg-destructive shadow-xs hover:bg-destructive/90 ... text-white',
  'ghost-destructive': 'text-destructive hover:bg-destructive/10 ...',  // Epicenter custom
}
```

Problems:

1. **Markup diverges from upstream permanently**: every upstream component fix (a11y, bits-ui, behavior) must be hand-reconciled against inline strings. The README's "regenerate in a scratch project and copy" workflow now silently pulls the cn-* rewrite and breaks.
2. **Customizations are entangled with base styling**: overrides live as extra `cn()` args inside each component, so there is no single place that answers "what did Epicenter change."

### Desired State

Component markup is byte-identical to upstream Vega (`cn-*` hooks). Styling lives in vendored `style-vega.css`. Epicenter deltas live in one `epicenter-overlay.css`. Swapping presets later (e.g. to Rhea/Mira for denser product surfaces) is a one-class change on the app root.

## Research Findings

### The cn-* mechanism is lossless

`cn-*` classes are `@apply` of the same Tailwind utilities, relocated into per-style CSS. Verified against `style-vega.css`:

```css
.style-vega { .cn-button-variant-default { @apply bg-primary text-primary-foreground hover:bg-primary/80; } }
```

Every style defines the full variant + size set. Nothing collapses away.

### Token diff: no color gaps

Upstream base (`shadcn-svelte/tailwind.css`, 89 lines) adds NO colors. Your `app.css` palette is already a superset (includes `--warning`, `--success`). What you lack and Vega's `@apply` rules depend on:

```
@custom-variant data-open / data-closed / data-checked / data-unchecked
                data-disabled / data-active / data-horizontal / data-vertical
@utility no-scrollbar
@keyframes accordion-up / accordion-down
```

### Vega vs the other presets

| Style | Character | Radius | Fit for Epicenter |
|---|---|---|---|
| **Vega** | classic shadcn | rounded-md | matches today; chosen |
| Luma | soft/fluid, macOS-Tahoe | rounded-4xl, open spacing | too airy for dense tools (community shipped Rhea to fix this) |
| Nova / Mira | compact, product-focused | rounded-lg / md | candidate for later if we want density + personality |
| Rhea | compact Luma | rounded-2xl | candidate for later |

Sources: shadcn changelog (Luma), shadcnblocks component-styles post, shadcndesign style-choice guide. **Key finding**: Vega is the low-surprise choice (matches current radius); personality presets (Rhea/Mira) are a later one-class experiment.

### Vega button vs current (the visible deltas)

| | Current (inline) | Vega |
|---|---|---|
| radius | rounded-md | rounded-md (same) |
| focus ring | ring-[3px] | ring-3 (same) |
| destructive | SOLID (`bg-destructive` + white text) | TINTED (`bg-destructive/10 text-destructive`) |
| press | none | `active:not-aria-[haspopup]:translate-y-px` (subtle) |
| icon sizes | custom `size-6/8/10` | native, identical dims |

## Design Decisions

| Decision | Class | Choice | Rationale |
|---|---|---|---|
| Adopt cn-* base | 2 coherence | Yes | Makes markup upstream-trackable; the whole point |
| Preset | 3 taste | Vega | Matches current `rounded-md`; lowest surprise |
| Vendor vs depend | 2 coherence | Vendor `style-vega.css` + base into `src/styles/` | README forbids generator deps; keep package self-contained |
| Apply mechanism | 1 evidence | `.style-vega` class on each app root | Verified: vega.css scopes all rules under `.style-vega {}`; without an ancestor class, cn-* components are unstyled |
| Icon sizes | 1 evidence | Drop custom, use native | Verified Vega dims identical (size-6/8/9/10); 41 call-sites unchanged |
| showCloseButton | 1 evidence | Drop custom, use native | Upstream 1.x dialog-content has it |
| Load-bearing customs | 2 coherence | Carry IN the migrating wave | Unknown tv variant renders unstyled; cannot defer (see Edge Cases) |
| Cosmetic overrides | 3 taste | Defer to polish pass | Graceful degradation; tracked in Deferred Ledger |
| IconPlaceholder | 2 coherence | Strip, keep `@lucide/svelte` | Epicenter convention; upstream multi-icon abstraction unwanted |

## Architecture

### Plumbing (Wave 0)

```
packages/ui/src/
  styles/
    shadcn-base.css       <- vendored upstream tailwind.css (data-* variants, no-scrollbar, keyframes)
    style-vega.css        <- vendored upstream Vega (all cn-* rules, scoped under .style-vega)
    epicenter-overlay.css <- Epicenter deltas (scoped under .style-vega); GROWS each wave
  app.css                 <- @import the three above

each consuming app root (app.html / root mount):
  <html class="style-vega">   <- activates the scoped cn-* rules
```

Invisibility guarantee: until a component emits `cn-*` classes, every rule in `style-vega.css` is inert. Wave 0 changes nothing visually.

### Activation scope (critical)

Button is SHARED. The moment it emits `cn-*` (Wave 1), EVERY consuming app needs `.style-vega` on its root or its buttons render unstyled. Therefore Wave 0 must add the class to ALL consuming app roots before Wave 1 lands.

## Catalog: collapse-vs-carry

```
COLLAPSE INTO NATIVE (delete Epicenter code, call-sites unchanged):
  Button size icon-xs/icon-sm/icon-lg   -> native, identical dims   (41 call-sites)
  Dialog showCloseButton prop           -> native
  input-group-button xs/sm/icon-*       -> native
  (bonus) Button size xs (text)         -> native, newly available

CARRY AS OVERLAY (load-bearing; call-sites pass these by name):
  Button variant ghost-destructive      -> .cn-button-variant-ghost-destructive
  Button tooltip prop                   -> keep markup (Tooltip.Root wrapper)
  Badge variant id / success / status.* -> overlay (+ existing --success token)
  Alert variant warning                 -> overlay (+ existing --warning token)

CARRY (cosmetic, DEFER to polish pass; graceful degradation):
  z-40 layering: dialog/drawer overlay+content (5 sites)
  Select max-w-min
  Resizable gap-2
  Drawer scrollable-children wrapper
  Dialog tall-content scroll (overflow-y-auto max-h)
  Item min-w-0 truncation + relative base
  solid destructive (restore over Vega's tinted, IF desired)

UNTOUCHED (no shadcn-core equivalent; inherit new look internally):
  chat, command-palette, confirmation-dialog, copy-button, emoji-picker,
  file-drop-zone, github-button, light-switch, link, loading, modal,
  natural-language-date-input, pm-command, section-header, snippet,
  star-rating, timezone-combobox, tree-view
```

## Call sites: before and after (Button)

**Before** (`packages/ui/src/button/button.svelte:9`): inline Tailwind tv() block (see Current State).

**After**: same markup/props (href, tooltip, snippet), only the tv() strings change:

```svelte
variant: {
  default: 'cn-button-variant-default', destructive: 'cn-button-variant-destructive',
  outline: 'cn-button-variant-outline', secondary: 'cn-button-variant-secondary',
  ghost: 'cn-button-variant-ghost', link: 'cn-button-variant-link',
  'ghost-destructive': 'cn-button-variant-ghost-destructive',   // carried via overlay
},
size: {
  default: 'cn-button-size-default', sm: 'cn-button-size-sm', lg: 'cn-button-size-lg',
  icon: 'cn-button-size-icon', 'icon-xs': 'cn-button-size-icon-xs',
  'icon-sm': 'cn-button-size-icon-sm', 'icon-lg': 'cn-button-size-icon-lg',
},
```

Base class becomes `cn-button` (plus Epicenter keeps the `tooltip` prop logic untouched).

**Semantic shift to flag**: `variant="destructive"` buttons go from solid red to tinted. See QA Checklist.

## Implementation Plan

### Wave 0: Plumbing (invisible)

- [x] **0.1** Vendor upstream base to `packages/ui/src/styles/shadcn-base.css`
- [x] **0.2** Vendor Vega to `packages/ui/src/styles/style-vega.css`
- [x] **0.3** Create `packages/ui/src/styles/epicenter-overlay.css` (seeded with ghost-destructive for Wave 1)
- [x] **0.4** Import all three from `packages/ui/src/app.css`
- [x] **0.5** Add `class="style-vega"` to every consuming app root (9 roots: 7 app.html + tab-manager sidepanel + landing BaseLayout.astro)
- [~] **0.6** Build-verify one app. STATIC check done (all Vega `@apply` color tokens present in app.css; base deps provided). LIVE build pending: `vite` not runnable in this workspace.

### Wave 1: Button pilot

- [x] **1.1** Rewrite `button.svelte` tv() strings to `cn-*` (tooltip/href/snippet markup unchanged; added native `link` variant + `xs` size)
- [x] **1.2** Add `.cn-button-variant-ghost-destructive` to overlay
- [x] **1.3** Delete inline custom icon-size defs (now native, identical dims)
- [x] **1.4** `bun run check:ui-boundary` passes (exit 0). svelte-check not runnable in this workspace (missing binary).
- [ ] **1.5** Visual QA per checklist below (run an app)
- [ ] **1.6** Build-verify a consuming app (run locally where `vite` is available)

### Wave 2+: Fan-out (DONE via background workflow `wf_c3a8e6d0-58b`)

Migrated all 42 remaining shadcn-core components (migrate + adversarial review per component).

- [x] **2.1** Fan-out: 38 migrated, 3 no-change (collapsible, sonner, spinner had no cn-* styling to adopt), 1 partial (scroll-area: viewport left inline because `cn-scroll-area-viewport` is not in the vendored Vega yet).
- [x] **2.2** Overlay rules applied centrally (agents returned, did not write): Alert `warning`, Badge `id`/`success`/`status.completed`/`status.failed`/`status.running` (verbatim from git HEAD, preserving `[a&]:hover:`).
- [x] **2.3** Fixed all review-flagged BROKEN regressions:
  - switch: added `size` prop + `data-size` (Vega gates all dimensions on it; was rendering zero-size).
  - alert-dialog-content: added `size` prop + `data-size` (max-width was gated on data-size; was spanning full viewport).
  - sidebar-menu-button + sidebar-menu-sub-button: emit `data-active` only when active (`isActive ? 'true' : undefined`); Vega uses presence selectors, so literal `data-active="false"` was styling every row as active.
- [x] **2.4** Verified: vendored `style-vega.css`/`shadcn-base.css` untouched by agents; `check:ui-boundary` passes.
- Non-blocking note: `tabs` editor diagnostic (index.ts re-exporting `tabsListVariants` from a `.svelte`) is the TS-server lagging on `.svelte` type regen; identical to the proven `button/index.ts` pattern and resolved by `svelte-check`.

### Polish pass (after all waves green)

- [ ] Restore deferred cosmetic items from the ledger (decide solid vs tinted destructive, re-apply z-40, etc.)
- [ ] Rewrite README update-workflow section (the scratch-project-copy instruction is now wrong)

## Deferred Cosmetic Ledger

Consolidation pass (commit `1ac35f433`) moved utility overrides into the overlay; the rest stay inline by necessity.

- [x] **Consolidated into overlay** (components now byte-identical to upstream): table-row hover (also FIXED the double-hover regression), select `max-w-min`, resizable `gap-2`, item `min-w-0` (content + title), item-description `text-balance`, item-separator `my-0`.
- [x] **z-40 layering** (dialog/drawer): **REMOVED** (commit `6924abbde`). It was a no-op: Tailwind emits `z-50` after `z-40` (same property, ascending), so with both classes present `z-50` always won. Dialogs were effectively `z-50` already; alert-dialogs sit above via portal/DOM order, not z-index. If a hard z-order guarantee is ever needed, add `@apply z-40!` in the overlay (behavior change, test it).
- [x] **Structural overrides stay in components** (markup, not CSS): drawer scroll wrapper (`drawer-content:39`), item actions overlay, badge `<svelte:element>`, item-media icon, item base `relative` + `[a]:hover:bg-accent/50` (kept inline; ambiguous arbitrary-variant selector, working).
- [x] **Solid vs tinted destructive**: RESOLVED, keep Vega's tinted destructive. No overlay override. Confirmed after building.
- [x] **Dialog tall-content scroll**: moved to the overlay (`.cn-dialog-content { @apply overflow-y-auto max-h-[calc(100vh-2rem)] }`); dialog-content is now byte-identical to upstream.
- [ ] **drawer `onOpenAutoFocus` workaround** (`drawer-content:24`): remove once vaul-svelte ships bits-ui 2.x compat (verify).

### No-op forward-compat hooks (REMOVED, commit `6924abbde`)

Dead `cn-*` hooks the fan-out emitted but the vendored Vega did not define were removed, establishing the **invariant**: every `cn-*` class a component emits is defined in `style-vega.css` or `epicenter-overlay.css` (verified: 247 emitted, 0 undefined). Removed: `cn-font-heading` (3 titles, all consistent now), `cn-menu-target` (select + 2 dropdown), `cn-alert-dialog-footer`/`-action`/`-cancel`, `cn-tabs-list-variant-*`, the `cn-resizable-handle` prefix (handle stays inline; Vega defines only `cn-resizable-handle-icon`), and the undefined input-group-button `sm` size (unused by any app). `cn-scroll-area-viewport` was never emitted (viewport stays inline). If a newer `style-vega.css` later defines any of these, re-add the hooks then.

## QA Checklist (where to look after each wave)

### Wave 1 (Button)

**`variant="destructive"` (solid red -> tinted, HIGHEST priority):**
- whispering: `TextPreviewDialog.svelte:118`, `transformations-editor/Runs.svelte:48`, `recordings/row-actions/EditRecordingModal.svelte:195`
- fuji: `stress-test/+page.svelte:225`

**`variant="ghost-destructive"` (verify overlay matches old look):**
- fuji: `EntryEditor.svelte:47`, `trash/+page.svelte:90`
- tab-manager: `chat/ChatErrorBanner.svelte:29,33`, `chat/ConversationPicker.svelte:122`

**`size="icon-xs|sm|lg"` (should be identical):** tab-manager `TabItem.svelte`, `UnifiedTabList.svelte`, `ChatInput.svelte`; fuji table/header/timeline actions; opensidian `ChatInput` (icon-lg), `SidebarHeader`; skills `NewSkillDialog`, `ReferencesPanel`.

## Edge Cases

### Unknown tv variant renders unstyled (why load-bearing customs cannot be deferred)

`tailwind-variants` applies no classes for an unrecognized variant value. If Button is migrated to upstream's tv() block WITHOUT `ghost-destructive`, the 5 call-sites passing it get base-only buttons (no background) = visibly broken. So load-bearing customs (ghost-destructive, badge status/success/id, alert warning, tooltip) MUST land in the same wave as their component.

### Vendored Vega references an unknown utility

If a `cn-*` rule `@apply`s a utility/token absent from `app.css`, Tailwind errors at build for ALL apps. Wave 0.6 build-verify catches this. Mitigation if it fires: add the missing token, or split the offending rule out until its component's wave.

### App missed in Wave 0.5

An app without `.style-vega` on its root renders all migrated components unstyled. Enumerate roots exhaustively; a build does not catch this (it is runtime CSS scoping).

## Open Questions

1. **Solid vs tinted destructive** (Class 3): RESOLVED, keep Vega's tinted destructive (no overlay override). Confirmed after building.
2. **Vendor full Vega vs per-wave slices**: full file (chosen, 0.2) is simpler but generates inert CSS during transition and risks one unknown-utility error blocking everything. **Recommendation**: full file + build-verify; fall back to slicing only if 0.6 errors.
3. **Later preset swap to Rhea/Mira**: deferred; one-class experiment once Vega is stable.

## Success Criteria

- [ ] Wave 0 + Wave 1 land with `@epicenter/ui` typecheck green and `check:ui-boundary` passing
- [ ] At least one consuming app builds (no `@apply` errors)
- [ ] Button markup matches upstream Vega + carries ghost-destructive + tooltip; custom icon sizes deleted
- [ ] QA checklist sites visually confirmed (destructive tinted is the only intended change)
- [ ] Spec checkboxes + Deferred Ledger reflect actual progress

## References

- `packages/ui/src/button/button.svelte` - Wave 1 target
- `packages/ui/src/app.css` - token set (superset of upstream) + import site
- `packages/ui/README.md` - update-workflow section to rewrite in polish
- upstream `huntabyte/shadcn-svelte@main`: `docs/src/lib/registry/ui/button/button.svelte`, `docs/src/lib/registry/styles/style-vega.css`, `packages/cli/src/tailwind.css`
- Agent discovery outputs: customization inventory + call-site map (this conversation)
