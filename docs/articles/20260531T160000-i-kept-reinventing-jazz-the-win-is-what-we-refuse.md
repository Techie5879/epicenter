# Convergent Evolution with Jazz, and What Focus Let Us Refuse

While I was building Epicenter, a lot of the things I built independently ended up resembling Jazz. It was convergent evolution, down to the syntax. Typed tables, query subscriptions, materialization, the same instincts arrived at from the other side of the room. That made me reconcile a lot about what the long-term vision actually is, because Jazz does plenty of things better than Epicenter does. So the question I kept coming back to is the asymmetric one: what does the Epicenter vision let us refuse, so we avoid that complexity altogether?

The answer is one sentence. A workspace is a fully local replica that materializes to a folder you own. We do not need partial syncing, or snapshotting, or row-level anything, because we are hyper-focused on personal apps. That single constraint shrinks the scope enough that we get to build on Yjs and open standards instead of rolling our own sync engine.

## Convergent evolution is real, down to the schema DSL

Jazz v2 presents itself as a local-first relational database: tables, columns, relations, queries, mutations. I never read its source while building Epicenter, and I still landed on the same shape.

```ts
// Epicenter: defineTable with a typed schema, versioned for migrate-on-read
const Note = defineTable({
  title: Type.String(),
  body: Type.String(),
});

// Jazz v2: tables in schema.ts, columns via the s DSL, relations via include()
const Note = s.table({
  title: s.string(),
  body: s.string(),
});
```

Both give you typed rows, reactive subscriptions, local writes that show up instantly, and a sync story underneath. When two people reach the same API from different premises, the API is probably right. The interesting part is not where we agree. It is the handful of places where Jazz solves a problem I decided Epicenter should never have.

## Jazz solved the harder problem. Our scope means we get to skip it.

I want to be clear that Jazz is the more ambitious system here, and it is well thought out. It is genuinely ahead on a cluster of features, and the more I looked at each one, the more I saw a hard problem solved carefully rather than a feature bolted on. Every one of them serves a use case Epicenter is narrow enough to never reach.

| What Jazz does | The hard problem it solves | Why our scope never raises it |
|---|---|---|
| Partial replication | Thin clients holding a slice of a dataset too big to hold whole | The folder is the unit of scale, so you hold the whole workspace |
| Row-level permissions | Many users sharing rows inside one database | The workspace is the unit of sharing, so you share a folder, not a row |
| Bidirectional schema migrations | Many clients on many schema versions hitting shared state at once | One owner, devices that update together, so forward migrate-on-read is enough |
| First-class chunked file tables | A general database needs a blob story for every app | Personal scale lets attachments stay simple |

This is the right engineering for a multi-user, multi-tenant, arbitrary-scale database. Jazz is building that, and building it well. Epicenter is building something smaller on purpose, and most of what looks like a missing feature is really a problem we arranged never to have.

## The refusals fall out of one sentence

Here is the spine again, and watch how each Jazz feature turns into a refusal the moment you take it seriously:

```txt
A workspace is a FULL local replica that materializes to a folder you own.
The folder is the unit of sharing, the unit of scale, and the unit of durability.

  unit of sharing   -> share a workspace, not a row   -> refuse row permissions
  unit of scale     -> you hold the whole workspace   -> refuse partial sync
  unit of durability -> latest replica re-materializes -> refuse snapshots/branches
```

These are not three decisions. They are one decision made three times. Epicenter's granularity is the workspace and the folder. Jazz's granularity is the row. That single difference of scope is the whole differentiation, and I get it by refusing, not by building.

Refusing partial replication is the one that pays for everything else. The folder promise already requires a full local replica: something has to hold the whole workspace to write the whole folder. Once you accept that, partial sync stops being a missing feature and becomes a contradiction. "You own all of your data, locally" and "the client only holds the rows its query matched" are opposite promises. You cannot sell both, so I sell the first one and delete the entire machinery behind the second.

## Refusing partial sync is what lets us stand on Yjs

This is the part I did not see until the convergent-evolution moment forced it. A single Yjs document is a whole-document unit by nature. The protocol ships the whole state; you cannot ask it for fifty matching rows. If Epicenter wanted partial replication, it would have to abandon that model and build a custom relational sync engine with its own query-scoped protocol. That is exactly the multi-year thing Jazz built.

```txt
Want partial sync?  -> roll your own relational sync protocol  (Jazz's road)
Refuse partial sync? -> a workspace is one full replica
                     -> Yjs is already a full-replica CRDT
                     -> stand on Yjs, y-protocols, IndexedDB, OPFS, SQLite
                     -> open standards instead of a private engine
```

The scaling worry that usually justifies partial sync, "what if a workspace is too big for a browser tab," has a cheaper answer in our world: the daemon already holds the full replica and already materializes it to SQLite. A thin client does not sync rows. It queries the materialized SQLite. The thing I built for human-readable files turns out to be the scaling surface too, and I only see that because I refused the other path.

## The honest edge of the refusal

The one place this breaks is a single workspace too large to fit on one disk. For personal apps that effectively never happens, and the folder promise already assumes your data fits on your machine. So I am comfortable drawing the line exactly there. If Epicenter ever chases a use case where one workspace outgrows one disk, partial sync comes back as a deliberate scope expansion, not a feature I bolt on now to feel competitive.

Jazz and I will keep looking similar from across the room. The schemas rhyme, the subscriptions rhyme, the local-first instincts rhyme. The vision lives in the part that does not rhyme: Jazz syncs slices of a shared database to everyone, and Epicenter materializes one whole workspace into a folder that belongs to you. If you want to see where that line is drawn in code, the workspace engine and its materializers are all in the open. Fork it, grep the folder, and tell me where the refusal is wrong.
