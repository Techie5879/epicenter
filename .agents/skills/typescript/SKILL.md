---
name: typescript
description: TypeScript style, type co-location, naming conventions (acronym casing), arktype patterns. Use when mentioning TS types, naming, or writing .ts files, defining types, organizing tests.
metadata:
  author: epicenter
  version: '2.0'
---

# TypeScript Guidelines

> **Related Skills**: See `arktype` for runtime type validation patterns. See `typebox` for TypeBox schema patterns. See `testing` for test file conventions.

## When to Apply This Skill

Use this pattern when you need to:

- Write or refactor TypeScript code with project-wide naming and style conventions.
- Choose clear control-flow/value-mapping patterns for unions and discriminated values.
- Apply baseline TypeScript defaults before loading specialized sub-topic guidance.

## References

Load these on demand based on what you're working on:

- If working with **type placement and constants organization** (`types.ts` location, co-location rules, inline-vs-extract hop test, options/IDs naming), read [references/type-organization.md](references/type-organization.md)
- If working with **factory-focused refactors** (parameter destructuring, extracting coupled `let` state into sub-factories), read [references/factory-patterns.md](references/factory-patterns.md)
- If working with **arktype + branded IDs** (optional property syntax, brand constructors, workspace table IDs), read [references/runtime-schema-patterns.md](references/runtime-schema-patterns.md)
- If working with **test writing and test file layout** (inline single-use setup, source-shadowing tests), read [references/testing-patterns.md](references/testing-patterns.md)
- If working with **advanced TS/ES features** (iterator helpers, const generic array inference), read [references/advanced-typescript-features.md](references/advanced-typescript-features.md)

---

## Core Rules

- **Do not add a type until you have tried to derive or import it**: New named
  types are guilty until proven useful. Before declaring a type, check whether
  the shape already exists in an external library, an arktype/typebox schema, a
  factory return value, a runtime constant, or a function signature.

  ```typescript
  // Good: imported from the owner package
  import type { User } from 'better-auth';

  // Good: derived from a runtime schema
  export const AuthUser = type({ id: 'string', email: 'string' });
  export type AuthUser = typeof AuthUser.infer;

  // Good: derived from a function or factory
  type TokenOptions = Parameters<typeof verifyAccessToken>[1];
  export type AuthClient = ReturnType<typeof createAuthClient>;

  // Bad: hand-written copy of a shape owned elsewhere
  type OAuthPayload = { sub?: unknown };
  type AuthClient = { signOut(): Promise<void> };
  ```

  Keep explicit named types when they are the real contract: public package API,
  protocol vocabulary, discriminated result unions, capability ports, or shapes
  implemented by more than one runtime. Prefer `satisfies` when an
  implementation should be checked against a contract while keeping inference
  pointed at the concrete value.

- **Local shape copies are boundary smells**: A local type that exists only to
  imitate an upstream value should be suspicious before it becomes normal. The
  common tells are names ending in `Like`, casts to local `Like` types,
  `as Record<string, unknown>` inside already-typed internal code,
  `Pick<T, 'singleMethod'>` dependency seams, test-only
  `Parameters<typeof fn>[n]` gymnastics, and production casts whose only job is
  to make a test fake compile.

  ```typescript
  // Bad: local copy of a dependency shape
  type AuthClientLike = {
    signOut(): Promise<void>;
  };

  // Good: name the caller's actual capability
  type SignOut = () => Promise<void>;
  ```

  Prefer the owning runtime type, schema, factory return type, function
  signature, or a caller-owned capability function. Keep incomplete fake objects
  in tests, checked with `satisfies` when useful, instead of widening
  production code to accommodate them. See
  `docs/articles/copied-types-are-boundary-leaks.md` for the full review
  pattern.

