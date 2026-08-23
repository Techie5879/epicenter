# Temporal Is a Value Type, Not a Storage Format

Temporal is the right answer for date math. It's the wrong answer for what sits in your SQLite column. Epicenter stores `DateTimeString` as a branded RFC 3339 string, with a separate zone field when the originating IANA zone matters. It only constructs a `Temporal.ZonedDateTime` when something actually needs to compute with it. Two layers, two jobs.

## The two questions are not the same

When you reach for "how do I represent a date," there are really two questions hiding:

1. **At rest**: what bytes sit in storage and travel over the wire?
2. **In hand**: what object do I call methods on to add a month, compare instants, or render in the user's locale?

`Date` answers both questions badly. Temporal answers question 2 beautifully, but if you let it answer question 1 you pay a tax on every read, every sort, and every JSON boundary.

## What Temporal is great at (the value-type job)

`Temporal.ZonedDateTime` is what `Date` should have been:

```ts
const zdt = Temporal.ZonedDateTime.from('2024-01-01T15:00:00-05:00[America/New_York]')

zdt.add({ months: 1, days: 3 })            // calendar-correct, not "30 days"
zdt.add({ hours: 2 })                      // DST-aware
zdt.until(other, { largestUnit: 'days' })  // returns a Duration, not a number
zdt.hour                                   // 15, in NY, regardless of where you run this
```

Five things `Date` cannot do:

1. **Calendar arithmetic.** `Date + 1 month` is "+30 days," wrong at month boundaries. Temporal knows months are not 30 days.
2. **Zone as data.** `Date` has no zone; you reach for `toLocaleString({ timeZone })` at render time and pray. `ZonedDateTime` carries the IANA zone *as part of the value*.
3. **Distinct types for distinct concepts.** `Instant`, `ZonedDateTime`, `PlainDateTime`, `PlainDate`, `PlainTime`, `Duration`. You cannot accidentally compare a birthday to a server timestamp.
4. **Immutability.** `Date.setHours()` mutates. Temporal returns new values. Comparison is explicit (`Temporal.ZonedDateTime.compare(a, b)`), not accidental coercion through `valueOf()`.
5. **Nanoseconds and non-Gregorian calendars.** First-class.

So when you actually need to do anything *with* a date, Temporal is the obvious choice. That's the value-type job.

## What Temporal is bad at (the storage job)

Now let it sit in a SQLite column. Three problems show up immediately.

### 1. Lex sort breaks across zones

SQLite sorts TEXT lexicographically. The canonical `Temporal.ZonedDateTime` string is:

```
2024-01-01T15:00:00-05:00[America/New_York]
└─ local wall clock ─┘└offset┘└── IANA ──┘
```

The leading bytes are *local time*. Two rows from different zones sort by local wall clock, not by the actual instant. `ORDER BY createdAt` is silently wrong.

`DateTimeString` stores the instant in RFC 3339 form:

```
2024-01-01T20:00:00.000Z
└──── UTC instant ─────┘
```

When zone semantics matter, store the IANA zone in a sidecar field such as `createdAtZone`. UTC instant remains the sortable prefix, so lex order equals chronological order, for free, across every zone.

### 2. Per-row `fromDriver` overhead

If your column type is "Temporal," every row read invokes a `fromDriver` hook to parse text into a `Temporal.ZonedDateTime`. On a 10k-row query that's 10k synchronous parses, possibly through a polyfill, before you've done any work. The cost lands on every read whether or not you needed date math.

`DateTimeString` is a branded plain string. The driver hands you the bytes; you build a Temporal value *only* at the call site that needs `.add({ months: 1 })`. The "last responsible moment" pattern.

```ts
// Read path: zero conversion
const rows = tables.notes.getAll()         // each createdAt is a DateTimeString

// Math path: convert exactly once, where the math happens
const due = Temporal.Instant
  .from(row.createdAt)
  .toZonedDateTimeISO(row.createdAtZone)
  .add({ days: 7 })
```

