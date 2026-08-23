# Repo History Cleanup Rehearsal

**Date**: 2026-05-28
**Status**: Draft
**Owner**: Braden
**Branch**: codex/repo-history-cleanup-spec

## One Sentence

Epicenter should rehearse one coordinated history rewrite that fixes Braden's commit email metadata and removes generated or accidental junk from Git history without squashing normal source history.

## How To Read This

Read first:

```txt
One Sentence
Current Findings
Target Shape
Rewrite Scope
Pull Request Impact
Rehearsal Plan
Go Or No-Go Rules
```

Read before executing:

```txt
Candidate Removal Ledger
Verification
Rollback Plan
Communication Plan
Open Questions
```

This is a working vision and rehearsal plan. It is not approval to force-push `main`, delete refs, or rewrite GitHub history.

## Current Findings

The repo has two separate issues that should not be confused.

First, a large set of commits uses an email that may not be associated with Braden's GitHub profile:

```txt
origin/main author emails:
  13,515  13159333+braden-w@users.noreply.github.com
   1,598  git@bradenwong.com
     530  bmw02002turbo@gmail.com
       4  braden@Bradens-Mac-Studio.local

all local refs author emails:
  19,618  13159333+braden-w@users.noreply.github.com
   1,674  git@bradenwong.com
     794  bmw02002turbo@gmail.com
      11  braden@Bradens-Mac-Studio.local
```

Second, historical generated files are taking space. Current `origin/main` is mostly normal source, docs, lockfiles, icons, and screenshots. The waste is in old history and in local refs.

```txt
local object store:
  packed: 589.43 MiB
  loose:  530.45 MiB
  total:  about 1.1 GiB

origin/main reachable historical blobs:
  all blobs, uncompressed: 703.04 MiB
  .wrangler history:       40.15 MiB

all local refs reachable historical blobs:
  all blobs, uncompressed: 1,106.07 MiB
  .wrangler history:        347.34 MiB
```

The current tree on `origin/main` does not track `.wrangler` files. `.wrangler` is already ignored. The cleanup target is historical reachability, not current source files.

## Target Shape

The target is a repo with the same meaningful project history, but without generated artifacts and with Braden-authored commits mapped to the intended GitHub noreply email.

```txt
Keep:
  source history
  PR-level authorship and chronology
  tags and branches that still matter
  docs, specs, fixtures, screenshots, app icons, lockfiles

Rewrite:
  author and committer emails for known Braden identities
  generated build output paths
  accidental local export files

Do not do:
  squash main
  collapse feature commits for taste
  delete normal old code just because it is old
  rewrite open PRs by hand without a branch map
```

The rewrite should be one coordinated pass. Email rewrites and junk-path removals both change commit SHAs, so doing them separately doubles the disruption.

## Rewrite Scope

Use `git filter-repo` in a mirror clone. The exact command should be generated after the rehearsal ledger is confirmed.

The likely shape is:

```sh
git filter-repo \
  --mailmap ../epicenter-history-mailmap.txt \
  --paths-from-file ../epicenter-history-remove-paths.txt \
  --invert-paths
```

The mailmap should map known Braden author and committer identities to:

```txt
Braden Wong <13159333+braden-w@users.noreply.github.com>
```

Candidate old identities:

```txt
Braden Wong <git@bradenwong.com>
Braden Wong <bmw02002turbo@gmail.com>
Braden Wong <braden@Bradens-Mac-Studio.local>
braden-w <braden-w@users.noreply.github.com>
```

The path removal file should start narrow and evidence-based. Every path needs a reason and a verification command.

## Candidate Removal Ledger

High-confidence generated output:

```txt
apps/api/.wrangler/
packages/server-cloudflare/.wrangler/
packages/server-remote-cloudflare/.wrangler/
```

Reason:

```txt
Wrangler temporary bundles and sourcemaps are generated artifacts. They are already absent from current origin/main and covered by ignore rules.
```

Measured examples:

```txt
apps/api/.wrangler/tmp/dev-vj0mDT/index.js.map
apps/api/.wrangler/tmp/dev-p5Xb0k/index.js.map
apps/api/.wrangler/tmp/dev-4g0Z1y/index.js.map
packages/server-remote-cloudflare/.wrangler/tmp/dev-Tl2q7h/app.js.map
packages/server-cloudflare/.wrangler/tmp/dev-cmZQt7/worker.js.map
```

Medium-confidence generated output:

