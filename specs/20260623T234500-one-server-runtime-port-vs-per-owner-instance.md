# One server, a runtime port, two honest capabilities (room + blob)

- **Status:** Draft
- **Date:** 2026-06-23
- **Branch:** wash-saddle
- **Relates / re-scopes:** `specs/20260522T220000-api-runtime-portability.md` (the
  detailed Node/Bun room-backend plan, now partly shipped and partly stale) and
  `specs/20260528T130000-runtime-port-and-public-origin.md` (the agreed `Runtime`
  shape; public-origin slice shipped). This spec is the design verdict that
  reconciles both with today's reality and rejects one tempting unification.

## One sentence

```
A capability is pure logic over an injected Runtime port; the cloud binds the
port to per-room Durable Objects + R2, a single Node binary binds the same port
to local SQLite + an in-process room map + any S3, and room and blob share the
PORT, never a SHAPE.
```

## The question this answers

We just made `blob` runtime-portable (a pure aws4fetch S3 client, no R2 binding:
`packages/server/src/s3-blob-store.ts`). The `room` system is shaped for the same
move but unfinished (`room/contracts.ts` + `room/core.ts` are runtime-agnostic;
only `room/backends/cloudflare/` exists). Both have a "Cloudflare adapter" and a
portability goal.

The radical hypothesis on the table (from the `composable-apps` direction): stop
writing per-capability adapters and go one level up to a per-OWNER **instance**, a
single Hono app + SQLite that idle-hibernates and hosts in a DO **or** a Node box
**or** a Tauri shell. The DO would stop being a per-room shard and become a
per-owner host: room relay = an in-memory `Map`, blobs = local store, auth =
local, and the same binary is the self-host. One implementation, two hosts,
instead of N capability adapters.

This spec grills that hypothesis and delivers the ideal shape, the honest ledger,
and the verdict.

## Verdict (up front)

1. **The runtime port is the giant win, and it is ~70% built, not hypothetical.**
   The room logic is already behind three Epicenter-owned contracts; the blob is
   already a pure S3 client. The remaining gap is one capability (the Node room
   backend) plus a thin Node host. This is the real collapse: *one library, two
   runtimes*, which turns "two Cloudflare Workers" into "the same code, no
   Cloudflare account required for self-host."

2. **The "per-owner instance" is a FALSE unification for this layer.** It is a
   deployment topology, not a shared abstraction, and it is the topology for a
   *different* product (hosting arbitrary per-owner code), not for the room+blob
   capability layer. Forcing room and blob into one owner-scoped object/instance
   re-adds the exact actor/DB/queue plumbing the blob spec just deleted, and
   regresses the cloud's per-room hibernation granularity for no abstraction win.
   Identity and billing are inherently a shared global plane and refuse to live in
   a per-owner instance at all.

3. **Room and blob are honestly asymmetric and must stay two capabilities.** A
   room is a stateful, single-writer, live CRDT actor with sockets and presence; a
   blob is immutable, content-addressed, owner-less bytes. They share the Runtime
   port (each is pure logic with its runtime primitive injected). They do not share
   a lifecycle, a storage engine, or a deployment unit. Do not merge them.

4. **The DO does not disappear; it becomes one binding of the port.** Its
   single-writer-per-room guarantee and hibernate-to-zero economics are exactly
   what the cloud needs at multi-tenant scale and exactly what a single self-host
   process gets for free. Same code, different binding.

**Cheapest-first sequence (and what is done):** collapse with Road 1 wherever a
standard exists, Road 2 only for the actor that has no standard.

1. **Drop `SESSION_KV` (Road 1 by deletion). DONE this pass.** Highest ratio:
   deletes a divergent path *and* a footgun, makes auth construction identical on
   both runtimes. (Caveat handled: rate limiting was silently flipping to
   per-isolate memory; made explicit, acceptable because email/password is off.)
2. **Finish assets -> blobs, including the `create-auth.ts` user-delete site.**
   That is the move that removes the last R2 binding from the auth path. Larger:
   it is the blob spec's slice 6 (port consumers, delete the route/table/bucket).
3. **Lift the pg lifecycle into an injected `db` handle (per concern), carrying
   `waitUntil`/`afterResponse` with it.** After this the only Workers-only binding
   the library reads is `ROOM`. Cheap and no-behavior-change, but it moves `pg`
   into the deployables and has no functional payoff until a Node host exists, so
   it is deferred to that trigger (see below), not built speculatively now.
