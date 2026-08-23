# Versioned Table and KV Specification

## Overview

This specification defines APIs for versioned data storage in local-first applications, enabling schema evolution without traditional migrations. Data is validated against a union of all schema versions on read, then migrated to the latest version.

### Related Specs

- `specs/20260126T103000-table-api-split.md` - Versioned Tables vs Dynamic Tables distinction
- Removed `specs/20260126T120000-static-workspace-api.md` - historical full API for defineTable, defineKv, defineWorkspace, and composability, recoverable through `docs/spec-history.md`

---

## Core Concepts

### Why This Works: Granularity Match

This versioning pattern is possible because **the granularity of the schema matches the granularity of writes**:

- **Tables**: We do row-level edits, not cell-level edits. The entire row is written atomically, so the entire row can have a coherent schema version.
- **KV**: Each value is written atomically, so each value can have its own schema version.

If we had cell-level edits (like the current `table-helper.ts`), versioned schemas wouldn't work because different cells could be at different versions after concurrent edits.

### Migrate-on-Read Pattern

1. Store data as atomic JSON blobs (last-write-wins)
2. On read, validate against union of all registered schemas
3. Run user-provided migration function to normalize to latest version
4. Return strongly-typed latest version to caller
5. **Reads are pure** - we do NOT write migrated data back automatically

### User-Defined Discriminator (Highly Recommended)

While the library does NOT require a version field, **it is highly recommended** that users include one. Both patterns work, but explicit versioning is cleaner and less error-prone.

#### Pattern 1: With Discriminator (Recommended)

```typescript
const posts = defineTable('posts')
  .version(type({ id: 'string', title: 'string', _v: '"1"' }))
  .version(type({ id: 'string', title: 'string', views: 'number', _v: '"2"' }))
  .version(type({ id: 'string', title: 'string', views: 'number', author: 'string | null', _v: '"3"' }))
  .migrate((row) => {
    // Clean switch statement - easy to read and maintain
    switch (row._v) {
      case '1':
        return { ...row, views: 0, author: null, _v: '3' as const };
      case '2':
        return { ...row, author: null, _v: '3' as const };
      case '3':
        return row;
    }
  });
```

**Why this is preferred:**
- Clear and explicit versioning
- Simple switch/if statements in migration
- Easy to understand which version you're dealing with
- Works well with TypeScript discriminated unions
- Less fragile than checking field presence

#### Pattern 2: Without Discriminator (Works but Not Recommended)

```typescript
const posts = defineTable('posts')
  .version(type({ id: 'string', title: 'string' }))
  .version(type({ id: 'string', title: 'string', views: 'number' }))
  .version(type({ id: 'string', title: 'string', views: 'number', author: 'string | null' }))
  .migrate((row) => {
    // Check for field presence - works but can be fragile
    let current = row;

    if (!('views' in current)) {
      current = { ...current, views: 0 };
    }
    if (!('author' in current)) {
      current = { ...current, author: null };
    }

    return current;
  });
```

**Why this is less ideal:**
- Fragile if fields are optional or can be undefined
- Harder to reason about which version you're handling
- No TypeScript discriminated union support
- Can break if you remove a field in a later version

**Both patterns are fully supported**, but Pattern 1 is the recommended approach for production use.

### Design Decision: Why User-Defined Discriminator?

We considered having the library automatically inject a `__v` field:

```typescript
// Alternative: Library-managed version field (NOT chosen)
.version(schema1)  // Library adds __v: 1
.version(schema2)  // Library adds __v: 2
```

**We chose user-defined discriminators instead because:**

1. **No magic** - Users see exactly what's in their data
2. **Flexibility** - Users can name it `_v`, `version`, `schemaVersion`, whatever fits their domain
3. **Value flexibility** - Users can use numbers (`1, 2, 3`), strings (`'v1', 'v2'`), or anything else
4. **Simpler implementation** - Library doesn't need to inject/strip fields
5. **Debugging clarity** - When you look at raw data, you see the version field you defined

The trade-off is users must remember to add the discriminator. We mitigate this by strongly recommending it in documentation.

### Standard Schema Union

Internally, schemas are combined into a Standard Schema union:

```typescript
function createUnionStandardSchema<TSchemas extends StandardSchemaV1[]>(
  schemas: TSchemas
): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'epicenter',
      validate: (value) => {
        for (const schema of schemas) {
          const result = schema['~standard'].validate(value);
          if (!result.issues) return result;
        }
        return { issues: [{ message: 'No schema version matched' }] };
      }
    }
  };
}
```