```txt
apps/dashboard/.svelte-kit/
apps/ytext-editor-poc/.svelte-kit/
```

Reason:

```txt
SvelteKit output is generated. Current examples are small, but they should not be in history if the goal is to remove generated artifacts consistently.
```

Needs verification:

```txt
Confirm these paths do not contain hand-authored files that were later moved or renamed.
```

Accidental export candidates:

```txt
reddit_export.zip
```

Reason:

```txt
This looks like a local data export, not source. It is only about 837 KiB, but data exports are the kind of file that should not stay in repo history unless intentionally published.
```

Needs verification:

```txt
Inspect the commit that introduced it.
Confirm whether the zip contains private or user data.
Decide whether removal is privacy cleanup, size cleanup, or both.
```

Yale or course data candidates:

```txt
No .csv, .tsv, .xls, or .xlsx paths were found in origin/main or all local refs during the first audit.
```

This does not prove the data was never committed. It may have used a different extension, lived inside an archive, or been renamed before deletion.

Search before finalizing:

```sh
git rev-list --objects --all |
  rg -i 'yale|course|courses|catalog|registrar|college|class|classes|csv|tsv|xlsx|xls|reddit|export'
```

If a candidate is inside an archive, extract and inspect it only in a disposable directory.

Probably keep:

```txt
apps/whispering/src/lib/services/sound/assets/*.mp3
apps/whispering/src-tauri/tests/fixtures/*.mp3
apps/whispering/src-tauri/tests/fixtures/*.webm
apps/whispering/src-tauri/icons/*
docs/assets/images/*
bun.lock
Cargo.lock
```

Reason:

```txt
These are current product assets, test fixtures, app icons, documentation assets, and lockfiles. They may be binary or noisy, but they are not generated junk by default.
```

## Pull Request Impact

Open PRs do not automatically become useless, but they become risky if only `main` is rewritten.

Good case, rewrite base and PR head with the same filter:

```txt
Before:
  old main: A - B - C
  PR:             C - D - E

After:
  new main: A' - B' - C'
  PR:              C' - D' - E'
```

The PR can usually remain understandable because the branch relationship survives. GitHub may still mark reviews and checks as stale because every rewritten commit has a new SHA.

Bad case, rewrite only `main`:

```txt
After:
  new main: A' - B' - C'
  old PR:   A - B - C - D - E
```

Now the PR branch points into the old history graph. GitHub may show a huge diff, stale commits, or a confusing merge base. Some PRs may still merge after manual rebase, but the UI should not be trusted until each branch is refreshed.

Same-repo PRs are manageable because the maintainer can rewrite and force-push the head branches. Fork PRs are different: the maintainer cannot rewrite someone else's fork branch. Those need contributor coordination, a maintainer-created replacement branch, or a new PR.

## Rehearsal Plan

Run the rehearsal in a mirror clone. Do not start from an active worktree.

```sh
git clone --mirror git@github.com:EpicenterHQ/epicenter.git epicenter-history-rewrite.git
cd epicenter-history-rewrite.git
```

Capture the baseline:

```sh
git count-objects -vH
git for-each-ref --format='%(refname)' refs/heads refs/tags refs/pull > ../refs-before.txt
git rev-list --objects --all > ../objects-before.txt
git log --all --format='%ae%x09%an' | sort | uniq -c | sort -nr > ../author-emails-before.txt
git log --all --format='%ce%x09%cn' | sort | uniq -c | sort -nr > ../committer-emails-before.txt
```

Build the removal files:

```txt
epicenter-history-mailmap.txt
epicenter-history-remove-paths.txt
```

Run the rewrite locally:

```sh
git filter-repo \
  --mailmap ../epicenter-history-mailmap.txt \
  --paths-from-file ../epicenter-history-remove-paths.txt \
  --invert-paths
```

Expire local old references only inside the disposable mirror:

```sh
git reflog expire --expire=now --expire-unreachable=now --all
git gc --prune=now --aggressive
git count-objects -vH
```

Capture the after state:

```sh
git for-each-ref --format='%(refname)' refs/heads refs/tags refs/pull > ../refs-after.txt
git rev-list --objects --all > ../objects-after.txt
git log --all --format='%ae%x09%an' | sort | uniq -c | sort -nr > ../author-emails-after.txt
git log --all --format='%ce%x09%cn' | sort | uniq -c | sort -nr > ../committer-emails-after.txt
```

