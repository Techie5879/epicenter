# AI Workflows: Triggers, Portability, and Durable Execution

**Date**: 2026-05-29
**Status**: Review record (resolves Open Question 3 of the bounded-programs spec)
**Owner**: Braden
**Method**: 3 web-grounded research agents + 4 adversarial fighters + user stories, adjudicated

> **Reasoning record.** The CANONICAL current design is
> `20260530T100000-ai-workflows-consolidated-design.md`. This doc is the web-grounded research behind
> the trigger and format decisions (durable execution, local-first automation, portable formats).
> Read it for the prior-art table and sources.

**Chain**:
- `20260529T120000-ai-workflows-bounded-programs.md` (the design: AI emits bounded data, engine dry-runs)
- `20260529T163000-ai-workflows-ux-grill-and-clean-break.md` (UX gauntlet; collapsed 3 models to 2)
- this doc (saved / recurring / reactive automation: is a portable or durable recipe worth building?)

## One sentence

A saved automation should be stored as the portable bounded program (data, not a TypeScript file),
its first real trigger should be REACTIVE (on-change, evaluated on the device that made the edit), and
durable-execution infrastructure and cron should be refused for v1, because in a local-first app the
only moment a device is provably awake and holding your data is the moment you edit it.

## Why this doc exists

The bounded-programs spec left Open Question 3 open: "one-shot only, or saved recipes?" The UX grill
provisionally said "kill recipes, route recurrence to a Model 2 script + cron." Braden pushed back with
a real observation:

```txt
"A TS script IS a saved recipe, but it is limited to Node/Bun and runs at elevated
 (full-trust, desktop-only) permission. So is it worth having a PORTABLE recipe / DSL
 that runs in both browser AND desktop? Or do we just ship TS scripts + one-at-a-time
 flows for now, and treat the rest as future-proofing?"
```

That reopened the question correctly, because the same portability logic that pushed the SELECT form
to a predicate AST (so it runs on the phone) also argues that a SAVED automation wants to be portable
data, not a desktop-only TS file. This doc resolves it by separating four axes that were tangled into
one, then grounding each in prior art and the repo's hard constraints.

## The four axes (separate them or the question stays muddy)

```txt
A. PORTABILITY  Where can the saved unit RUN?
     TS script:        desktop + Bun + full trust ONLY. Imports bun:sqlite, calls the daemon.
                       Cannot exist on a phone or in a browser tab (Y.Doc is in memory, no SQLite).
     bounded program:  JSON data interpreted by a fixed engine -> runs on every device.

B. TRIGGER  What STARTS it?
     manual ("run it again")  |  scheduled (cron: every Monday)  |  reactive (on-change: "when X, do Y")

C. EXECUTOR HOME  WHERE does it fire, in a local-first app where data is on-device and
                  devices are not always on?
     desktop daemon:  single writer, has bun:sqlite + Y.Doc, but only up while the laptop is awake.
     cloud worker:    always on, but CANNOT read on-device CRDT data (the cloud executor is dead).
     phone/browser:   only while the app is open.
     THIS AXIS GATES EVERYTHING.

D. FORMAT  If portable, own a tiny AST, or adopt CEL / JSONLogic / jq?
```

## The decisive finding: axis C has no free always-on home, and that picks the trigger

Every durable-execution engine and every reliable-cron product runs the same way: it is the always-on
owner of the data. Epicenter is not. That single fact cascades.

```txt
PRIOR ART ON WHERE AUTOMATION RUNS (web-grounded; sources at end)

  product         reliable cron?   how it pays for it
  Notion          no cron at all   reactivity by CENTRALIZING data in Notion's cloud
  Zapier / Make   yes              their cloud is the always-on data home (or you push data to it)
  Tana            no prominent cron AI runs server-side in Tana's cloud; tag-triggered (reactive)
  Apple Shortcuts time triggers    UNRELIABLE without a dedicated always-on HUB (HomePod/Apple TV);
                                   iPhone sleeps and battery-throttles background work
  Raycast         interval refresh best-effort, ONLY while the Mac is awake with the app running
  Obsidian/Logseq no native cron   automation is manual JS plugins; community keeps begging for a
                                   scheduler precisely because there is no always-on executor
  Actual Budget   NO cron, by      REACTIVE rules-as-data: fire on import and on edit, with a
   (local-first!) design           pre-commit PREVIEW of the computed effect
```

Read the table along the awake-device line and the answer falls out:

```txt
SCHEDULED (cron) is the awkward trigger. It presupposes an always-on home Epicenter
  refuses to have (the cloud executor is dead, the synced run-queue is deleted, the phone
  sleeps, the laptop closes). Every tool that does cron well either centralizes your data
  or mandates a hub. Epicenter has neither.

REACTIVE (on-change) is the natural trigger. The edit that fires the rule is made on a
  device that is, by definition, AWAKE and AUTHORITATIVE for that change and holds the
  Y.Doc in memory. No scheduler, no server, no wake-up problem. It works identically on
  phone-when-open, browser, and desktop because it evaluates the same closed-operator
  SELECT AST over in-memory rows. Actual Budget, the closest local-first analogue, shipped
  exactly this and no cron at all.
```

