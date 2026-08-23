# AI Workflows: Consolidated Design

**Date**: 2026-05-30
**Status**: CANONICAL. This is the one document to read. The three records dated 2026-05-29 are the
reasoning trail (how each decision was grilled); this doc states the current truth top to bottom.
**Owner**: Braden

## One sentence

The AI manipulates your workspace by emitting bounded DATA, a selection (a per-row predicate AST) plus
a typed transform; a fixed engine dry-runs it against a forked Y.Doc to produce a concrete, reviewable
EFFECT; you approve the effect, not the model's claim; and arbitrary code lives in a separate,
desktop-only, full-trust coding-agent lane.

## The whole thing in one picture

```txt
                         the model emits ONE artifact: bounded DATA
                         { intent, select: <predicate AST>, apply: <typed bindings>, limit }
                                            |
                                            v
   ENGINE (fixed, no arbitrary code):  run select read-only  ->  build typed mutation per row
                                       ->  DRY-RUN on a forked Y.Doc  ->  computed EFFECT
                                            |
                                            v
                         you approve the EFFECT (count + diff + spot-check)
                                            |
                                            v
                         commit; undo = scoped inverse from captured before-values

   the select AST is the SINGLE SOURCE OF TRUTH. everything else is a projection of it:
        matches(row)        evaluate in memory      -> runs on every device + reactive
        compileToSql(ast)   emit SQL (optional)     -> desktop speed on large N
        renderSentence(ast) plain language          -> the approval card
        renderFilterUI(ast) dropdowns + chips       -> a future non-AI filter builder
```

## Two models (and the line between them is the local binary, not SQLite)

```txt
Model 1   typed actions over the workspace. The AI calls them as tools, OR emits a bounded program
          the engine expands into many calls. Dry-runnable. Runs in-app on EVERY device (phone too).
          Inference is HOSTED (OpenAI/Gemini via the Cloudflare Worker), billed through your session.

Model 2   arbitrary TypeScript / files / shell. The desktop coding agent. Full trust, git-diff review.
          Inference is your LOCAL Claude/Codex subscription via the CLI binary.
```

The old framing said Model 2 was desktop-only "because SQLite is desktop-only." That was wrong.
SQLite is portable (WASM SQLite runs in any browser and mobile webview). The real, irreducible reason
Model 2 is desktop-only is the things a phone genuinely does not have:

```txt
desktop ONLY has:    the local Claude/Codex BINARY (run on your own subscription, bypass hosted
                       inference and its billing)
                     the FILESYSTEM (write arbitrary files)
                     the SHELL, and the daemon as the single writer / always-on-ish executor

The data layer is SYMMETRIC across devices. The compute-and-trust layer is not.
That asymmetry, the binary and the filesystem and the shell, IS the Model 1 / Model 2 line.
```

There is no "Model 1.5." What the early record called Model 1.5 is one FEATURE of Model 1: the model
emits a compact bounded program and the ENGINE expands it into N calls (the model cannot enumerate
4,000 calls in context). Same actions, same fork, same review card, same undo. A feature, not a tier.

## The selection AST is canonical; SQL is a compiled projection of it

This is the cohesive core. There is no "predicate vs SQL" fork. There is one authored, stored form
(the predicate AST) and several things generated FROM it.

### What the model emits and stores

```json
// "stale entries not touched since March 1"
{ "and": [
    { "includes": { "field": "tags",     "value": "stale" } },
    { "lt":       { "field": "updatedAt", "value": "2026-03-01" } }
] }
```

### The engine is one recursive function

```ts
function matches(node, row) {
  if ("and" in node)      return node.and.every(n => matches(n, row));
  if ("or"  in node)      return node.or.some(n  => matches(n, row));
  if ("not" in node)      return !matches(node.not, row);
  if ("eq"  in node)      return row[node.eq.field] === node.eq.value;
  if ("lt"  in node)      return row[node.lt.field]  <  node.lt.value;
  if ("includes" in node) return row[node.includes.field]?.includes(node.includes.value);
  if ("isNull"   in node) return row[node.isNull] == null;
  // ~15 cases total. this is the entire engine. no dependency, no database.
}
const matched = allRows.filter(row => matches(node, row));
```

### The closed operator set (covers the realistic gauntlet)

