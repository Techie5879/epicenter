# Liveness Belongs to the Process, Not the Row

A discriminated union with three variants can still have one variant too many. If one of your states means "this is happening right now," it does not belong in durable storage. The process doing the work already knows it is alive. The moment that process dies, the stored claim becomes a lie that no reader can detect.

Here is a transformation-run result, stored as a row in a Yjs table:

```ts
// Before: three variants, one of them a liveness claim
type Result =
  | { status: 'running' }
  | { status: 'completed'; completedAt: string; output: string }
  | { status: 'failed';    completedAt: string; error: string };
```

```ts
// After: store only the facts; absence means "did not finish"
type Result =
  | { status: 'completed'; completedAt: string; output: string }
  | { status: 'failed';    completedAt: string; error: string };
// `result` is now optional on the row. Liveness is derived, not stored.
```

The two terminal variants are facts. This run finished at this time with this output. This run failed with this error. Facts are what storage is for: write once, read forever. `running` is not a fact. It is a claim about the present, asserted by whatever process is currently executing the run.

## Terminal states are facts; "running" is a claim about right now

The tell is what happens on crash. Quit the app mid-run and the writer never comes back to set the terminal state. The row still says `running`. It will say `running` tomorrow, next week, and the next time you open the app, because nothing is left alive to correct it.

```txt
write { status: 'running' }   <- process A, at kickoff
... process A crashes ...
                              <- the row is now permanently wrong
                              <- and no reader can tell a live run from a dead one
```

Now you reach for the fix that every "status got stuck" bug reaches for: a repair pass on startup that scans for stale `running` rows and resets them. That repair pass is the smell. You are writing code to undo a write you should never have made.

## Absence is the honest third state

Drop the variant and the wedge becomes unrepresentable. A row that never reached a terminal state simply has no `result`, and absence reads honestly in every situation:

```txt
result present                  -> terminal. Render completed or failed.
no result + process is alive    -> running. Show the spinner.
no result + no live process     -> did not finish. Offer retry.
```

The version with a stored `running` could not express that bottom row at all. "Completed" and "crashed mid-run" were durably indistinguishable, so the UI showed a spinner forever and called it running. With absence, a crash leaves a row with a start time and no outcome, which the UI reads as interrupted, with zero repair code anywhere.

## Two write paths can't disagree about a field neither one writes

Crash-wedging is the loud symptom. The quiet one shows up the moment more than one code path can start the work. Whispering stored a recording's transcription state in a single select that did two jobs at once: the durable outcome and the live progress.

```ts
// Before: one column, two concerns (outcome + liveness), four flat states
transcriptionStatus: 'UNPROCESSED' | 'TRANSCRIBING' | 'DONE' | 'FAILED'
```

Three paths could transcribe a recording, and they did not agree on the progress half. The record-and-transcribe pipeline went straight from `UNPROCESSED` to `DONE` and never wrote `TRANSCRIBING`. Bulk transcription wrote nothing per row. Only the manual retry button set it. So the field already lied before any crash: a recording could be transcribing with its column still reading `UNPROCESSED`. And `FAILED` carried no reason; the error went to a toast and vanished.

Splitting the two concerns by owner fixes both at once:

```ts
// After: the outcome is stored; liveness is not a column at all
transcript: string                          // the output, in its own column
transcription:
  | { status: 'completed'; completedAt: string }
  | { status: 'failed';    completedAt: string; error: string }
  | null                                     // not yet, or interrupted
```

`failed` keeps its error now. Absence covers both "never transcribed" and "interrupted," which is exactly right because they share one affordance: a transcribe button. And nothing can disagree about whether a recording is transcribing, because no path writes that down anymore. There is one source, and it is the in-flight transcription request.

## The live process owns liveness; its shape depends on who is asking

In both cases the thing that holds "is this happening right now" is the process doing the work, never the row. What you read it from depends on whether the reader is that same process.

When the reader is the writer, read it straight off the in-flight operation. Whispering runs transcription as a mutation, so a recording is transcribing exactly while its mutation is pending. No stored field, no extra state, and it cannot wedge, because a dead process has no pending mutation.

```ts
const status = mutation.isPending
  ? 'transcribing'
  : recording.transcription?.status ?? 'unprocessed';
```

When the reader is a different process (a second tab, another device), it cannot see your in-flight operation, so it needs a signal in shared state. The cheapest honest one is recency over a timestamp the row already carries. A transformation run stores `startedAt` at kickoff, so any reader treats a run with no result as live while `startedAt` is recent and interrupted once it is stale.

```ts
const isLive = (run) =>
  !run.result && Date.now() - Date.parse(run.startedAt) < GRACE_MS;
```

That is a heartbeat collapsed to a single tick, and it works because a transformation is short and bounded. For work that runs long enough that one timestamp cannot bound it, advance the timestamp as you go and read its age instead. The shape changes with the distance to the reader; the move does not. Store a fact (last alive at T), derive the claim (alive while T is recent), and let the claim decay on its own instead of writing code to retract it.

A `running` boolean has no honest reading once the writer dies; it stays true forever. A timestamp has one: it stops advancing, its age crosses the window, and every reader independently concludes the work went quiet.

The rule under all of it: a value that is only true while a specific process is alive does not belong in storage that outlives the process. Keep the terminal facts in the row. Keep liveness where it actually lives.
