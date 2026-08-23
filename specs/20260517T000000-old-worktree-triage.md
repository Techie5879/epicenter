# Old worktree triage and preservation note

**Date**: 2026-05-17
**Branch**: `codex/preserve-old-worktree-intent` (from `main` @ `c2596e76c`)
**Status**: Reference. Records what was preserved, what was discarded, and which worktrees are safe to remove.

This note documents the triage of seven stale Epicenter worktrees. The goal was to preserve durable intent (decision docs, design articles, draft specs that still target current `main`) without merging stale implementation in. Worktrees and branches were left in place; nothing was deleted.

## A. Verification table

| Worktree | Branch | Committed diff vs `main` | Dirty / untracked | Durable intent | Preserve action | Delete readiness |
|---|---|---|---|---|---|---|
| `shanghai-v3` | `workspace-as-daemon-transport-v1` | ~24 commits on early daemon-transport + RemoteNotSupported + buildRemoteWorkspace + path consolidation. All superseded by `sun-valley`'s rewrite (Remote<T>, single-envelope, table-actions deletion) and by current `main`'s `connectDaemonActions` shape. | 2 untracked supervisor specs, byte-identical to `sun-valley`. | None unique. Pure archaeology of an early daemon transport pass. | None. The unique committed work was an exploration that the next worktree (`sun-valley`) replaced wholesale. | Safe after preservation branch lands (nothing to preserve from this one). |
| `sun-valley` | `workspace-as-daemon-transport` | ~20 commits on later daemon transport: Remote<T> mapped type, defineQuery/defineMutation branding, structural Standard Schema -> TypeBox, table-actions deletion, action-tree remote contract docs. | Same 2 untracked supervisor specs. | TypeBox / Standard Schema reasoning article. Daemon transport docs are stale against current `main` (which uses `connectDaemonActions`, current sync supervisor, folder-routed daemon workspaces). | Preserved: `docs/articles/20260429T120000-typebox-standard-schema-pivot.md` as Reference. Daemon/supervisor specs intentionally **not** preserved; they would mislead a reader into thinking `serve`, old `connectDaemon`, `RemoteNotSupported`, or full remote workspace proxy are current direction. | Safe after preservation branch lands. |
| `sofia-v2` | `braden-w/shadcn-ui-update` | 7 commits: shadcn-svelte Luma preset + corner radius tightening, biome-ignore restore, export restores, `RunStatusBadge`, `ghost-destructive` -> `destructive` migration. | 1 modified `packages/ui/src/app.css`. | UI refresh slices; theming README. No standalone doc/spec to preserve. | None at the doc level. If/when the UI refresh is revisited, mine the branch directly. | Keep temporarily while UI refresh is being mined; otherwise safe to delete. |
| `valencia-v1` | `braden-w/column-dsl-spec` | 6 commits: column DSL spec evolution + Temporal-as-value-type article + `specification-writing` skill edits. | Modified `packages/workspace/specs/20260429T000000-column-dsl-and-define-table.md` (the **dirty** version is the valuable one: `DateTimeString.schema()`, branded `column.string<T>()`, version guards, `tableActions(table)`). Untracked `.agents/skills/workspace-app-layout/` is **obsolete**: current `main` already ships that skill. | Column DSL design; Temporal-as-value-type reasoning. | Preserved (dirty version) at `packages/workspace/specs/20260429T000000-column-dsl-and-define-table.md` with a Draft + status header. Preserved `docs/articles/20260429T180000-temporal-is-a-value-type-not-a-storage-format.md` as Reference (em dashes sanitized to house style). | Keep temporarily until the column DSL preservation has been reviewed against current `main`; then safe to delete. |
| `abu-dhabi` | `braden-w/collapsible-section` | No commits ahead of `main`. | 1 untracked `apps/tab-manager/src/lib/components/CollapsibleSection.svelte`, plus a noisy `bun.lock` change. | Tiny UI experiment. | None. | Safe to delete now. The experiment can be re-derived from the file in five minutes if ever wanted. |
| `havana` | `codex/sync-create-auth-v1` | No commits ahead of `main`. | 1 untracked `specs/20260504T210000-better-auth-1.6.9-upgrade.md` (566 lines). Verified: current `main` still pins `better-auth ^1.5.3` and `drizzle-orm ^0.44.7`, so the upgrade target and motivation are still valid. | Better Auth 1.6.9 / Drizzle 0.45.x upgrade plan with surface-by-surface grounding. | Preserved at `specs/20260504T210000-better-auth-1.6.9-upgrade.md` as an active draft spec. | Safe after preservation branch lands. |
| `caracas-v2` | `braden-w/licensing-research` | No commits ahead of `main`. | Modified root `LICENSE`, `FINANCIAL_SUSTAINABILITY.md`, `README.md`, `apps/api/LICENSE`, `packages/sync/LICENSE`. New untracked LICENSE files for `apps/{breddit,dashboard,skills,zhongwen}` and `packages/{auth,auth-svelte,skills}`. New `specs/20260428T120000-licensing-strategy.md`. Verified: `apps/dashboard/package.json` declares `AGPL-3.0` while the current root `LICENSE` lists only `apps/api` and `packages/sync` as AGPL. The mismatch is real. | Licensing decision doc, threat model, three-tier split. The in-tree LICENSE edits are a related but separable docs-consistency PR. | Preserved at `docs/licensing/licensing-strategy.md` as an Active decision doc. The LICENSE / `FINANCIAL_SUSTAINABILITY.md` / per-package LICENSE edits are **not** carried over here. They should be evaluated as a follow-up consistency patch against current `main`, not blindly copied. | Safe after preservation branch lands and a follow-up patch handles the `apps/dashboard` license mismatch. |

