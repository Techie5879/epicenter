# Wave Ordering

## When To Read This

Read this when a clean break replaces an old code path with a new one,
especially when the old path is tempting to delete as soon as the new path
compiles.

## Rule

Order the implementation as four phases:

```txt
Wave 1 to N    Build the new path
Wave N+1       Stop importing the old path; it stays on disk, unused
Wave N+2       Verify: typecheck, tests, and relevant smoke coverage
Wave N+3       Delete the old path
```

Stopping imports before deleting keeps rollback cheap. If verification fails,
the fallback is still on disk and the rollback can be one import flip or one
revert.

This is a rollback point, not product compatibility. The old path must be
unimported before verification; users and callers should already be on the new
path.

## Wrong Shape

```txt
Wave 1 to N    Build the new path
Wave N+1       Delete the old path
Wave N+2       Verify
```

If verification fails, the fallback is gone. Rollback is more painful than it
needs to be.

## Decision Hygiene Connection

This is the same failure mode that specification-writing calls unverified
deletion: treating an empirical question as if design coherence already
answered it.

```txt
Question:
  Does the replacement work?

Class:
  1 evidence

Required behavior:
  Run typecheck, tests, and relevant smoke coverage before deletion.
```

Coherence is necessary. It is not proof.

## Worked Example

See `specs/20260504T040000-machine-auth-adopt-better-auth-device-client.md` for
the machine-auth migration:

```txt
Wave 5    Stop importing the old transport
Wave 8    Verify
Wave 9    Delete the transport file
```

If Wave 8 finds a behavior gap, the rollback is one revert.