"Name the box" is the killshot the team should keep handy: any "let us build the scheduler" argument
has to finish the sentence "and it fires on ____, which can read my data." There is no such box that
has not already been rejected. A scheduler built now is a timer wired to nothing.

## The corollary that makes the boundary clean: dry-run-approve breaks unattended

This is the structural insight that unifies the whole design. The bounded program's safety model is
"the user approves the COMPUTED EFFECT before commit." That model has a human in the loop by
construction.

```txt
trigger     is a human present to approve the computed effect?     fits which lane?
manual      yes (they just clicked Run)                            bounded data (dry-run + approve)
reactive    yes (they are right there editing)                     bounded data (dry-run + approve)
cron 2am    NO (nobody is watching)                                NOT bounded data. full-trust code.
```

So the trust model itself tells you where the line is. Unattended scheduled work cannot use the
approve-the-effect gate, because there is no one to approve. That means cron-style automation belongs
in the FULL-TRUST lane (a TS script you reviewed and approved ONCE, the way you pre-approve any code),
not in the bounded-data lane (which assumes a fresh human approval each run). This is not a limitation
to engineer around; it is the honest boundary. Reactive keeps the approval step (or an explicit, scoped
auto-apply with undo, per the auto-approve rule in the UX grill). Cron cannot, so cron is code.

## Verdict per axis

```txt
A. PORTABILITY   The SAVED UNIT is the portable bounded program (intent + select AST + apply
                 bindings + limit), stored in the Y.Doc, NOT a TS file. A TS recipe forfeits
                 phone and browser on day one and cannot fire reactively in the sync loop.
                 TS scripts (Model 2) remain the desktop-only full-trust ESCAPE HATCH, never the
                 saved-recipe format.

B. TRIGGER       Sequence: manual (v1) -> reactive (first real trigger) -> cron (deferred, and when
                 it comes it is the full-trust TS lane, not bounded data). Do NOT build cron into the
                 bounded-data lane.

C. EXECUTOR HOME Reactive fires on the editing device in the Y.Doc observer loop (free, works
                 everywhere). Cron, when finally wanted, binds to the desktop daemon timer and fires
                 ONLY while that machine is awake (state this honestly), or runs as a TS script under
                 OS cron (launchd/systemd). A Cloudflare Durable Object Alarm may, at most, PING the
                 daemon or set a cross-device "due" marker; it never executes over the data. Never
                 revive the cloud executor or the synced run-queue.

D. FORMAT        KEEP the owned ~15-operator predicate AST + owned apply bindings. Do NOT adopt CEL,
                 JSONLogic, jq, or JMESPath. Steal two ideas from CEL instead (below).

DURABLE EXECUTION  Refuse all of it (Cloudflare Workflows, Temporal, Inngest, DBOS, Restate). They run
                 server-side and are blocked by axis C, and their guarantees (checkpoint, saga,
                 exactly-once, multi-day mid-flight sleep) target long non-idempotent transactions. A
                 bounded program is small and idempotent and re-expands from scratch each run.
                 Re-run-from-scratch IS the durability story (Actual Budget literally re-runs all
                 matching rules on every import).
```

## Why keep the owned AST and not adopt CEL (axis D), in one move

The bounded program has TWO halves and no off-the-shelf format spans both:

```txt
SELECT (predicate)   CEL fits well (non-Turing-complete, type-checkable, browser+server impls) and
                     its operators are a superset of your ~15.
APPLY  (mutation)    CEL is READ-ONLY by design. JSONLogic is read-only. jq mutates but is
                     Turing-complete string syntax with a wasm-blob cost and an LLM syntax-error tax.
                     There is NO adoptable mutation format.
```

So "adopt CEL" can never mean "adopt one format for the saved unit." It means "own APPLY anyway AND
add a community-maintained CEL dependency for SELECT, kept behaviorally identical across the phone and
the server, forever." You would maintain two formats to replace half of one you already own, render to
the approval card for free, and validate with a schema check. This is the same shape as the SQL
decision in the UX grill: refuse the extra expressiveness the bounded transform cannot consume.

Two things worth STEALING from CEL as a few dozen lines, not a dependency:

```txt
1. Parse-then-CHECK. Add a type-check pass over the owned AST against the table schema, so a bad
   field name or a string-vs-int comparison is rejected BEFORE the dry-run. A naive owned AST (and
   JSONLogic) silently evaluate a bad field to null; this closes that gap.
2. Bounded macros. If list-valued predicates are ever needed, copy CEL's rule that all/exists/filter
   iterate ONLY over a provided list, never unbounded, so the format stays non-Turing-complete by
   construction.
```

## User stories (the axes made concrete)