- Always use `type` instead of `interface` in TypeScript.
- **`readonly` only for arrays and maps**: Never use `readonly` on primitive properties or object properties. The modifier is shallow and provides little protection for non-collection types. Use it only where mutation is a realistic footgun:

  ```typescript
  // Good - readonly only on the array
  type Config = {
  	version: number;
  	vendor: string;
  	items: readonly string[];
  };

  // Bad - readonly everywhere is noise
  type Config = {
  	readonly version: number;
  	readonly vendor: string;
  	readonly items: readonly string[];
  };
  ```

  Exception: Match upstream library types exactly (e.g., standard-schema interfaces). See `docs/articles/readonly-is-mostly-noise.md` for rationale.

- **Acronyms in camelCase**: Treat acronyms as single words, capitalizing only the first letter:

  ```typescript
  // Correct - acronyms as words
  parseUrl();
  defineKv();
  readJson();
  customerId;
  httpClient;

  // Incorrect - all-caps acronyms
  parseURL();
  defineKV();
  readJSON();
  customerID;
  HTTPClient;
  ```

  Exception: Match existing platform APIs (e.g., `XMLHttpRequest`). See `docs/articles/acronyms-in-camelcase.md` for rationale.

- TypeScript 5.5+ automatically infers type predicates in `.filter()` callbacks. Don't add manual type assertions:

  ```typescript
  // Good - TypeScript infers the narrowed type automatically
  const filtered = items.filter((x) => x !== undefined);

  // Bad - unnecessary type predicate
  const filtered = items.filter(
  	(x): x is NonNullable<typeof x> => x !== undefined,
  );
  ```

- When moving components to new locations, always update relative imports to absolute imports (e.g., change `import Component from '../Component.svelte'` to `import Component from '$lib/components/Component.svelte'`)
- **Use `.js` extensions in relative imports**: The monorepo uses `"module": "preserve"` in tsconfig, which requires explicit file extensions. Always use `.js` (not `.ts`) in relative import paths—TypeScript resolves `.js` to the corresponding `.ts` file at compile time:

  ```typescript
  // Good — .js extension in relative imports
  import { parseSkill } from './parse.js';
  import type { Skill } from './types.js';

  // Bad — no extension (fails with module: preserve)
  import { parseSkill } from './parse';

  // Bad — .ts extension (non-standard, won't resolve correctly)
  import { parseSkill } from './parse.ts';
  ```

  This does NOT apply to package imports (`import { type } from 'arktype'`) or path aliases (`import Component from '$lib/components/Foo.svelte'`)—only bare relative paths.
- **`export { }` is only for barrel files**: Every symbol is exported directly at its declaration (`export type`, `export const`, `export function`). The `export { Foo } from './bar'` re-export syntax is reserved for `index.ts` barrel files—that's their entire job. Don't add re-exports at the bottom of implementation files "for convenience"; they go unused, leave orphaned imports, and create a false second import path.

  ```typescript
  // Good — direct export at declaration
  export type TablesHelper<T> = { ... };
  export const EncryptionKey = type({ ... });
  export function createTables(...) { ... }

  // Good — barrel re-exports in index.ts
  export { createTables } from './create-tables.js';
  export type { TablesHelper } from './types.js';

  // Bad — re-export at bottom of create-tables.ts
  export type { TablesHelper, TableDefinitions };
  ```
- **Question single-method `Pick` dependencies**: `Pick<T, K>` is fine for data projection, but `Pick<Thing, 'method'>` in dependency injection is often a boundary smell. If the caller only needs one operation, prefer a named capability function in the caller's language. Keep the object shape only when the caller participates in that object's life cycle or needs the rest of the capability family. See `docs/articles/single-method-pick-is-a-boundary-leak.md`.
- When functions are only used in the return statement of a factory/creator function, use object method shorthand syntax instead of defining them separately. For example, instead of:
  ```typescript
  function myFunction() {
  	const helper = () => {
  		/* ... */
  	};
  	return { helper };
  }
  ```
  Use:
  ```typescript
  function myFunction() {
  	return {
  		helper() {
  			/* ... */
  		},
  	};
  }
  ```