4. **Write the Node room backend (Road 2) only when a real Node host exists** — a
   self-hoster who refuses Cloudflare, or the Tauri-local instance becoming a
   priority. The one place that genuinely needs two implementations.

## The ideal shape

### Two roads, decided per subsystem (the corrected framing)

There are exactly two ways to run one codebase on two runtimes, and the blob work
proved which is which:

- **Road 1: collapse to one portable path.** Find an open standard both runtimes
  already speak, depend on it, and there is no second backend to maintain. Blobs
  took this road (SigV4/S3 is spoken by R2 and MinIO/Garage/S3, so one module runs
  on Workers and Node). The binding was the lock-in; the standard was the collapse.
- **Road 2: inject the divergence behind a tiny contract.** When no portable
  primitive exists, define the smallest Epicenter-owned contract and supply one
  backend per runtime, chosen at the `apps/*` edge. Rooms take this road (a
  hibernating stateful actor has no open standard).

Decision rule: **does an open primitive exist that both runtimes can speak?**
Object storage -> yes (S3). SQL -> yes (Postgres wire via `pg`). Crypto/hash ->
yes (Web Crypto). HTTP egress -> yes (`fetch`). A hibernating stateful actor ->
no. Road 1 is strictly cheaper whenever available (one path, not two in lockstep).

### Reject the `Runtime` god-object: inject per concern

An earlier draft of this spec proposed a single `Runtime` object with five
co-equal legs (`db`, `sessionStore`, `assets`, `rooms`, `afterResponse`). That was
wrong twice over. First, it implies five Road-2 backends when most of those legs
collapse to nothing under Road 1 (see the inventory). Second, a `Runtime` bag
re-bundles exactly what the `mount*` / `resolveOrigin` design just spent effort
unbundling, and it violates the honest-asymmetry preference (distinct shapes for
distinct concerns, no umbrella discriminator). So the seam is **per-concern
injection**, matching `resolveOrigin`: the deployment composes the concerns at the
`apps/*` edge; the library never sees a `Runtime`.

### The inventory: every Cloudflare seam in `packages/server`, classified

| Seam | Sites | Road | Verdict |
|---|---|---|---|
| `ASSETS_BUCKET` (R2) | `assets.ts` x4, `create-auth.ts` x1 | 1 | Collapsing into blobs/S3. The auth-cleanup site is the last R2 binding on the auth path. |
| `SESSION_KV` (KV) | `create-auth.ts` x1 | 1, by deletion | **DONE.** Postgres + the JWE cookie cache is one path; the KV cache divergence (and its `storeInDatabase` footgun) is deleted. |
| `HYPERDRIVE` (pg) | `server-app.ts` x1 | 1 + ~15-line seam | `pg`/drizzle are portable; only connection *acquisition* differs (Worker per-request `Client` vs Node module-scope `Pool`). Inject a `db` handle, do not "drop Hyperdrive." |
| `executionCtx.waitUntil` | `server-app.ts` x1 | 2, trivial | ~3 lines; rides with the db seam (Node just awaits the queue). |
| `ROOM` (Durable Object) | `registry.ts`, `durable-object.ts` | 2, real | Cannot collapse. Already behind the `Rooms`/`RoomUpdateLog`/`RoomSocket` contracts; needs the second (Node) backend. |
| `c.env.ASSETS` (static SPA) | `apps/api` only | n/a | Cloud-only, correctly outside the library. |

Every binding except `ROOM` is read at a single site. After Road-1 collapses
`SESSION_KV` (done), assets (the blob migration), and the `db` acquisition seam,
**the only Workers-only binding the library reads is `ROOM`** — already correctly
behind a contract. That is the server collapsed as far as best practice allows.

### The locked db seam (Road 1 + a tiny Road-2 acquisition)

The library depends on an injected per-request db handle, never on the
`HYPERDRIVE` binding shape. `pg` + drizzle stay portable; only acquisition is
injected, the same `resolveOrigin` move:

