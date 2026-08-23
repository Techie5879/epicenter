# Testing Patterns

## When to Read This
Read this when writing TypeScript tests or deciding how to organize test files relative to source modules.

# Inline Definitions in Tests

## Prefer Inlining Single-Use Definitions

When a schema, builder, or configuration is only used once in a test, inline it directly at the call site rather than extracting to a variable.

### Bad Pattern (Extracted Variables)

```typescript
test('builds a workspace bundle', () => {
	const posts = defineTable({ id: field.string<PostId>(), title: field.string() });

	const theme = defineKv(Type.Union([Type.Literal('light'), Type.Literal('dark')]), () => 'light');

	const workspace = createWorkspace({
		id: 'test-app',
		tables: { posts },
		kv: { theme },
	});

	expect(workspace.ydoc.guid).toBe('test-app');
});
```

### Good Pattern (Inlined)

```typescript
test('builds a workspace bundle', () => {
	const workspace = createWorkspace({
		id: 'test-app',
		tables: {
			posts: defineTable({ id: field.string<PostId>(), title: field.string() }),
		},
		kv: {
			theme: defineKv(
				Type.Union([Type.Literal('light'), Type.Literal('dark')]),
				() => 'light',
			),
		},
	});

	expect(workspace.ydoc.guid).toBe('test-app');
});
```

### Why Inlining is Better

1. **All context in one place**: No scrolling to understand what `posts` or `theme` are
2. **Reduces naming overhead**: No need to invent variable names for single-use values
3. **Matches mental model**: The definition IS the usage - they're one conceptual unit
4. **Easier to copy/modify**: Self-contained test setup is easier to duplicate and tweak

### When to Extract

Extract to a variable when:

- The value is used **multiple times** in the same test
- You need to chain methods on the result (e.g., `.migrate()` on a multi-version `defineTable(v1, v2)`)
- The definition is **shared across multiple tests** in a `beforeEach` or test fixture
- The inline version would exceed ~15-20 lines and hurt readability

### Applies To

- `defineTable()`, `defineKv()`, `createDisposableCache()` builders
- `createWorkspace()` factory calls
- Schema definitions (TypeBox `field.*` / `Type.*`, arktype, zod, etc.)
- Configuration objects passed to factories
- Mock functions used only once

# Test File Organization

## Shadow Source Files with Test Files

Each source file should have a corresponding test file in the same directory:

```
src/static/
├── schema-union.ts
├── schema-union.test.ts      # Tests for schema-union.ts
├── define-table.ts
├── define-table.test.ts      # Tests for define-table.ts
├── create-tables.ts
├── create-tables.test.ts     # Tests for create-tables.ts
└── types.ts                  # No test file (pure types)
```

### Benefits

- **Clear ownership**: Each test file tests exactly one source file
- **Easy navigation**: Find tests by looking next to the source
- **Focused testing**: Easier to run tests for just one module
- **Maintainability**: When source changes, you know which test file to update

### What Gets Test Files

| File Type                      | Test File? | Reason                                |
| ------------------------------ | ---------- | ------------------------------------- |
| Functions/classes with logic   | Yes        | Has behavior to test                  |
| Type definitions only          | No         | No runtime behavior                   |
| Re-export barrels (`index.ts`) | No         | Just re-exports, tested via consumers |
| Internal helpers               | Maybe      | Test via consumer if tightly coupled  |

### Naming Convention

- Source: `foo-bar.ts`
- Test: `foo-bar.test.ts`

### Integration Tests

For tests spanning multiple modules, either:

- Add to the test file of the highest-level consumer
- Create a dedicated `[feature].integration.test.ts` if substantial