- **Prefer factory functions over classes**: Use `function createX() { return { ... } }` instead of `class X { ... }`. Closures provide structural privacy—everything above the return statement is private by position, everything inside it is the public API. Classes mix `private`/`protected`/public members in arbitrary order, forcing you to scan every member and check its modifier. See `docs/articles/closures-are-better-privacy-than-keywords.md` for rationale.
- **Generic type parameters use `T` prefix + descriptive name**: Never use single letters like `S`, `D`, `K`. Always prefix with `T` and use the full name:

  ```typescript
  // Good — descriptive with T prefix
  function validate<TSchema extends StandardSchemaV1>(schema: TSchema) { ... }
  type MapOptions<TDefs extends Record<string, Definition>> = { ... };
  function get<TKey extends string & keyof TDefs>(key: TKey) { ... }

  // Bad — single letters
  function validate<S extends StandardSchemaV1>(schema: S) { ... }
  type MapOptions<D extends Record<string, Definition>> = { ... };
  function get<K extends string & keyof D>(key: K) { ... }
  ```

- **Destructure options in function signature, not the first line of the body**:

  ```typescript
  // Good — destructure in the signature
  export function createThing<T>({
  	name,
  	value,
  	onError,
  }: ThingOptions<T>) {
  	// function body starts here
  }

  // Bad — intermediate `options` parameter, destructured on first line
  export function createThing<T>(options: ThingOptions<T>) {
  	const { name, value, onError } = options;
  	// ...
  }
  ```

  This includes the common half-fix where a function accepts `options`, then
  immediately does `const { foo } = options` or `const { foo } = options ?? {}`.
  Move that destructuring into the call signature instead:

  ```typescript
  // Good
  export function createThing({
    name,
    value = defaultValue,
  }: ThingOptions = {}) {
    // ...
  }

  // Bad
  export function createThing(options: ThingOptions = {}) {
    const { name, value = defaultValue } = options;
    // ...
  }
  ```

  Use judgment for real payload objects. Keep a named `options` parameter when
  the value is the domain object being transformed or forwarded as a whole,
  when the object is intentionally stateful, or when destructuring would make
  the signature harder to scan than the body. For configuration bags with
  defaults or a few plucked fields, destructure in the signature.

- **Don't annotate return types the compiler can infer**: Let TypeScript infer return types on inner/private functions. Only annotate return types on exported public API functions when the inferred type is too complex or when you need to break circular inference.

  ```typescript
  // Good: inner functions let TS infer
  function parseValue(raw: string | null) {
  	if (raw === null) return defaultValue;
  	return JSON.parse(raw);
  }

  // Bad: unnecessary return type annotation
  function parseValue(raw: string | null): SomeType {
  	if (raw === null) return defaultValue;
  	return JSON.parse(raw);
  }
  ```

- **Factory return types derive from the factory**: If a public type is exactly the return object from a `create*` function, export the type as `ReturnType<typeof createThing>` and let the function return its concrete object. If the public type is a nested slice of a factory result, use a focused inference helper like `InferSignedIn<typeof session>`. Put needed annotations on the returned methods and properties instead of on the factory itself. This keeps one source of truth and makes Go to Definition land on the returned object shape.

  ```typescript
  // Good: the factory owns the shape
  export type BrowserDocCache<
    TId extends string,
    TDocument extends BrowserDocInstance,
  > = ReturnType<typeof createBrowserDocCache<TId, TDocument>>;

  export function createBrowserDocCache<
    TId extends string,
    TDocument extends BrowserDocInstance,
  >(source: BrowserDocSource<TId, TDocument>) {
    return {
      open(id: TId): TDocument & Disposable {
        return source.create(id);
      },
    };
  }

  // Bad: the type and return object now describe the same shape twice
  export type BrowserDocCache<TId extends string, TDocument> = {
    open(id: TId): TDocument & Disposable;
  };

  export function createBrowserDocCache<TId extends string, TDocument>(
    source: BrowserDocSource<TId, TDocument>,
  ): BrowserDocCache<TId, TDocument> {
    return {
      open(id) {
        return source.create(id);
      },
    };
  }
  ```

  Keep explicit contract types when several implementations share the same surface, when the type is protocol vocabulary, or when you intentionally want to hide the concrete return shape. Use `satisfies` when the implementation should be checked against an external contract but the returned value should keep its own inferred shape.

