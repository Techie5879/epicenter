# Epicenter

Local-first workspace platform. Monorepo with Yjs CRDTs and Svelte UI.

Structure: `apps/whispering/` (Tauri transcription app), `apps/tab-manager/` (Chrome extension), `apps/api/` (Cloudflare hub), `packages/workspace/` (core TypeScript/Yjs library), `packages/cli/` (published CLI package and `epicenter` binary), `packages/ui/` (shadcn-svelte components), `specs/` (planning docs), `docs/` (reference materials).

Always use bun: Prefer `bun` over npm, yarn, pnpm, and node. Use `bun run`, `bun test`, `bun install`, and `bun x` (instead of npx).

Destructive actions need approval: Force pushes, hard resets (`--hard`), branch deletions.

Token-efficient execution: When possible, delegate to sub-agent with only the command. Instruct it to execute without re-analyzing.

Writing conventions: Load `writing-voice` skill for any user-facing text (UI strings, tooltips, error messages, docs). Do not use em dashes (`—`) or en dashes (`–`) anywhere, including prose, comments, JSDoc, and error strings. Use a colon, comma, semicolon, parenthesis, or sentence break instead. This applies to source files, markdown, and commit messages.

Explanation conventions: For spec walkthroughs, architecture explanations, and API summaries, prefer the visual style from the `git` skill reference. Interleave short prose with concrete code snippets, before/after blocks, and ASCII diagrams. Avoid long prose-only explanations when code or structure is being discussed.

Type conventions: When an exported type is exactly the object returned by a `create*` factory, make the type derive from the factory with `ReturnType<typeof createThing>` instead of annotating the factory return with that type. When the public type is a nested slice of a factory result, use a focused inference helper like `InferSignedIn<typeof session>` instead of declaring the shape up front. Keep concrete parameter and member return annotations inside the returned object when they preserve inference, JSDoc, or IntelliSense navigation. Use `satisfies` when checking an implementation against an external contract while keeping Go to Definition pointed at the returned value.

Collapse passes: For continuous indirection-reduction work ("collapse pass", "simplify pass", "reduce indirection", "shrink the surface"), load the `collapse-pass` skill. It carries the per-iteration ritual, finding format, anti-cosmetic gate, durable-strings never-touch list, stop conditions, and final report shape. Goals invoking it should declare only scope, stop condition, citation requirement, and starting target; everything else is in the skill.
