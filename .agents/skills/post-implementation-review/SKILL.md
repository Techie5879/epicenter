---
name: post-implementation-review
description: "Second-read protocol: reread files, inline helpers, audit dead paths, boundaries, invariants. Use after implementing or before handoff."
metadata:
  author: epicenter
  version: '1.0'
---

# Post Implementation Review

Use this skill after code changes and before final handoff. The goal is a hard
second read: catch stale abstractions, dead paths, bad ownership, and confusing
names while the edit context is still fresh.

Do not silently fix structural concerns. Flag what is wrong, explain why, then
make the smallest coherent follow-up edit if the user asked you to continue
through cleanup.

## Related Skills

This skill is a hub for broad second reads. Focused requests can start from a
focused skill first, then escalate here when the work needs a full final pass.

Load only the skills that match the touched surface:

```txt
cohesive-clean-breaks   public API, package boundary, config, lifecycle, naming, or ownership change
refactoring             caller counts, inlining, dead exports, stale imports, straggler sweep
approachability-audit   too many hops, misleading names, clever types, first-read confusion
code-audit              recurring repo smells and grep-based checks
one-sentence-test       new abstraction, wrapper, option, endpoint, command, or module
testing                 test files or changed behavior that needs coverage
typescript              type organization, inference, runtime schema, type tests
svelte                  Svelte components, stores, runes, query usage, UI state
yjs                     CRDT documents, shared types, transactions, conflict behavior
```

## Review Order

1. Identify every file touched by the implementation.
2. Re-read each touched file from top to bottom.
3. List every file read as an ASCII tree before analysis.
4. Run the mental inlining pass.
5. Run the smell and invariant checks.
6. Review API shape, naming, and file organization.
7. Run diagnostics and tests appropriate to the changed scope.
8. Report findings before making cleanup edits unless the issue is a direct
   compile or test failure.

The ASCII tree is not decoration. It forces the review to show its evidence.

```txt
Files read
packages/foo/
|-- src/
|   |-- create-foo.ts
|   |-- foo-options.ts
|   `-- index.ts
`-- package.json
```

## Mental Inlining Pass

Mentally inline every helper, wrapper, component, prop bundle, adapter, file,
factory, compartment, and extracted function back into its call sites.

Ask:

```txt
Would the raw call site be easier to read without this layer?
Does the helper own an invariant, or only rename simple control flow?
Does the wrapper hide a branch that every caller already knows?
Does the file split make the concept clearer, or preserve an old boundary?
Does this component prop exist for real reuse, or only to pass through values?
```

Keep indirection when it owns a real invariant, isolates unsafe input, names
non-obvious domain behavior, supports several real callers, or protects a public
contract. Otherwise, mark it as inlineable.

## Smell Check

Look for:

```txt
dead exports, dead methods, dead config hooks
stale imports and stale JSDoc
redundant work after ownership moved earlier
identity wrappers and pass-through modules
unnecessary casts or duck-typing inside typed code
fallback parsers for old shapes
callbacks that mirror internal implementation steps
single-file directories and pointless barrels
```

If a smell is repo-recurring, use `code-audit` for the relevant grep pattern. If
the smell came from the refactor itself, use `refactoring` for the straggler
sweep.

## Invariant Audit

Name the layer that owns each important rule.

```txt
Invariant                         Owner
config shape is valid              config loader
route names are unique             defineConfig validation
document id is parsed once          document cache
runtime socket opens once           daemon startup
cleanup policy is app-owned         injected lifecycle callback
```

If an invariant is checked repeatedly downstream, move it earlier: construction,
validation, or the type signature. If a later layer no longer needs a safety
check because setup guarantees it, delete the redundant check and name the setup
guarantee in the review.

## API Shape

Read the public surface as if designing it today.

Ask:

```txt
Is there one obvious call site?
Do option names describe domain policy instead of implementation steps?
Did the change leave both old and new shapes alive?
Can TypeScript prevent the common misuse?
Does the lifecycle name match when side effects happen?
```

For clean breaks, compatibility is a feature only when explicitly requested.
Otherwise, delete old public names and update all examples to the new shape.

## Naming And Files

Names should match what the code does now, not what it used to do.

Check:

```txt
Does foo-manager.ts still manage anything?
Does create* construct, define* return inert definitions, start* begin runtime work?
Does a type name describe a real contract or a library workaround?
Does each file have one reason to exist for a new reader?
```

When file organization is part of the finding, show both trees before editing.

```txt
Current
packages/foo/src/
|-- lifecycle.ts
|-- lifecycle-options.ts
|-- cleanup.ts
`-- index.ts

Proposed
packages/foo/src/
|-- lifecycle.ts
`-- index.ts
```

## Output Shape

For a review-only pass, report:

```txt
Files read
[ASCII tree]

Findings
1. [severity] [file:line] What is wrong and why.

Would change
[Specific edits worth making]

Would leave alone
[Indirection or duplication that earns its keep]

Verification
[Commands run and result, or why not run]
```

For an implementation pass, make the cleanup edits after reporting the issue in
the working notes. Keep the final answer short: what changed, what was left
alone, and what verified it.
