# Workspace Apps Audit Prompt

```txt
/goal Audit stale folder-discovery concepts in `packages/workspace/src/workspace-apps` after the move to `epicenter.config.ts` route registration. Do not edit source files. First read AGENTS.md, the collapse-pass skill, and the last two commits with `git show --stat HEAD~1..HEAD`. Then inspect `packages/workspace/src/workspace-apps/**` and grep for `daemonEntryPath`, `DAEMON_ENTRY_FILENAME`, `WorkspaceFolder`, `WorkspaceDaemonInvalidExport`, `folder-routed`, `discoverWorkspaceApps`, and stale discovery wording. Write findings to `specs/20260519T161500-config-route-collapse-pass/reports/workspace-apps.md` with file:line citations, caller counts, one-sentence-test notes, proposed collapses, and targeted validation commands. Stop after writing the report.
```
