---
name: workflow
description: Workflow for implementing features with specs and planning docs. Use when: "start a new feature", "how should I plan this", "what's the process", or any non-trivial task.
metadata:
  author: epicenter
  version: '1.0'
---

# Standard Workflow

1. First think through the problem, read the codebase for relevant files, and write a plan to specs/[timestamp] [feature-name].md where [timestamp] is the timestamp in YYYYMMDDThhmmss format and [feature-name] is the name of the feature.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan. For non-trivial changes (multiple approaches, 3+ files, architecture shifts), present competing options with before/after diffs and ASCII diagrams before implementing (see [change-proposal](../change-proposal/SKILL.md) skill).
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Before final handoff, run `post-implementation-review` against the touched files. Use it to catch stale abstractions, dead paths, invariant drift, naming issues, and missing verification.
8. Finally, add a review section to the .md file with a summary of the changes you made, what the post-implementation review found, and any other relevant information.

## When to Apply This Skill

Use this pattern when you need to:

- Start a non-trivial feature with a timestamped planning spec in `specs/`.
- Build a checklist-driven implementation plan before writing code.
- Get plan verification before execution begins.
- Execute work in small, simple steps with high-level progress updates.
- Run a post-implementation review before handing work back.
- Close work by adding a review summary to the spec.

# Spec Placement

All specs live in the root `/specs/` directory. Do not create nested specs in `apps/` or `packages/`.
