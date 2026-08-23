# AI Workflows: UX Gauntlet and Clean-Break Verdict

**Date**: 2026-05-29
**Status**: Review record (grills `20260529T120000-ai-workflows-bounded-programs.md`)
**Owner**: Braden
**Method**: 8-story user gauntlet + 4 adversarial fighters, adjudicated against repo ground truth
**Follow-on**: `20260529T190000-ai-workflows-triggers-portability-durable-execution.md` resolves
recurrence (Q3) with web-grounded research: portable data over TS files, reactive over scheduled.

> **Reasoning record.** The CANONICAL current design is
> `20260530T100000-ai-workflows-consolidated-design.md`. This doc is the concrete grilling that
> produced it: 8 user stories, 4 fighters, the story-by-story tally. Read it for the cards and the
> evidence behind each verdict. Note: the consolidated doc reframes Q1 (the old "phone vs SQL" C-1 is
> resolved: the predicate AST is canonical, SQL is an optional COMPILED projection, never an input).

## What this document is

The parent spec settled the trust model: the AI emits DATA (`{ intent, select, apply, limit }`),
a fixed engine runs `select` read-only and dry-runs the typed transform on a forked Y.Doc, the user
approves the COMPUTED EFFECT, undo is a scoped inverse-op from captured before-values. None of that is
reopened here.

What IS on trial is the SHAPE: whether each of the three "models" earns its right to exist in the
form the spec describes, and how each open question resolves when you walk a real human through a real
screen. This is a UX-first review. Every claim below traces to a card a person sees or a decision a
person makes. Where the gauntlet contradicted the parent spec, the contradiction wins and is recorded.

The headline result, stated up front so the rest can defend it:

```txt
The parent spec has THREE models. The gauntlet supports TWO.
  Model 1   typed actions over the workspace, dry-runnable, runs in-app and on phone
  Model 2   arbitrary code, desktop-only, full trust, git-diff review

"Model 1.5" is not a third model. It is Model 1 with one extra emission mode
(the model emits a bounded program the ENGINE expands, instead of enumerating
calls itself) plus an aggregate review card. Same actions, same fork, same undo.
Keep the FEATURE. Delete the TAXONOMY.
```

Everywhere below, "bulk mode" means what the parent spec calls Model 1.5.

---

## 1. The verdict table (Section A)

Eight stories, walked end to end (full transcripts in Section 3). Each is graded by what actually
carries it.

| # | Story | Carried by | Verdict |
|---|-------|-----------|---------|
| S1 | "archive my stale notes" (the easy mechanical one) | bulk mode, one op | **clean** |
| S2 | "delete saved tabs older than 30 days" (destructive) | bulk mode, destructive grade | **clean** |
| S3 | "tag all 4,212 old entries 'imported'" (large-N) | bulk mode, but exceeds `limit:1000` | **degrades** (forced batch sequence) |
| S7 | "merge todo / to-do / TODO into 'todo'" (phone, non-technical) | bulk mode as an ordered SEQUENCE (Tier 2) | **clean** (corrects the draft, see note) |
| S4 | "tag each note with its topic" (per-row judgment) | hands off to Model 1 loop | **degrades to Model 1 loop** |
| S5 | "delete the ones that are actually duplicates" (per-row judgment) | exact slice = bulk; semantic = judgment | **needs Model 2** (for the semantic slice) |
| S6 | "append a footer to every published post's BODY" | nothing on the typed surface | **impossible** (route to Model 2) |
| S8 | "every Monday archive stale entries" (recurrence) | one-shot is bulk; recurrence is not a recipe | **clean one-shot**; recurrence re-homed |

**Tally:** clean 4, degrades 2, needs-Model-2 1, impossible 1.

Read the tally honestly:

```txt
- Bulk mode cleanly carries the mechanical jobs (S1, S2, S7) and the one-shot
  of the recurrence job (S8). That is the 50% it is FOR, and it does it well.
- It degrades gracefully, not silently, on large-N (S3) and on per-row
  judgment (S4). Graceful degrade is a feature, not a failure, IF the wall is
  visible. The danger is silent mis-handling, which the gauntlet shows up in
  exactly two places (the 1000 cap and the per-row template) and which the UX
  must refuse to paper over.
- One story is genuinely impossible (S6, body edits) and that single story is
  the cleanest proof Model 2 must exist.
```

