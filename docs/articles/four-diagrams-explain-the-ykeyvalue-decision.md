# Four Diagrams Explain the YKeyValue Decision

The useful thing here is not just the ASCII art. It is that each diagram answers a different question about the same decision. The journey diagram explains how we got here. The layer diagram explains what owns what. The flow diagram explains why timestamps matter. The comparison table explains when to use each primitive.

Start with the journey. This is the shape to use when a decision only makes sense after you have seen the previous two attempts.

```txt
┌─────────────────────────────────────────────────────────────────┐
│  First attempt: Direct Y.Map                                     │
│  Problem: 524,985 bytes storage overhead                         │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Second attempt: YKeyValue wrapper                               │
│  Result: 271 bytes (1935x improvement!)                          │
│  Problem: Unpredictable conflict resolution                      │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Current: YKeyValue with LWW timestamps                          │
│  Keeps the storage wins, adds predictable "latest wins"          │
└─────────────────────────────────────────────────────────────────┘
```

That diagram is compact because it keeps the emotional shape of the work: first we chose the native thing, then we found the storage cliff, then we fixed storage and found the conflict problem, then we kept the storage shape and added timestamp ordering.

The same story gets harder to understand if you only describe the final API. A reader sees `YKeyValueLww` and asks why it exists at all. The journey diagram answers: it exists because direct `Y.Map` stored too much history for repeated row updates, and plain `YKeyValue` did not give the conflict semantics we wanted.

The layer diagram answers a different question. It does not explain the historical path. It explains ownership.

```txt
┌─────────────────────────────────────────────────────────────────┐
│  createDisposableCache((id) => { ... }).open(id)                 │  ← High-level
│    User-owned Y.Doc builder, composes attach* primitives         │
├─────────────────────────────────────────────────────────────────┤
│  attachTables(ydoc, {...}) / attachKv(ydoc, {...})               │  ← Mid-level
│    Binds to an existing Y.Doc                                    │
├─────────────────────────────────────────────────────────────────┤
│  defineTable() / defineKv()                                      │  ← Low-level
│    Pure schema definitions                                       │
└─────────────────────────────────────────────────────────────────┘
```

This is the diagram to reach for when people are mixing levels. `defineTable()` should not know how to open a user workspace. `attachTables()` should not own the lifecycle of the whole document. `createDisposableCache()` can own the document lifecycle because that is the layer where repeated opens, teardown, and cache reuse become real.

In words:

```txt
defineTable() / defineKv()
  -> describe the shape

attachTables(ydoc, ...) / attachKv(ydoc, ...)
  -> bind that shape to an existing Y.Doc

createDisposableCache(...).open(id)
  -> owns the user-level document lifecycle
```

The flow diagram is about movement. Two clients write while disconnected, sync later, and the storage primitive has to decide which value readers see.

```txt
┌────────────────────────────────────────────────────────────────┐
│  Client A (2:00pm)  ──┐                                        │
│                       │──→  Sync  ──→  Winner: Client B        │
│  Client B (3:00pm)  ──┘                                        │
│                                                                │
│  With timestamps: Latest always wins                           │
│  Without: Whoever syncs first wins (unpredictable)             │
└────────────────────────────────────────────────────────────────┘
```

One detail matters here: "whoever syncs first" is useful shorthand, but the precise Yjs behavior is not literally sync order. Without our timestamp field, the winner comes from Yjs's deterministic internal ordering, including client IDs. That is still unpredictable from the user's perspective. The user cares that the 3:00pm edit should beat the 2:00pm edit; `YKeyValueLww` makes that rule explicit.

The comparison table is the final compression. Use it when the reader already understands the mechanism and needs to choose.

```txt
┌────────────────────────────────────┬────────────────────────────┐
│  Use Case                          │  Recommendation            │
├────────────────────────────────────┼────────────────────────────┤
│  Real-time collab, simple cases    │  YKeyValue (positional)    │
│  Offline-first, multi-device       │  YKeyValueLww (timestamp)  │
│  Clock sync unreliable             │  YKeyValue (no clock dep)  │
└────────────────────────────────────┴────────────────────────────┘
```

This table is not the whole argument. It is the thing you can keep in your head after the argument has already been made.

The four diagrams are useful because they do not compete with each other:

```txt
Journey:
  How did the decision change?

Layer:
  Which abstraction owns which responsibility?

Flow:
  What moves, merges, or wins?

Comparison:
  Which option should I pick?
```

For YKeyValue specifically, the durable rule is simple: use `YKeyValueLww` when repeated writes and offline-first expectations matter, as long as Yjs garbage collection stays on. If you need `gc: false` for revision history, the storage story changes and `Y.Map` can win again.
