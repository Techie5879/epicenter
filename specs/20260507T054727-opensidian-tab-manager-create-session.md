# opensidian adopts createSession; tab-manager follow-up

> Two apps still construct their workspace at module top-level via `await waitForAuthState`. Migrate opensidian to the `createSession` factory pattern that fuji, honeycrisp, and zhongwen already use. Keep tab-manager as an explicit follow-up because its sidepanel has the same lifecycle smell but its workspace factory is async today.

**Date**: 2026-05-07
**Status**: Proposed; refreshed 2026-05-07; tab-manager blocked on async workspace construction decision
**Author**: Captures the asymmetry surfaced after the spec-2 cleanup waves; opensidian and tab-manager are the last two apps not on `createSession`.
**Current note**: This spec was written before `20260507T080000-drop-context-module-helper.md` landed and has been refreshed against the current tree. Do not implement a `SignedInSessionProvider`, `createContext`, or `setSignedInSession` path. Opensidian should match the current fuji, honeycrisp, and zhongwen shape: `session.current` for layout gating, `InferSignedIn<typeof session>` for the signed-in type, and a module-level `getSignedInSession()` helper exported from `session.svelte.ts`. Tab-manager has the same lifecycle smell in the side panel, but its workspace factory is async today, so it is not a direct `createSession` migration.
**Branch**: follow-up to `feat/encrypted-local-workspace-storage`

## One-sentence thesis

```txt
Browser apps should not hide a signed-in-only workspace behind module import.
SvelteKit apps can use `createSession` now; tab-manager needs an async
construction decision before it can join the same pattern.
```

## Why this draft exists

Spec 2 + post-implementation review consolidated three apps (fuji, honeycrisp, zhongwen) on `createSession`:

```ts
export const session = createSession({ auth, build: (identity) => {...} });
export type FooSignedIn = InferSignedIn<typeof session>;
```

The remaining two apps (opensidian, tab-manager) still use the older shape:

```ts
await session.whenReady;
const auth = createBearerAuth({...});
const signedInState = await waitForAuthState(auth, ...);
if (signedInState.status !== 'signed-in') throw new Error('signed-in required.');
export const opensidian = openOpensidian({ userId: signedInState.identity.user.id, ... });
auth.onStateChange((state) => { /* reload on sign-out / user-switch */ });
```

Two patterns for the same problem. The split exists for historical reasons, not architectural ones.

## Refresh findings: 2026-05-07

Fresh code audits changed the action plan:

```txt
opensidian:
  client.ts still owns auth, waitForAuthState, module-level opensidian,
  workspaceAiTools, and manual auth.onStateChange reload policy.

  Main consumers are +layout.svelte, fs-state, chat-state, ContentEditor,
  terminal/search/skill state, sample-data loading, and TabBar.

  Migration is still actionable and should move auth to lib/auth.ts,
  create session.svelte.ts, expose getSignedInSession(), and migrate
  consumers away from importing $lib/opensidian/client.

tab-manager:
  Only the sidepanel imports the signed-in workspace client. The background
  entry point is inert.

  client.ts still blocks on session.whenReady, waitForAuthState, peer/device
  identity, and await openTabManager before App.svelte can finish importing.

  createSession is conceptually the right lifecycle model for the sidepanel,
  but createSession.build is synchronous and openTabManager is async today.
  Resolve the async peer/workspace construction shape before migrating.
```

The consequence: opensidian can move now. Tab-manager should not be hand-waved
as "just extension asymmetry," but it also should not be forced into
`createSession` until the async `openTabManager` path has a deliberate home.

## What is wrong today

```txt
SMELL                                         WHERE                                    COMPENSATING FOR
─────────────────────────────────             ──────────────────────────────────       ─────────────────────────────
Top-level await blocks module load until      apps/opensidian/src/lib/                "I want a synchronous import
the user is signed-in                          opensidian/client.ts:25-32              that returns a workspace handle."
                                              apps/tab-manager/src/lib/                Loses the session lifecycle
                                              tab-manager/client.ts:19-27              discriminated union.

Two reload-policy primitives                   client.ts auth.onStateChange + manual    No standard place to express
                                               status checks                            "what does signed-in mean"

`signedIn` reload semantics duplicated         opensidian/client.ts and                Same logic written by hand
                                               tab-manager/client.ts                    in each app

Workspace constructed once at module load      `export const opensidian = ...`         Workspace handle outlives the
                                                                                        signed-in scope on paper
```

## One-sentence test

After this spec:

```txt
"opensidian uses `session.current` for auth lifecycle and carries its
workspace handle in the signed-in payload; tab-manager's remaining
top-level workspace export is documented as a temporary async-build blocker."
```

## Asymmetric refusals