The S7 correction is load-bearing, so it is flagged in the table: the draft transcript escalated tag
normalization to Model 2. That was wrong. It is expressible as an ordered list of bounded ops (append
the canonical tag, then remove each known variant), every op uniform and dry-runnable. This is the
strongest evidence in the whole gauntlet that "ordered list of bounded ops" (the parent spec's Tier 2)
earns its keep: it converts an apparent judgment task into mechanical steps. See S7 in Section 3.

---

## 2. The six open questions, each answered and defended

Each answer takes a position, names the asymmetric win, and names the 10% refused. No menus.

### Q1. Selection body: SQL, structured predicate, or both?

**Answer: structured predicate AST is the only emitted form. Delete the `select: { sql }` field.
SQL survives, if at all, as an optional, internal, desktop-only compile target for large-N speed,
never as something the model emits.**

The fight that settled it: SQL-only argued the predicate is a doomed SQLite reimplementation the LLM
is worse at; predicate-only argued SQL cannot run on the phone (no materializer there) and that the
predicate IS the explanation. The deciding cut neither side led with: **the bounded transform cannot
consume most of SQL.** The `apply` is one mutation per row with bindings off that row. JOINs, GROUP
BY, subqueries, and window functions produce shapes no per-row binding can read. So you would pull in
a Turing-adjacent language to express a boolean filter tree, then write a validator (`single
statement, starts with SELECT, returns id, PRAGMA query_only`) whose entire job is to fence off the
95% of SQL the engine cannot use. The predicate has no fence to maintain because its grammar IS the
bound, and the cliff-edge of a transform-bounded predicate coincides exactly with the transform's own
edge (see the operator enumeration in Section 4-B). That coincidence is the clean seam.

The selection form is also NOT the gate. The user approves the computed effect (count + diff +
spot-check), not the SELECT. So "predicate renders to plainer language than SQL" only buys you a nicer
optional "Query" disclosure, which is a weaker argument than the parent spec implies. The real reason
to choose predicate is that it runs over in-memory Y.Doc rows on every device with a ~50-line
evaluator and no SQLite, which makes it actually LIGHTER on phone than SQL, not heavier.

```txt
Asymmetric win:  one emitted artifact that runs identically on desktop, browser, and
                 phone, with no SQL-validator fence and portable saved programs.
10% refused:     model SQL fluency (LLMs are slightly better at SQL than at a closed
                 JSON predicate) and the exotic queries the transform could not consume
                 anyway. Mitigation: let the model reason in SQL internally, but emit the
                 predicate; a closed ~15-operator grammar with TypeBox validation plus the
                 effect-count as the catch-all gate keeps malformed predicates cheap.
```

This answer depends on one product fact only Braden can confirm; see Contradiction C-1 in Section 5.

### Q2. Is mechanical-only the honest contract for bulk mode?

**Answer: yes, with one widening the gauntlet forced: "mechanical" includes an ordered SEQUENCE of
uniform ops (Tier 2), not just one op. The seam to per-row intelligence is the model declining to emit
a program and entering the Model 1 loop with an upfront cost-and-consent card. There is never a
"call the model per row" binding.**

This is the load-bearing question and the gauntlet's center of gravity. S4 and S5 are the walls. A
bounded template applies the SAME `apply` to every selected row; every binding (`from`, `literal`,
`append`, `remove`, `set`) resolves to a constant or a value already on the row. "The topic of THIS
note" (S4) is neither a column nor derivable in SQL, because the body that holds the topic is not in
the materializer at all. So the only honest behaviors are: error (useless), mis-tag all rows with one
literal (the exact failure the same-template constraint makes tempting, and a lie), or recognize the
request is non-mechanical and offer the loop. The UX renders the third (card in Section 5-C).

The tempting rescue, a `{ callModel: prompt }` binding, is ruled out decisively. It destroys
dry-runnability (computing the "effect" would itself need the 412 calls, so you would be approving a
PREDICTION of what the model will later decide, which is approving the model's claim, the precise
thing the trust model exists to kill); it breaks determinism (approved effect diverges from applied
effect per row); and it makes cost unbounded inside a shape whose whole pitch is one cheap expansion.
For S5 it does not even work: duplication is pairwise and "keep which copy" is a cross-row decision a
per-row binding structurally cannot make. So per-row intelligence lives in the Model 1 loop, where
each call is visible, individually approvable, and individually undoable through the same machinery.

```txt
Asymmetric win:  refuse per-row intelligence inside the program to keep it DATA, dry-runnable,
                 deterministic, and bounded-cost. The 90% that is real bulk work (one rule, or a
                 short sequence of rules, over many rows) stays trustworthy.
10% refused:     per-row judgment expressed AS bulk. It is not lost, it is served by the loop,
                 which already ships. The seam is a handoff card, not a new capability.
```

### Q3. One-shot only, or saved recipes?

**Answer: delete saved recipes as a distinct subsystem (parent spec Slice 4). Recurrence splits
cleanly into two things that already have homes: (a) "remind me to run this" = save the bounded
program as a named bookmark plus an optional local timer that re-posts the normal one-shot card; and
(b) "do it without me" = a Model 2 reviewed-once bun script on OS cron behind a one-time
execute-on-a-schedule gate.**

The kill-recipes fighter is right and the repo proves it: `docs/scripting.md`'s canonical example IS
the weekly stale-entries loop, today, behind `connectDaemonActions`. Slice 4 proposes to BUILD a
recipe store, a scheduler, and a re-expansion engine to re-create a capability that already exists,
and which the parent spec's own "What We Refuse" section already rejected once as the deleted
`commands` run-queue. The S8 transcript argued the other way (re-approval IS the safety model), and it
is correct about that, but its own argument collapses the distinction: "re-approve each Monday" is
identical to "re-run the saved one-shot each Monday," which needs nothing beyond save + a timer-nudge.
There is no honest middle product where a stored program is re-expanded AND a human must approve every
run AND it is somehow more than re-running the one-shot. If a human is at the gate, it is a reminder.
If no human is at the gate, it is full-trust unattended code, which is Model 2 by definition.

```txt
Asymmetric win:  delete the recipe store, the scheduler primitive, the re-expansion engine, and
                 the weekly re-review-card-forever UX. Recurrence becomes "a saved program + a
                 nudge" or "a reviewed script + cron," both of which already exist.
10% refused:     a true zero-touch recurring bulk op that is ALSO bounded-data-not-code. That
                 case does not exist honestly: zero-touch means no gate means full trust means code.
```

**Update (resolved by `20260529T190000-ai-workflows-triggers-portability-durable-execution.md`).**
A web-grounded grill sharpened this in two ways. First, the saved unit should be the PORTABLE bounded
program (data), not a TS file: a TS recipe forfeits phone and browser on day one and cannot fire in
the sync loop. Second, and deeper, the trust model itself draws the line: "approve the computed
effect" needs a human present, so unattended cron cannot use it and belongs in the full-trust TS lane,
while the first trigger worth building is REACTIVE (on-change), the only one whose executor home is
free (it fires on the awake editing device in the Y.Doc observer loop). Refined sequence: one-shot now,
reactive next, cron deferred to the TS/daemon lane. Durable-execution engines are refused (all run
server-side, blocked by the no-cloud-executor constraint). See that doc for the four-axis breakdown.

### Q4. Auto-approve rule.

**Answer: for bulk mode, auto-apply with an undo toast IFF the computed effect is forkable
(therefore undoable) AND non-destructive (zero deletes, nothing irreversible) AND has no external
effects AND touches at most a small N (propose 10). Everything else is reviewed. Do NOT overload the
existing per-action `toolTrust` table for bulk.**

The shipping `toolTrust` is `{ id, trust: 'ask' | 'always' }`, per-action, user-set via an "Always
Allow" button. That is the right gate for a SINGLE Model 1 call (close one tab). It is the WRONG gate
for bulk: a user who once clicked "Always Allow" on `entries_update` must not thereby auto-apply a
4,000-row change. So bulk uses a rule computed from the dry-run effect, not the trust flag. The rule is
something a user can state in one breath: "small, additive, reversible changes just happen and I can
undo them; anything that deletes, touches many rows, or leaves the app, I see first." Two artifacts,
two gates: this is honest asymmetry, not a missing unification. Cards in Section 4-F.

```txt
Asymmetric win:  a predictable, effect-computed rule the user can reason about, with no new
                 per-action permission surface and no risk of a single "always" decision
                 silently authorizing a bulk blast.
10% refused:     letting power users raise the bulk auto-threshold per action. They do not need
                 it; the undo toast already covers the small additive case, and review covers the
                 rest. If this bites, it is one tunable number (Contradiction C-2).
```

### Q5. Is there a real Model 2 task?

**Answer: yes, and S6 is it. Editing a note BODY is impossible on the typed, dry-runnable surface,
for two independent structural reasons, neither a config gap. That single story earns Model 2 its
existence.**

`entries_update` has no body field; the body is a separate child Y.Doc per entry (`attachRichText`,
its own guid). Even if a body-writing action existed, the dry-run forks the workspace via
`Y.encodeStateAsUpdate(parentDoc)`, and that update does not contain child-doc contents, so the fork
has nothing to mutate and the field-diff renderer has nothing to diff. The entire trust chain
(run select, bind, dry-run on fork, approve the computed effect) collapses at the fork step because
the artifact under review is not in the forked state. The honest UX is a hard, explained stop with an
offer to hand to the coding agent on desktop, NOT a fabricated count. Card in Section 3, S6.

```txt
Asymmetric win:  Model 2 has exactly one job and one sentence (below), so it never competes with
                 bulk mode and the bounce between them is comprehensible.
10% refused:     nothing. This is the irreducible lane: anything that must leave the typed,
                 dry-runnable surface (bodies, files, shell, arbitrary code).
```

### Q6. Undo scope.

**Answer: confirm session-scoped, last-writer-wins, forkable-only, transient, absent on
external/irreversible ops. It stays honest IF AND ONLY IF the copy matches the mechanism. The
contract does not lie; sloppy toast wording would.**

Walked against the worst cases (Section 4-F): undo after data changed underneath CLOBBERS the
intervening change, which is honest only because the affordance is transient (seconds) and undo is
itself just another LWW write, consistent with the CRDT model; it is a lie only if labeled "rewind."
A hard-delete undo (S2) is RE-CREATE (a new write, possibly a new identity, LWW), not resurrection,
and the card must say so. A partial-failure batch restores only the rows that actually changed (the
dry-run captured before-values only for applied rows) and the toast must say "30 changed, 7 skipped."
Large-N undo is per-batch, never global, and the card says so.

```txt
Asymmetric win:  near-free, high-confidence reversal reusing before-values the dry-run already
                 captured, with no general history subsystem.
10% refused:     time travel, undo of external effects, undo-of-undo, permanent undo. The copy
                 "put these N back to what they were just now (last write wins)" is the whole
                 honest contract.
```

---

## 3. The gauntlet, walked (concrete transcripts and cards)

Conventions: prose is the model's restated intent (the untrusted label, "did it understand me?"); the
card is the computed effect (the gate). Selection is shown in all three forms the mandate asked for:
SQL (desktop materializer), predicate AST (the portable form, per Q1 the one actually emitted), and
the plain sentence the user reads.

### S1. "archive my stale notes" -> clean

```txt
User   archive my stale notes

AI     You want to add the tag "archived" to entries tagged "stale" that have
       not been updated since March 1, 2026. Here is exactly what that does.
```

```txt
SQL (desktop):  SELECT id, tags FROM entries
                WHERE tags LIKE '%"stale"%' AND updatedAt < '2026-03-01' AND deletedAt IS NULL
predicate AST:  { and: [ {includes:{tags:"stale"}}, {lt:{updatedAt:"2026-03-01"}}, {isNull:"deletedAt"} ] }
plain sentence: Add tag "archived" to 37 entries.
```

```txt
+----------------------------------------------------+
|  *  Add tag "archived" to 37 entries               |
|     Create 0 . Delete 0 . Undoable                 |
|                                                    |
|  > See the 37 entries   > What changes   > Query   |
|                                                    |
|     [ Apply ]                     [ Cancel ]       |
+----------------------------------------------------+

> What changes  (generic field diff, first rows)
   entry abc123  tags: ["stale"]        -> ["stale","archived"]
   entry def456  tags: ["stale","q1"]   -> ["stale","q1","archived"]
   ... 35 more
```

Click [Apply]: the engine replays the 37 frozen `entries_update` calls the dry-run resolved. Toast:
`Added "archived" to 37 entries. [ Undo ]`. Undo replays each captured BEFORE tags array back through
`entries_update`.

**Subtlety the shape forces (correction to the parent spec's filled example):** `entries_update` does
a WHOLE-ARRAY tags replace; there is no native append. So `{ append: "archived" }` is NOT passed
through to the action. The engine reads the row's current `tags` (which is why `tags` must be in the
SELECT), dedup-appends, and binds the resulting whole array. If the SELECT omitted `tags`, those rows
fail `Value.Check` and are reported and skipped, not guessed. The parent spec's example
`tags: { append: "archived" }` reads as pass-through; it is engine-computed. Worth fixing in the spec.

### S2. "delete saved tabs older than 30 days" -> clean (destructive grade)

```txt
SQL:            SELECT id,url,title,favIconUrl,pinned,sourceDeviceId,savedAt
                FROM savedTabs WHERE savedAt < 1745884800000
predicate AST:  { lt: { savedAt: 1745884800000 } }   // run by the extension's predicate evaluator
plain sentence: Delete 88 saved tabs. Undo re-creates them as new rows (last write wins).
```

Every column is selected on purpose: a hard delete keeps no field-diff, so the full row is the
before-value undo re-creates from.

```txt
+--------------------------------------------------------+
| !  Delete 88 saved tabs                                |
|    Create 0 . Delete 88 . Hard delete                  |
|                                                        |
|    Removed permanently. Undo does NOT rewind: it       |
|    re-creates them as new rows (new write, last        |
|    write wins). Pinned tabs included.                  |
|                                                        |
|  > See the 88 tabs   > What is deleted   > Query       |
|                                                        |
|    Type DELETE to confirm:  [____________]             |
|                                                        |
|     [ Delete 88 ]                  [ Cancel ]          |
+--------------------------------------------------------+
```

The wall here is honesty-of-language, not capability. `savedTabs` has no soft-delete column, so this
is a true hard delete; the engine sees `Delete count > 0`, renders the `!` grade with a typed
confirm, and the undo line states plainly that "undo" means re-create.

### S3. "tag all my old entries 'imported'" (4,212 rows) -> degrades (the 1000 cap)

```txt
SQL:            SELECT id, tags FROM entries WHERE date < '2024-01-01' ORDER BY id LIMIT 1000 OFFSET k
predicate AST:  { lt: { date: "2024-01-01" } }   + engine page window {limit:1000, offset:0..4000}
plain sentence: Add "imported" to 4,212 entries, in 5 batches of up to 1,000. This batch: 1,000.
```

The schema literal is `Type.Integer({ minimum: 1, maximum: 1000 })`. The model CANNOT emit
`{ limit: 4212 }`; `Value.Check` rejects it before the engine runs. Three behaviors at this wall:

```txt
(1) ERROR ("too many, narrow your query")     honest, but useless for a real 4,212-row job
(2) SILENTLY TRUNCATE to 1,000                 a LIE: the gate count diverges from reality.
                                               THIS IS THE DANGEROUS OPTION. Refuse it.
(3) BATCH: COUNT(*) first (free, trusted),     the only honest path that still does the job
    paginate one predicate into 5 windows,
    dry-run each on a fresh fork, walk the
    user batch by batch
```

```txt
+--------------------------------------------------------+
|  *  Add tag "imported" to 4,212 entries                |
|     Too many for one pass (cap is 1,000 per batch).    |
|     Split into 5 batches. You approve each in order.   |
|     Same change to every match of:                     |
|     "entries dated before Jan 1 2024"                  |
|     Create 0 . Delete 0 . Undoable per batch           |
|                                                        |
|  > Spot-check 10 random   > What changes   > Query     |
|                                                        |
|  --- Batch 1 of 5 -------------------------------------|
|     1,000 entries (rows 1 to 1,000, ordered by id)     |
|     [ Apply batch 1 of 5 ]            [ Cancel all ]   |
+--------------------------------------------------------+
```

There is never a single `[Apply to 4,212]` button, because no single approved effect covers 4,212:
the gate is five separate computed effects. The aggregate "4,212" appears only as trusted context.
Cost surfaced honestly: ordering must be stable (`ORDER BY id`) or pagination double-counts under
concurrent edits, and undo fragments to per-batch.

### S7. "merge todo / to-do / TODO into 'todo'" (phone, non-technical) -> clean as a SEQUENCE

This is the corrected story. The draft escalated it to Model 2 because one `apply` binding cannot do a
per-row set-subtraction (`{set}` clobbers other tags, `{append}` leaves the old spellings behind,
`{remove}` removes one literal). True for ONE op. But the model knows the three variants (it inspects
the tag set first), so it emits an ORDERED LIST of four uniform ops:

```txt
op1  select tags includesAny ["TODO","to-do","To-Do"]  -> append "todo"
op2  select tags includes "TODO"                        -> remove "TODO"
op3  select tags includes "to-do"                       -> remove "to-do"
op4  select tags includes "To-Do"                       -> remove "To-Do"
```

Each op is uniform and dry-runnable; the engine runs them in order on the SAME fork so op2 sees op1's
result, and renders one aggregate card.

```txt
predicate AST (op1):  { includesAny: { tags: ["TODO","to-do","To-Do"] } }
sqlForm:              unavailable on phone (no SQLite materializer); the predicate evaluator runs
                      over in-memory Y.Doc rows, which is exactly why predicate is the emitted form
plain sentence:       Add "todo" to 58 entries, then remove 3 old spellings. Net: all 58 end with
                      "todo", messy spellings gone.
```

```txt
+--------------------------------------------------------+
|  *  Clean up "todo" tags on 58 entries                 |
|     Plan: add "todo", then remove TODO, to-do, To-Do   |
|     Create 0 . Delete 0 . Undoable                     |
|                                                        |
|  What changes, on a sample entry:                      |
|     before:  [groceries, TODO, work]                   |
|     after:   [groceries, todo, work]                   |
|                                                        |
|  > See the 4 steps   > See the 58 entries   > Sample   |
|                                                        |
|     [ Clean up 58 ]                   [ Cancel ]       |
+--------------------------------------------------------+
```

A non-technical phone user reads "add todo, then remove the old spellings" and the before/after
sample, and trusts it without reading any query. **This is the strongest case in the gauntlet that
Tier 2 (ordered list of bounded ops) earns its keep:** it makes an apparent judgment task fully
mechanical. The schema implication is real and should be in the parent spec: the emitted artifact is
`BulkOperation[]`, not a single `BulkOperation`, dry-run in sequence on one fork.

**Phone-portability finding:** selection ports cleanly via the predicate evaluator. The honesty of the
card depends on the TRANSFORM being faithful, and the four-step sequence makes it faithful. Had we
been stuck with a single op and used `{append}`, the card "all become todo" would have been a lie
(old spellings remain). The device was never the wall; the single-op transform was, and Tier 2 clears
it.

### S4. "tag each note with its topic" -> degrades to the Model 1 loop

```txt
SQL:            partial. SELECT id,title,subtitle,tags FROM entries WHERE deletedAt IS NULL
                returns the rows, but no "topic" value exists to bind from, and the body that would
                reveal the topic is not a column (separate child Y.Doc).
predicate AST:  same wall: selects rows, produces no per-row topic.
plain sentence: cannot build one card; there is no binding meaning "the topic of THIS note."
```

The system recognizes the request is non-mechanical and offers the loop. It does NOT mis-tag all 412
rows with one literal.

```txt
+----------------------------------------------------+
|  ?  This needs reading each note, not a bulk rule  |
|                                                    |
|  You asked to tag each note with ITS OWN topic.    |
|  A bulk change applies the SAME value to every     |
|  row. No column holds each note's topic, and the   |
|  body is not readable by the bulk engine, so I     |
|  cannot fill the tag mechanically.                 |
|                                                    |
|  I can go note by note: read each, pick a topic,   |
|  and apply. That is 412 notes, about 412 model     |
|  calls.                                            |
|                                                    |
|  > Why this cannot be bulk   > See the 412 notes   |
|                                                    |
|   [ Go note by note (~412 calls) ]   [ Cancel ]    |
+----------------------------------------------------+
```

Click [Go note by note]: hands to Model 1 (shipping). The agent loops, reads each note (including the
child body via a read tool where needed), decides a topic, calls `entries_update` per note. Each call
is a mutation and flows through the SAME fork-dry-run, effect, and per-call undo machinery. There is
no atomic "undo all 412"; undo is per note, last write wins, and the card says so. **This is also the
clearest proof that the review machinery is shared infrastructure, not a "Model 1.5" possession:** the
loop reuses every piece of it.

### S5. "delete the ones that are actually duplicates" -> needs Model 2 (for the semantic slice)

```txt
SQL:            exact groups only. ...WHERE title IN (SELECT title FROM entries GROUP BY title
                HAVING COUNT(*) > 1). Misses "Q3 plan" vs "Q3 planning draft", cannot read bodies,
                cannot choose which copy to keep.
predicate AST:  impossible by construction. A per-row predicate cannot ask "is this row semantically
                a duplicate of some OTHER row" (pairwise, content-reading).
plain sentence: cannot build a bulk card for "actually duplicates."
```

Two walls, both fatal to the bulk shape: selection cannot express pairwise semantic similarity, and
`apply` runs the same template on every row, so a uniform delete marker would delete BOTH copies of
every pair (strictly worse than nothing). The `{ callModel }` rescue fails twice over here: pairwise
needs a second operand a per-row call does not have, and "keep which" is a cross-row choice a per-row
binding cannot make.

```txt
+----------------------------------------------------+
|  ?  I can't decide "duplicate" with a bulk rule    |
|                                                    |
|  "Actually a duplicate" means comparing notes to   |
|  each other by meaning, then choosing which copy   |
|  to keep. The bulk engine has no binding for       |
|  either, and cannot read note bodies.              |
|                                                    |
|  Exact-title matches I CAN do safely: 14 notes in  |
|  6 groups.                                         |
|                                                    |
|  > See the 6 exact groups   > Why not bulk         |
|                                                    |
| [ Review exact dupes ] [ Go pair by pair ] [ Cancel ]
+----------------------------------------------------+
```

The honest decomposition is rendered as a choice: the safe mechanical slice (14 exact-title rows) is a
normal destructive bulk card; true semantic dedup over bodies needs reading every child doc and
arbitrary comparison logic the typed surface does not expose, which is genuinely Model 2 territory.
The product shows the split rather than silently merging it.

### S6. "append a footer to every published post's BODY" -> impossible

```txt
SQL:            SELECT id,title FROM entries WHERE tags LIKE '%"published"%' AND deletedAt IS NULL
                -- the SELECT is fine; everything after it is the wall.
predicate AST:  { and: [ {includes:{tags:"published"}}, {isNull:"deletedAt"} ] }  -- selection was
                never the problem.
plain sentence: I cannot preview body changes. There is no effect to approve.
```

Two independent structural walls (Section 2-Q5): no body-writing action exists, and the parent-doc
fork the dry-run uses cannot contain or diff child-doc body text. No `[Apply]` button exists because
there is no computed effect.

```txt
+----------------------------------------------------+
|  x  Cannot preview this change                     |
|     Edits the note BODY, which I cannot dry-run    |
|                                                    |
|     Each post's body lives in a separate document  |
|     from the fields I can read and fork. No typed  |
|     action writes a body, and the dry-run cannot   |
|     see body text, so I have no effect to show you.|
|                                                    |
|  > Why   > Hand to the coding agent (desktop)      |
|                                                    |
|     [ Open coding agent ]          [ Cancel ]      |
+----------------------------------------------------+
```

On phone the hand-off is absent and the card says "Available on desktop only." The product must NOT
fabricate a count or fall back to looping a non-existent body action. A hard, explained stop is the
correct behavior. This is the bounce from the typed surface to Model 2, and it is comprehensible
precisely because the card names why the typed surface cannot do it.

### S8. "every Monday archive stale entries" -> clean one-shot; recurrence re-homed

The one-shot is unambiguously clean bulk: `apply.action = entries_update`,
`input = { id: { from:"id" }, tags: { append:"archived" } }` (engine-computed from the returned array,
as in S1). `deletedAt IS NULL` and `NOT includes "archived"` keep it idempotent.

```txt
predicate AST:  { and: [ {lt:{updatedAt:{relativeDays:-30}}}, {isNull:"deletedAt"},
                         {notIncludes:{tags:"archived"}} ] }
                relativeDays resolves at RUN time, not save time, or the rule rots.
```

Per Q3, recurrence is not a recipe subsystem. The card offers exactly the three honest choices:

```txt
+----------------------------------------------------+
|  *  Add tag "archived" to 18 entries               |
|     Create 0 . Delete 0 . Undoable                 |
|                                                    |
|  > See the 18 entries  > What changes  > Query      |
|                                                    |
|  [ Apply once ]                                    |
|  [ Save + remind me every Monday ]                 |
|  [ Cancel ]                                        |
+----------------------------------------------------+
```

[Save + remind me every Monday] stores the bounded program as a named bookmark and sets a local timer.
Each Monday the timer re-runs the saved program as a fresh one-shot (re-select, re-dry-run, post the
normal card into chat). It is NOT a re-expansion engine and NOT a synced run-queue; it is "re-run the
thing you already approved the shape of." If the user wants zero-touch with no Monday card, that is an
explicit Model 2 escalation (next card), named as such, never smuggled in.

---

## 4. Selection-body deep dive and the auto-approve / undo cards

### 4-B. The worst-case filter in three forms, and the predicate operator surface

The mandate asked for the gnarly `WHERE` (LIKE + date math + array containment) in all three forms.

```txt
SQL (desktop, model is fluent here):
  SELECT id, tags FROM entries
   WHERE tags LIKE '%"stale"%' AND tags NOT LIKE '%"archived"%'
     AND updatedAt < '2026-03-01' AND rating < 3 AND deletedAt IS NULL

predicate AST (the emitted form, renders to the sentence by a direct walk):
  { and: [ {includes:{tags:"stale"}},
           {notIncludes:{tags:"archived"}},
           {lt:{updatedAt:"2026-03-01"}},
           {lt:{rating:3}},
           {isNull:"deletedAt"} ] }

plain sentence (the optional "Query" disclosure, NOT the gate):
  tagged "stale", not already "archived", untouched since Mar 1, rating under 3, not deleted
```

Note the SQL array-membership is the fragile hack `tags LIKE '%"stale"%'` (one bad escape and the rows
and the sentence disagree); the predicate `includes` is exact. This is a real point in predicate's
favor, though secondary to the transform-cannot-consume-SQL argument in Q1.

The evaluator's full operator surface, enumerated, to cover the gauntlet:

```txt
logical    and, or, not
scalar     eq, ne, lt, lte, gt, gte
date       lt/gt on ISO strings; relativeDays (resolved at run time)
null       isNull, isNotNull
array      includes, notIncludes, includesAny, includesAll      (tags, type are JSON string[])
string     contains (substring), startsWith
set        in (value in list)
```

That is ~15 closed operators. Where it falls off a cliff, and why each cliff is the RIGHT place to
stop:

```txt
FTS / body-text search    body is not in the materializer at all (child Y.Doc). Structural, not a
                          gap. Route to Model 1 (read each) or Model 2.
JOINs (savedTabs x        produces a shape no per-row binding can consume. Route to Model 2.
  entries)
GROUP BY / aggregates     "tag count above median", "duplicates" (S5). The result is not a per-row
                          filter and cannot feed a binding. Route to Model 1/2.
subqueries / correlated   same: output is not a per-row binding input.
```

Every cliff coincides with the transform's edge: the moment the SELECT needs power a per-row binding
cannot consume, you were leaving bulk mode anyway. That coincidence is why the evaluator does not grow
toward SQLite forever; its grammar is bounded by what `apply` can use.

### 4-F. The auto-approve boundary, as two predictable cards

The rule, stated as something a user could predict:

```txt
AUTO-APPLY (toast + undo)  IFF  forkable  AND  no deletes / nothing irreversible
                                          AND  no external effects  AND  N <= 10
REVIEW (full card)         otherwise  (any delete, any external effect, or N > 10)
```

```txt
AUTO (small + additive + reversible)        REVIEW (37 rows, or any delete)
  AI  Added "archived" to 6 stale            +----------------------------------------+
      entries.  [ Undo ]  . > details        |  *  Add "archived" to 37 entries        |
                                             |     Create 0 . Delete 0 . Undoable      |
  one true sentence, undo in reach,          |  > See the 37  > What changes  > Query   |
  no decision demanded up front              |     [ Apply ]            [ Cancel ]      |
                                             +----------------------------------------+
```

`toolTrust` ('ask' | 'always') stays exactly as shipped for single Model 1 calls and is NOT consulted
for the bulk gate. The propose-10 threshold is the one tunable number (Contradiction C-2).

### 4-F-undo. The worst undo cases, with the actual toast copy

```txt
case                         toast copy                                   what actually happens
small additive (S1)          Added "archived" to 37 entries. [Undo]       re-set each captured BEFORE
                                                                          tags array via entries_update
hard delete (S2)             Deleted 88 saved tabs. [Undo]                RE-CREATE 88 rows from captured
                             (expanded: "re-creates as new rows")         before-values. New writes, LWW.
partial-failure batch        Updated 30 entries (7 skipped). [Undo]       restore ONLY the 30 applied;
                                                                          before-values exist only for them
data changed underneath      Put 37 entries back to before. [Undo]        LWW overwrite of the intervening
                             (NOT "rewind")                               edit. Honest only because the
                                                                          toast is transient (seconds).
large-N (S3)                 Added "imported" to 1,000 (batch 2). [Undo]  per-batch only; no global undo,
                                                                          stated on the card
body edit (S6)               (no toast)                                   nothing applied, nothing to undo
```

The contract is honest as long as the copy matches the mechanism. The one phrase that would make it
lie is "rewind" or "restore history"; the safe phrase is "put back, last write wins."

---

## 5. Each gradation on trial, and the unresolved contradictions

### One-sentence test per gradation (Section E)

```txt
Model 1        "the only thing that can let the model read and DECIDE per item, with a human gate
                per decision."
bulk mode      "the only thing that can apply one mechanical rule (or a short ordered sequence of
                rules) to N rows the model never enumerates itself."
Model 2        "the only thing that can leave the typed, dry-runnable surface: bodies, files, shell,
                arbitrary code."
```

Model 1 and bulk mode do NOT overlap on the verb (decide-per-item vs one-rule-many-rows), so the
FEATURE is real. But the EXECUTION and REVIEW machinery (fork dry-run, effect card, scoped undo) is
shared by both, as S4's degrade proves: the Model 1 loop reuses all of it. So "Model 1.5" as a third
MODEL fails the test: a model defined as "the loop, but only when the body is constant, rendered as an
aggregate" is a feature plus a renderer, not a tier.

```txt
Is bulk mode just Model 1 with a fan-out renderer?
  Mostly yes. The fork dry-run is a property of the execution TARGET (point invokeAction at a forked
  doc), not of a new model. The card is the existing approval event, summed. The ONE thing that is
  genuinely not a renderer is engine-side enumeration: the model emits a compact program and the
  ENGINE expands it to N calls, because the model cannot enumerate 4,000 calls in context. That is a
  real capability. It is a capability of Model 1's action surface, registered as one bulk_apply-style
  action carrying the { select, apply, limit } schema. A capability is a feature, not a model.

Where is the user-visible seam, and is the bounce comprehensible?
  1 <-> bulk:   the model chooses the artifact. Uniform rule (or short sequence) -> bulk card
                ("same change to N rows"). Per-item judgment -> loop card ("I'll go one by one,
                ~N calls"). Comprehensible: the two cards describe two different jobs.
  bulk <-> 2:   the bounded surface REFUSES (body S6, files, shell, exotic query) and names why it
                cannot dry-run, then offers the desktop coding agent. Comprehensible because the card
                states the structural reason. The one jarring case is a phone user hitting S6 and
                getting "desktop only"; jarring but honest and unavoidable.
```

### Model 2's execution gate (Section D card)

For the zero-touch recurrence and the S6 hand-off, Model 2's "approve running this" gate looks like:

```txt
+------------------------------------------------------+
|  >_  Run script every Monday 9:00 AM                 |
|      archive-stale.ts  (reviewed, in your repo)      |
|                                                      |
|  Reads  entries (read-only SQLite)                   |
|  Writes entries_update via daemon  . full trust      |
|  > See the script   > Edit schedule                  |
|                                                      |
|     [ Approve schedule ]            [ Cancel ]       |
+------------------------------------------------------+
```

Approved once; OS cron plus the daemon run it; drift shows up as a git diff the user chose, never a
weekly re-review card. This is strictly more auditable than re-dry-running an untrusted SELECT against
drifted data every Monday, which is why Slice 4 dies.

---

## 6. What I would cut from the parent spec, and the story that exposed it

```txt
cut / change                                              exposed by
1. The "Model 1.5" name and the three-model taxonomy      kill-1.5 fight + S4 (the loop reuses the
   and the decision-rule table. Collapse to: Model 1       same dry-run/card/undo, so the machinery
   (typed actions, two emission modes) + Model 2.          is not a "1.5" possession).

2. select: { sql } as the emitted field. Replace with     S7 (phone, no SQLite) + the Q1 cut that
   the predicate AST as the one emitted artifact; SQL      the transform cannot consume SQL's power.
   only as an optional desktop compile target.

3. Slice 4 "saved recipes / re-dry-run engine."           S8 + kill-recipes (docs/scripting.md
   Replace with save-as-bookmark + local timer-nudge       already ships the weekly loop; Slice 4
   (re-runs the one-shot) and Model 2 cron for             rebuilds the deleted commands queue).
   unattended. SHARPENED in 20260529T190000: saved
   unit is portable data; reactive is the first
   trigger; cron lives in the full-trust TS lane.

4. Overloading toolTrust for the bulk auto-approve gate.   Q4 / Section 4-F (one "always" click must
   Replace with the effect-computed rule.                  not authorize a bulk blast).

5. The filled example `tags: { append: "archived" }` read  S1 / S8 wallNotes (entries_update is a
   as pass-through. Clarify: append/remove are ENGINE-      whole-array replace; the engine computes
   COMPUTED from the SELECT's returned array.               the new array, the action gets a whole set).

6. The silent reading of `limit: max 1000`. Surface it as  S3 (4,212 rows). Silent truncation is the
   explicit batching UX; forbid silent truncation.         one option that lies on the gate.

ADD (not a cut): the emitted artifact is BulkOperation[]   S7 (faithful tag merge needs an ordered
   (an ordered sequence dry-run on one fork), not a         sequence; one op cannot do per-row set
   single BulkOperation. This is Tier 2 made concrete.      subtraction).
```

---

## 7. Open contradictions I could not resolve without you

Phrased as either/or with my recommendation flagged.

### C-1 (gates Q1): Is bulk-over-my-data a PHONE feature in v1, or a desktop power tool?

```txt
IF phone is a v1 target for bulk:   predicate AST canonical (my recommendation). It is the only form
                                    that runs on the phone at all, and the transform cannot consume
                                    SQL's extra power anyway. SQL becomes an optional desktop speed
                                    compile-target.
IF bulk is a desktop power tool in   SQL-only wins. Ship SQL against the materializer now, zero
v1 (phone deferred):                 engine to own, best model fluency, and revisit phone when a
                                     WASM SQLite or daemon round-trip is worth building.

>> My flag: predicate-canonical. Your own mandate says this "gates whether it runs on my phone at
   all" and requires a non-technical phone story (S7), and Model 1 already runs on phone, so bulk
   feeling desktop-only would be a visible regression from the surface beside it. But this is
   genuinely your product call, because it trades a little model SQL fluency for portability, and
   only you know if phone bulk is a v1 promise.
```

### C-2 (tunes Q4): What is the bulk auto-apply row threshold?

```txt
Small number (propose 10):   conservative; almost everything additive-and-reversible above a handful
                             gets a glance. My recommendation, because the undo toast already covers
                             the genuinely tiny case and review is cheap.
Larger (e.g. 50) or          more friction-free, more chance a user waves through a change bigger than
make it per-action tunable:  they pictured.

>> My flag: ship 10, hard-coded, and only make it tunable if real use shows it nags. This is a number,
   not an architecture, so it is the cheapest thing in the doc to change later.
```

### C-3 (naming): Does "bulk mode" deserve a user-facing name at all?

```txt
Name it ("Bulk", a distinct      discoverable; users learn they can ask for sweeping changes.
  card style):
Do not name it; it is just       less surface, less to explain; the agent simply does a bulk thing
  "the agent did a thing,         and shows the aggregate card when N is large.
  here is the review":

>> My flag: do NOT brand it as a model or mode to users. Internally it is one action plus a preview;
   to the user it is just the agent, which sometimes shows a per-call approval and sometimes an
   aggregate effect card. Branding a third "model" is the exact taxonomy this review is cutting. Minor
   relative to C-1, but it is the user-facing echo of the same decision.
```
