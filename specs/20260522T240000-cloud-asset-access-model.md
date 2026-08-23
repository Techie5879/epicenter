# Cloud Asset Access Model: Link-Shared via the Encrypted Document

**Date**: 2026-05-22
**Status**: Draft
**Author**: AI-assisted
**Branch**: chore/modernize-monorepo-tsconfig

> This rewrites and replaces an earlier `20260522T230000-cloud-asset-encryption-model.md`
> draft that proposed client-side encryption of asset bytes. That draft was
> retired after grounding it against the Yjs ecosystem's URL-reference
> recommendation and against Epicenter's own infrastructure caps. This
> rewrite commits to the capability-URL model honestly, names its cost, and
> lets the encrypted document carry the reference.

## Overview

An embedded image or file in an Epicenter document is stored in a separate
blob store (R2 today; filesystem on a Bun self-host per
`specs/20260522T220000-api-runtime-portability.md`) and addressed by an
unguessable `assetId`. The `assetId` lives only inside the encrypted Yjs
document. The read endpoint is unauthenticated: knowledge of the `assetId`
is the credential. The bytes are plaintext.

## One-sentence thesis

> The encrypted document protects the reference; the unguessable URL is the
> credential to the bytes; the bytes themselves are link-shared, not encrypted.

## Motivation

### Current State

`apps/api/src/asset-routes.ts` already implements this shape: an authenticated
upload, an unauthenticated read by `<userId>/<assetId>` (the `userId` segment
moves out per the portability spec). The bytes are stored plaintext in R2.
The JSDoc names it: "Read is unauthenticated: the unguessable URL is the
credential, same model as Google Drive 'anyone with the link', Discord CDN,
and Supabase Storage."

### Why the prior encryption draft was retired

The prior draft proposed encrypting asset bytes client-side with the per-subject
keyring. Two findings retired it.

**Yjs guidance** (DeepWiki, `yjs/yjs`, 2026-05-22): the community explicitly
recommends storing binaries by URL reference, not as embedded `Uint8Array`.
`ContentBinary` is atomic and unsplittable; multi-MB binaries are an explicit
DoS concern in the Yjs threat model.

**Epicenter's own caps**:

```
MAX_PAYLOAD_BYTES   = 5 MB   (constants.ts)   one update > 5MB cannot sync
MAX_COMPACTED_BYTES = 2 MB   (room.ts:68)     the DO SQLite per-row limit;
                                                docs > 2MB never compact, the
                                                update log grows unbounded
```

Inlining a 5MB+ image into the Yjs document is not "slow but workable." It
physically does not fit through the sync transport, and the room compaction
stops working forever. A separate blob store is required. Inside that frame,
the asymmetric win is to refuse the encryption pipeline entirely, accept the
link-shared model honestly, and commit to the capability URL. This is the
Notion / Google Docs embedded-image model.

### Desired State

```
client encrypts doc D with subject keyring
  D contains: { assetId, contentType, originalName }

client uploads bytes plaintext  ─>  AssetStore.put(assetId, bytes)
client renders:  <img src="/api/assets/<assetId>">
                    the request fetches plaintext bytes
                    Content-Type from the asset row
                    Referrer-Policy: no-referrer
```

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Asset confidentiality | 2 coherence | Link-shared. Plaintext bytes; the `assetId` is the bearer credential | The encrypted document protects the reference. The unguessable id is ~77 bits, guessing is dead. Industry-standard for embedded media (Notion, Google Docs) |
| Asset read endpoint | 2 coherence | Unauthenticated | The unguessable id IS the credential. Adding auth breaks cross-origin `<img src>` without protecting bytes the operator already holds |
| Inline-in-Yjs for the general case | 1 evidence | Rejected | Yjs's URL-reference recommendation + the 2MB/5MB Epicenter caps. Acceptable only for sub-200KB icons as an opportunistic optimization, not the architecture |
| Server-side encryption of asset bytes | 2 coherence | Refused | Pipeline cost is roughly equal to authenticated-plaintext (both need fetch+blobURL), so the asymmetric win is to refuse encryption entirely and own the link-shared model honestly. See "What this refuses" |
| Content-addressing (`sha256(bytes)`) | 1 evidence | Rejected | Makes the URL computable from content; defeats the bearer-credential model |
| Asset URL shape | 2 coherence | `/api/assets/<assetId>`, no `userId` | Owned by the portability spec; the bearer token is the id |
| Server-side metadata on `asset` row | 3 taste | Keep `id`, `userId`, `contentType`, `sizeBytes`, `originalName`, `uploadedAt` | Bytes are plaintext anyway; no privacy gain from hiding metadata. Useful for admin and quota |
| `Referrer-Policy: no-referrer` on asset responses | 3 taste | Add | Free, removes one leak vector |
| MIME allow-list + size gate | n/a | Keep, server-side (as today) | Server sees plaintext bytes; validation works |
| Future signed-URL / encryption feature | Deferred | Deferred | If a real privacy or compliance requirement appears, write that spec then. Do not build it speculatively |

## What this refuses, named honestly

- The bytes are **plaintext at rest**. The deployment operator (Epicenter on
  Cloud, the org on self-host) can read user images. A bucket leak or backup
  theft exposes images.
- The `assetId` appears in Worker / CDN request logs and the browser network
  tab the moment a `GET /api/assets/<id>` happens. Anyone with access to those
  logs plus the unauthenticated read endpoint can fetch the image.
- The document text is encrypted per subject. An embedded image is **not**.
  This is the inconsistency. It is acceptable only because it is named: in
  the product UX, embedded files are "link-shared, not end-to-end-encrypted."