This works with any Standard Schema-compatible library (Zod, ArkType, TypeBox, Valibot).

### Design Decision: Why Standard Schema Union?

We considered several validation strategies:

| Strategy | How It Works | Performance | Pros | Cons |
|----------|--------------|-------------|------|------|
| **Try schemas newest-first** | Iterate and try each schema until one passes | O(n) | No discriminator needed | Schemas can overlap (v2 data might pass v1 validation) |
| **Check discriminator, then validate** | Read `_v` field, validate against that schema | O(1) | Fast, precise | Requires discriminator in data |
| **Standard Schema union** | Create union schema, let library handle it | O(n) or O(1)* | Library-agnostic, works with any validation library | Depends on library implementation |

*ArkType auto-discriminates unions for O(1). Other libraries are O(n).

**We chose Standard Schema union because:**

1. **Library-agnostic** - Users can use Zod, ArkType, TypeBox, Valibot, or mix
2. **No data requirements** - Works even without a discriminator field
3. **Simple implementation** - Just wrap schemas in a union
4. **Future-proof** - As validation libraries improve, we get the benefits automatically

---

## Table API

### Storage Architecture

```
Y.Doc (gc: true)
└── tables (Y.Map<tableName, YKeyValue>)
     └── posts (YKeyValue<{ key: string, val: Row }>)
          ├── { key: "row-1", val: { id: "row-1", title: "Hello", views: 42 } }
          └── { key: "row-2", val: { id: "row-2", title: "World", views: 100 } }
```

