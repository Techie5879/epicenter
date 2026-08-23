---
'@epicenter/auth': minor
---

Remove the workspace keyring from the auth client and the session contract.

`PersistedAuth` and `ApiSessionResponse` drop their `keyring` field, and the OAuth, machine, and same-origin-cookie auth clients stop persisting, caching, comparing, and projecting it. The `/api/session` response no longer carries a keyring. Offline `ownerId` and grant caching, the fail-closed behavior, and the different-owner wipe are unchanged.

This follows the trusted-relay direction: the relay reads plaintext, so there is no server-derived workspace key left to ship to the client.
