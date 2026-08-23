# Inline Single-Use Definitions in Tests

When writing tests, a common pattern is to extract schema definitions, builders, or configurations into variables before passing them to the function under test. This feels organized but often adds cognitive overhead without benefit.

## The Problem

AI coding assistants and many developers default to extracting every definition:

```typescript
test('binds tables to a Y.Doc', () => {
  const posts = defineTable({
    id: field.string(),
    title: field.string(),
  });

  const theme = defineKv(
    field.select(['light', 'dark']),
    () => 'light' as const,
  );

  const ydoc = new Y.Doc();
  const tables = attachTables(ydoc, { posts });
  const kv = attachKv(ydoc, { theme });

  expect(tables.posts.count()).toBe(0);
  expect(kv.theme.get()).toBe('light');
});
```

This pattern forces the reader to:

1. See `posts` and `theme` used in `attachTables` / `attachKv`
2. Scroll up to understand what they are
3. Mentally connect the variable name to its definition

The variable names (`posts`, `theme`) don't add information. They're just the same as the property keys.

## The Better Pattern

Inline single-use definitions directly at the call site:

```typescript
test('binds tables to a Y.Doc', () => {
  const ydoc = new Y.Doc();
  const tables = attachTables(ydoc, {
    posts: defineTable({
      id: field.string(),
      title: field.string(),
    }),
  });
  const kv = attachKv(ydoc, {
    theme: defineKv(
      field.select(['light', 'dark']),
      () => 'light' as const,
    ),
  });

  expect(tables.posts.count()).toBe(0);
  expect(kv.theme.get()).toBe('light');
});
```

Everything is visible in one place. No scrolling, no mental variable binding.

## Why Inlining is Better

### 1. All Context in One Place

The reader sees the complete picture without jumping around the file. The definition and its usage are the same conceptual unit, so they should be the same textual unit.

### 2. Reduces Naming Overhead

No need to invent variable names for single-use values. The property key (`posts`, `theme`) already provides the name. A variable would just duplicate it.

### 3. Matches the Mental Model

For attachment primitives like `attachTables()` or `attachKv()`, the definition IS the usage. You're not defining a table and then doing something else with it. You're defining a table to bind to a Y.Doc. They're inseparable.

### 4. Easier to Copy and Modify

Self-contained test setup is easier to duplicate and tweak for variations. You copy one block, not scattered variables.

## When to Extract

Extract to a variable when:

- **Used multiple times**: If `posts` is referenced twice in the same test, extract it
- **Need to call methods on the result**: Testing `posts.versions.length` or intermediate builder steps requires a variable
- **Shared across tests**: In a `beforeEach` or shared test fixture
- **Exceeds readability threshold**: If inline would be 15-20+ lines, consider extracting

## What This Applies To

- `defineTable()`, `defineKv()` definitions
- `attachTables()`, `attachKv()` attachment calls
- Schema definitions (TypeBox, zod, valibot, arktype)
- Configuration objects passed to factories
- Mock functions used only once
- Any builder pattern where the output is consumed immediately

## The Composability Trap

Layered APIs often encourage extraction because they're designed for composability. You CAN define tables separately and compose them. But just because an API supports composition doesn't mean you should always use it.

For tests especially, composition is overrated. Each test should be self-contained and readable. The "reuse" benefit of extracted definitions rarely materializes. Tests are usually slight variations, not exact duplicates.

When someone is reading your test six months from now, they want to see the complete setup in one place. They don't want to hunt for variable definitions scattered across the file.
