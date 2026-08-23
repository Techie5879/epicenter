# Move the Boundary Down One Layer

When callback hooks start showing up in an abstraction, slow down and check the layer boundary.

Hooks are not always wrong. Some hooks are real lifecycle points. But hooks that ask one layer to make a decision so another layer can keep driving the effect often mean the boundary is wrong.

The smell looks like this:

```typescript
createSyncRelay({
  resolveAccess,
  onRoomAccess,
  onStorageBytesChanged,
  onDisconnect,
});
```

The relay wants to stay generic, so it asks the host for decisions through callbacks. But the host still owns the real decisions: who may connect, who pays, what gets deleted, what gets logged. The hooks are a sign that the abstraction may be sitting one layer too high.

The cleaner version is usually one layer lower:

```typescript
const access = await requireRoomAccess(request);

const result = await sync.handleHttpSync(request, {
  roomName: access.roomName,
});

await recordUsage({
  roomName: access.roomName,
  storageBytes: result.storageBytes,
});

return result.response;
```

The hook disappeared because the host route became the composer.

## Hooks Appear When Decisions And Effects Split Apart

The callback version has two owners for one workflow:

```txt
host:
  decides access
  owns billing
  owns route errors

relay:
  accepts sockets
  persists bytes
  counts storage
```

Now the relay needs hooks to tell the host what happened. The more complete the workflow gets, the more hooks appear.

```typescript
createSyncRelay({
  resolveAccess,
  onRoomAccess,
  onStorageBytesChanged,
  onCapabilityRejected,
  onRoomDeleted,
  onClientDisconnected,
  onCompactionFinished,
});
```

At that point the generic abstraction is not generic anymore. It is a workflow with decision points removed and callbacks stapled on.

## The Lower Boundary Is Often Smaller

Move the reusable part down until it owns only the mechanism.

```typescript
const sync = createSyncEngine(rooms);
```

The engine does not know users, sessions, plans, invoices, or access-control rows. It receives an already-authorized room name and performs the mechanical sync work.

```typescript
const result = await sync.handleHttpSync(request, {
  roomName,
});
```

Everything around that call belongs to the host.

```typescript
app.post('/rooms/:room', async (c) => {
  const user = await requireUser(c);
  await requirePlanAllowsSync(user);

  const roomName = `owners/${user.id}/rooms/${c.req.param('room')}`;
  const result = await sync.handleHttpSync(c.req.raw, { roomName });

  await recordUsage({
    userId: user.id,
    roomName,
    storageBytes: result.storageBytes,
  });

  return result.response;
});
```

The host route is not a callback. It is the workflow.

## A Concrete Rule

The reusable layer should own the thing it can do without asking the caller to make workflow decisions in the middle of its own control flow.

For a sync engine, that might be:

```txt
read request bytes
reject oversized payloads
call the selected room
turn room bytes into an HTTP response
return mechanical observations like storageBytes
```

The host owns the questions that choose the workflow:

```txt
who is this user?
which room are they allowed to open?
what namespace should this room live under?
does their plan allow this?
what should we audit or bill?
what route error should the caller see?
```

That distinction is what keeps the smaller abstraction honest. The lower layer can be reused because it does not pretend to understand decisions its caller already owns.

## The Test Is Simple

Ask what happens when you delete the hooks.

```txt
Can the caller just do the work before or after calling the reusable function?

Yes:
  the hook probably belongs outside

No:
  the reusable layer may truly own the lifecycle point
```

Some hooks are real. A database transaction hook, a lifecycle event from a framework, or a low-level protocol callback may be the right shape because the lower layer genuinely owns the timing.

But decision hooks are suspicious. If the hook asks the caller to decide access, billing, audit, deletion, org membership, retry behavior, route errors, or what should happen next, the caller may own the workflow and should compose the lower-level primitive directly.

## Compose Up, Do Not Callback Sideways

The direction matters.

```txt
Callback sideways:
  generic relay -> host hook -> generic relay continues

Compose upward:
  host route -> sync engine -> host records result
```

The second version is less magical. The route reads in order. The caller owns the decisions. The reusable code owns mechanics. Nobody has to guess which callback fires when.

That is the design rule I want to keep:

```txt
If hooks are multiplying, move the boundary down one layer.
```
