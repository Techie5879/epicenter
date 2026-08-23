# Honest Tests

## When to Read This

Read before auditing a test file you suspect is padded, before reviewing
green tests that "feel" hollow, or whenever you add a fake/mock/stub.

If the job is to delete low-value tests across a file or package, read
[test-deletion-grill.md](test-deletion-grill.md) first. It defines the
deletion taxonomy, commit discipline, and final report shape.

The pattern: a green test is not proof of value. A test only earns its
line count if it can fail for a real reason, and a fake only earns its
line count if some assertion path actually drives it.

## The Two Questions

Ask both of these for every `test(...)` block. If either answer is "no"
or "nothing real," trim or rewrite.

```
1. What would have to break in production for this test to fail?
2. Can that thing actually break given how this test constructs the world?
```

Question 2 catches the most failures. Many tests assert behavior that
the test's own setup makes structurally impossible to reach.

## Smells

### 1. The hedged assertion that excludes the failure mode

```typescript
// SMELL: alternatives are pre-excluded by the setup
test('initial status is offline or connecting', () => {
  const { collaboration } = setup();           // supervisor parks in CONNECTING sync
  expect(['offline', 'connecting']).toContain(collaboration.status.phase);
});
```

Inside `setup()`, the supervisor reaches `connecting` synchronously
before the call returns. `connected` and `failed` require a handshake
that the fake never delivers. The remaining options are both green. The
test cannot fail. Delete it or rewrite it to pin one specific phase
with a specific cause.

### 2. The pass-through getter

```typescript
// SMELL: asserting that an object literal assigns its own property
test('exposes the supplied installationId', () => {
  const { collaboration } = setup({ installationId: 'self' });
  expect(collaboration.installationId).toBe('self');
});
```

`openCollaboration` does `installationId: config.installationId`. This
tests that property assignment works. Keep only if the field is part of
a documented contract callers depend on, and even then prefer folding
the check into a richer test that exercises real behavior.

### 3. The fake that stalls past the interesting part

```typescript
function stalledOpenWebSocket(): Promise<WebSocket> {
  const ws = {
    readyState: 0,
    // ... 27 lines of listeners, send, binaryType, addEventListener, etc.
  };
  return Promise.resolve(ws);  // returns a socket that never opens
}
```

A fake that parks in CONNECTING avoids ever simulating `onopen`,
`onmessage`, frame routing, or disconnect. The shape of the fake is the
tell: **whatever the fake refuses to simulate is the behavior the file
isn't testing.** In this case the file shipped under the name
"openCollaboration tests" while testing none of: presence routing,
dispatch result routing, URL query wrapping, or disconnect settling.

### 4. Dead fake surface

If a fake declares `addEventListener`, `removeEventListener`, `send`,
`onmessage`, `onerror`, `binaryType` and so on, every one of those
properties should be hit by some assertion path. Walk the production
code and confirm. Unused fake surface is scaffolding that lies about
what's covered.

```typescript
// Minimal honest fake for the parked-supervisor case
function fakeWebSocket(): Promise<WebSocket> {
  const ws = {
    readyState: 0,
    onclose: null as ((e: CloseEvent) => void) | null,
    close() {
      if (ws.readyState === 3) return;
      ws.readyState = 3;
      ws.onclose?.({ code: 1000, reason: '' } as CloseEvent);
    },
  };
  return Promise.resolve(ws as unknown as WebSocket);
}
```

Three properties, all reached. If the supervisor later starts using a
fourth, the absent property is a real signal worth investigating, not
noise lost in 27 lines of decoration.

### 5. Docstring contradicting the code

If the file's leading JSDoc says one thing and the body does another,
the doc is worse than missing: it lies to the next reader.

```typescript
// BAD: docstring claim, refuted by the fake's body
/**
 * No real WebSocket: `openWebSocket` returns a never-resolving promise...
 */
function stalledOpenWebSocket(): Promise<WebSocket> {
  // ...
  return Promise.resolve(ws);  // <- promise resolves immediately
}
```

The *socket* stalls in CONNECTING; the *promise* resolves. Fix the doc
to describe what the file actually exercises, and name what it
deliberately doesn't.

### 6. One-line wrappers asserted in isolation

```typescript
// BORDERLINE: dispose() is literally ydoc.destroy()
test('dispose destroys the underlying ydoc', () => {
  const { ydoc, collaboration } = setup();
  let destroyed = 0;
  ydoc.once('destroy', () => destroyed++);
  collaboration[Symbol.dispose]();
  expect(destroyed).toBe(1);
});
```

Keep only when the wrapper is documented contract (here:
`[Symbol.dispose]() === ydoc.destroy()`) that consumers rely on. If
the wrapper is implementation detail subject to change, skip the test.

## The Audit Pass

For each `*.test.ts` you touch, walk this four-step check before
adding new tests or signing off on existing ones.

```
[1] List every test() block in the file.

[2] For each block, answer in writing:
    - What production change would make this fail?
    - Does the setup make that change reachable?
    - If both "real" and "yes" -> keep.
    - If "trivial" or "no"     -> trim, fold, or delete.

[3] For every fake/mock declared in the file, list its properties.
    - Walk the production code paths the tests reach.
    - Cross out each property that gets touched.
    - Anything left uncrossed is dead scaffolding -> delete.

[4] Re-read the file docstring against the trimmed body.
    - Every claim must match the code.
    - Name what is deliberately out of scope so the next reader
      doesn't mistake silence for coverage.
```

## What Honest Looks Like

The trimmed `open-collaboration.test.ts`: four tests, 10-line fake.
One test (action-key validation) drives real branching logic. Three
tests pin documented contract pass-throughs. The fake's three
properties are all reached on the teardown path. The docstring names
both what's in scope and what isn't.

A file that passes the audit is shorter, names what it doesn't test,
and would fail loudly if any of its assertions stopped reflecting the
code. That's the bar.
