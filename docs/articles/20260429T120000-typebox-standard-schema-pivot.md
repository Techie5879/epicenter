# The Schema Wars Just Shifted: TypeBox, Standard Schema, and the JSON Schema Bet

**TL;DR**: TypeBox 1.0.28 removed Standard Schema support and TypeMap got archived with no migration path. The bet TypeBox is making: JSON Schema is the real interop currency, not a shared runtime validation contract. If you're building tooling that accepts multiple schema libraries, this changes your architecture.

## The Surprise

On April 15, 2026, Sinclair archived `@sinclair/typemap`. No blog post. No deprecation notice. No migration guide. Open issues got mass-closed as `wontfix`. The repo page now reads: "This repository was archived by the owner on Apr 15, 2026. It is now read-only."

TypeMap was the cross-library translation utility, peer-pinned to `@sinclair/typebox ^0.34.30`. It never crossed to TypeBox 1.x. The version sitting archived is 0.10.1.

If you blinked, you missed the upstream signal that made this inevitable: TypeBox 1.0.28 had already quietly removed Standard Schema. The release notes say exactly this much: "Remove Standard Schema." One line. TypeMap, which depended on a TypeBox that spoke Standard Schema, had nowhere to go.

Here's the thing though: Sinclair's reasoning is actually coherent. But the cost to TypeMap users is real and undocumented. Both of those things are true at the same time.

## What Standard Schema Was Supposed to Be

Standard Schema (the spec at `standardschema.dev`) is a minimal runtime contract that the authors of Zod, ArkType, and Valibot built together. The core idea is simple: if every schema library puts a `~standard` property on its schema objects with a `validate` function, then any tool (a form library, a server framework, an AI SDK) can accept "any schema" without needing to know which library produced it.

```typescript
// The contract: one function, library-agnostic
const result = schema['~standard'].validate(unknownInput);

if (result.issues) {
  // validation failed
} else {
  // result.value is the parsed output
}
```

That's it. You can drop an ArkType schema into a Hono route handler, a Zod schema into TanStack Form, a Valibot schema into an AI SDK tool call, all through the same code path.

The appeal is real. In 2024 to 2025, this looked like the convergence point the TypeScript ecosystem had been waiting for. Zod had dominated, but developers wanted alternatives. Standard Schema gave those alternatives a way to be first-class citizens in the existing tooling.

TypeBox initially joined. Then it left.

## Why TypeBox Left

The maintainer's stated reasoning, paraphrased from PR #1384 ("Version 1.0.28"):

Standard Schema is designed for Zod-style libraries that couple schema definition to validation. TypeBox is decoupled by design. A `TSchema` in TypeBox is a JSON Schema document: you can serialize it, post it over the wire, hand it to Ajv, emit it as OpenAPI, pass it to a tool-calling LLM. Carrying `~standard.validate` on every `TSchema` was complicating composition, inference, and framework integrators that read TypeBox output as plain JSON Schema.

More pointed: Sinclair argues that calling TypeScript interfaces "schemas" when they're really validators is a terminology problem. TypeBox was explicitly created to fix what Joi and Yup broke by coupling validation to schema definition. Rejoining that design pattern via Standard Schema would have been walking backwards.

The JSON Schema position is explicit in the PR: libraries should emit JSON Schema so trusted validators like Ajv can enforce constraints across languages.