```txt
STORY 1  manual, phone -> PORTABLE RECIPE WINS
  "On the train: take everything in my inbox today, move person-name notes to People,
   tag URL notes read-later, archive empty stubs. Show me before doing it."
  The device in his hand is awake and holds the Y.Doc. The saved program is JSON, evaluates over
  in-memory rows, dry-runs, he approves on mobile. A TS script CANNOT run here at all (no Bun, no
  SQLite, no daemon on the phone). This is the case the portable artifact wins outright.

STORY 2  scheduled + filesystem + unattended -> TS SCRIPT WINS
  "Every night at 2am, close tabs untouched for a week and write a markdown digest to my notes folder."
  Writes an arbitrary file (not on the typed action surface), runs at 2am with nobody watching (no one
  to approve the computed effect), needs full trust. This is exactly what Model 2 TS scripts are for,
  scheduled by OS cron. The bounded-data lane should NOT stretch to cover it: the missing approver is
  the signal that this is the full-trust lane.

STORY 3  reactive, any device -> PORTABLE RECIPE WINS (the future direction)
  "When I add the tag #book to an entry, also set type=book and add it to my reading-list."
  Saved as portable data with trigger { kind: reactive, on: tag.added, value: "book" }. Maria adds the
  tag FROM HER PHONE; a Y.Doc observer on the phone sees the change, runs the SELECT over in-memory
  rows, dry-runs the typed apply on a fork, she approves (or it auto-applies under the small+reversible
  rule with an undo toast). No server fired it; the editing device did. A TS script structurally
  cannot occupy this slot (it is not in the sync loop and not on the phone).
```

The reactive danger to design for (named honestly): an on-change rule that mutates can fan out or loop
(rule A's write triggers rule B's write triggers rule A). Reactive needs debounce/coalescing, a
loop-guard (do not re-fire on a write the rule itself made), and a clear "auto-apply vs preview" gate.
A once-a-day cron is calmer in this one respect; reactive is not strictly easier in every dimension, it
is only the one whose executor home is free.

## Recommended slices (supersedes Slice 4 of the bounded-programs spec)

```txt
v1   one-shot bounded programs (already the plan) + TS scripts (Model 2, already shipping).
     LOCK the saved unit as portable JSON { intent, select, apply, limit, trigger } in the Y.Doc.
     trigger defaults to "manual"; the handler honors ONLY manual. The field is reserved so later
     triggers attach with no schema repaint and no migration of saved units.
     (Caveat from the defer-everything fighter: only reserve the trigger field once select/apply have
      stopped churning; do not freeze a shape that is still moving.)

v-next  REACTIVE rules. Add a Y.Doc-observer trigger that reuses the existing SELECT evaluator and the
        dry-run / approve / scoped-undo flow, plus debounce + loop-guard. Works on every device.

deferred  CRON. When a real time-only need bites, bind it to the desktop daemon timer (honest: fires
          only while that machine is awake) or a TS script under OS cron. Optionally a DO alarm pings
          the daemon. This lives in the FULL-TRUST lane, not the bounded-data lane.

never   a durable-execution engine; adopting CEL/JSONLogic/jq; a custom grammar+parser DSL; reviving
        the cloud executor; rebuilding a synced run-queue.
```

## The open decision this leaves for Braden

The research strongly favors reactive over scheduled, but it is ultimately a product call about how you
picture USING this:

```txt
EITHER  "whenever I do X, also do Y"        -> reactive-first. Build the portable artifact now, make
        (the high-value, infra-free case)      reactive the first trigger. RECOMMENDED.

OR      "every Monday, do X" matters more   -> you accept that this is desktop-only, daemon-or-TS,
        to you than reactive                   fires only while the machine is awake, and lives in
                                               the full-trust lane. Then reactive is secondary.
```

My flag: reactive-first. It is the only trigger whose executor-home problem is solved for free, it is
the dominant pattern in every comparable tool, it keeps the approve-the-effect trust model intact, and
it makes the portable-data-as-saved-unit decision pay off immediately. Cron is a real but secondary
need that the full-trust TS lane already covers honestly.

## Sources (web-grounded)

```txt
Durable execution:
  developers.cloudflare.com/workflows (+ /build/rules-of-workflows), blog.cloudflare.com/workflows-ga
  developers.cloudflare.com/durable-objects/api/alarms, blog.cloudflare.com/durable-objects-alarms
  dbos.dev/blog/durable-execution-coding-comparison, docs.dbos.dev/architecture
  inngest.com/docs/learn/how-functions-are-executed, docs.restate.dev/concepts/durable_execution
Local-first automation:
  actualbudget.org/docs/budgeting/rules, notion.com/help/database-automations
  help.tana.inc/posts/command-nodes-and-command-line, silentvoid13.github.io/Templater
  developers.raycast.com/information/background-refresh, inkandswitch.com/essay/local-first
  homekitnews.com (Apple home hub), discussions.apple.com/thread/255849306
Portable formats:
  github.com/google/cel-spec (+ /blob/master/doc/langdef.md), github.com/google/cel-go
  jsonlogic.com, jqlang.github.io/jq, jmespath.org
```