## Identity Checks: Brand, Don't Probe

When `isFoo(x)` is asking "is this the specific thing my factory returned," use a `Symbol` brand stamped at the factory, not a coincidental-property probe. Shape probes collide with look-alikes and rot as the type grows; the brand is unforgeable and survives normal object spreads.

```typescript
// Smell: three coincidental properties stand in for identity.
// Any object that happens to have ydoc + id + Symbol.dispose passes.
function isWorkspaceHandle(value: unknown): value is WorkspaceHandle {
	if (value == null || typeof value !== 'object') return false;
	const record = value as Record<string | symbol, unknown>;
	return (
		'ydoc' in record &&
		'id' in record &&
		typeof record[Symbol.dispose] === 'function'
	);
}

// Better: brand stamped by the factory, one check carries the intent.
// Use `Symbol.for('<namespace>.<thing>')`, not `Symbol(...)`, so the brand
// survives module duplication (see "Cross-package brands" below).
export const WORKSPACE_HANDLE = Symbol.for('epicenter.workspace-handle');

function isWorkspaceHandle(value: unknown): value is WorkspaceHandle {
	return (
		value != null &&
		typeof value === 'object' &&
		WORKSPACE_HANDLE in value
	);
}
```

### Cross-package brands: `Symbol.for`, never `Symbol`

Any brand that has to be recognized across a module boundary — CLI-walks-user-bundles, server-adapter-walks-workspace, AI-tool-bridge-walks-actions — must use the global symbol registry. Plain `Symbol('name')` creates a fresh reference per module evaluation; a monorepo that ends up with two instances of `@epicenter/workspace` (pnpm hoisting, dual CJS/ESM publish, bundler dedup miss, test vs. app resolution) gives each instance its own brand reference. `defineX` from copy A stamps symbol-A; `isX` from copy B checks for symbol-B; the identity check silently fails.

`Symbol.for('epicenter.action')` talks to a process-global registry keyed by the string. Every call anywhere returns the same reference. The brand survives duplication.

```ts
// Wrong — local reference; fails under module duplication
export const ACTION_BRAND = Symbol('epicenter.action');

// Right — registry-resolved; always the same reference
export const ACTION_BRAND = Symbol.for('epicenter.action');
```

Convention: namespace the key (`epicenter.action`, `epicenter.document-handle`), and centralize cross-package brand keys in one `brands.ts` per package so the duplication-safe identity set is visible and reviewable. The brand constant itself is an implementation detail — consumers import the `isX` guard, never the raw symbol.

**When the brand can be local**: if the factory and the check both live in the same file and the type never crosses a package boundary, plain `Symbol()` is fine. The `Symbol.for` rule is specifically for cross-package identity.

**This rule is narrow. It does NOT apply to:**

- **Union narrowing via presence** — `'data' in result` / `'error' in result` on a wellcrafted `Result`, or `'error' in response` on an OAuth response union. The union *is* the contract; the presence check discriminates it.
- **Discriminated union tags** — `switch (change.type)`. The tag is already a brand.
- **Protocol / feature detection** — `Symbol.dispose in x`, `Symbol.asyncIterator in x`, `typeof x.then === 'function'`. These check *capability*, not identity.
- **Single-or-function config** — `typeof baseURL === 'function'` to distinguish a value from a getter. A config API pattern, not a broken contract.
- **Node error inspection** — `'code' in error` on `NodeJS.ErrnoException`. Upstream type genuinely requires it.

**When a shape probe IS the smell, the fix is usually upstream.** If you're about to write `isFoo(x)` that shape-probes an internal factory's output, the factory should stamp a brand. If you're about to shape-probe user input or `JSON.parse` output, validate with arktype/typebox at the boundary — the probe accepts any object that happens to match; the schema rejects anything off-contract.

### Factory output: flat objects, not prototype delegation

When a factory returns a "bag of data + a few lifecycle methods," spread the data and add the methods as own enumerable properties. Don't use `Object.create(bundle)` to inherit the data, and don't hide methods with non-enumerable `Object.defineProperties`.

