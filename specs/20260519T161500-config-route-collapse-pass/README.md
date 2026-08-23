# Config Route Collapse Pass

Purpose: clean up dead code, stale wording, and avoidable indirection left behind by the move from folder-routed daemon discovery to `epicenter.config.ts` as the project marker and route registry.

Run this in two waves.

## Wave 1: Parallel Audits

Open three fresh agents and give each one prompt:

- `01-workspace-apps-audit.prompt.md`
- `02-client-cli-audit.prompt.md`
- `03-docs-api-surface-audit.prompt.md`

Each audit writes findings to its matching report file:

- `reports/workspace-apps.md`
- `reports/client-cli.md`
- `reports/docs-api-surface.md`

These agents must not edit source files.

## Wave 2: Implementation

After all three reports exist, open one implementation agent with:

- `04-implementation.prompt.md`

That agent reads the reports, builds a small queue, applies safe collapse-pass edits, and writes:

- `reports/implementation.md`

## Why This Shape

The audits parallelize safely because they are read-only. The implementation is intentionally serial because the findings can overlap across config loading, CLI startup, tests, and docs.

This keeps orchestration simple:

```txt
parallel:
  audit workspace-apps
  audit client-cli
  audit docs-api-surface

then serial:
  implement the best findings
  validate
```

## Final Validation Greps

The implementation agent should run these before finishing:

```bash
rg "findEpicenterDir|DAEMON_ENTRY_FILENAME|daemonEntryPath|WorkspaceFolder|WorkspaceDaemonInvalidExport|MissingConfig|folder-routed|\\.epicenter/daemon\\.sock|workspaces/<route>/daemon\\.ts"
```

Any remaining hit should be either removed or justified in `reports/implementation.md`.