## B. Preserved artifacts

Created on this branch:

| Path | Source worktree | Source state | Status header |
|---|---|---|---|
| `specs/20260504T210000-better-auth-1.6.9-upgrade.md` | `havana` | untracked | Active spec (draft inside) |
| `docs/licensing/licensing-strategy.md` | `caracas-v2` | untracked | Active decision doc |
| `packages/workspace/specs/20260429T000000-column-dsl-and-define-table.md` | `valencia-v1` | dirty working tree (newer than HEAD) | Draft |
| `docs/articles/20260429T120000-typebox-standard-schema-pivot.md` | `sun-valley` | committed | Reference |
| `docs/articles/20260429T180000-temporal-is-a-value-type-not-a-storage-format.md` | `valencia-v1` | committed | Reference (em dashes sanitized) |

Each preserved file starts with a `Preservation status (2026-05-17)` block that names its origin worktree, branch, source state, and current verdict.

## C. Intentionally not preserved

- **shanghai-v3 daemon transport commits.** Superseded by `sun-valley`'s later pass, which is itself stale against current `main`. Re-introducing them would mislead readers about current direction.
- **sun-valley daemon and supervisor docs/specs.** Stale against current `main` (which uses `connectDaemonActions`, the current sync supervisor design, folder-routed daemon workspaces). Marking them "Archived" was considered but rejected; they reference an architecture that has since shifted enough that an archive would still tempt readers into a wrong mental model. The reasoning that **is** durable was already extracted into the TypeBox / Standard Schema article.
- **sun-valley / shanghai-v3 supervisor specs (`20260427T010000-supervisor-redesign.md`, `20260427T020000-supervisor-redesign-step-1-abortsignal.md`).** Untracked in both worktrees and superseded by the in-tree `packages/workspace/specs/20260430T104326-attach-sync-supervisor-evolution.md`.
- **valencia-v1 `.agents/skills/workspace-app-layout/` untracked tree.** Obsolete: current `main` already ships that skill at the same path.
- **valencia-v1 `.agents/skills/specification-writing/SKILL.md` edits.** Skill-direction-dependent. Not preserved here; if useful, mine directly when revising that skill.
- **sofia-v2 UI refresh commits.** No standalone doc/spec to preserve. Mine the branch when the UI refresh is revisited.
- **abu-dhabi `CollapsibleSection.svelte` experiment.** Tiny enough to re-derive.
- **caracas-v2 LICENSE / `FINANCIAL_SUSTAINABILITY.md` / per-package LICENSE diffs.** Not blindly copied. Should ship as a follow-up consistency PR that audits current `main`'s license declarations against the now-canonical `docs/licensing/licensing-strategy.md`.

## D. Final recommendation

**Safe to delete after this preservation branch lands:**
- `shanghai-v3`
- `sun-valley`
- `havana`
- `caracas-v2`

**Safe to delete now (or near-now):**
- `abu-dhabi`

**Keep temporarily for mining:**
- `valencia-v1` until the preserved column DSL spec has been reviewed against current `main`.
- `sofia-v2` only if the UI refresh slices will be mined soon. Otherwise safe to delete.

**Do not delete yet:** none.

Per the constraints of this task, no worktrees or branches were deleted, and no files inside any old worktree were modified.

## E. Follow-up suggested (not done here)

1. Audit license declarations in current `main`. Specifically: `apps/dashboard/package.json` declares `AGPL-3.0` but the current root `LICENSE` does not list `apps/dashboard` in the AGPL section. Reconcile against `docs/licensing/licensing-strategy.md`.
2. When the column DSL spec is ready to execute, refresh it against current `main`'s `defineTable` (still arktype / Standard Schema based) and rename branch / dating accordingly.
3. The Better Auth 1.6.9 upgrade spec's "Section 1 grounding" walkthrough was written against `havana`'s read of `apps/api/`. Re-verify call sites before executing.