```ts
// Smell — data lives on the prototype, methods are non-enumerable.
// Object.keys(handle) returns []; {...handle} spreads nothing;
// callers reach through Object.getPrototypeOf(handle) to iterate.
const handle = Object.create(bundle);
Object.defineProperties(handle, {
	dispose:          { value: () => {...} },
	[Symbol.dispose]: { value: () => {...} },
});

// Better — flat, own, enumerable. Spreads, Object.keys, and debuggers all work.
return {
	...bundle,
	dispose: () => {...},
	[Symbol.dispose]: () => {...},
	[DOCUMENT_HANDLE]: true,
};
```

If you're reaching for `Object.create` to get class-like delegation, either write a `class` or flatten — don't simulate one with the other. The only legitimate `Object.defineProperty` in this repo patches a Node-owned getter (`process.stdout.isTTY`) in a test; normal assignment doesn't work there.

### Casts: never `as any`, rarely `as unknown as T`

`as any` in production code is a red flag: either the callee is over-narrow (fix the signature) or the caller is passing the wrong type (fix the call). `as unknown as T` double-casts that mask a real type error are the same smell in disguise — e.g., `generateId() as unknown as BrandedId` should be `as string as BrandedId`, or better, fix `generateId`'s return type.

Legitimate cast exceptions:

- **Generics ceremony in typed builders** — `Object.assign(handler, {...}) as unknown as Query<T, U>` when `Object.assign` erases the generic overload inference. Acceptable when the overload signature is the real contract; keep the cast at the innermost scope.
- **Test fixtures casting mocks** — acceptable in `*.test.ts`, never leaked out of a test file.

### Optional properties: `?.` over `in` or truthiness

When a property is optional in the type (`foo?: () => void`, including symbol keys like `[Symbol.asyncDispose]?: () => Promise<void>`), access it with optional chaining. Don't `in`-check, don't cast, don't truthiness-check. The type already proves the call is safe; runtime probes are redundant and invite casts.

```ts
// Bad — runtime `in` check + cast
if (Symbol.asyncDispose in sink) {
  await (sink as AsyncDisposable)[Symbol.asyncDispose]();
}

// Bad — truthiness check before call
if (handler.onError) handler.onError(err);

// Good — optional chaining handles it
await sink[Symbol.asyncDispose]?.();
handler.onError?.(err);
```

`Partial<AsyncDisposable>` and optional-function property types compose cleanly with `?.()` — no casts needed — and it works identically for string, symbol, and computed keys. Real example from the workspace-logger:

```ts
type LogSink = ((event: LogEvent) => void) & Partial<AsyncDisposable>;

for (const sink of sinks) await sink[Symbol.asyncDispose]?.();
// consoleSink has no dispose → no-op; stateful sinks (file, network) get awaited
```

## Boolean Naming: `is`/`has`/`can` Prefix

Boolean properties, variables, and parameters MUST use a predicate prefix that reads as a yes/no question:

- `is` — state or identity: `isEncrypted`, `isLoading`, `isVisible`, `isActive`
- `has` — possession or presence: `hasToken`, `hasChildren`, `hasError`
- `can` — capability or permission: `canWrite`, `canDelete`, `canUndo`

```typescript
// Good — reads as a question
type Config = {
	isEncrypted: boolean;
	isReadOnly: boolean;
	hasCustomTheme: boolean;
	canExport: boolean;
};

get isEncrypted() { return currentKey !== undefined; }
const isVisible = element.offsetParent !== null;
if (hasToken) { ... }

// Bad — ambiguous, doesn't read as yes/no
type Config = {
	encrypted: boolean;    // adjective without 'is'
	readOnly: boolean;     // could be a noun
	state: boolean;        // what state?
	mode: boolean;         // what mode?
};
```

This applies to:
- Object/type properties (`isActive: boolean`)
- Getter methods (`get isEncrypted()`)
- Local variables (`const isValid = ...`)
- Function parameters (`function toggle(isEnabled: boolean)`)
- Function return values when the function is a predicate (`function isExpired(): boolean`)

Exception: Match upstream library types exactly (e.g., `tab.pinned`, `window.focused` from APIs where the type is externally defined).

