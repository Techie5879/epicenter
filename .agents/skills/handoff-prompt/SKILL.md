---
name: handoff-prompt
description: Draft a self-contained implementation prompt for zero-context handoff. Use when: "draft a prompt", "write a handoff", "make a prompt I can copy-paste", "create a delegation brief".
metadata:
  author: epicenter
  version: '2.0'
---

# Handoff Prompt

Follow [writing-voice](../writing-voice/SKILL.md) for prose tone.

A handoff prompt is a cold execution brief. The recipient has never seen this codebase, this conversation, or this context. Everything they need to execute must be in the prompt itself.

## How It Differs from Specs

| Spec (`specification-writing`) | Handoff Prompt |
| --- | --- |
| Planning document, lives in `specs/*.md` | Communication artifact, lives in clipboard |
| Tracks progress with checkboxes | Single-shot fire-and-forget |
| Assumes the reader has repo access and can explore | Assumes the reader has zero context |
| Leaves open questions for the implementer | Closes all questions—the recipient shouldn't need to ask |
| Iterative—you come back and update it | One shot—you won't get to clarify |

A spec says "here's the plan." A handoff prompt says "here's everything you need to do it right now."

## Structure

There's no rigid template. The sections you need depend on the type of handoff. Every prompt needs a task statement and guardrails. Everything else is judgment.

### Task Statement

One or two sentences. What to build and where. Be specific about file paths.

```
Create an About page at `apps/opensidian/src/routes/about/+page.svelte`.
This page explains the technical architecture to visitors and is linkable from the app toolbar.
```

Not: "Build a page that explains the app." The recipient needs exact locations.

### Context

Everything the recipient needs to understand the codebase without reading it. This is the most important section—it's what makes the prompt self-contained.

What to include depends on the handoff type:

**For implementation tasks** (building UI, adding features): paste actual code. If the data layer is 10 lines, paste those 10 lines. Include file paths for every snippet. Name the components that exist with their paths. List what's available in the UI library.

**For architectural tasks** (refactoring, migrations, design decisions): describe the current structure, the constraints, and the trade-offs already made. Code snippets matter less than the shape of the system and the decisions already locked in.

**For debugging handoffs** (fixing broken behavior): include the error output, reproduction steps, what was already tried and why it didn't work. The recipient needs to pick up where you left off, not re-diagnose from scratch.

**For all types**: never paraphrase when you can paste. "The workspace uses Yjs" is useless. The actual `createDisposableCache((id) => { ... }).open(id)` call is useful.

```
## Context

The entire app's data layer is this one file (`src/lib/workspace.ts`):

\`\`\`typescript
// paste the actual code
\`\`\`

The workspace API provides: Yjs CRDT table storage, per-file Y.Doc content documents,
IndexedDB persistence, and an in-browser SQLite index.
```

### Requirements

What to build. Be exhaustive—the recipient can't ask clarifying questions.

For UI work: describe each section with what it contains, what components to use, what data it displays, and how it behaves.

For logic work: describe input/output contracts, edge cases to handle, and integration points with existing code.

If there's a choice to make (which component, which layout, which approach), make it here. Don't leave it open.

### MUST DO

Non-negotiable requirements. Keep this short—only things that genuinely can't be left to judgment.

```
## MUST DO
- Follow existing Svelte 5 runes patterns (`$props()`, `$derived`, `$state`)
- Use components from `@epicenter/ui/*` and `@lucide/svelte`
```

### MUST NOT DO

Hard blocks only. Things that are genuinely never acceptable for this task—not soft preferences, not style guidance. Litmus test: would this be wrong regardless of context? If yes, hard block. If "it depends," leave it out. The agent uses judgment for everything else.

```
## MUST NOT DO
- Do not suppress TypeScript errors with `@ts-ignore` or `as any`
- Do not delete or skip existing tests to make the build pass
```

Think about what the recipient might do wrong and preempt it. But only the things that would actually break something or violate a hard constraint.

## Drafting Process

1. **Gather context first.** Read the relevant files, understand the codebase patterns, check what components and tools are available. You can't write a self-contained prompt without knowing the details.

2. **Identify the recipient's blind spots.** What does someone need to know that isn't obvious? The tech stack, the import conventions, the existing patterns, the file structure.

3. **Paste, don't paraphrase.** Real code beats descriptions of code. Real file paths beat vague references. Real component names beat "use the UI library."

4. **Close all decisions.** A spec can leave open questions. A handoff prompt cannot. If there's a choice to make, make it.

5. **Scope aggressively.** The tighter the scope, the better the output. "Create 3 files" beats "build the feature." "Modify only these 2 existing files" beats "update as needed."

6. **Test mentally.** Read the prompt as if you've never seen this codebase. Could you execute it? If you'd need to grep for something, that information should be in the prompt.

## Common Mistakes

### Too abstract

```
## Context
The app uses a workspace API built on Yjs CRDTs for data storage.
```

This tells the recipient nothing actionable. Paste the workspace setup code instead.

### Missing file paths

```
Create a new page component and link it from the toolbar.
```

Where? What's the toolbar file called? What's the routing convention? Be explicit.

### Assuming knowledge

```
Use the standard shadcn components for this.
```

Which ones? The recipient doesn't know what "standard" means in this project. List them.

### Leaving decisions open

```
You could use either a Card grid or an Accordion for this section—pick whichever works better.
```

Pick one. The recipient will waste time deliberating instead of building.

### Overloading MUST NOT DO

```
## MUST NOT DO
- Do not install any new dependencies
- Do not use images or external assets
- Do not make the page feel like a SaaS landing page
- Do not use inline styles
```

The first item might be a hard block. The rest are preferences. Mixing them dilutes the signal. Hard blocks only.

## Good vs Bad

### Good (self-contained, specific, closed)

```
Create `src/routes/about/+page.svelte`. Import `Card` from `@epicenter/ui/card`
and `Badge` from `@epicenter/ui/badge`. The page has 4 sections...

The workspace setup code is:
\`\`\`typescript
const cache = createDisposableCache((id: string) => {
  const ydoc = new Y.Doc({ guid: id });
  const tables = attachTables(ydoc, { files: filesTable });
  const idb = attachIndexedDb(ydoc);
  return { ydoc, tables, idb, [Symbol.dispose]() { ydoc.destroy(); } };
});
export const ws = cache.open('opensidian');
\`\`\`

MUST NOT: suppress TypeScript errors, delete existing tests to pass build.
```

### Bad (vague, open-ended, assumes context)

```
Create an about page for the app that explains the architecture.
Use whatever components make sense. Make it look good.
```

The good version works cold. The bad version requires a follow-up conversation.