- **YKeyValue** provides bounded memory (vs Y.Map's unbounded growth)
- Rows are atomic JSON blobs (last-write-wins on entire row)
- Enables schema evolution since entire row is replaced together

See benchmark: `packages/epicenter/scripts/ymap-vs-ykeyvalue-benchmark.ts`

### API: defineTable

```typescript
import { defineTable, createTables } from 'epicenter';
import { type } from 'arktype';  // or zod, typebox, valibot

// Define table with schema versions
const postsDefinition = defineTable('posts')
  .version(type({ id: 'string', title: 'string' }))
  .version(type({ id: 'string', title: 'string', views: 'number' }))
  .version(type({ id: 'string', title: 'string', views: 'number', author: 'string | null' }))
  .migrate((row) => {
    // row is V1 | V2 | V3, must return V3
    if (!('views' in row)) {
      return { ...row, views: 0, author: null };
    }
    if (!('author' in row)) {
      return { ...row, author: null };
    }
    return row;
  });

// Bind to Y.Doc
const tables = createTables(ydoc, {
  posts: postsDefinition,
  users: usersDefinition,
});

// Usage
tables.posts.set({ id: 'post-1', title: 'Hello', views: 0, author: null });
const post = tables.posts.get('post-1');  // Validated + migrated
```

### Type Signature

```typescript
function defineTable(name: string): TableBuilder<[], never>;

type TableBuilder<TVersions extends StandardSchemaV1[], TLatest> = {
  // Schema must extend { id: string } - enforced at type level
  version<TSchema extends StandardSchemaV1>(
    schema: StandardSchemaV1.InferOutput<TSchema> extends { id: string }
      ? TSchema
      : never
  ): TableBuilder<[...TVersions, TSchema], StandardSchemaV1.InferOutput<TSchema>>;

  migrate(
    fn: (row: StandardSchemaV1.InferOutput<TVersions[number]>) => TLatest
  ): TableDefinition<TLatest>;
};

type TableDefinition<TRow extends { id: string }> = {
  readonly name: string;
  readonly versions: readonly StandardSchemaV1[];
  readonly unionSchema: StandardSchemaV1;
  readonly migrate: (row: unknown) => TRow;
};
```

### Single Version (No Migration Needed)

```typescript
// When there's only one version, migrate just returns the row
const simpleTable = defineTable(type({ id: 'string', name: 'string', _v: '1' }));
```

### Design Decision: Why `.version().migrate()` API Shape?

We considered several API patterns:

**Option A: Explicit version numbers (not chosen)**
```typescript
defineTable('posts')
  .v1(schema1)
  .v2(schema2)
  .v3(schema3)
  .migrate(fn);
```
Rejected: Verbose, limits to predefined version count.

**Option B: Migration per version (not chosen)**
```typescript
defineTable('posts')
  .version(schema1)
  .version(schema2, (v1) => ({ ...v1, views: 0 }))
  .version(schema3, (v2) => ({ ...v2, author: null }));
```
Rejected: Couples migration to version definition, harder to do direct jumps (v1→v3).

**Option C: `.version().migrate()` (chosen)**
```typescript
defineTable('posts')
  .version(schema1)
  .version(schema2)
  .version(schema3)
  .migrate(fn);
```

**Why we chose this:**
1. **Clean separation** - Schema definitions separate from migration logic
2. **Full control** - User implements migration however they want (incremental, direct, hybrid)
3. **Simpler types** - Migration function is `(V1 | V2 | V3) => V3`
4. **Familiar pattern** - Builder pattern with terminal `.migrate()` is intuitive

### Design Decision: Why `id` in Row (Not Separate Parameter)?

We considered two API patterns for `set()`:

**Option A: `set(row)` where row includes id (chosen)**
```typescript
tables.posts.set({ id: 'post-1', title: 'Hello', views: 0 });
```

**Option B: `set(id, row)` where row omits id (not chosen)**
```typescript
tables.posts.set('post-1', { title: 'Hello', views: 0 });
```

**Why we chose Option A:**

1. **Read/write symmetry** - `get()` returns `TRow` with id, `set()` takes `TRow` with id. No type gymnastics.
   ```typescript
   const post = tables.posts.get('post-1');
   tables.posts.set({ ...post, views: post.views + 1 }); // Just spread and update
   ```

2. **Self-contained rows** - When iterating with `getAll()`, each row stands alone. No need to zip keys with values.

3. **No mismatch risk** - With `set(id, row)`, if `row` also has an `id` field, which one wins? Confusing.

4. **Domain modeling** - The id *is* a property of the entity, not just a storage address. A Post has an id.

5. **Type enforcement** - All schemas must extend `{ id: string }`, enforced at compile time.

**Trade-off:** Slight redundancy at call site (`id` appears in property), but this is outweighed by consistency benefits.

**Reference:** Dexie.js supports both patterns, but their primary/common pattern is also id-in-object.

### Table Helper Methods

```typescript
type TableHelper<TRow extends { id: string }> = {
  // Read (validates + migrates)
  get(id: string): GetResult<TRow>;
  getAll(): RowResult<TRow>[];
  getAllValid(): TRow[];
  filter(predicate: (row: TRow) => boolean): TRow[];
  find(predicate: (row: TRow) => boolean): TRow | null;

  // Write (always writes latest schema shape)
  // Row includes id - no separate id parameter needed
  set(row: TRow): void;
  setMany(rows: TRow[]): void;

  // Delete
  delete(id: string): void;
  deleteMany(ids: string[]): DeleteManyResult;
  clear(): void;

  // Observe
  observe(callback: (changedIds: Set<string>, transaction: Y.Transaction) => void): () => void;

  // Metadata
  count(): number;
  has(id: string): boolean;
};
```

---

## KV API

### Storage Architecture

```
Y.Doc (gc: true)
└── kv (YKeyValue<{ key: string, val: JSON }>)
     ├── { key: "theme", val: { value: "dark", fontSize: 14 } }
     ├── { key: "sidebar", val: { collapsed: false, width: 250 } }
     └── { key: "user", val: { name: "Alice", avatar: null } }
```

- **YKeyValue** for KV (consistent with tables, bounded memory)
- Each key's value is an atomic JSON blob
- Different keys can have different schema evolution paths

#### Why YKeyValue over Y.Map?

Benchmarks show Y.Map has unbounded memory growth with frequent updates:

| Updates/Key | Y.Map Size | YKeyValue Size | Ratio |
|-------------|------------|----------------|-------|
| 1 | 194 B | 225 B | Similar |
| 10 | 562 B | 241 B | Y.Map 2.3x larger |
| 100 | 4.43 KB | 254 B | Y.Map 18x larger |
| 1000 | 44 KB | 259 B | Y.Map 174x larger |

For consistency with tables and bounded memory, we use YKeyValue for both.

### API: defineKv

```typescript
import { defineKv, createKv } from 'epicenter';
import { type } from 'arktype';

// Define KV keys with schema versions
const themeDefinition = defineKv('theme')
  .version(type({ value: "'light' | 'dark'" }))
  .version(type({ value: "'light' | 'dark' | 'system'", fontSize: 'number' }))
  .migrate((v) => {
    if (!('fontSize' in v)) {
      return { ...v, fontSize: 14 };
    }
    return v;
  });

const sidebarDefinition = defineKv('sidebar')
  .version(type({ collapsed: 'boolean' }))
  .version(type({ collapsed: 'boolean', width: 'number' }))
  .migrate((v) => {
    if (!('width' in v)) {
      return { ...v, width: 250 };
    }
    return v;
  });

// Bind to Y.Doc
const kv = createKv(ydoc, {
  theme: themeDefinition,
  sidebar: sidebarDefinition,
});

// Usage
kv.theme.set({ value: 'dark', fontSize: 16 });
const theme = kv.theme.get();  // Validated + migrated
```

### Type Signature

```typescript
function defineKv(key: string): KvBuilder<[], never>;

type KvBuilder<TVersions extends StandardSchemaV1[], TLatest> = {
  version<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): KvBuilder<[...TVersions, TSchema], StandardSchemaV1.InferOutput<TSchema>>;

  migrate(
    fn: (value: StandardSchemaV1.InferOutput<TVersions[number]>) => TLatest
  ): KvDefinition<TLatest>;
};

type KvDefinition<TValue> = {
  readonly key: string;
  readonly versions: readonly StandardSchemaV1[];
  readonly unionSchema: StandardSchemaV1;
  readonly migrate: (value: unknown) => TValue;
};
```

### KV Helper Methods

```typescript
type KvHelper<TValue> = {
  // Read (validates + migrates)
  get(): KvGetResult<TValue>;

  // Write (always writes latest schema shape)
  set(value: TValue): void;

  // Reset to default (if defined) or delete
  reset(): void;

  // Observe
  observe(callback: (change: KvChange<TValue>, transaction: Y.Transaction) => void): () => void;
};

type KvGetResult<TValue> =
  | { status: 'valid'; value: TValue }
  | { status: 'invalid'; key: string; error: KVValidationError }
  | { status: 'not_found'; key: string };
```

---

## Internal Implementation

### TableDefinition Structure

```typescript
const postsDefinition = defineTable('posts')
  .version(v1Schema)
  .version(v2Schema)
  .version(v3Schema)
  .migrate(migrateFn);

// Internal structure:
{
  name: 'posts',
  versions: [v1Schema, v2Schema, v3Schema],
  unionSchema: createUnionStandardSchema([v1Schema, v2Schema, v3Schema]),
  migrate: migrateFn,
}
```

### Validation + Migration Flow

```typescript
function parseRow<TRow>(
  definition: TableDefinition<TRow>,
  rawRow: unknown
): RowResult<TRow> {
  // 1. Validate against union of all versions
  const result = definition.unionSchema['~standard'].validate(rawRow);

  if (result.issues) {
    return {
      status: 'invalid',
      id: (rawRow as any)?.id ?? 'unknown',
      tableName: definition.name,
      errors: result.issues,
      row: rawRow,
    };
  }

  // 2. Run migration to normalize to latest
  const migrated = definition.migrate(result.value);

  return { status: 'valid', row: migrated };
}
```

### createTables Implementation

```typescript
function createTables<TDefs extends Record<string, TableDefinition<{ id: string }>>>(
  ydoc: Y.Doc,
  definitions: TDefs
): { [K in keyof TDefs]: TableHelper<TDefs[K] extends TableDefinition<infer R> ? R : never> } {
  const ytables = ydoc.getMap<YKeyValue<any>>('tables');

  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      // Get or create YKeyValue for this table
      let yarray = ytables.get(name);
      if (!yarray) {
        yarray = ydoc.getArray(`table:${name}`);
        ytables.set(name, yarray);
      }
      const ykv = new YKeyValue(yarray);

      return [name, createTableHelper(ykv, definition)];
    })
  ) as any;
}
```

### createKv Implementation

```typescript
function createKv<TDefs extends Record<string, KvDefinition<any>>>(
  ydoc: Y.Doc,
  definitions: TDefs
): { [K in keyof TDefs]: KvHelper<TDefs[K] extends KvDefinition<infer V> ? V : never> } {
  // Use YKeyValue for bounded memory (consistent with tables)
  const yarray = ydoc.getArray<{ key: string; val: unknown }>('kv');
  const ykv = new YKeyValue(yarray);

  return Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      return [name, createKvHelper(ykv, definition)];
    })
  ) as any;
}
```

---

## Complete Example

```typescript
import * as Y from 'yjs';
import { defineTable, defineKv, createTables, createKv } from 'epicenter';
import { type } from 'arktype';

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

// Table: posts (3 versions)
const posts = defineTable(
  type({ id: 'string', title: 'string', content: 'string', _v: '1' }),
  type({ id: 'string', title: 'string', content: 'string', views: 'number', publishedAt: 'string | null', _v: '2' }),
  type({ id: 'string', title: 'string', content: 'string', views: 'number', publishedAt: 'string | null', tags: 'string[]', _v: '3' }),
).migrate((row) => {
  // V1 → V3
  if (row._v === 1) {
    return { ...row, views: 0, publishedAt: null, tags: [], _v: 3 as const };
  }
  // V2 → V3
  if (row._v === 2) {
    return { ...row, tags: [], _v: 3 as const };
  }
  // V3 → V3
  return row;
});

// Table: users (1 version - no migration needed)
const users = defineTable(type({ id: 'string', email: 'string', name: 'string', _v: '1' }));

// KV: theme (2 versions)
const theme = defineKv(
  type({ mode: "'light' | 'dark'", _v: '1' }),
  type({ mode: "'light' | 'dark' | 'system'", accentColor: 'string', _v: '2' }),
).migrate((v) => {
  if (v._v === 1) {
    return { ...v, accentColor: '#3b82f6', _v: 2 as const };
  }
  return v;
});

// KV: sidebar (1 version)
const sidebar = defineKv(type({ collapsed: 'boolean', width: 'number', _v: '1' }));

// ═══════════════════════════════════════════════════════════════════════════
// BIND TO Y.DOC
// ═══════════════════════════════════════════════════════════════════════════

const ydoc = new Y.Doc({ gc: true });

const tables = createTables(ydoc, { posts, users });
const kv = createKv(ydoc, { theme, sidebar });

// ═══════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════

// Write (always latest version)
tables.posts.set({
  id: 'post-1',
  title: 'Hello World',
  content: 'My first post',
  views: 0,
  publishedAt: null,
  tags: ['intro'],
});

// Read (validates + migrates)
const post = tables.posts.get('post-1');
if (post.status === 'valid') {
  console.log(post.row.tags);  // ['intro']
}

// KV
kv.theme.set({ mode: 'dark', accentColor: '#10b981' });
const themeValue = kv.theme.get();
if (themeValue.status === 'valid') {
  console.log(themeValue.value.mode);  // 'dark'
}

// Observe changes
tables.posts.observe((changedIds) => {
  for (const id of changedIds) {
    const result = tables.posts.get(id);
    if (result.status === 'not_found') {
      console.log('Deleted:', id);
    } else if (result.status === 'valid') {
      console.log('Changed:', result.row);
    }
  }
});
```

---

## Design Decision: No Automatic Write-Back

**Question**: After reading and migrating old data, should we automatically write the migrated version back?

**Answer**: No. Reads should be pure and not cause writes.

**Rationale:**

| Approach | Pros | Cons |
|----------|------|------|
| **Auto write-back** | Data upgrades over time; future reads faster | Reads cause writes (unexpected); increases sync traffic; potential conflicts if multiple clients read simultaneously |
| **Read-only migration (chosen)** | Reads are pure and predictable; no surprise sync traffic; no conflicts from reads | Old data stays old until explicitly updated |

**If users want to persist migrations**, they can explicitly write after reading:

```typescript
const result = tables.posts.get('post-1');
if (result.status === 'valid') {
  // Optionally persist the migrated version
  tables.posts.set(result.row);
}
```

**Future consideration**: Could add opt-in `writeback: true` option if needed.

---

## Migration Best Practices

### 1. Check for Field Presence (Recommended)

```typescript
.migrate((row) => {
  if (!('views' in row)) {
    return { ...row, views: 0 };
  }
  return row;
})
```

### 2. Use a Version Field (Optional)

```typescript
// If you want explicit version tracking, add it to your schema:
.version(type({ id: 'string', title: 'string', _v: '1' }))
.version(type({ id: 'string', title: 'string', views: 'number', _v: '2' }))
.migrate((row) => {
  if (row._v === '1') {
    return { ...row, views: 0, _v: '2' as const };
  }
  return row;
})
```

### 3. Handle Multiple Versions Cleanly

```typescript
.migrate((row) => {
  let current = row;

  // V1 → V2: Add views
  if (!('views' in current)) {
    current = { ...current, views: 0 };
  }

  // V2 → V3: Add author
  if (!('author' in current)) {
    current = { ...current, author: null };
  }

  // V3 → V4: Add tags
  if (!('tags' in current)) {
    current = { ...current, tags: [] };
  }

  return current as LatestRow;
})
```

---

## TODO

- [ ] Implement `defineTable` builder with TypeScript inference
- [ ] Implement `defineKv` builder with TypeScript inference
- [ ] Implement `createUnionStandardSchema` for library-agnostic validation
- [ ] Implement `createTables` binding function
- [ ] Implement `createKv` binding function
- [ ] Add tests for migration scenarios
- [ ] Add tests for validation error handling
- [ ] Benchmark union validation performance
- [ ] Consider write-back optimization (persist migrated data)
