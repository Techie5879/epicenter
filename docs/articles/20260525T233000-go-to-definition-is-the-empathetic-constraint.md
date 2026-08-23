# Go-to-Definition Is the Most Empathetic Constraint

Go-to-Definition is one of the most empathetic things I think about when I design TypeScript. Every annotation I write is a place where someone pressing F12 either lands on real code or lands on a label and has to press F12 again. So I treat hops like a budget: every one a reader makes between their call site and the body has to earn it.

The cheapest version of that budget says: prefer the form that lands the reader on a body, not on a signature.

## Annotations Send F12 To The Label

Here is the same factory written two ways. The first one annotates the return type.

```typescript
interface Counter { increment(): number }

function createCounter(): Counter {
	let count = 0;
	return { increment: () => ++count };
}

const c = createCounter();
c.increment(); // F12 lands on `increment(): number` in the interface
```

The interface tells you the shape. It does not tell you that `increment` mutates a closure variable. To see the behavior the reader has to take a second hop to the function body.

Now drop the annotation. Or, if you want compile-time shape checking, use `satisfies` on the returned object.

```typescript
function createCounter() {
	let count = 0;
	return { increment: () => ++count } satisfies { increment(): number };
}

const c = createCounter();
c.increment(); // F12 lands on `increment: () => ++count`
```

The reader pressing F12 lands on the line that runs. Same compile-time check. One fewer hop.

## Derive The Type From The Factory, Not The Other Way Around

When you want a name for the factory's return type, derive it. Do not declare an interface and make the factory implement it.

```typescript
// Don't: factory implements a separately declared type
interface CounterService { increment(): number }
export function createCounter(): CounterService { ... }
export type Counter = CounterService;

// Do: type is derived from the factory
export function createCounter() {
	let count = 0;
	return { increment: () => ++count };
}
export type Counter = ReturnType<typeof createCounter>;
```

The value and the type share a source. F12 on `Counter` from anywhere in the codebase, and F12 on `c.increment()` from a call site, both terminate at the same `createCounter` body. There is no separate "declaration" file that can drift from the implementation.

This is a judgment call, not a law. When you genuinely have multiple implementations of the same contract, a real impl plus a test mock plus a fake for storybook, the interface earns its keep. The interface IS the source of truth in that case, and F12 landing there is correct: the body is one of many, and you do not want to privilege one over the others by jumping into its code.

The trap is when there is exactly one implementation and the interface exists only because "you should always have an interface." Then the interface is a redirect with no destination.

## Constants: The Same Choice Shows Up

```typescript
// Annotation form: F12 on themes.light has nowhere clean to land.
// Record<string, ...> erased the keys to plain string.
const themes: Record<string, { color: string }> = {
	light: { color: 'white' },
	dark: { color: 'black' },
};

themes.light; // F12 wanders to `Record<...>` or to nothing useful
```

```typescript
// Satisfies form: keys are preserved, and shape is still checked.
const themes = {
	light: { color: 'white' },
	dark: { color: 'black' },
} satisfies Record<string, { color: string }>;

themes.light; // F12 lands on the `light:` key in the literal
```

The annotation form widens the value to match the type and discards what the literal told you. The satisfies form keeps the literal's identity while checking it against the constraint. F12 has somewhere to go.

Same idea, different syntactic neighborhood as the factory case: when you want shape checking, attach it to the value rather than over the value.

## Casts Are F12 Black Holes

```typescript
const x = something as unknown as typeof import('./real').thing;
```

`as` casts tell the reader: "this might be a lie, and the lie is whatever T says it is." F12 jumps to T's declaration, never to a body. The behavior is wherever the original `something` is, but T's name does not point you there.

We just refactored five web-stub files in this repo to drop `as unknown as typeof import('./index.tauri').X` in favor of `satisfies typeof Tauri.X`. The cast was not just ugly. It was hiding real shape drift: error variants that did not exist on the real module, methods missing from the stub, four wrong property names in one file. `satisfies` surfaced all of it because it actually checks, and F12 from a consumer now lands on the real Tauri module instead of on a synthetic stub.

## Re-Export Chains Charge Per Hop

```typescript
// utils.ts
export { formatDate } from './dates';

// dates.ts
export { formatDate } from './dates-impl';

// dates-impl.ts
export function formatDate(d: Date) { ... }
```

Three F12 presses to reach the function body. Each `export from` is an alias that adds zero behavior and one hop. Aliases earn their place when they hide a refactor in progress, or stabilize a public surface across a moving internal layout. Most of the time they are just sediment.

The same critique applies to behavior-free adapters. A wrapper that forwards every argument and every return value, with no logging, no defaults, no transformation, is a hop with no payload.

## Destructure-And-Re-Export Has The Same Cost

```typescript
const stub = {
	asShellCommand: unreachable,
	CommandError: { ExecuteFailed: unreachable },
	CommandServiceLive: { execute: unreachable },
} satisfies typeof import('./index.tauri');

export const { asShellCommand, CommandError, CommandServiceLive } = stub;
```

This pattern is appealing because it puts one `satisfies` over the whole module surface, which catches drift on new exports too. But F12 from a consumer of `CommandError` lands on the destructuring line, not on the `export const`. One more hop to read the actual shape.

If module-level checking matters more than the navigation cost, pay the cost knowingly. If it does not, write three direct `export const` lines each with their own `satisfies`. The cost is in the eye of the reader you are trying to be empathetic to.

## The Honest Rule

Each annotation, alias, wrapper, cast, and destructure-re-export you add is a hop you are charging the reader. Some hops are load-bearing. The interface with three implementations earns the hop. The compatibility re-export during a migration earns the hop. The cast at a true type-system boundary earns the hop.

Most don't. When in doubt, write the form that ends with F12 on a body.