## Switch Over If/Else for Value Comparison

When multiple `if`/`else if` branches compare the same variable against string literals (or other constant values), always use a `switch` statement instead. This applies to action types, status fields, file types, strategy names, or any discriminated value.

```typescript
// Bad - if/else chain comparing the same variable
if (change.action === 'add') {
	handleAdd(change);
} else if (change.action === 'update') {
	handleUpdate(change);
} else if (change.action === 'delete') {
	handleDelete(change);
}

// Good - switch statement
switch (change.action) {
	case 'add':
		handleAdd(change);
		break;
	case 'update':
		handleUpdate(change);
		break;
	case 'delete':
		handleDelete(change);
		break;
}
```

Use fall-through for cases that share logic:

```typescript
switch (change.action) {
	case 'add':
	case 'update': {
		applyChange(change);
		break;
	}
	case 'delete': {
		removeChange(change);
		break;
	}
}
```

Use block scoping (`{ }`) when a case declares variables with `let` or `const`.

When NOT to use switch: early returns for type narrowing are fine as sequential `if` statements. If each branch returns immediately and the checks are narrowing a union type for subsequent code, keep them as `if` guards.

### Exhaustiveness via `default: x satisfies never`

When switching over a **closed type** — a discriminated union, a defineErrors variant, a literal-string enum, a migration version — guard the switch with an exhaustiveness check so adding a new variant breaks the build until every site handles it.

```typescript
// Good — adding a new RpcError variant fails the build here
switch (error.name) {
	case 'ActionNotFound':
		handleNotFound(error.action);
		return;
	case 'Timeout':
		handleTimeout(error.ms);
		return;
	case 'PeerOffline':
	case 'PeerLeft':
		handleDisconnect();
		return;
	case 'ActionFailed':
		handleFailure(error.cause);
		return;
	case 'Disconnected':
		handleDisconnect();
		return;
	default:
		error satisfies never;
}
```

Why `satisfies never` and not `const _exhaustive: never = error; void _exhaustive;`? Same compile-time guarantee, less emit, no unused-variable suppression dance.

```typescript
// satisfies — type-level only, strips to the bare expression
default: error satisfies never;
// emits: default: error;

// const form — declares a real binding, needs `void` to silence unused-var
default: {
	const _exhaustive: never = error;
	void _exhaustive;
}
// emits: default: { const _exhaustive = error; void _exhaustive; }
```

`satisfies` (TS 4.9+) is the blessed idiom for "assert conformance without producing a value."

**When NOT to add an exhaustive check:**

- Switches over **open input** — wire bytes (`messageType` from a binary protocol), HTTP status codes, file extensions from user paths, error names from external libraries you don't control. These need real `default:` handling (`throw`, `return null`, etc.) because unknown values are reachable at runtime.
- Switches whose `default:` is doing intentional fallback (e.g., "anything else gets the noop").

The rule of thumb: if the type checker proves the input is one of N closed values AND adding an N+1th value should require updating this site, add `satisfies never`. Otherwise, leave the switch alone.

See `docs/articles/switch-over-if-else-for-value-comparison.md` for rationale.

## Record Lookup Over Nested Ternaries

When an expression maps a finite set of known values to outputs, use a `satisfies Record` lookup instead of nested ternaries. This is the expression-level counterpart to "Switch Over If/Else": switch handles statements with side effects, record lookup handles value mappings.

```typescript
// Bad - nested ternary
const tooltip = status === 'connected'
	? 'Connected'
	: status === 'connecting'
		? 'Connecting…'
		: 'Offline';

// Good - record lookup with exhaustive type checking
const tooltip = ({
	connected: 'Connected',
	connecting: 'Connecting…',
	offline: 'Offline',
} satisfies Record<SyncStatus, string>)[status];
```

`satisfies Record<SyncStatus, string>` gives you compile-time exhaustiveness: if `SyncStatus` gains a fourth value, TypeScript errors because the record is missing a key. Nested ternaries silently fall through to the else branch.