```txt
Refusal 1: opensidian top-level workspace export
  Deletes:
    - export const opensidian = openOpensidian({...})
    - The blocking `await waitForAuthState(...)` at opensidian module load
    - The hand-rolled opensidian auth.onStateChange reload logic

  Replaces:
    - export const session = createSession({ auth, build: (identity) => {...} });
    - export type OpensidianSignedIn = InferSignedIn<typeof session>;
    - export function getSignedInSession(): OpensidianSignedIn { ... }
    - createSession owns the user-switch reload; consumers narrow via `session.current`.

  User loss: every consumer that does `import { opensidian } from '...'` and
            uses it synchronously must migrate to `getSignedInSession()` (in a
            Svelte component scope) or guard via `session.current.status`.

Refusal 2: tab-manager immediate migration
  Tab-manager has no SvelteKit `+layout.svelte`, but that is not the real
  blocker: the current active entry point is only the sidepanel, and it could
  gate on session.current at App.svelte. The real blocker is async build:
  client.ts awaits peer/device identity and await openTabManager(...), while
  createSession.build is synchronous.

  Decision required:
    A. Make tab-manager workspace construction synchronous by resolving peer
       identity before createSession or by changing openTabManager's shape.
    B. Extend the session primitive with an async-build variant.
    C. Keep the current top-level await temporarily, but document that signed-out
       sidepanel rendering remains blocked by module import.

  This spec proposes C for this wave and opens a follow-up for A or B. That is
  not a permanent endorsement of the old client.ts shape.
```

## What changes per app (proposed)

### apps/opensidian: full migration

```txt
DELETED:
  apps/opensidian/src/lib/opensidian/client.ts
    - top-level await waitForAuthState
    - if (signedInState.status !== 'signed-in') throw
    - export const opensidian = openOpensidian({...})
    - auth.onStateChange reload logic
    - module-level workspaceAiTools

CREATED / MOVED:
  apps/opensidian/src/lib/auth.ts
    - export const auth = createBearerAuth({...})
    - persistedState BearerSession setup

  apps/opensidian/src/lib/session.svelte.ts
    - export const session = createSession({
        auth,
        build: (identity) => {
          const opensidian = openOpensidian({...});
          return { userId, opensidian, [Symbol.dispose]() {...} };
        },
      });
    - export type OpensidianSignedIn = InferSignedIn<typeof session>;
    - export function getSignedInSession(): OpensidianSignedIn { ... }

  apps/opensidian/src/routes/+layout.svelte
    - gate on session.current with pending / signed-out / signed-in branches
    - WorkspaceGate inside the signed-in branch

CONSUMERS:
  Audit `import { opensidian } from ...` across apps/opensidian/src.
  Each consumer migrates to `getSignedInSession()` inside Svelte components,
  or `session.current` narrowing for non-component code.

  workspaceAiTools: rebuild inside the build factory (per-mount), exposed
  on signedIn.aiTools. Or expose actions statically and let consumers
  call `actionsToAiTools(opensidian.actions)` per-component if they need
  per-mount tool instances.
```

### apps/tab-manager: defer migration, document the blocker

```txt
TAB-MANAGER STAYS on current shape:
  - top-level await pattern preserved for this wave
  - registerDevice fires once after idb.whenLoaded (current behavior)
  - auth.onStateChange reload (current behavior)
  - signed-out sidepanel rendering may remain blocked by module import

FOLLOW-UP:
  Decide whether tab-manager should:
    A. make peer/workspace construction synchronous enough for createSession, or
    B. use a new async createSession variant.

Do not justify the old shape only by saying "extension." The current background
entry point is inert; the sidepanel is the real consumer, and it has the same
signed-in lifecycle issue as the SvelteKit apps.
```

## Wave ordering

```txt
Wave 0   Decide tab-manager follow-up shape.
         This wave does not migrate tab-manager. It records whether the next
         spec should make openTabManager synchronous enough for createSession
         or introduce an async session primitive.

Wave 1   apps/opensidian/src/lib/session.svelte.ts (new)
         apps/opensidian/src/lib/auth.ts (move auth out of client.ts)
         Drop top-level await, top-level export, bindAuthWorkspaceScope-replacement.
         Export getSignedInSession() directly from session.svelte.ts.
         Typecheck.

Wave 2   apps/opensidian/src/routes/+layout.svelte
         Gate on session.current in the signed-in branch.

Wave 3   Migrate consumers in apps/opensidian/src that read `opensidian.X`
         to `getSignedInSession().opensidian.X` (component code) or
         narrow via `session.current` (non-component code).
         Audit grep:  grep -rn "from '\$lib/opensidian/client'" apps/opensidian/src

Wave 4   Verify opensidian (rollback point):
         - typecheck (apps/opensidian + svelte-utils)
         - smoke test: cold boot signed-in / signed-out, sign in, sign out,
           different-user switch (full reload), HMR
         - chat conversation flow still works (chat-state.svelte.ts is the
           heaviest opensidian.X consumer)
         - sample data load still works

Wave 5   Tab-manager documentation cleanup.
         Document the temporary blocker: sidepanel uses the old top-level
         await shape because openTabManager is async and createSession.build
         is synchronous. Do not describe this as generic extension asymmetry.

Wave 6   Final audit:
         grep -rn "waitForAuthState" apps/ packages/
         grep -rn "module-level workspace" docs/
         Update workspace-app-layout skill to document one canonical pattern.
```