What is *not* refused, and remains intact:

- The unguessable `assetId` (~77 bits) makes brute-force enumeration infeasible.
- The primary storage channel for the `assetId` is the encrypted document.
  Logs leak the id at fetch time; nothing else exposes it.
- Documents and rooms remain per-subject encrypted (this spec changes nothing
  there).
- The R2 bucket is private; all reads are proxied through the Worker, which
  sets security headers (`asset-routes.ts` JSDoc).

## Architecture

```
UPLOAD
──────
client                            api worker / bun                postgres + store
──────                            ───────────────                 ─────────────────
authed POST /api/assets
file -> bytes ──────────────────> MIME check, size cap
                                  billing/quota gate
                                  assetId = nanoid(15)
                                  AssetStore.put(assetId, bytes) -> R2 / fs
                                  asset row { id, userId, contentType,
                                              sizeBytes, originalName }
                                                                     201 { assetId }

client encrypts doc D; stores { assetId, contentType, originalName } INSIDE
the encrypted Yjs doc. The assetId is born inside ciphertext.


READ
────
client decrypts doc; learns assetId.

  <img src="/api/assets/<assetId>">
        │
        ▼
  GET (unauthenticated) /api/assets/<assetId>
        │
        ▼
  AssetStore.get(assetId) -> bytes
  Content-Type: <from asset row>
  Referrer-Policy: no-referrer
  Cache-Control: private, max-age=...
  Accept-Ranges: bytes
        │
        ▼
  bytes -> <img> renders
```

`AssetStore` (defined by the portability spec) stores and returns **opaque
bytes**. No encryption, no chunking, no AEAD. Range requests, conditional
GET, and ETag all work because the bytes are plaintext.

## Edge Cases

### Referer behavior

When a page containing `<img src="/api/assets/abc">` renders, the *image
fetch* sends a `Referer` header containing the page URL to the asset host.
That discloses information about the embedding page, not about the asset URL.
The asset URL itself does not leak via Referer because the asset is the
*target* of the fetch, not its source. `Referrer-Policy: no-referrer` is set
on the asset *response* so that any subsequent navigation initiated from the
asset does not carry the asset URL onward.

### Asset URL in browser cache and history

`<img src>` URLs land in the browser disk cache, devtools network tab, and
(if directly navigated to) browser history. This is normal capability-URL
behavior. Mitigation: do not paste asset URLs into chat or external surfaces;
treat them as semi-private.

### `assetId` in logs

The `assetId` appears in Cloudflare access logs as part of the request line.
Log retention defines the leak window. Mitigation: route asset traffic away
from broadly-readable observability streams; treat asset logs as PII-adjacent.

### Asset URL persistence in clients (greenfield)

Grep on 2026-05-22 confirmed zero references to `api/assets` or `assetId`
anywhere outside `apps/api`. No client persists or consumes an asset URL
today. The `/api/assets/<userId>/<assetId>` to `/api/assets/<assetId>` shape
change has no migration cost.

## Open Questions

1. **When does signed-URL / expiry get added.**
   - Today: unauthenticated, no expiry.
   - Future trigger: a real privacy or compliance requirement, or evidence
     that asset URLs leak in practice.
   - **Recommendation**: deferred. Do not build speculatively.

2. **Opportunistic inline-in-Yjs for sub-200KB icons.**
   - Tiny images could be inlined as a binary field in the Yjs doc and
     inherit document encryption for free.
   - **Recommendation**: opportunistic, not architectural. If a small-image
     use case appears, add it as a separate workspace field type; do not
     promote it to the asset model.

## Decisions Log

- Refuse encryption of asset bytes for v1: the asymmetric win is the deletion
  of the entire client decrypt pipeline, the blob-URL lifecycle, the
  decrypted-asset cache, and the chunked-AEAD-vs-range-request tension.
  Revisit when: a real privacy or compliance requirement appears, or asset
  URLs are observed leaking in production.
- Keep the unauthenticated read endpoint: once the credential is the id, auth
  only re-checks something the id already proves, and it breaks cross-origin
  `<img src>`. Revisit when: existence-hiding (not confidentiality) becomes a
  real requirement.

## Success Criteria

- [ ] `GET /api/assets/<assetId>` returns plaintext bytes from an
  unauthenticated request.
- [ ] No `userId` in the URL. The `userId` lives only on the `asset` row.
- [ ] The upload response returns `{ assetId }`; the client stores it inside
  the encrypted document.
- [ ] `Referrer-Policy: no-referrer` is on every asset response.
- [ ] The R2 bucket stays private; all reads go through the Worker.
- [ ] The product UX names the link-shared model where users embed assets.

## References

- `specs/20260522T220000-api-runtime-portability.md` - owns the `AssetStore`
  contract (opaque bytes in, opaque bytes out) and the flat asset URL.
- `specs/20260522T200000-cloud-workspace-ownership-model.md` - the per-subject
  ownership model; the document encryption that protects the `assetId`.
- `apps/api/src/asset-routes.ts` - the current implementation (already this
  shape, modulo the URL flattening and the `Referrer-Policy` header).
- DeepWiki `yjs/yjs` (2026-05-22) - the URL-reference recommendation for
  binary content; the Yjs threat model on large updates.
- `apps/api/src/room.ts:68`, `apps/api/src/constants.ts` - the
  `MAX_COMPACTED_BYTES = 2MB` and `MAX_PAYLOAD_BYTES = 5MB` caps that bound
  any inline-in-Yjs approach.
- `.claude/skills/greenfield-clean-breaks` - the asymmetric-wins pass that led
  to refusing the encryption pipeline.