```ts
// packages/server exports createDb(client) to keep the drizzle schema internal.
// createServerApp gains, alongside resolveOrigin:
connectDb: (env) => Promise<{ db: Db; close: () => Promise<void> }>;
waitUntil: (c, work: Promise<unknown>) => void;
resolveRooms: (env) => Rooms;   // rooms is already injected via c.var.rooms today
// apps/api (Cloudflare): per-request pg.Client over HYPERDRIVE; close = client.end();
//                        waitUntil = c.executionCtx.waitUntil; resolveRooms = DO namespace.
// Node host (later):     shared module-scope pg.Pool; close = no-op;
//                        waitUntil = fire-and-forget; resolveRooms = in-process Map.
```

### Room: the contract already is the seam

`createRoomCore({ updateLog })` owns the Y.Doc, the connection map, presence, and
dispatch, and imports nothing Cloudflare. Three injected things make it portable,
and all three contracts already exist in `room/contracts.ts`:

| Port member | Cloudflare binding (exists) | Node binding (to write) |
|---|---|---|
| `RoomUpdateLog` (sync `loadAll`/`append`/`replaceAll`/`byteSize`/`entryCount`) | `ctx.storage.sql` | `bun:sqlite` / `better-sqlite3`, one file per room |
| `RoomSocket` (`send`/`close`/`readyState`/`serializeAttachment?`) | hibernation `WebSocket` (native) | Bun/Node `ServerWebSocket` (native, no wrapper) |
| `Rooms` (`get(name)`) | `DurableObjectNamespace` + `idFromName` | `Map<string, RoomCore>`, lazy create |

The sync contract is load-bearing and correct: the `updateV2` listener that calls
`append` cannot `await`, so the engine must be synchronous (`ctx.storage.sql`,
`bun:sqlite`, and `better-sqlite3` all are). The hibernation restore step
(`getWebSockets()` re-enumeration) lives only in the Cloudflare adapter because a
single Node process never wipes its in-memory connection set.

### Blob: already one implementation across both runtimes

`s3-blob-store.ts` is the model the room should imitate. It talks plain
S3-over-HTTPS via aws4fetch (SigV4), which uses only `fetch` + `SubtleCrypto`,
both present on Workers and Node 18+. The endpoint is config, so the identical
module runs against R2 (cloud) and MinIO/Garage/S3 (self-host). Bytes never pass
through the server; the route only mints presigned PUT/GET and signs
head/list/delete. There is no DB row, no queue, no event. **The blob is already
done.** It needs no per-runtime backend because S3 is the runtime-neutral
primitive.

### Where assets fits: it is retired, not ported

The old runtime-port plan (`20260522T220000`) designed a filesystem `AssetStore`
contract with R2 and fs backends. **That plan is superseded.** The
content-addressed blob store solves asset portability better: one mechanism, no
Workers-only `R2Bucket` binding, content-addressed integrity, and it already runs
on both runtimes unchanged. `assets` (route + table + `ASSETS_BUCKET`) is being
deleted into `blobs` (blob spec slice 6). So "where assets fits" is: nowhere; it
collapses into the blob substrate. The fs `AssetStore` contract should never be
built.

### The deployment picture

```
ONE library: packages/server (Hono app + RoomCore + blob route + auth)
  bind Runtime → Cloudflare:   apps/api (personal) and apps/self-host (shared)
                               per-room DO + R2 + Hyperdrive + KV
  bind Runtime → Node binary:  ONE process + ONE Postgres + ONE S3 endpoint
                               in-process room Map + bun:sqlite room files
  bind Runtime → Tauri shell:  the same Node binding, embedded, local-only
```

Identity (Better Auth: users, sessions, OAuth clients), billing (Autumn,
hosted-only), the inference gateway, and the DO-instance telemetry table stay a
**shared global plane** behind the same Postgres. They are cross-owner by nature
and are not per-instance state.

## The grilling (the five hard questions)

### 1. What does the DO actually give that a per-owner Node process does not?

Grounded against `cloudflare/cloudflare-docs`:

- **Single-writer per room.** `idFromName(name)` resolves to exactly one global
  instance; a DO runs single-threaded with input/output gates (strict
  serializability). For a Yjs relay this is the killer feature: the in-memory doc
  is authoritative, fan-out is a local map iteration, presence is exact, and a late
  joiner's SyncStep1 is always answered from current state.
- **Hibernate-to-zero economics.** A DO idle and hibernation-eligible is **not
  billed for duration** (400k GB-s/mo included, then $12.50/M GB-s at a fixed
  128 MB) while its WebSockets stay connected at the edge. `setWebSocketAutoResponse`
  answers ping/pong without waking it. This is per-tenant scale-to-zero a Node
  process cannot do: an idle process still holds RAM you pay for.