```txt
logical   and, or, not
scalar    eq, ne, lt, lte, gt, gte
date      lt/gt on ISO strings; relativeDays (resolved at run time)
null      isNull, isNotNull
array     includes, notIncludes, includesAny, includesAll      (tags, type are JSON string[])
string    contains (substring), startsWith
set       in (value in a list)   <- this is the escape valve for "intersect with a set of ids"
```

### What the AST CANNOT express, and why it does not matter

```txt
CANNOT:   JOIN across tables, GROUP BY / aggregates, correlated subqueries, "intersect with the
          LIVE result of another query", semantic similarity ("actually a duplicate").

WHY IT IS FINE:  the AST is a per-row predicate, and the transform is a per-row mutation. Their
          ceilings COINCIDE. The moment selection needs more than a per-row test, the result is no
          longer per-entity rows with an id, so the transform could not apply to it anyway. Those
          cases were already routed elsewhere (Model 1 loop for per-row judgment, Model 2 for
          joins/aggregates/semantic work). You cannot select anything you could not also bulk-mutate.

ESCAPE VALVE:  a cross-table need often collapses to an `in` list. "Tag entries whose url is in my
          saved tabs" is not a join; resolve the tab urls to a list first, then
          { in: { field: "url", value: [...] } }. Works when one side is small enough to materialize.
          Only a genuine streaming join (both sides large) is truly out, and that is Model 2.
```

### The four projections of the one AST

```txt
projection         what it does                     when you build it
matches(ast,row)   evaluate in memory               NOW (bulk + reactive both need it)
renderSentence     plain-language approval card      NOW (the card needs it)
compileToSql(ast)  emit a parameterized SQL WHERE    LATER, only when desktop large-N is slow.
                   against the materializer           PERFORMANCE ONLY, never new expressiveness.
renderFilterUI     dropdowns/chips that BUILD the     LATER, only if you want a non-AI filter builder.
                   AST from clicks                    AI and manual UI become two authors of one form.
```

### The one discipline that keeps this honest

```txt
REFUSED (Version B): a node that holds a raw SQL string, e.g. { sql: "tags LIKE '%x%'" }.
  That brings back a SQL parser, a validation fence, and the "the text says one thing, the card
  says another" honesty hole. The AST is the ONLY authored or stored form.
  You GENERATE sql from the trusted ast (safe). You never PARSE sql as input (the trap).
```

### Why the AST, not SQL, even with WASM SQLite available

WASM SQLite means SQL *could* run on the phone, so portability is no longer the deciding argument.
The deciding argument is REACTIVE rules (next section). SQL is the wrong SHAPE for "did this one
edited row just match?", no matter where SQLite runs: you would re-run a whole SELECT per keystroke.
`matches(ast, row)` is built for exactly that: one row, microseconds, synchronous, inside the Y.Doc
observer that already fires on every edit. The AST is the only engine that serves BOTH bulk and
reactive with one piece of code.

```txt
                       | SQL desktop-only | SQL everywhere (WASM) | predicate AST (chosen)
new code to write      | ~none (exists)   | most (wasm + browser  | ~300 lines, once
                       |                  | Y.Doc->SQLite mirror)  |
runs on phone/browser  | no               | yes                   | yes
good for REACTIVE       | no (wrong shape) | no (wrong shape)      | YES (the reason)
plain-language card     | parse SQL        | parse SQL             | free (walk the AST)
serves bulk + reactive  | no               | bulk only             | BOTH, one engine
   with one engine       |                  |                       |
```

## The transform: mechanical, one rule (or an ordered sequence) per program

`apply` is one mutation action per selected row, filled by bindings off that row.

```txt
binding     meaning
from        copy a column off the selected row
literal     a constant
set         overwrite a scalar
append      add to an array column (engine computes the new whole array from the row's current value)
remove      remove from an array column (engine-computed, same reason)
```

Note `append`/`remove` are engine-computed, because real actions like `entries_update` do a
whole-array replace (no native append). The engine reads the row's current array (so that column must
be in the selection), edits it, and binds the result.

```txt
MECHANICAL ONLY, and that is the honest contract:
  - same template applied to every selected row. control flow lives in the SELECT.
  - the artifact may be an ORDERED LIST of bounded ops (BulkOperation[]), dry-run in sequence on one
    fork, so step 2 sees step 1's result. (This is how a tag-merge "add canonical, then remove each
    variant" stays mechanical.)
  - NEVER a per-row "call the model" binding. That would make the effect un-dry-runnable (you would
    approve a prediction, not a fact), non-deterministic, and unbounded in cost. Per-row JUDGMENT is
    the Model 1 loop's job, entered via an explicit "I will go row by row, ~N calls, approve?" card.
```

