# Don't encrypt the data the server holds. Don't hold it.

We were trying to find the nicest compromise: privacy for the people who want it, convenience for everyone else. The original answer was encrypted key-values. We'd encrypt every CRDT value at rest, but the key came from our server, so the philosophy became: if you cared about full encryption, you'd become the server. That worked. It just wasn't the best one. Then Iroh changed the shape of the problem. Instead of encrypting the data our server holds, we can make the server not touch your data at all. You bring your own anchor, or you trust Epicenter as one. An anchor is just a node that's always on.

## The original compromise: encrypt at rest, keep the key on the server

This is what the code does today. Encryption happens at the workspace value layer, before anything enters the synced Yjs doc, so the sync path only ever relays ciphertext. The key hierarchy is two stages, and both ends are visible in `packages/encryption` and `packages/server/src/auth/encryption.ts`:

```
ENCRYPTION_SECRETS              (root keyring, lives on our server)
        |  SHA-256
        v
   owner key                    <- the auth server derives this
        |  HKDF info = owner:{ownerId}
        v
 workspace key                  <- the client derives this from the owner key
        |  HKDF info = workspace:{workspaceId}
        v
encrypted CRDT value            <- XChaCha20-Poly1305, then into the doc
```

The keys reach the client through `/api/session`. Sign in, and `@epicenter/auth` caches `{ ownerId, keyring }` so the workspace can decrypt local Yjs data offline. The split was the whole design: the relay moves encrypted values and never holds the keys, while the auth server can derive owner keys because it holds the deployment root keyring.

That last clause is the catch.

## The tell: encrypting at rest still trusts the server

Server-managed encryption protects against the storage layer, not the server. A stolen disk, a database snapshot, provider-managed at-rest leakage: covered. But the server code can still read it, a server bug can still log it, an operator with production access can still inspect it, because the root keyring lives on the server and the owner key is derived from it. You're not server-blind. You're trusting the application.

So the escape hatch we shipped was "become the server." Run your own deployment, set your own `ENCRYPTION_SECRETS`, hold your own root. It's an honest answer, and it's also a lot to ask: you're standing up the whole auth-and-sync stack just to be the only one who can read your notes.

## Iroh moves the data off the server entirely

Iroh gives every device a public-key identity and opens a direct, encrypted QUIC connection between two devices by that identity. The session is end-to-end encrypted with keys derived from the devices' own keypairs, and when two peers can't connect directly, a relay forwards the encrypted frames it cannot decode. It's a packet relay addressed by public key, sitting below the application, so it never sees content.

Read those failure modes again with that in mind. "Server code can read it." Which server? The bytes go device to device. The relay can't decrypt; the transit is already sealed by Iroh. The entire "trust the server" question doesn't arise across transit, because no server is an endpoint of the encrypted session.

It survives in exactly one place. When your phone edits and your laptop is asleep, something always-on has to hold that update until the laptop wakes. That something is the anchor, and the anchor is an endpoint: it decrypts and stores. So the question stops being "do we encrypt the data" and becomes "who runs the anchor."

```
browser (leaf, relay-bound)  ─┐
                              ├── Iroh, end-to-end encrypted ──┐
native device ────────────────┘                               │
                                                               v
                                          relay: forwards sealed frames,
                                                 reads nothing
                                                               │
                                                               v
                                            anchor  (a node that's always on)
                                              ├─ yours      -> nobody else holds it
                                              └─ Epicenter  -> you trust us to hold it
```

One honest note on the browser. It can run Iroh, but only over WebSockets to a relay, with no direct hole-punching, so it's always a relay-bound leaf. That's fine: the relay still can't read the frames. The privacy is decided by who owns the far end of the session, never by the transport in the middle.

## Privacy becomes a topology choice, not an encryption layer

Here's the part I like. The old design gave you privacy through cryptography: hold the key, and the server holds ciphertext it can't read. The new design gives you privacy through topology: run the anchor, and the server holds nothing at all.

If you run your own anchor, Epicenter is never an endpoint of your data. The relay forwards sealed frames; your own node is the only thing that decrypts and stores. That's stronger than the encrypted key-value ever was, and it needs zero encryption code, because there's no server to be blind to. If you'd rather not run anything, you trust Epicenter's anchor and accept that we hold your data, the same promise as before, just without the key-derivation machinery around it.

So "become the server" becomes "become the anchor," and an anchor is a much smaller thing to become than an auth-and-sync deployment. It's one always-on node that holds your updates and forwards them to your other devices.

Two caveats, because every version of this has a cost. Most people won't run an anchor, so the default is still "trust Epicenter," and the marketing has to stay honest about that: "we can't read your data" is true in the self-host tier, not the default one. And if your self-hosted anchor is your only always-on node and it dies, that's data loss, so backup is the one narrow place a sealed blob still earns its keep: client-encrypted snapshots, not a server that reads your live edits.

That's the trade I'd rather offer. Stop encrypting the data the server holds, and stop holding it. Bring your own anchor if you want nobody else to touch your data, or trust ours if you'd rather not think about it. If you want to read the code or stand up your own anchor, it's all there to fork.