I'm not going to invent quotes beyond what's in the public record, and the TypeMap archival has no documented rationale at all. We can read the signal (TypeMap needed TypeBox 0.x's `~standard`, TypeBox 1.x dropped it, TypeMap had no path forward), but Sinclair never wrote a migration guide or a deprecation post. If you were depending on TypeMap, you got an archived repo and a pile of `wontfix` issues. That's a real cost, and it deserved documentation that wasn't written.

## Schema-as-Data vs Schema-as-Validator

This is the deeper argument, and it's worth sitting with.

Zod-style libraries treat the schema as an opaque object. The important thing it does is validate and parse. The inferred TypeScript type is the public surface you care about. The schema object itself is an implementation detail.

TypeBox treats the schema as a document. A `TSchema` literally is a JSON Schema object:

```typescript
import { Type } from '@sinclair/typebox'

const User = Type.Object({
  id: Type.String(),
  age: Type.Number({ minimum: 0 }),
})

// User is this JSON object at runtime:
// {
//   type: 'object',
//   properties: {
//     id: { type: 'string' },
//     age: { type: 'number', minimum: 0 }
//   },
//   required: ['id', 'age']
// }
```

You can `JSON.stringify` it and post it to a schema registry. You can hand it to `ajv.compile`. You can render it as an OpenAPI path parameter. The validation step is separate, pluggable, and optional.

These two worldviews have been blurring for years. Zod 4 added native JSON Schema emission. ArkType has `.toJsonSchema()`. Valibot has `@valibot/to-json-schema`. Every major library can now produce JSON Schema. But TypeBox is the only one that starts from JSON Schema: the value and the document are the same thing.

TypeBox 1.0.28 is a recommitment to that position. Standard Schema asks TypeBox to bolt a validator interface onto something that is intentionally not a validator. Sinclair said no.

## The JSON Schema Interop Pattern in Practice

Here is the thing that makes this workable: every library in this space can emit JSON Schema, and once you have JSON Schema you can bring it back into TypeBox through `Type.Unsafe`.

```typescript
import { type } from 'arktype'
import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

// Step 1: define in ArkType
const User = type({ id: 'string', age: 'number >= 0' })

// Step 2: emit JSON Schema from ArkType
const jsonSchema = User.toJsonSchema()

// Step 3: wrap in TypeBox, preserving the inferred type
const UserBox = Type.Unsafe<typeof User.infer>(jsonSchema)

// Step 4: compile and validate with TypeBox's Ajv-backed compiler
const check = TypeCompiler.Compile(UserBox)
check.Check({ id: 'abc', age: 25 }) // true
```

For Zod 4:

```typescript
import { z } from 'zod'
import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

const ZUser = z.object({ id: z.string(), age: z.number().min(0) })

// Zod 4 native JSON Schema emission
const jsonSchema = z.toJSONSchema(ZUser)

const UserBox = Type.Unsafe<z.infer<typeof ZUser>>(jsonSchema)
const check = TypeCompiler.Compile(UserBox)
```

For Valibot:

```typescript
import * as v from 'valibot'
import { toJsonSchema } from '@valibot/to-json-schema'
import { Type } from '@sinclair/typebox'

const VUser = v.object({ id: v.string(), age: v.pipe(v.number(), v.minValue(0)) })
const jsonSchema = toJsonSchema(VUser)
const UserBox = Type.Unsafe<v.InferOutput<typeof VUser>>(jsonSchema)
```

Same pattern across all three. The interop layer is JSON Schema, not a shared runtime contract.

And here is the irony worth naming: Standard Schema itself has already moved in this direction. The `standardschema.dev/json-schema` page defines `StandardJSONSchemaV1`, a sub-spec (shipped in `@standard-schema/spec@1.1.0`) that adds a `jsonSchema` converter to the `~standard` namespace. Every library that implements it exposes a `jsonSchema` object with `input` and `output` methods:

```typescript
import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec'
import { Type, type TUnsafe } from '@sinclair/typebox'

/**
 * Wrap any library that implements both StandardSchemaV1 and the
 * StandardJSONSchemaV1 sub-spec (arktype 2.1.28+, zod 4.2+, valibot 1.2+)
 * as a TypeBox TSchema, preserving the inferred output type.
 */
export function toTypeBox<S extends StandardSchemaV1 & StandardJSONSchemaV1>(
  schema: S,
): TUnsafe<StandardSchemaV1.InferOutput<S>> {
  // Call as a method, not via destructuring. The spec's example
  // implementer uses `this.input(params)` inside `output()`; pulling
  // `input` off the converter would break the binding.
  const json = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
  return Type.Unsafe<StandardSchemaV1.InferOutput<S>>(json)
}
```

`Type.Unsafe<T>(jsonSchemaValue)` is the canonical TypeBox API for "I have a JSON Schema document from somewhere, give me a TSchema with my chosen static type." There is no `Type.FromJsonSchema(json)` in TypeBox 0.34.x or in the 1.x dev line: `Type.Unsafe` is the documented escape hatch, intentionally so.

One subtle gotcha worth surfacing: the `jsonSchema` converter is an *object* with `input` and `output` methods, not a function. The spec's reference implementation writes `output(params) { return this.input(params) }` (method shorthand using `this`), so destructuring `const { input } = schema['~standard'].jsonSchema` would unbind the receiver and break that implementer. ArkType happens to use arrow functions internally, so destructuring works there, but the spec doesn't guarantee it. Always invoke as a method on the converter.

The validate contract and the JSON Schema contract both live under `~standard`. TypeBox isn't implementing either. But the trajectory of the rest of the ecosystem is converging on the JSON Schema side regardless.

## What You Give Up

None of this is free.

Library-specific features don't survive the conversion. ArkType's pipe transformations, branded types, and narrow constraints don't map cleanly to JSON Schema. Zod's `.transform()`, `.preprocess()`, and refinements that run arbitrary code have no JSON Schema equivalent. When you go through the JSON Schema boundary, you get structural validation only. Anything semantic or behavioral is stripped.

Single-pass validation across libraries disappears too. Standard Schema lets you plug any library's schema directly into a form library or framework and get the library's own validation logic running. With the JSON Schema approach, you're always running the JSON Schema validator (usually Ajv), not the original library's engine.

For purely structural object schemas (the majority of API request and response shapes, OpenAPI payloads, LLM tool parameters) this doesn't matter much. For anything with transformations, you need to be honest about the loss.

## Practical Recommendation for Library Authors

If you're building a library or platform that needs to accept "any of TypeBox, ArkType, Zod, or Valibot" as inputs:

**Don't depend on Standard Schema at TypeBox's boundary.** TypeBox is off that train as of 1.0.28. If your code does `schema['~standard']`, TypeBox schemas won't have it.

**Pick JSON Schema as your interop format.** Every major library can emit it. JSON Schema is language-agnostic, tool-compatible, and stable. It's what OpenAPI reads, it's what Ajv validates, it's what LLM tool-calling specs use. It predates all of these libraries and will outlast all of them.

**Convert at the edge, once, with the library's own emitter.** ArkType uses `.toJsonSchema()`. Zod 4 uses `z.toJSONSchema(schema)`. Valibot uses `@valibot/to-json-schema`. TypeBox values are already JSON Schema. Run the conversion once when you receive user input, store the JSON Schema internally, and work from there.

**Be upfront about what you can't represent.** If a user passes an ArkType schema with pipes or a Zod schema with transforms, tell them those features won't survive conversion. Don't silently drop them.

If you were using TypeMap: there is no drop-in replacement and Sinclair didn't document a migration path. Your options are to pin to TypeBox 0.x (which TypeMap supports) and accept that path is a dead end, or to implement the JSON Schema conversion pattern yourself using the emitters above. The JSON Schema pattern is not much more code than TypeMap was, and it doesn't have an archived-repo problem.

## The Golden Rule

A schema is a document first and a validator second. If a schema can't be serialized and handed to a tool that has never heard of your library, it's a validator wearing a costume. TypeBox decided that matters. The rest of the ecosystem is quietly proving it right by shipping JSON Schema emitters.
