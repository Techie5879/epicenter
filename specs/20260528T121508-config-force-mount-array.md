# Force `epicenter.config.ts` to export `Mount[]`

## Decision

`epicenter.config.ts` must default-export a `Mount[]` **always**. Drop support for
default-exporting a single `Mount`. One app becomes `export default [fuji()]`.

Greenfield clean break: compatibility is not load-bearing (one private external
consumer, `/Users/braden/Code/vault`, already exports an array). The only migration
is wrapping 6 in-repo single-mount configs in brackets.

### Why (one sentence)

An Epicenter root declares the **set** of apps its daemon serves; the daemon spine
already speaks `Mount[]` end to end (`openEpicenterRoot` consumes `Mount[]` and
never branches on shape, and the generated scaffold already ships
`export default []`), so the single form is sugar that `loadEpicenterConfig`
normalizes away one line after reading it.

### Invariant this owns

> The config default export **is** a `Mount[]`. Anything else, including a bare
> valid `Mount` that is not wrapped in an array, is a structured
> `EpicenterConfigError.EpicenterConfigInvalid` pointed at the file.
> `loadEpicenterConfig` never throws.

## Edits

### 1. Core normalization: `packages/workspace/src/config/load-epicenter-config.ts`

**1a. Collapse the body** (current lines 95-108). Replace:

```ts
	const value = module.default;
	if (Array.isArray(value)) {
		if (value.every(isMount)) return Ok(value);
		return EpicenterConfigError.EpicenterConfigInvalid({
			epicenterConfigPath,
			detail:
				'an array entry is not a Mount (each needs a string `name` and an `open` function)',
		});
	}
	if (isMount(value)) return Ok([value]);
	return EpicenterConfigError.EpicenterConfigInvalid({
		epicenterConfigPath,
		detail: 'the default export must be a Mount or a Mount[]',
	});
```

with:

```ts
	const value = module.default;
	if (Array.isArray(value) && value.every(isMount)) return Ok(value);
	return EpicenterConfigError.EpicenterConfigInvalid({
		epicenterConfigPath,
		detail:
			'the default export must be a Mount[] (each entry needs a string `name` and an `open` function)',
	});
```

`isMount` (the helper at the bottom of the file) stays unchanged: it still validates
each array entry at the type-erased dynamic-import boundary.

**1b. Update the file's top doc comment** (current lines 3-12). Replace the
"one of: single `Mount` / `Mount[]`" paragraph and the "Both forms normalize"
sentence with a single statement of the new contract. Replace:

```
 * The config default-exports one of:
 *
 *   - a single `Mount`:
 *       `export default fuji();`
 *
 *   - a `Mount[]`:
 *       `export default [fuji(), notes()];`
 *
 * Both forms normalize to `Mount[]` so callers do not branch on shape.
```

with:

```
 * The config default-exports a `Mount[]`. One app is a list of one:
 *
 *   `export default [fuji()];`
 *   `export default [fuji(), notes()];`
```

Leave the `isMount`-is-real-input-validation paragraph and the "never throws"
sentence intact.

### 2. Tests: `packages/workspace/src/config/load-epicenter-config.test.ts`

- **Delete** the test `'normalizes a single Mount default export into a Mount[]'`
  (current lines 44-52). The behavior it pins no longer exists.
- **Delete** `'rejects a Mount that lacks open()'` (lines 89-94) and
  `'rejects a Mount that lacks a string name'` (lines 96-101). These exercised
  `isMount` against a bare single value; that path is gone, and per-entry validation
  is already covered by `'rejects a Mount[] containing a non-Mount value'`.
- **Rename** `'rejects a default export that is neither a Mount nor Mount[]'`
  (line 72) to `'rejects a non-array default export'`. The body is unchanged.
- **Add** a test that pins the new break:

```ts
	test('rejects a bare Mount that is not wrapped in an array', async () => {
		writeConfig("export default { name: 'demo', open() {} };\n");

		const { error } = await loadEpicenterConfig(epicenterRoot);
		expect(error?.name).toBe('EpicenterConfigInvalid');
	});
```

Keep: not-found, `Mount[]` passthrough, empty `[]`, non-Mount array entry,
no-default-export, and bad-syntax tests as-is.

### 3. JSDoc / comment touch-ups (no behavior change)

- `packages/workspace/src/daemon/define-mount.ts` (lines 4-5):
  `` `epicenter.config.ts` default-exports a `Mount` (single mount) or a `Mount[]`
  (multi-mount). `` -> `` `epicenter.config.ts` default-exports a `Mount[]`. ``
- `packages/workspace/src/config/epicenter-config-source.ts` (line 3):
  `// Default-export a Mount or Mount[] value. Example:` ->
  `// Default-export a Mount[] value. Example:`
  (The shipped `export default []` body is already correct.)
- `packages/workspace/src/workspace-apps/open-epicenter-root.ts` (line 9):
  `validates that its default export is a `Mount` / `Mount[]`.` ->
  `validates that its default export is a `Mount[]`.`

### 4. CLI README: `packages/cli/README.md`

- Line 61: `The default export is a `Mount` (single mount) or a `Mount[]`
  (multi-mount).` -> `The default export is a `Mount[]`.`
- Inline example (lines 91-98): wrap the `defineMount({...})` call in an array so
  the documented example obeys the new contract:
  `export default defineMount({` ... `});` -> `export default [defineMount({` ... `})];`

### 5. Wrap the 6 in-repo single-mount configs

Each is a one-line change (plus one doc line in fuji):

| File | Change |
| --- | --- |
| `examples/fuji/epicenter.config.ts` | `export default fuji({ ... });` -> `export default [fuji({ ... })];`; also update the header doc line `one mount, declared at the root.` -> `one mount in a list, declared at the root.` |
| `playground/tab-manager-e2e/epicenter.config.ts` | `export default tabManager;` -> `export default [tabManager];` |
| `playground/opensidian-e2e/epicenter.config.ts` | `export default opensidian;` -> `export default [opensidian];` |
| `examples/notes-cross-peer/peer-a/epicenter.config.ts` | `export default notes;` -> `export default [notes];` |
| `examples/notes-cross-peer/peer-b/epicenter.config.ts` | `export default notes;` -> `export default [notes];` |
| `packages/cli/test/fixtures/inline-actions/epicenter.config.ts` | `export default demo;` -> `export default [demo];` |

### Out of scope / do not touch

- `/Users/braden/Code/vault/epicenter.config.ts` already exports an array. No change.
- Historical specs `specs/20260527T235147-mount-level-git-autosave.md` and
  `specs/20260522T220000-api-runtime-portability.md` mention the old union in their
  reasoning/rollback prose. Leave them: they are records of past decisions, not the
  live contract. (The portability spec's "single mounted directory" / "single knob"
  hits are about `DATA_DIR`, unrelated.)

## Verification

1. `bun test packages/workspace/src/config/load-epicenter-config.test.ts` passes.
2. `bun run --filter @epicenter/workspace typecheck` (or repo typecheck) is clean.
3. `rg -n -i 'Mount or Mount\[\]|Mount` / `Mount\[\]|single Mount'` across source +
   `packages/cli/README.md` returns nothing in live code/docs (matches only the
   historical specs noted above, which stay).
4. Sanity: `export default fuji()` (bare) in a config now fails with
   `EpicenterConfigInvalid`; `export default [fuji()]` succeeds.
