# content-vault — a reference-field example

A three-table vault that exercises Matter's row-level reference validator. It mirrors the
`pages → adaptations → publications` model: an adaptation points at the page it adapts, a
publication points at the adaptation it ships.

```
pages/          a source idea (no references)
adaptations/    page:       x-ref -> pages          one adaptation per (page, format)
publications/   adaptation: x-ref -> adaptations    one publication per (adaptation, platform)
```

A reference VALUE is the target row's **stem** (its filename without `.md`), the form you
write in frontmatter — e.g. `page: become-the-source` resolves to `pages/become-the-source.md`.

## Deliberately dangling references

Two rows point at stems that do not exist, so the validator has something to catch:

- `adaptations/orphan-adaptation.md` → `page: ghost-page` (no `pages/ghost-page.md`)
- `publications/stale-pub.md` → `adaptation: deleted-adaptation` (no such adaptation)

Every other field in those rows is valid, so checking a single folder on its own passes them —
only the whole-vault check flags them.

## Run the cross-folder check

The check infers its scope from the path: point it at a vault of table folders and it resolves
references across all of them.

```bash
cd apps/matter
bun src/cli/check.ts ../../examples/matter/content-vault
```

Expected: both rows above flagged as `dangling`, with a `7 ready, 2 need attention` summary.

Point it at a single table folder and its cross-table references have no target table loaded —
surfaced as a note, not a failure (the rows still read `ready`):

```bash
# Checking adaptations without pages: page's target table isn't in the vault.
mkdir -p /tmp/partial && cp -r adaptations /tmp/partial/
bun src/cli/check.ts /tmp/partial   # adaptations.page -> "references pages: no such table in the vault"
```

## Opening it in the live app

`content-vault` is a vault: a folder of table folders, read as one relational unit. `bun run dev`,
then open the `content-vault` parent itself — you get the live Vault view: a table switcher across
`pages`, `adaptations`, and `publications`, references resolved across tables, and the two dangling
rows above surfaced in the integrity panel. References resolve at the vault level because they only
have meaning across two tables of the same vault.

Opening a single child folder (`content-vault/pages`, `content-vault/adaptations`, or
`content-vault/publications`) works too — each carries its own `matter.json`. It is just the
degenerate one-table vault, so its cross-table references have no target table loaded and read as
notes rather than failures.
