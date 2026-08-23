# 0002. Stored entries reconcile to four visible states (the unreadable bucket)

- **Status:** Superseded
- **Superseded by:** [ADR-0003](0003-three-read-states-after-encryption-removal.md)
- **Date:** 2026-06-15

> **Superseded by [ADR-0003](0003-three-read-states-after-encryption-removal.md).**
> The `unreadable` bucket existed only for encrypted rows; the trusted-relay
> change removed the encryption layer, collapsing the read surface to three
> states. This record is kept for history.

Every stored table entry resolves to exactly one of four states (conforming,
nonconforming, newer-writer, unreadable), and `storedCount()` equals the sum of
the four `scan()` buckets. The fourth state, `unreadable`, is the load-bearing
one: most Epicenter apps run encrypted tables, and a row whose key version is
missing from the keyring decrypts to nothing. That row used to be invisible
everywhere (a readable-only iterator skipped it, `size` subtracted it, only a
bare count recorded it), which is the encrypted twin of the schema-edit silent
drop. We taught the shared `ObservableKvStore` contract to surface every stored
entry as `present` or `unreadable` in one classified pass (`reads()`, with a
`read(key)` point form) and redefined the raw count to include the unreadable
ones, so no row can sit in storage and be invisible to every read.

## Consequences

The write guard tightened. A `set()` over an undecryptable row used to see
`get()` return undefined, treat the slot as empty, and overwrite a row it could
not read. Now `set()`/`bulkSet()`/`clear()` refuse unreadable rows with
`UnreadableRefusal` alongside the existing newer-writer refusal, and `get()` /
`update()` report `UnreadableRow` instead of a silent `Ok(null)`. `delete()`
stays unguarded: removing a row you cannot read is a legitimate, key-independent
intent.

For plaintext tables the `unreadable` bucket is always empty and the sum
identity still holds. The point of the identity is not that callers compute it;
it is that the model has no gap.
