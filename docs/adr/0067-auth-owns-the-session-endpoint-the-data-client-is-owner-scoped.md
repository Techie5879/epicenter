# 0067. Auth owns the `/api/session` endpoint; the data client is owner-scoped

- **Status:** Accepted
- **Date:** 2026-06-24
- **Amended by:** [ADR-0092](0092-identity-is-the-partition.md)

> **2026-07-02 amendment:** ADR-0092 keeps auth as the owner of `/api/session`, but changes the session body to `{ principalId, email? }` and removes owner path segments from the data client. The data client no longer receives an `ownerId` for URL construction; auth resolves the principal and routes derive the partition server-side.

## Context

`/api/session` returns `{ user, ownerId }`. The auth client already fetched it
(on sign-in and on every bearer verification) but discarded the profile,
publishing only `ownerId` on `state`. Meanwhile `@epicenter/client` fetched
`/api/session` a *second* time, lazily, just to learn the `ownerId` it needed to
build owner-scoped URLs, and the account popover fetched it a *third* time to
show the user's email. Two redundant reads, and the data client carried a
`session.*` surface plus a one-shot cache and `ready()` whose only job was to
resolve an identity the data client does not own. A clean break wanted exactly
one owner of identity.

## Decision

Auth owns `/api/session`. `auth.state` carries the capability id (`ownerId`);
`auth.getProfile()` reads presentational identity (the email) on demand through
the same credential boundary as `auth.fetch`. The data client receives `ownerId`
at construction, is owner-scoped, never touches `/api/session`, and exposes only
data surfaces (`blobs`, and the retiring `assets`). The email is never persisted
and never placed on `state`: that keeps `AuthState` (MIT, shared with workspace)
free of AGPL profile types and honors the standing rule that presentational
profile is fetched where it is displayed, not carried in capability/boot state.

## Consequences

- One identity owner. The data client is synchronous to construct, holds no
  session cache, and drops `ready()` and the entire `session.*` surface.
- The CLI reads `ownerId` off `auth.state` (failing closed when signed out); the
  account popover reads the email via `auth.getProfile()`, bridged into TanStack
  Query's throw-on-error contract with `queryOptions`. `app-shell` no longer
  depends on `@epicenter/client`.
- The client now builds URLs from the persisted (not-yet-verified) `ownerId`
  rather than the server's answer to a lazy `/api/session` read. The first authed
  request verifies it: on an owner mismatch the auth client wipes the persisted
  cell and withholds the bearer, so an upload fails closed (a 401 before any bytes
  are written) and the user re-authenticates, rather than silently auto-correcting
  to the server's owner as the old lazy read did. Both `assets.url` and
  `blobs.url` are now bound to that construction owner; `blobs.url` dropped its
  explicit-owner parameter, which had no caller (cross-owner blob reads are a
  shared-mode feature that does not exist yet).
- A profile read is now an explicit `getProfile()` call rather than a field on
  `state`. The displayed email can be momentarily stale until the next read,
  which is acceptable for a label and self-heals on the auth client's own
  `/api/session` revalidation; the capability `ownerId` is always fresh on
  `state`. This forecloses reading the email synchronously off `state`.

## Considered alternatives

- **Put the email on `AuthState`.** Rejected primarily because it contradicts the
  deliberate "capability state, not credential state" and "profile fetched on
  demand" rules recorded on `AuthState`/`PersistedAuth`: the email would have to
  thread through the `install*` verbs (and `installUnverified`, post-refresh, has
  no fresh email to carry), and presentational data does not belong in
  capability/boot state. The realistic shape is `email: string`, a primitive that
  crosses no license boundary; the MIT/AGPL firewall (`AuthState` lives in MIT
  `@epicenter/identity`, `AuthUser` in AGPL `@epicenter/auth`) is a secondary
  reason that only forecloses putting the `AuthUser` *type* on state, not the
  email value.
- **Keep `client.session.*` Result-native and bridge it in the popover.**
  Rejected: preserves a redundant `/api/session` read and leaves the data client
  owning an identity surface it should not have.
