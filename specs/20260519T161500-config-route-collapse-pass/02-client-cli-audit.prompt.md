# Client And CLI Audit Prompt

```txt
/goal Audit stale client, project-root, and CLI behavior after `epicenter.config.ts` became the project marker and route registry. Do not edit source files. First read AGENTS.md, the collapse-pass skill, and the last two commits with `git show --stat HEAD~1..HEAD`. Scope: `packages/workspace/src/client/**`, `packages/workspace/src/node.ts`, `packages/workspace/src/daemon/paths.ts`, and `packages/cli/src/**`. Grep for `findEpicenterDir`, `findProjectRoot`, `.epicenter` as marker, `workspaces/` as marker, `MissingConfig`, project socket wording, and old `epicenter up` wording. Write findings to `specs/20260519T161500-config-route-collapse-pass/reports/client-cli.md` with file:line citations, caller counts, proposed collapses, and targeted validation commands. Stop after writing the report.
```