- **Edge placement.** Created near first access; `locationHint` and `jurisdiction`
  (`eu`, `fedramp`) available. A self-host on one box does not need this.
- **Horizontal shard-by-name.** The platform distributes millions of DOs with no
  orchestrator. A self-host with one process does not need this.

**Which does self-host genuinely NOT need:** edge placement, fleet sharding, and
per-instance hibernation billing are all unneeded or free for a single
process-per-owner/team. **Which would silently break if the CLOUD collapsed to one
process per owner:** hibernate-to-zero (100k mostly-idle owners would mean 100k
paid-for idle processes), edge latency, and the free fleet distribution. So the
DO's distinctive value is precisely "single-writer-per-room + idle-to-zero on
shared multi-tenant infra," which the single self-host process provides trivially
and the cloud genuinely depends on.

### 2. Is the primitive "durable instance," "object store," or neither?

Neither. Mentally inlining `RoomCore` + `s3-blob-store` + the DO storage shows two
unlike lifecycles:

- **Room:** mutable CRDT + live sockets + presence + dispatch; long-lived,
  single-writer, hibernate-and-wake; tiny hot append-log (DO SQLite caps at 10 GB
  per object, 2 MB per row/value).
- **Blob:** write-once immutable bytes addressed by their own hash; no liveness, no
  sockets, no owning process; large cold objects (single PUT up to 5 GiB).

"Model room state as just another object" is a **false unification**: a room is not
its bytes, it is the live process that owns those bytes plus sockets plus presence;
a blob has no live process. Routing immutable bytes through a per-owner actor
re-adds the deleted DB/queue/coordination. "Owner-scoped object store as THE
primitive" fails the other way: the blob has no owner-process and the blob spec's
whole win was deleting the actor around bytes.

The real shared substrate is smaller than "instance": it is the **Runtime port**
(host primitives injected). The room injects a sync update-log + socket accept +
scheduler; the blob injects an S3 endpoint. The honest shared thing is the
injection seam, not a merged object. This is the honest-asymmetry lesson applied:
two unlike operations get two call shapes, unified only by who provides their
primitives.

### 3. The hard part DOs give for free: multi-node scale-out. State the boundary.

Grounded against `yjs/yjs` + `yjs/y-protocols`: N server replicas of one room
**converge for free on document content** (updates are commutative and idempotent
under `applyUpdateV2`), but you must supply, by hand, everything else:

- eventual cross-replica dissemination (a pub/sub or anti-entropy bus),
- loop / duplicate-traffic suppression (correctness is safe, bandwidth is not),
- a durable, mergeable log with coordinated appends and compaction races handled,
- a cross-replica **presence relay** (awareness is ephemeral LWW-per-client with
  30 s timeouts, separate from doc convergence and not solved by the CRDT),
- and you inherit the sharpest hazard: a client routed to a replica that has not
  yet seen another replica's recent updates gets a **stale SyncStep1 diff**.
  Convergence is eventual; the handshake wants current.

The DO erases all of that by guaranteeing exactly one owner per room. **The honest
boundary:** a single process (self-host, Tauri) trivially holds one
owner/team's load (tens of thousands of WebSockets, KB-to-MB docs); single-process
is correct essentially always for self-host. You need the sharded, hibernating,
single-writer-per-room substrate (the DO) when either (a) **one owner's live
working set exceeds one box**, or (b) you run **many thousands of mostly-idle
independent owners** where per-owner processes cannot fit or cannot scale to zero
economically. That second condition is exactly the public cloud. So: single
process below "one owner fits one box and you do not need per-tenant idle-to-zero";
sharded DO above it. The collapse does not remove the DO, it makes the DO the
cloud's binding of the port.

### 4. The other Cloudflare couplings: thin seams or load-bearing?

