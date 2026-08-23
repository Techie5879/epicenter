# Docs And API Surface Audit Prompt

```txt
/goal Audit docs and public exports affected by the config-routed daemon migration. Do not edit source files. First read AGENTS.md, the collapse-pass skill, the writing-voice skill, and the last two commits with `git show --stat HEAD~1..HEAD`. Scope: `packages/workspace/src/index.ts`, `packages/workspace/src/node.ts`, `packages/workspace/src/config/**`, `docs/scripting.md`, `packages/cli/README.md`, app READMEs touched by the last two commits, and relevant agent skills. Grep for stale folder-routed language, `.epicenter` as discovery marker, `workspaces/<route>/daemon.ts` as an authority, and exports with no current callers. Write findings to `specs/20260519T161500-config-route-collapse-pass/reports/docs-api-surface.md` with file:line citations, caller counts, proposed collapses, and targeted validation commands. Stop after writing the report.
```