## Tradeoffs (honest accounting)

**Top-level await goes away.** Apps no longer block module load on auth. Consumers that imported `opensidian` and used it synchronously now hit a discriminated union. This is more honest: the workspace literally doesn't exist when signed-out, but every call site changes.

**Tab-manager migration is deferred, not rejected.** The sidepanel has the same
signed-in lifecycle smell as opensidian: importing the client waits for
signed-in auth before the UI can fully load. The reason not to migrate it in
this wave is narrower: `createSession.build` is synchronous, while
`openTabManager` awaits peer/device identity and workspace construction.

**Module-level workspaceAiTools.** Tab-manager's `actionsToAiTools(tabManager.actions)` runs at module load today. After migration, tools are rebuilt per-mount or exposed static. Need to verify the AI tool registration works without a workspace handle at module scope.

**HMR semantics.** Today's pattern disposes the workspace on HMR via `import.meta.hot.dispose`. After migration, the createSession factory's HMR hook handles it. Behavior should match.

**registerDevice timing.** Tab-manager's `registerDevice` fires once after IDB load. In a migrated version, it would run inside the signed-in workspace construction path or immediately after it settles. That timing must be preserved.

## Open questions

### Q1: Does opensidian have an analog to honeycrisp's `state` aggregation?

Honeycrisp folded `createHoneycrispState` (folders + notes + view) into the SignedIn payload. Opensidian's `chat-state.svelte.ts` is the closest analog. Should it move into `buildOpensidianSignedIn` as `signedIn.chatState`, or stay as a per-component state factory?

Default: leave chat state where it is for now; revisit if multiple components need shared chat state.

### Q2: Should tab-manager's RPC contract types still reference the workspace handle?

`apps/tab-manager/src/lib/workspace/rpc-contract.ts` imports `type { tabManager }`. While tab-manager stays on the top-level export, this still works. If tab-manager migrates, the type should derive from `InferSignedIn<typeof session>['tabManager']` or from the factory return type.

### Q3: Is there still a shared provider to extract?

No. `20260507T080000-drop-context-module-helper.md` deleted the provider layer
in fuji, honeycrisp, and zhongwen. The current shared pattern is
`createSession` plus a per-app module-level `getSignedInSession()` helper.

This question is closed unless a future app reintroduces a real context owner.

### Q4: What happens to `bindAuthWorkspaceScope` after this spec?

Already deleted in spec 2 cleanup. This spec removes the opensidian hand-rolled replacement. Tab-manager keeps its replacement until the async construction decision is made.

If tab-manager defers migration, its `auth.onStateChange` block stays. That's the only remaining hand-rolled lifecycle handler in the monorepo. Document it as a temporary async-build blocker, not as the preferred pattern.

## Final check (greenfield-clean-breaks)

```txt
Can I explain the new API without saying "or"?
  Not yet. "Every SvelteKit app gates on createSession; tab-manager sidepanel
  still uses top-level await until async workspace construction has a home."
  That exception is an open follow-up, not a settled design.

Does one layer own each invariant?
  Yes:
    auth                        identity truth (same as today)
    createSession               when the workspace exists; user-switch reload
    per-app session.svelte.ts   what the SignedIn payload contains
    getSignedInSession          enforces the signed-in precondition at read time
    descendants                 read getSignedInSession() once per component

Would a new caller find only one obvious path?
  For SPAs: yes: createSession + InferSignedIn + getSignedInSession.
  For tab-manager: not yet. Current top-level await pattern is documented as temporary.

Are examples free of compatibility shapes?
  For opensidian, yes. For tab-manager, no: the compatibility shape remains
  until the async construction follow-up lands.

Did I delete stale names instead of leaving aliases?
  Yes for opensidian. Tab-manager stale names remain by explicit deferral.

Did I move the boundary that caused the smell, or only wrap it?
  Moved for opensidian. Tab-manager still needs a follow-up boundary move.

Did I run the asymmetric wins pass before adding another invariant?
  Yes. Deferring tab-manager keeps this wave cohesive: opensidian can migrate
  to the current session pattern without also designing async session builds.
```

## References

- `specs/20260506T013348-session-state-replaces-signed-in-component.md` (spec 1: createSession factory)
- `specs/20260506T143000-lazy-identity-reads-from-auth.md` (spec 2: lazy identity)
- `packages/svelte-utils/src/session.svelte.ts` (createSession + InferSignedIn)
- `apps/fuji/src/lib/session.svelte.ts` (canonical SPA pattern)
- `apps/honeycrisp/src/lib/session.svelte.ts` (with state aggregation in payload)
- `apps/zhongwen/src/lib/session.svelte.ts` (minimal SPA pattern)
- `apps/opensidian/src/lib/opensidian/client.ts` (current pre-migration shape)
- `apps/tab-manager/src/lib/tab-manager/client.ts` (current shape; potentially refused)