| Coupling | Verdict | Note |
|---|---|---|
| `HYPERDRIVE` → pg | **thin, but the real one** | Code already uses `pg.Client` over a connection string; Hyperdrive is just an accelerating pooler. Any Postgres works. The load-bearing fact is not portability, it is that this DB is a **shared global plane** (auth, sessions, OAuth clients, billing, DO telemetry), not per-owner. The per-owner-instance dream fragments it wrongly. |
| `SESSION_KV` → Better Auth `secondaryStorage` | thin | An optional read-through cache. Node drops it; Postgres is the only store. |
| Workers Static Assets (`ASSETS`) → fs | thin, cloud-only | Dashboard SPA, hosted-only; self-host ships its own UI; Node serves static files. |
| `executionCtx.waitUntil` → process lifetime | thin | In a DO it is a no-op (the DO stays alive while work pends); in a Worker it is ~30 s bounded; in a Node process you just do not return until done. A one-line `afterResponse` member on the port. |
| `ROOM` → DO namespace | already injected | `createServerApp` already sets `c.var.rooms = createDurableObjectRooms(c.env.ROOM)`. The seam is built; only the second binding is missing. |
| `ASSETS_BUCKET` → R2 | being deleted | Superseded by the portable blob store. |

So the Cloudflare lock-in concentrates in exactly one place worth naming: the
**room runtime** (DO), and that is already behind a contract. Everything else is a
thin seam, and bytes already escaped. The shared Postgres is portable but is the
honest-asymmetry boundary at the identity layer: it is a global plane, not
per-owner state, so it does not belong in any per-owner instance.

### 5. Asymmetric win: the single deletion that makes the system explainable.

The sentence we want true: **"There is one server. It runs in a DO or a process.
Capabilities never know which."** To keep it clean we must REFUSE:

- **Refuse to merge room and blob into one instance/object.** Keep the honest
  asymmetry. The refusal costs nothing (they are already two files) and preserves
  the blob spec's deletion of the actor around bytes.
- **Refuse to let any capability read `c.env` or import `cloudflare:workers`.**
  Everything goes through the `Runtime` port. The deletion prize: the
  `cloudflare:workers` mock disappears from room tests, and the day a second
  runtime is real, it is a wiring change at one edge, not a library hunt.
- **Refuse the per-owner-instance topology for this layer.** It is the topology for
  a different product (per-owner app hosting) and even there identity stays global.
  Adopting it here would trade per-room hibernation granularity for nothing.

## The honest ledger

**What the collapse (finish the runtime port) buys**

- Self-host stops requiring a Cloudflare account: one binary + one Postgres + one
  S3 endpoint (MinIO/Garage). The single biggest lowering of the self-host bar.
- One codebase, two runtimes, no fork (the GitLab/Discourse/Plausible shape).
- The Tauri-local instance becomes the same binary embedded, enabling a true
  local-first server with no cloud dependency.
- Room logic testable with zero Workers globals.

**What it costs**

- A second room backend to write and maintain (`bun:sqlite` / `better-sqlite3`
  update log + an in-process `Rooms` map + idle eviction + a Node WS-reject path
  for the 4401 auth-fail close). Bounded, designed in `20260522T220000`.
- A Node host entry, static serving, module-scope `pg.Pool`, and Better Auth
  without `secondaryStorage`.