## Triggers: manual now, reactive next, cron is the full-trust lane

The deep reason the trigger axis resolves cleanly: the trust model needs a human present to approve
the computed effect.

```txt
trigger    human present to approve the effect?     lane
manual     yes (they just clicked Run)              bounded data (dry-run + approve)
reactive   yes (they are right there editing)       bounded data (dry-run + approve, or auto + undo)
cron 2am   NO (nobody is watching)                  NOT bounded data. full-trust TS code.
```

In a local-first app there is no free always-on home for cron: the cloud cannot read on-device data
(the cloud executor is dead), the phone sleeps, the laptop closes. REACTIVE is the natural trigger
because the edit that fires it happens on a device that is, by definition, awake and holding the data.
This is exactly how the closest local-first analogue (Actual Budget rules) works: structured rules as
data, fired on edit, with a pre-commit preview.

```txt
BUILD ORDER
  manual     v1. you pick a saved program and run it. the device in your hand is the executor.
  reactive   next. a Y.Doc observer evaluates matches(ast, changedRow) on the editing device,
             dry-runs the typed apply, you approve (or it auto-applies under the small+reversible
             rule). needs debounce + a loop-guard (do not re-fire on the write the rule itself made).
  cron       deferred, and when it comes it is a reviewed-once Model 2 TS script under OS cron, or a
             desktop daemon timer (honest: fires only while that machine is awake). NOT bounded data.

The SAVED UNIT is the portable bounded program { intent, select, apply, limit, trigger } stored in
the Y.Doc, NOT a TS file. A TS recipe forfeits phone and browser and cannot fire in the sync loop.
trigger defaults to "manual"; reserve the field so reactive/cron attach later with no repaint.
```

## Auto-approve and undo

```txt
AUTO-APPLY (toast + undo)  IFF  forkable  AND  no deletes / nothing irreversible
                                          AND  no external effects  AND  N <= 10 (tunable)
REVIEW (full card)         otherwise (any delete, any external effect, or N over the threshold)

This uses a rule COMPUTED from the dry-run effect. It does NOT reuse the per-action toolTrust flag
('ask' | 'always'), which is right for a single Model 1 call but must not let one "always" click
authorize a bulk blast.

UNDO   session-scoped, last-writer-wins, forkable-mutations only, transient toast, absent on
       external/irreversible ops. The COPY must match the mechanism:
         normal edit  -> "put these N back to what they were just now"  (not "rewind")
         hard delete  -> "re-creates them as new rows (last write wins)"  (not "restore")
         partial batch-> "30 changed, 7 skipped"
       Honest only because it is transient and is itself just another LWW write.
```

## Auth: unchanged

The data engine sits below the auth boundary, so choosing the predicate AST (or WASM SQLite) changes
nothing about identity, sessions, or sync. It is your data on your device either way; sync still goes
through the already-authed relay.

The only auth-flavored distinction in this whole design is which inference path runs, and it maps 1:1
onto the two models, so it introduces no new auth surface:

```txt
Model 1 inference   hosted (Cloudflare Worker) -> Epicenter session + Autumn credits. Existing auth.
Model 2 inference   your local Claude/Codex CLI -> the CLI's own auth, not billed by Epicenter.
```

