# Prelaunch Reset Runbook

**Date**: 2026-05-31
**Status**: Draft
**Owner**: Braden
**Source Spec**: `specs/20260528T222820-clean-reset-and-workspace-schema-collapse.md`

## One Sentence

Reset the prelaunch hosted Epicenter cloud and local app replicas after the
workspace schema collapse, using the Drizzle baseline migration for Postgres
and explicit cleanup steps for every other store.

## Approval Gate

Do not execute this runbook until Braden gives final explicit approval for the
destructive reset.

Approval must cover:

- Postgres rebuild
- OAuth client reseed
- `SESSION_KV` clear
- R2 object deletion
- Durable Object room storage deletion or abandonment
- Autumn customer cleanup keyed by old `user.id`
- local IndexedDB and app data wipe

## Preconditions

- The code cleanup branch is reviewed and ready to deploy.
- All current hosted and local app data is disposable.
- Infisical access works for `/ops` and `/api` production secrets.
- Wrangler is authenticated against the correct Cloudflare account.
- Autumn dashboard or API access can find customers by old `user.id`.
- Local browsers and desktop apps can be wiped after cloud cleanup.

## 1. Postgres Rebuild

Use the committed Drizzle baseline migration, not `drizzle-kit push`.

Plan:

1. Stop or avoid live app traffic during the reset window.
2. Connect with the production admin database URL.
3. Drop and recreate the production database, or drop all app-owned schemas and
   recreate them from zero.
4. Run the committed baseline migration from `apps/api/drizzle`.
5. Verify the migration journal and core table counts.

Command shape:

```bash
cd apps/api

# Destructive: run only after approval with the admin database URL.
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB_NAME?sslmode=require'

psql "$DATABASE_URL" <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL

bun x drizzle-kit migrate
```

Verification:

```bash
cd apps/api
psql "$DATABASE_URL" <<'SQL'
\dt public.*
SELECT count(*) AS migration_count FROM drizzle.__drizzle_migrations;
SELECT count(*) AS oauth_client_count FROM public.oauth_client;
SQL
```

Expected result:

- Better Auth tables exist.
- OAuth client table exists but is empty until reseed.
- App tables exist from migrations.
- `drizzle.__drizzle_migrations` has one row for `0000_thin_the_captain`.
- `oauth_client` is empty until the reseed step runs.

## 2. OAuth Client Reseed

The seed script is idempotent and projects trusted OAuth clients from code.

Command:

```bash
cd apps/api
bun run oauth:seed:remote
```

Verification:

- The script reports seeded first-party OAuth clients for `https://api.epicenter.so`.
- PKCE sign-in and CLI OAuth flows can complete after deploy.

## 3. SESSION_KV Clear

Clear the Better Auth secondary session cache.

Binding:

```txt
SESSION_KV
namespace id: a67bda23b98441bfa9f56c2ca2e8e1de
```

Plan:

1. List keys in the production namespace.
2. Delete every key, or recreate and rebind the namespace if Cloudflare tooling
   makes that safer.
3. Verify the namespace is empty.

Command shape:

```bash
cd apps/api

# Destructive: delete keys only after approval.
wrangler kv key list --namespace-id a67bda23b98441bfa9f56c2ca2e8e1de
wrangler kv key delete "<key>" --namespace-id a67bda23b98441bfa9f56c2ca2e8e1de
```

For many keys, use a small script that pages through `wrangler kv key list` and
deletes each returned key. Keep the key list as reset evidence.

## 4. R2 Object Cleanup

Bucket:

```txt
epicenter-assets
binding: ASSETS_BUCKET
```

Plan:

1. List current objects.
2. Delete all objects in the bucket.
3. Verify the bucket is empty.

Command shape:

```bash
cd apps/api

# Destructive: run only after approval.
wrangler r2 object list epicenter-assets
wrangler r2 object delete epicenter-assets/<object-key>
```

For many objects, use a script that pages through object listing and deletes
each key. Keep before and after counts.

## 5. Durable Object Room Storage

Durable Object room storage contains the Yjs update logs. It is not reset by
rebuilding Postgres.

Binding:

```txt
ROOM
class: Room
```

Decision required before execution:

- Delete room storage if a supported and tested tool exists for this deployment.
- Otherwise intentionally abandon old room objects by starting from fresh owner
  IDs and room names after the Postgres reset.

Deletion path, if tooling exists:

1. Enumerate old room names from the pre-reset Postgres room metadata.
2. Resolve each name through the `ROOM` namespace.
3. Call a reviewed admin-only cleanup endpoint or maintenance script that runs
   `ctx.storage.deleteAll()` for that object.
4. Verify old room snapshots no longer return data.

Abandonment path:

1. Document that old Durable Objects remain unreachable prelaunch residue.
2. Confirm the Postgres reset creates new `user.id` values.
3. Confirm room names include the new owner id.
4. Verify old local clients are wiped before reconnecting.

Do not invent a production admin route during the reset window. If deletion
tooling is missing, choose intentional abandonment and record it.

## 6. Autumn Customer Cleanup

Autumn customer state is keyed by old `user.id`, so a Postgres reset can strand
customers and balances.

Plan:

1. Export or list Autumn customers whose id matches old Epicenter `user.id`
   values.
2. Delete, archive, or mark them inactive according to Autumn's supported
   workflow.
3. Verify a fresh sign-in creates a fresh customer for the new `user.id`.

Command shape:

```bash
cd apps/api

# Use Autumn dashboard or an approved Autumn API script.
# Do not run blind deletes. First list the exact customer ids.
```

Evidence to keep:

- Old customer ids selected for cleanup.
- Cleanup action taken for each old id.
- Fresh customer id after reset.

## 7. Local IndexedDB And App Data Wipe

Old local replicas can reintroduce stale rows into fresh cloud rooms if they
reconnect after the reset.

Wipe all local development app storage before signing in again:

- Fuji browser IndexedDB and local storage.
- Honeycrisp browser IndexedDB and local storage.
- Whispering browser IndexedDB and local storage.
- Whispering desktop app local data.
- Tab Manager extension storage.
- Any other Epicenter workspace app used during development.

Verification:

- Fuji opens with no entries.
- Honeycrisp opens with no notes.
- Whispering opens with no recordings.
- Creating a new row writes the latest-only table shape.
- Sync works across two fresh browser or device contexts.

## Final Smoke Test

Run after all cleanup steps:

- Hosted API health endpoint returns 200.
- Sign-in works.
- OAuth clients complete PKCE.
- `/api/session` returns a new user and owner keyring.
- R2 bucket is empty before new uploads.
- `SESSION_KV` contains only sessions created after the reset.
- No old `ownerId` appears in Postgres app tables.
- Billing dashboard creates or reads a new Autumn customer.

## Stop Conditions

Stop and ask before continuing if:

- The production database cannot be rebuilt from Drizzle migrations.
- OAuth reseed fails.
- Wrangler points at an unexpected account or namespace.
- Durable Object deletion tooling is missing and abandonment has not been
  explicitly accepted.
- Autumn customer ids cannot be matched confidently to old `user.id` values.
- Any local app data contains user data that is not disposable.