Create a report before pushing anything:

```txt
size before and after
first changed commit from git-filter-repo output
refs rewritten
refs deleted or unexpectedly unchanged
open PR branches affected
paths removed
author and committer email counts before and after
sample rewritten commit comparison
```

## Pull Request Branch Map

Before the real rewrite, export open PR metadata from GitHub:

```sh
gh pr list --state open --limit 200 \
  --json number,title,headRefName,headRepositoryOwner,headRepository,baseRefName,isCrossRepository
```

Classify each PR:

```txt
same-repo head:
  can be rewritten and force-pushed by maintainers

fork head:
  cannot be rewritten directly
  needs contributor rebase, maintainer replacement branch, or new PR

stale or obsolete:
  close before rewrite if no longer useful
```

For same-repo PRs, rehearse the rewritten branch heads in the mirror and confirm each PR still has a sensible merge base against rewritten `main`.

## Verification

The rewrite is not ready unless these checks pass in the mirror clone.

Authorship:

```sh
git log --all --format='%ae%x09%an' | rg 'git@bradenwong.com|bmw02002turbo@gmail.com|Bradens-Mac-Studio.local'
git log --all --format='%ce%x09%cn' | rg 'git@bradenwong.com|bmw02002turbo@gmail.com|Bradens-Mac-Studio.local'
```

Generated paths:

```sh
git rev-list --objects --all |
  rg '(^|/)(\\.wrangler|\\.svelte-kit)/|reddit_export\\.zip'
```

Course or Yale data:

```sh
git rev-list --objects --all |
  rg -i 'yale|course|courses|catalog|registrar|college|class|classes|csv|tsv|xlsx|xls'
```

Current source tree:

```sh
git checkout main
bun install
bun run check:local
bun test
```

If the repo does not have those exact local scripts, replace them with the current monorepo verification commands. The point is to prove the rewritten tree still builds and tests from a fresh checkout.

## Rollback Plan

Before any force-push, create immutable backup refs and a local mirror backup.

```sh
git clone --mirror git@github.com:EpicenterHQ/epicenter.git epicenter-before-history-cleanup.git
```

For GitHub-side rollback, keep a list of old branch heads:

```sh
git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags > refs-before-rewrite.txt
```

Rollback means force-pushing old refs back. That is possible only if the old mirror is preserved and no one has built new work on top of the rewritten refs.

## Communication Plan

This needs a maintenance window.

Before:

```txt
Freeze merges.
Ask contributors to stop rebasing or force-pushing open PR branches.
Tell everyone the repo history will change and old clones must not push old history back.
```

During:

```txt
Rewrite mirror.
Push rewritten main and selected branches.
Refresh same-repo PR branches.
Record fork PRs that need contributor action.
```

After:

```txt
Tell contributors to reclone or hard-reset local branches to the new remote refs.
Ask fork PR authors to rebase onto the rewritten main.
Watch for old-history pushes that reintroduce removed objects.
```

## Go Or No-Go Rules

Go only if:

```txt
the mirror rehearsal produces a clear size win
author and committer email counts are fixed
candidate paths are gone from all intended refs
same-repo PR branch handling is rehearsed
fork PR impact is accepted
rollback refs are captured
Braden explicitly approves the force-push window
```

No-go if:

```txt
the size win is small and email verification already fixes contributions
open PRs are too important to disturb right now
the candidate deletion list includes ambiguous source files
the branch map is incomplete
any collaborator cannot tolerate a history rewrite this week
```

## Open Questions

1. Should `bmw02002turbo@gmail.com` also be rewritten to the noreply email, or only `git@bradenwong.com`?
2. Should `braden@Bradens-Mac-Studio.local` be rewritten, removed from public history, or left as-is?
3. Is `reddit_export.zip` private data, public test data, or an accidental export?
4. Was the Yale/course data committed under a non-spreadsheet extension or inside an archive?
5. Which of the 65 open PRs are same-repo branches, and which are fork branches?
6. Should closed PR refs be rewritten for GitHub storage cleanup, or is the goal limited to active branches and `main`?
7. Are there tags or release branches that must remain byte-for-byte untouched?

## Decision Bias

Prefer deleting generated artifacts and accidental data exports. Do not delete or squash normal source history for aesthetic reasons.

This rewrite is justified only if it produces durable cleanup with one coordinated disruption. If the plan starts turning into broad history simplification, stop and split that into a separate decision.