One thing to flag for the reactive DESIGN later (a billing-consent question, not an auth-mechanism
one): if a reactive rule ever calls HOSTED inference in the background (e.g. "when I add a note,
auto-summarize it"), it would spend credits while you are not present. Reactive rules that only do
mechanical typed mutations (the design above) make no inference call and raise no such question.

## What we refuse

```txt
- A third "model" (Model 1.5). It is a feature of Model 1.
- Raw SQL as an emitted/stored form, or a { sql } node inside the AST (Version B). SQL is compiled
  FROM the AST, never parsed INTO it.
- A per-row "call the model" binding (breaks dry-runnability, determinism, bounded cost).
- A saved-recipe subsystem with a re-expansion engine (the saved unit is portable data; cron is the
  TS lane).
- A durable-execution engine (Temporal/Workflows/Inngest/DBOS/Restate). All run server-side, cannot
  read on-device data, and target long non-idempotent transactions; a bounded program re-expands
  from scratch each run, which IS the durability story.
- Adopting CEL/JSONLogic/jq as the format. CEL covers only the read-only SELECT half and adds a
  dependency; the owned AST spans select AND apply in one portable JSON form.
- A custom grammar+parser DSL, a synced run-queue (deleted as `commands`), the cloud executor
  (cannot see local data).
```

## Decision ledger (current answers)

```txt
decision                          answer
trust model                       emit data, dry-run on fork, approve the effect, scoped undo. SETTLED.
how many models                   TWO. the line is the local binary/files/shell, not SQLite.
selection form                    predicate AST is canonical; SQL is an optional COMPILED projection
                                  (performance only); raw SQL is never an input.
what the AST cannot do            joins, aggregates, semantic similarity. fine: those exceed the
                                  transform too, and route to Model 1 loop or Model 2.
transform                         mechanical, one rule or an ordered sequence; never call-the-model.
triggers                          manual now, reactive next, cron = full-trust TS lane.
saved unit                        portable bounded program in the Y.Doc, not a TS file.
durable execution                 refused.
format                            owned AST (steal CEL's type-check idea, not the dependency).
auto-approve                      effect-computed rule, not the toolTrust flag.
undo                              session-scoped LWW; copy matches mechanism.
auth                              unchanged; only hosted-vs-local-subscription inference differs.
```

## Open decisions for Braden

```txt
1. REACTIVE rules: yes or no? This is the master question. If yes, the predicate AST is locked in
   (it is the only engine that serves bulk AND reactive). Recommendation: yes.
   Decision probe: 20260530T113000-ai-workflows-reactive-vs-bulk-only.md argues the opposite v1:
   bulk-only SQL-alone, with reactive and the predicate AST deferred until real standing rules bite.
2. Auto-apply row threshold (proposed 10). Minor, one number.
3. Does "bulk" get a user-facing name, or is it just "the agent did a thing"? Recommendation: no
   user-facing model/mode name. Minor.
```

See [AI Workflows: Reactive Rules Versus Bulk One-Shots](./20260530T113000-ai-workflows-reactive-vs-bulk-only.md)
for the grounded counterargument that recommends bulk-only SQL-alone for v1.

## Build order (slices)

```txt
v1   - Model 1 typed actions as tools (already shipping).
     - bounded program: predicate AST + matches() + typed apply bindings + dry-run on a fork +
       the computed-effect card + renderSentence() + scoped undo.
     - ordered-sequence support (BulkOperation[]) for tag-merge-style tasks.
     - effect-computed auto-approve rule.
     - save the program as a portable unit in the Y.Doc (trigger defaults to manual).
v-next - reactive trigger: Y.Doc observer -> matches(ast, changedRow) -> dry-run -> approve/auto.
         debounce + loop-guard.
later  - compileToSql() IF desktop large-N is slow (performance only).
       - renderFilterUI() IF you want a non-AI filter builder.
       - cron via Model 2 TS script + OS cron, IF a real time-only need appears.
```

## Reasoning trail (how each decision was grilled)

```txt
20260529T120000-ai-workflows-bounded-programs.md
  the original design and the dead-ends it killed (subprocess proposal, read-only sandbox, file
  edits, arbitrary TS, summary-based auto-approve). Read for WHY the trust model is shaped this way.

20260529T163000-ai-workflows-ux-grill-and-clean-break.md
  8 concrete user stories + 4 adversarial fighters. Collapsed three models to two; established
  predicate-canonical, mechanical-only-including-sequences, the body-edit impossibility (S6) that
  earns Model 2, and the undo honesty cases. Read for the concrete cards and the story-by-story tally.

20260529T190000-ai-workflows-triggers-portability-durable-execution.md
  web-grounded research on durable execution, local-first automation, and portable formats.
  Established reactive-over-scheduled, portable-data-over-TS, and the durable-execution refusal.
  Read for the prior-art table (Actual Budget, Notion, Apple, Obsidian) and the sources.

20260530T113000-ai-workflows-reactive-vs-bulk-only.md
  decision probe for the one assumption this doc still leaves open: whether reactive rules are worth
  building at all. Steelmans concrete reactive rules against Fuji entries, tab-manager savedTabs,
  workspace actions, and the Y.Doc observer pattern, then recommends bulk-only SQL-alone for v1.
```
