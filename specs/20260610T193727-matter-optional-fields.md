# Matter Optional Fields

Status: In Progress

Owner: Codex

Date: 2026-06-10

## One Sentence

Matter fields describe valid present values, while a top-level `optional` list says which modeled fields may be absent without making the row need attention.

## Current Shape

Matter currently treats every modeled field as required.

```txt
absent key       MISSING_REQUIRED
key: null        MISSING_REQUIRED
valid value      OK
invalid value    INVALID
```

That works for strict content pipelines, but it makes personal relationship data awkward. A field like `reviewBy` is still a real date field when present, but some rows should have no scheduled review date at all.

The write path already has the right canonical behavior:

```txt
clear cell -> delete the frontmatter key
```

Matter never writes `null` when a user clears a field.

## Target Shape

Keep `fields.*` fully JSON Schema-compatible. Put Matter row-completeness policy beside the field schemas:

```json
{
  "fields": {
    "name": { "type": "string", "minLength": 1 },
    "reviewBy": { "type": "string", "format": "date" }
  },
  "optional": ["reviewBy"]
}
```

The conformance states become:

```txt
missing required field       MISSING_REQUIRED
null required field          MISSING_REQUIRED
missing optional field       MISSING_OPTIONAL
null optional field          MISSING_OPTIONAL
present valid field          OK
present invalid field        INVALID
```

`MISSING_OPTIONAL` is valid. It should not count as attention and should project to SQL `NULL`.

## Decisions

### Optionality lives outside `fields.*`

`fields.*` stays a pure value schema. If `reviewBy` exists, it must be a date string. Whether a row may omit `reviewBy` is a Matter model policy, not a property of the date value.

### Clear deletes keys

The canonical authored shape for a missing optional field is absence:

```yaml
---
name: Alice
location: new-york
---
```

Matter should not write:

```yaml
reviewBy:
```

or:

```yaml
reviewBy: null
```

### Parsing is tolerant

Matter should still accept explicit YAML null as missing. A hand-edited `reviewBy:` is mechanically equivalent to omitting the key. Treating it as `INVALID` would create a repair task whose only answer is "delete the key."

The formal rule:

```txt
Matter validates dropNullKeys(frontmatter) against the derived object schema.
```

### Unknown optional entries must be visible

An `optional` entry that does not land on a typed modeled field should not silently do nothing. The model should report it as an unmatched optional entry so the UI and inspect script can surface the typo or unmodeled field.

### Classification owns requiredness

`MatterField.required` is a loaded-model fact used by conformance. It should not leak into field widgets. The classifier reads the policy once and emits a cell verdict:

```txt
MISSING_REQUIRED  missing required value
MISSING_OPTIONAL  missing optional value
```

After classification, UI code reads `cell.state`. Missing-value rendering is grouped through `MissingCell` and `FieldMissing`, so widgets do not re-derive requiredness booleans from the state.

## Implementation Plan

- [x] Add a `MatterField` type that wraps a recognized field with `required: boolean`.
- [x] Parse top-level `optional` as an array of field names, defaulting to all fields required.
- [x] Report optional entries that do not match typed modeled fields.
- [x] Add a `MISSING_OPTIONAL` conformance state for missing or null optional values.
- [x] Treat `OK` and `MISSING_OPTIONAL` cells as row-valid.
- [x] Project `MISSING_OPTIONAL` cells to SQL `NULL`.
- [x] Update the grid and detail dialog so `MISSING_OPTIONAL` is neutral, not attention.
- [x] Update field widgets so missing optional cells render as quiet absence, not `required`.
- [x] Update the demo fixture to exercise `MISSING_OPTIONAL`.
- [x] Add tests for optional parsing, conformance, folder reading, SQLite projection, and existing clear behavior.
- [x] Update documentation comments and the rationale article.
- [x] Run Matter core tests and typecheck.
- [ ] Run post-implementation review.
- [ ] Run Claude final grill on the completed diff.

## Verification

```bash
bun test apps/matter/src/lib/core/model.test.ts apps/matter/src/lib/core/conformance.test.ts apps/matter/src/lib/core/folder.test.ts apps/matter/src/lib/core/sqlite.test.ts apps/matter/src/lib/core/serialize.test.ts
bun run --cwd apps/matter typecheck
```

## Notes

The rationale article lives at `docs/articles/optional-fields-should-delete-keys.md`.