### 3. Wire and portability friction

`DateTimeString` is already a JSON string. It serializes for free, parses with stock date-time tooling, and survives logs, BI tools, and other services without a Temporal polyfill.

The bracketed-IANA suffix that Temporal uses (`...[America/New_York]`) is a Temporal-era extension. Lots of parsers reject it. You either ship a polyfill everywhere or you stringify on every wire boundary.

## The split: text in storage, Temporal in hand

```
┌──────────────┐   read    ┌──────────────────────┐   construct ┌──────────────────────┐
│   SQLite     │ ────────▶ │ DateTimeString + zone│ ──────────▶ │ Temporal.ZonedDateTime│
│ TEXT columns │           │ (branded strings)    │             │  (only when needed)   │
└──────────────┘           └──────────────────────┘             └──────────────────────┘
        ▲                              │                                  │
        │                              │ stringify back when storing      │
        └──────────────────────────────┴──────────────────────────────────┘
```

In code:

```ts
// Storage: DateTimeString round-trips with zero conversion
type DateTimeString = string & Brand<'DateTimeString'>
type TimezoneId = string & Brand<'TimezoneId'>

// Companion object: validate and create storage values
const DateTimeString = {
  now(): DateTimeString,
  is(v: unknown): v is DateTimeString,
}

// Schema: field.datetime() stores the instant; the zone rides beside it
const notes = defineTable({
  id: field.string(),
  createdAt: field.datetime(),         // DateTimeString
  createdAtZone: field.string(),       // TimezoneId
})

// Read: no conversion
const note = tables.notes.get(id)
note.createdAt                         // DateTimeString, branded

// Math: convert at the point of use
const dueAt = Temporal.Instant
  .from(note.createdAt)
  .toZonedDateTimeISO(note.createdAtZone)
  .add({ days: 7 })

// Write back: stringify back to storage shape
tables.notes.update(id, {
  remindAt: dueAt.toInstant().toString() as DateTimeString,
  remindAtZone: dueAt.timeZoneId as TimezoneId,
})
```

The storage format never changes. The math format never touches storage. Each layer does the one thing it's good at.

## Why not just use `Temporal.Instant`?

`Temporal.Instant` would actually sort fine: its serialization is `2024-01-01T20:00:00Z`, which is lex-sortable. The problem is it has no zone. "Created at 9am in Tokyo" loses the Tokyo. DST transitions, "remind me at 9am wherever you are next week," and locale rendering all need the origination zone preserved.

`DateTimeString` keeps the instant sortable and compact. The sidecar zone keeps the IANA semantics. `Instant` by itself only keeps the first half.

`PlainDateTime` is for wall-clock values with no zone (birthdays, "9am alarm"). Use it when there is genuinely no zone, not as a `createdAt`.

## The general principle

This is a specific instance of a more general pattern: **the type you compute with is rarely the type you store.**

- Encryption: store ciphertext bytes, decrypt to a plaintext value object only when you need to read.
- Markdown: store the source string, parse to an AST only when rendering.
- Money: store integer cents, construct a `Money` object at the boundary that does math.
- Dates: store `DateTimeString` plus a zone when needed, construct `Temporal.ZonedDateTime` at the boundary that does math.

The mistake is letting the value-type API leak into your storage layer because it has nice methods. Nice methods are for working with values, not for sitting in a column. Keep the storage representation cheap, sortable, and JSON-native; pay the construction cost only where the methods actually get called.

## References

- `packages/field/src/datetime-string.ts` (`DateTimeString` type and companion functions)
- `docs/articles/datetime-string-intermediate-representation.md` (the original migration from `DateWithTimezone`)
- `docs/articles/iso-8601-is-lossy-without-a-timezone.md` (why ISO alone isn't enough)
- `packages/workspace/specs/20260429T000000-column-dsl-and-define-table.md` (historical column DSL spec; current schemas use `field.datetime()`)