`as const` is unnecessary here. `satisfies` already validates the shape and value types. `as const` would narrow values to literal types (`'Connected'` instead of `string`), which adds no value when the output is just rendered or passed as a string.

When the record is used once, inline it. When it's shared or has 5+ entries, extract to a named constant.

See `docs/articles/record-lookup-over-nested-ternaries.md` for rationale.

## Compose Errors Bottom-Up, Don't Filter Top-Down

`Extract<MyUnion, { name: 'X' }>` on a union you defined is a code smell. It says the union was composed too wide; the method that needs the narrow type is patching the over-typing at its signature instead of fixing the source.

```typescript
// Smell — one wide union, methods filter it back down
export const TransportError = defineErrors({
	RequestFailed:             ({ cause }) => ({...}),
	DeviceCodeExpired:         () => ({...}),
	DeviceAccessDenied:        () => ({...}),
	DeviceAuthorizationFailed: ({ code, description }) => ({...}),
});

return {
	async requestDeviceCode(): Promise<
		Result<DeviceCodeResponse, Extract<TransportError, { name: 'RequestFailed' }>>
	> { ... },
};
```

The fix is bottom-up: define error types per fault domain, infer per-method return types from the bodies, let the union appear at the boundary that actually needs it.

```typescript
// Better — fault domains as their own unions, no extract anywhere
export const RequestError = defineErrors({
	RequestFailed: ({ cause }) => ({...}),
});
export const DeviceTokenError = defineErrors({
	DeviceCodeExpired:         () => ({...}),
	DeviceAccessDenied:        () => ({...}),
	DeviceAuthorizationFailed: ({ code, description }) => ({...}),
});

return {
	async requestDeviceCode() {
		// body only constructs RequestError.RequestFailed
		// → infers Result<DeviceCodeResponse, RequestError>
	},
	async pollDeviceToken() {
		// body constructs RequestError AND DeviceTokenError variants
		// → infers Result<DevicePollOutcome, RequestError | DeviceTokenError>
	},
};
```

The narrow types weren't extracted from a wide one. They were composed bottom-up; the wide one stopped existing. Callers that need the wide union get it where the pieces meet (e.g., a coordinator that calls all four methods naturally lands on the union of every error its callees can produce).

`Extract<>` is the right tool when the union is upstream and you can't redefine it: `Extract<keyof JSX.IntrinsicElements, 'div' | 'section'>`, `Extract<NodeJS.ErrnoException['code'], 'ENOENT' | 'EACCES'>`. The smell is when *you* defined the union and *you* are filtering it back down — that's a sign you owned the composition and composed it wrong.

The test: do I own this union? If yes, split it. If no, `Extract<>` is fine.

See `docs/articles/20260504T100000-extract-is-the-tell-you-composed-top-down.md` for rationale.

## Silent Fallback Smell

Not all `??` expressions are safe defaults. When the fallback creates **state that other systems depend on**, the nullish coalescing hides a broken invariant.

```typescript
// Safe default — divergence doesn't matter
const timeout = options.timeout ?? 5000;

// SMELL — fallback creates divergent identity
// Two machines importing the same data silently get different IDs
const id = parsedId ?? generateId();
```

The test: **does the fallback create state that must be consistent across systems?** If yes, the `??` is masking a problem. Fix it by:

- **Self-healing**: generate the value and write it back to the source, so the fallback never fires again
- **Throwing**: make the invariant explicit—if the value should exist, its absence is an error
- **Warning**: at minimum, make the fallback visible so silent divergence doesn't go unnoticed

## Round-Trip Invariant

If you serialize and then deserialize, identity properties must survive:

```typescript
// This must hold for any entity with stable identity:
const exported = serialize(entity);
const reimported = deserialize(exported);
assert(reimported.id === entity.id);
```

If an ID doesn't survive a full cycle, every system that references it by ID is broken—document handles, foreign keys, cache entries. The round-trip test is: "If I export to disk and import on a fresh machine, does everything still match?"

When designing parse/serialize pairs, decide which fields are **identity** (must survive round-trips) vs **derived** (can be recomputed). Persist identity fields explicitly—don't rely on matching by secondary keys to recover them.
