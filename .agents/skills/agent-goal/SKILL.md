---
name: agent-goal
description: Write `/goal` prompts for long-running agent work in Codex or Claude Code. Use for slash goal, agent goal, durable objective, autonomous coding run.
---

# Agent Goal

Write one `/goal` line that a coding agent can keep pursuing across turns until it can prove the work is done.

The best goal is both a directive and a completion condition:

```txt
/goal [do the work] until [observable condition is true].
```

Treat the goal as a contract. It should tell the agent what to do, what evidence proves it, what is in scope, and when to stop or pause.

The highest-signal goal answers three questions:

```txt
What should change?
How will the agent prove it changed?
What should make the agent stop, pause, or ask?
```

## Core Shape

Use this structure unless the user needs a different format:

```txt
/goal Complete [single objective] in [scope]. First read [required context]. Work in checkpoints. After each checkpoint, surface evidence from [validation]. Stop when [verifiable end state]. Pause if [risk or ambiguity].
```

Include only execution-critical details:

- Objective: one concrete outcome.
- Scope: files, package, app, branch, issue, spec, backlog label, or allowed directories.
- Context: plans, docs, issue links, logs, screenshots, traces, commands, or acceptance criteria to inspect first.
- Evidence: command output, tests, build result, screenshot comparison, eval score, file count, clean git status, or reviewed artifact.
- Stop condition: the exact state that means the goal is achieved.
- Pause condition: user decision, missing credentials, failing external service, destructive action, scope conflict, or repeated failed attempts.

## Rules

1. Start the answer with `/goal` when the user asks for the goal text.
2. Name one main objective. If the request contains a backlog, make the goal "finish this named queue/spec" and define what empty or complete means.
3. Make "done" observable. Prefer "`bun test packages/workspace` exits 0" over "tests pass"; prefer "all checked items in `PLAN.md` are complete" over "finish the plan."
4. Tell the agent to surface evidence in the transcript. Goal evaluators judge what the worker has shown, not private intent.
5. Put long requirements in a plan or spec, then point the goal at that file. Do not paste a huge spec into `/goal`.
6. Ask for checkpoints when the work spans multiple turns. Each checkpoint should produce a small status note: changed, verified, remaining, blocked.
7. Bound runaway work. Add a stop or pause clause such as "pause after 3 failed attempts on the same test" or "stop after 20 turns with a summary of remaining blockers."
8. Protect scope. Say what not to touch when unrelated changes would be tempting.
9. Do not use `/goal` for vague wishes, unrelated chores, open-ended research, or work where the agent cannot produce evidence.
10. Keep the condition judgeable from the transcript. If a separate verifier read only the conversation after each turn, it should be able to tell whether the goal is met.

## Distilled Pattern

Think in this order:

```txt
Outcome
  What must be true?

Evidence
  What command, artifact, or visible behavior proves it?

Scope
  Where may the agent work?

Method
  What should the agent read first, and how should it checkpoint?

Limits
  What should cause a pause instead of more guessing?
```

Then compress that into one goal.

## Platform Notes

Codex:

- Write the goal as a durable objective attached to the active thread, with a verifiable stopping condition.
- Codex docs do not describe Claude's separate evaluator model. Do not assume Codex uses the same evaluation mechanism.

Claude Code:

- `/goal` sets a session-scoped completion condition.
- Claude uses a separate small model after each turn to decide whether the condition has been met.
- The evaluator does not run tools or read files independently.

Shared rule: the goal should not rely on hidden state. Tell the agent to run checks and surface evidence in the transcript.

## Verifier Test

Before finalizing the goal, imagine a checker can see only the transcript, not the filesystem.

Good evidence:

```txt
`bun test packages/auth` exited 0.
All checklist items in `specs/auth.md` are checked.
The final screenshot shows the empty state and no overlap at 390px and 1440px.
`git diff --name-only` only lists files under `apps/api`.
```

Weak evidence:

```txt
The implementation looks complete.
The agent believes the migration is done.
Most tests should pass.
The UI seems better.
```

If the evidence is weak, rewrite the goal until completion can be judged from command output, visible artifact checks, or an explicit final status.

## Templates

Plan execution:

```txt
/goal Implement `specs/[file].md` in checkpoints until every checklist item is complete, the review section is filled in, and `[final validation command]` exits 0. First read the spec and the files it names. After each checkpoint, update the checklist and surface the validation result. Pause if the spec conflicts with current code or needs a product decision.
```

Failing tests:

```txt
/goal Fix the failing tests in `[scope]` until `[test command]` exits 0 and no unrelated files are changed. First run the command and inspect the failures. Work from the smallest root cause outward. After each fix, rerun the targeted test and report the result. Pause before deleting tests, weakening assertions, or changing behavior outside `[scope]`.
```

Migration:

```txt
/goal Migrate `[old path or system]` to `[new path or system]` until all callers use the new path, parity checks pass, and `[final validation command]` exits 0. First read `[migration plan or docs]` and identify callers. Work in checkpoints with validation after each checkpoint. Do not change unrelated public APIs. Pause if compatibility, data migration, or rollback policy is ambiguous.
```

Prototype:

```txt
/goal Build a polished first version of `[app or feature]` inside `[scope]` until the primary flow works end to end, the app builds and runs, and `[visual or command validation]` confirms the expected behavior. First read `[plan or reference]`. Work in checkpoints and surface screenshots or command output as evidence. Pause if the data model or user flow is unclear.
```

Backlog or issue queue:

```txt
/goal Work through `[queue or label]` until every item is closed or has a documented blocker. First list the queue and choose the smallest safe item. For each item, make the minimal fix, run `[validation]`, and report the result before moving on. Stop when the queue is empty. Pause if an item needs credentials, product judgment, or changes outside `[scope]`.
```

Eval or prompt loop:

```txt
/goal Improve `[prompt or system]` until `[eval command]` reaches `[target score]` or no further targeted improvement is justified. First run the eval and inspect failures. Make minimal edits, rerun the eval after each change, and report score changes. Pause if improvement requires product or policy guidance.
```

## Bad To Good

Weak:

```txt
/goal Make the app better and fix bugs.
```

Strong:

```txt
/goal Fix the checkout regressions tracked in `issues/checkout.md` until every listed reproduction passes, `bun test apps/storefront` exits 0, and the final status names any intentionally deferred issues. Work only in `apps/storefront` and shared checkout packages. Pause before changing payment provider contracts or deleting tests.
```

Weak:

```txt
/goal Finish the migration.
```

Strong:

```txt
/goal Complete `specs/20260514T120000 auth-migration.md` until every checklist item is checked, all auth callers compile against the new service, `bun test packages/auth apps/api` exits 0, and `git diff` shows no unrelated edits. Update the spec after each checkpoint. Pause if the old API has undocumented behavior that needs a compatibility decision.
```

## Final Check

Before handing back a goal, verify:

- It begins with `/goal`.
- It has one main objective.
- It names the evidence that proves completion.
- It tells the agent to surface that evidence.
- It defines scope and hard constraints.
- It says when to pause instead of continuing blindly.