- Ongoing: every room change must keep both backends honest against the shared
  `RoomCore` (mitigated by running the core's tests against both).

**What it makes impossible (or refuses)**

- A single self-host process cannot horizontally scale one room across machines (a
  room is a single-writer in-memory actor; two processes cannot co-host one room
  regardless of storage). Accepted: self-host is vertical-scale, HA deferred.
- Per-owner-instance hosting of arbitrary code is explicitly NOT delivered by this
  collapse; that is a separate product on a separate primitive.

**The scale threshold where the cloud (sharded DO) path is still required**

- Below: one owner/team's working set fits one box and you do not need per-tenant
  idle-to-zero. Self-host and Tauri live here essentially always.
- Above: thousands of mostly-idle independent tenants (you need hibernate-to-zero
  per owner, which a process cannot do) OR a single tenant whose live rooms exceed
  one box (you need shard-by-room). The public cloud is permanently above this
  line, so `apps/api` keeps the per-room DO binding forever. The two bindings
  coexist by design; neither is the loser.

## Execution status (this pass)

- **Waves 1-4: LANDED (branch `wash-saddle`).** ADR-0066 is now `Accepted`.
  - **Wave 1 (`refactor(server)`):** `createServerApp` injects `connectDb` +
    `afterResponse` per concern; `createDb(client)` + the Cloudflare
    `connectHyperdriveDb(env.HYPERDRIVE)` backend are exported and wired at both
    Worker edges. The library no longer reads `c.env.HYPERDRIVE` or calls
    `c.executionCtx.waitUntil`. No Worker behavior change.
  - **Wave 2 (`feat(server)`):** `resolveRooms` injected (last direct `c.env.ROOM`
    read removed). New `room/backends/node` (`bun:sqlite` update log + in-process
    `Map` registry). The `handleUpgrade(request) -> Response` impedance is resolved:
    the contract now takes `{ request, userId, nodeId }`, the route stops
    reconstructing the request, the Cloudflare backend stamps `userId` into the
    forwarded DO request, and the Bun backend uses `server.upgrade(request, { data })`
    + the top-level `websocket` handler. `RoomCore.handleMessage` widened to accept
    `Uint8Array`. The same `RoomCore` passes one suite on both backends, no
    `cloudflare:workers` mock on the Node path.
  - **Wave 3 (`feat(api)`):** `apps/api/server.ts` (`Bun.serve` + `websocket`,
    module-scope `pg.Pool`, in-process room registry over `DATA_DIR`, S3 blobs),
    plus a `dev:node` script and `.env.example`. `createAuth`'s env loosened to a
    portable secrets bag (R2 delete hook guarded); the `@epicenter/server/node`
    subpath barrel keeps the `cloudflare:workers`-tainted `Room` export off the Bun
    import graph. Also fixed: Bun auto-negotiates the WS subprotocol, so the manual
    `Sec-WebSocket-Protocol` echo (which broke the handshake) is dropped.
  - **Wave 4 (`docs`):** evidence captured. `bun server.ts` boots, connects its
    pool, and serves `/` (`runtime: "bun"`); the auth pipeline gates unauthenticated
    room/blob requests **over HTTP** (the WS-upgrade rejection had an untested Bun
    gap that the grill caught and fixed; see the post-grill section);
    a live-socket integration test syncs presence + a binary
    Yjs update across two real WebSocket clients through `server.upgrade`. The
    `apps/api` Worker still bundles via `wrangler deploy --dry-run` with every
    binding resolved. Remaining manual deploy-time gates: a live Google OAuth
    sign-in and a full MinIO/R2 blob round-trip (the blob store is one portable S3
    module with no per-runtime backend, so it is portable by construction).
- **Item 1 (drop `SESSION_KV`): DONE.** `create-auth.ts` removed `secondaryStorage`
  and the now-dead `storeSessionInDatabase` / `verification.storeInDatabase` flags,
  kept the JWE cookie cache, and set `rateLimit: { storage: 'memory' }` explicitly
  (grounded: removing secondary storage silently flips rate-limit storage to
  memory; acceptable because email/password is disabled, so there is no
  brute-force surface a shared counter protects). `SESSION_KV` removed from
  `ServerBindings`, both `wrangler.jsonc` files, the regenerated
  `worker-configuration.d.ts`, and the self-host README. Existing sessions are
  safe: they were already dual-written to Postgres. Typecheck green across the
  library and both deployables. Real proof (a live OAuth sign-in) is a deploy-time
  smoke test, still pending.
- **Item 2, 3, 4: not started** (see sequence above; 3 and 4 are trigger-gated).

## Post-grill refinements (2026-06-24)

An adversarial grill of the landed waves returned a **working-but-flawed** verdict: the load-bearing decisions held (per-concern injection with no `Runtime` god-object; `RoomCore` imports nothing Cloudflare and never branches on runtime; room and blob stayed honestly asymmetric; the DO stayed a binding), but the flaws were concentrated. ADR-0066's Consequences now carry the durable corrections; this logs the execution split.

**Landed (env + naming + the crash floor):**

- **WebSocketPair crash fixed.** `oauth-resource.ts`'s auth-reject-over-WS called `new WebSocketPair()` (a Cloudflare-only ambient global), which threw `ReferenceError` on Bun, reachable on any bad/expired-bearer room upgrade and masked by a test that injected a fake pair. Now capability-detected (`typeof WebSocketPair`, else HTTP) as the floor. The false `createWebSocketPair` test seam is deleted; both branches are tested against the real global.
- **Committed to Bun.** `room/backends/node` → `bun`, `createNodeRooms` → `createBunRooms`, `@epicenter/server/node` → `/bun`; the `Node` / `better-sqlite3` hedge is dropped. The second runtime is Bun (`bun:sqlite`, `Bun.serve`, `bun build --compile`).
- **Env honesty + validation.** `Env.Bindings` and the `createServerApp` hooks now name the library's own `ServerBindings`, never `Cloudflare.Env`; the ambient `cloudflare-bindings.d.ts` shim is deleted, and the dead `HYPERDRIVE` / `ROOM` members left the contract. `ServerBindings` became an **arktype schema** (value + inferred type); the Bun entry validates `process.env` against it at boot (`ServerBindings.merge({ DATABASE_URL, … })(process.env)` + an aggregated error + `process.exit`), retiring the `as unknown as` cast. `ASSETS_BUCKET` left the contract into a local `AssetsEnv` cast in the doomed assets route; the Worker, self-host, and billing read their runtime-only bindings via an `env as Cloudflare.Env` edge cast. Typechecks green: `@epicenter/server`, `apps/api`, `apps/self-host`.

**In flight on the parallel track (not this pass):**

- **Faithful `Rooms.rejectUpgrade`** — the room-backend path that lets Bun emit a real `4401` close instead of the HTTP floor (Bun cannot mint a detached socket from middleware). Contract + Bun implementation exist; **not yet wired** into the auth-reject path (`require-auth.ts` still calls the capability-detect helper). This supersedes the floor when wired.
- **Lifetime + ping/pong moved into `RoomCore`** (`sweepExpiredConnections`, the per-message bound, the literal `ping`/`pong`); the DO delegates. **Currently 2 failing** `durable-object.test.ts` lifetime tests (over-age sockets are not being closed with `4408`) — to resolve.

**Deferred (no collision, do after the parallel track settles):**

- A **shared `RoomCore` conformance suite** exercising the debounce, 4401, dispatch `RecipientOffline`, and compaction-cap behaviors once against the core (today they are partially re-tested per backend).
- Renaming the `c.var.afterResponse` queue var to disambiguate it from the `afterResponse` scheduler hook.

## The Bun dev server is the keystone (the trigger is now real)

The standing decision in `20260528T130000` was "do not build the rest of the port
until a second runtime is real," because building the seam with no second
implementation risks designing it blind. **A Bun/Node dev entry for `apps/api`
*is* that second runtime**, so it removes the objection and justifies the build.
It earns its keep three ways at once, which is why it is the keystone rather than
speculative churn:

1. **Dev speed.** `bun --watch server.ts` boots instantly with real stack traces
   and a debugger; `wrangler dev` emulates workerd and is slower. A fast inner loop.
2. **It validates the port by construction.** A contract only reveals it is
   secretly Cloudflare-shaped when a second impl consumes it. The clearest example:
   `ResolvedRoom.handleUpgrade(req) -> Response` fits CF's `Response(101,{webSocket})`
   but not Bun's `server.upgrade(req,{data})` + top-level `websocket` handler, so
   building the Bun room backend is what surfaces and fixes that leak.
3. **It is the self-host artifact.** `bun server.ts` against a plain Postgres + any
   S3 is the "one binary, no Cloudflare account" self-host, and the same entry is
   what a Tauri shell embeds locally.

**Best-practice shape: one Hono app, two entries, keep both.** `worker/index.ts`
(Cloudflare, `wrangler dev`/`deploy`) and `server.ts` (Bun, `bun --watch`) both
build the same `createServerApp(...)`. Additive, never a replacement: portable
means it *also* runs on Bun, never that it *stops* running on Cloudflare. The
server runtimes are Workers / Bun / Node; the browser and Tauri are clients of
whichever server (there is no in-browser server here: the room needs `bun:sqlite`
and `pg`).

**The one honest caveat: dev-prod runtime skew.** A bug that only manifests in the
DO (hibernation restore, alarm timing, edge placement) will not show in Bun dev.
So the discipline is Bun dev for speed, `wrangler dev` / staging for fidelity
before any deploy touching room/DO behavior. Both entries stay for exactly this
reason.

### Wave plan (each wave builds, typechecks, and commits on its own)

| Wave | Scope | Road | Removes |
|---|---|---|---|
| 1 | inject `connectDb` + `afterResponse`/`waitUntil` per concern into `createServerApp`; Cloudflare wiring moves to the `apps/*` edge | 1 + tiny | direct `HYPERDRIVE` + `executionCtx.waitUntil` reads in the library |
| 2 | inject `resolveRooms`; write `room/backends/node` (`bun:sqlite`/`better-sqlite3` `RoomUpdateLog` + in-process `Map` `Rooms`); resolve the WS-upgrade impedance | 2 (real) | the last direct `ROOM` read; the `cloudflare:workers` mock in room tests |
| 3 | loosen `createAuth`'s `env: Cloudflare.Env` to a secrets bag; guard the `ASSETS_BUCKET` user-delete hook (or finish assets->blobs); add `apps/api/server.ts` (`Bun.serve` + `websocket`) and a `dev:node` script | 1 + glue | the last Cloudflare-binding read on the auth construction path |
| 4 | prove: `bun server.ts` against local Postgres + R2/MinIO signs in, syncs a room, reads a blob, AND `wrangler dev` still serves everything | n/a | nothing; this is the Class-1 evidence gate |

Item 2 (assets -> blobs) is independent and still the cleanest standalone win,
because it removes the final R2 binding from auth (folded into Wave 3's auth-env
work, or done first).

After Waves 1-3 the library reads zero Cloudflare bindings directly: `db`,
`afterResponse`, `rooms`, and `blobs` are all injected per concern; only the
deployment edge (`apps/api/worker/index.ts` vs `apps/api/server.ts`) names a
runtime. That is the collapse, made real and exercised by Wave 4.

## ADR

Recorded as **[ADR-0066](../docs/adr/0066-runtime-portability-is-per-concern-injection-not-a-runtime-object.md)** (Proposed; flip to Accepted when the wave plan lands). The decision in one paragraph:

> **Runtime portability is decided per subsystem by one rule (is there an open
> standard both runtimes speak?): Road 1 collapses to that standard, Road 2 injects
> a tiny per-concern contract; capabilities never read `Cloudflare.Env` and there
> is no single `Runtime` bag; room and blob share the approach, not a shape, and
> identity stays a shared global plane.**
>
> - *Context:* `room` and `blob` both reached for runtime portability; the
>   tempting unifications were a per-owner instance hosting both and a single
>   `Runtime` god-object. Grilling showed the instance is a topology for a
>   different product, and the god-object overstates the work ~5x (most legs
>   collapse under Road 1) while re-bundling what `mount*`/`resolveOrigin` unbundled.
> - *Decision:* the seam is per-concern injection at the `apps/*` edge
>   (`resolveOrigin`, `connectDb`, `resolveRooms`, ...), never a `Runtime` object
>   and never `Cloudflare.Env` directly. Object storage and SQL collapse to open
>   standards (S3, the Postgres wire); the KV session cache is deleted, not ported;
>   the DO is the cloud's Road-2 binding of the room actor, not the unit of
>   deployment; identity/billing are a global plane, not per-instance state.
> - *Consequences:* self-host can drop Cloudflare (binary + Postgres + S3); the
>   `cloudflare:workers` mock leaves room tests; the cloud keeps per-room DO
>   sharding and hibernate-to-zero forever; a per-owner-instance product, if ever
>   built, is a separate primitive that still leaves identity global.

## Non-goals / open questions

- **Per-owner-instance app hosting** (router worker maps subdomain to a per-owner
  DO running arbitrary code) is a separate product, out of scope here. Revisit when
  hosting untrusted third-party per-owner code is an actual goal.
- **HA / multi-process self-host** deferred (single-writer actor; vertical scale
  for v1), per `20260522T220000` Open Question 1.
- **`bun:sqlite` vs `better-sqlite3`** for the Node room log: decide at build time;
  `better-sqlite3` is the only sync engine that also covers Node. Both swap behind
  `RoomUpdateLog` in one line.
- **Refresh or retire `20260522T220000`:** it predates the `packages/server` split,
  the `owners/<ownerId>` grammar, and the content-addressed blob store; its
  filesystem `AssetStore` decision is dead. Fold its still-valid execution detail
  (the room backend plan, the `bun:sqlite` findings, the edge cases) under this
  verdict when the build trigger fires, and delete the stale parts then.
- **Room cold-archival to S3** (snapshot a compacted room doc into the same blob
  store for backup) is possible but must NOT replace the local sync log: the
  `updateV2` append cannot await an S3 PUT. Keep the hot log local, S3 for cold.
</content>
</invoke>
