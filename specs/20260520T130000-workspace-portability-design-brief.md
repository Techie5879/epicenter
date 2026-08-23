# Workspace Portability Design Brief

**Date**: 2026-05-20
**Status**: Worth committing

Revision note, 2026-05-20: `specs/20260520T190000-cloud-workspace-app-instance-clean-break.md` supersedes this brief for Cloud naming. The portability requirements still stand, but in Cloud the portable app-data boundary is App Instance. The top-level Cloud Workspace is now the product account, membership, policy, and billing container backed by Better Auth organization.

## Purpose

This brief captures the broader requirements behind the Workspace Capsule work. It should guide open-ended design iteration before implementation.

The goal is not to lock in exact names, file paths, archive filenames, table names, or first-pass API shapes. The goal is to find the simplest durable model where a Workspace is a portable logical boundary that can survive cloud hosting, local hosting, export, import, encryption, sharing, and future enterprise policy.

## Core Intuition

```txt
Workspace = portable data capsule
Deployment = live runtime and access boundary
App = owner of its own data model
Room = live sync runtime for one Yjs document
Archive = runtime-independent portable representation
```

A Workspace should feel like the thing a person can move, unlock, back up, restore, share, or self-host.

Everything else exists to support that sentence.

## What A Workspace Enables

A Workspace gives the system one durable answer to these questions:

```txt
What data moves together?
What data syncs together?
What data is unlocked together?
What data is exported together?
What data can be shared together?
What data can later move to a different host?
```

This makes Workspace a product and data boundary, not a storage format.

## Important Non-Decisions

Do not treat these as settled by this brief:

- The root archive metadata filename. `workspace.json` is plausible, but not final.
- The exact archive folder layout.
- Whether doc payload files are named `.yjs`, `.yjsv2`, `.bin`, or something else.
- Whether checksums live inline, in a separate file, or are replaced by content-addressed blobs.
- Whether inventory is called inventory, index, catalog, manifest, or something else.
- Whether a WorkspaceCoordinator Durable Object is ever needed.
- Whether app entry docs remain convention-derived forever or become stored rows later.
- Whether full export is app-provided, inventory-based, registry-based, or hybrid.
- Whether organizations become a first-class product layer.

The design should keep these choices open until pressure tests force a decision.

## Required Properties

### Logical Boundary

The Workspace must not collapse into any single implementation detail.

```txt
Workspace is not:
  one Yjs document
  one Durable Object
  one SQLite file
  one app installation
  one user account
  one organization
```

### Runtime Independence

The same logical Workspace should be able to hydrate into different runtime shapes.

```txt
Cloudflare host:
  control database
  document Room Durable Objects
  asset object storage

Local host:
  local control database or files
  local Yjs stores
  local asset files

Archive:
  portable metadata
  portable Yjs document payloads
  portable asset payloads
  encryption metadata
```

The archive format should not require understanding Cloudflare Durable Object storage or a local SQLite schema.

### App-Owned Graphs

Apps own their internal document strategy.

```txt
Whispering today:
  one app entry Y.Doc
  tables and KV inside that doc
  audio blobs outside the doc

Fuji-style app:
  app entry doc
  child content docs referenced by rows

Future app:
  many peer docs
  or one doc
  or local-only docs
```

The platform may need a stable app entry point, but it should not force every app into a root-plus-children hierarchy.

### Honest Enumeration

Complete Workspace export requires some way to know which documents belong to the Workspace.

Possible discovery sources:

```txt
app-provided graph discovery
  app reads its own entry docs and lists child docs

platform-observed inventory
  sync layer records docs it has seen

mandatory registry
  every remote doc must be declared in control data

local storage scan
  local runtime enumerates files or tables it physically has
```

The design should prefer the least powerful mechanism that can honestly satisfy the export story.

Open question:

```txt
Can a thin observed inventory plus app export adapters satisfy real export needs without becoming a behavioral registry?
```

### Portable Archive

The portable artifact should describe logical data, not runtime storage.

Candidate contents:

```txt
root metadata file
key metadata file
docs/
  portable Yjs document payloads
assets/
  asset metadata
  asset blobs
app metadata/
  app-provided export metadata when needed
```

Likely default for Yjs documents:

```txt
compact Yjs V2 state update
```

But the design should still pressure-test:

```txt
compact Yjs state update
raw Yjs update log
runtime SQLite file
provider-specific IndexedDB export
hybrid backup plus portable export
```

### Assets

Assets should be portable and first-class.

The design must explain:

```txt
How app data references an asset
Whether asset ids are stable across import
Whether blobs are stored by asset id, hash, or both
How content type and size are recorded
How missing or corrupted blobs are detected
Whether assets are encrypted with the same Workspace key model
```

### Identity And Names

Workspace identity and display naming must be explicit, but the exact representation is open.

The design should decide or defer:

```txt
What is the stable source Workspace id?
When does import preserve that id?
When does import create a new id?
How are doc ids scoped?
Can two workspaces contain the same doc id?
Can the outer folder or archive filename be trusted?
How do names differ from ids?
```

Working intuition:

```txt
id = stable logical identity
name = user-facing label
folder or zip name = transport convenience
```

This intuition is not final. It should be tested.

### Encryption And Unlock

The design must separate passwords from keys.

Required rule:

```txt
Never store the raw password.
Never store raw workspace key material unless the export is explicitly unencrypted.
```

Candidate model:

```txt
password, passkey, account key, or device key
  -> wrapping key
    -> unwraps workspace key
      -> decrypts docs and assets directly or through derived keys
```

The design should explain:

```txt
What lives in the archive
What the user knows
What the server can see
How password change works
How a new device gets access
How another member gets access
How self-host import handles keys
Whether docs, assets, or individual values are encrypted
```

### Sharing

Workspace is the natural sharing boundary.

Examples:

```txt
Personal workspace:
  one owner
  multiple devices
  private data

Team workspace:
  multiple members
  shared app data
  shared assets
  role or policy layer
```

The design should keep this distinction clean:

```txt
Workspace owns portable data.
Deployment owns live access checks.
Organization, if present, owns policy and billing.
```

Membership may be stored in Postgres for cloud and `control.sqlite` for self-host, but it should not be confused with app data inside the Workspace.

## Example Scenarios To Pressure-Test

### Personal Power User

```txt
User:
  Braden

Workspaces:
  Personal

Apps:
  Whispering
  Tab Manager
  Email

Needs:
  sync across devices
  encrypted backup
  import onto a new machine
  no team policy required
```

### Team Workspace

```txt
Workspace:
  Acme Research

Members:
  Braden owner
  Alice editor
  Sam viewer

Apps:
  Whispering meeting transcripts
  Tab Manager research sessions
  Email shared notes or shared mailbox cache

Needs:
  role-based access
  member key wrapping
  export by owner
  possible future admin policy
```

### Whispering-Only Workspace

```txt
Workspace:
  Voice Notes

Apps:
  Whispering

Data:
  one app entry Y.Doc
  recording metadata and transcripts
  audio blobs
  transformations
  synced settings

Question:
  Does this need more than one Yjs document?
```

### Self-Hosted Enterprise

```txt
Deployment:
  company-owned host

Control:
  local or hosted control database
  users
  sessions
  memberships
  policy

Workspaces:
  team or department capsules

Needs:
  stronger auditability
  stricter inventory
  backup and restore
  possible admin-controlled export
```

## Design Questions

Answer these before implementation:

1. What is the minimum portable archive that can restore a Workspace into cloud or local runtime?
2. Which metadata is logical Workspace metadata, and which metadata belongs to a specific host?
3. Does every app need an entry doc, or only apps that sync through Epicenter?
4. Is an app entry doc a convention, a stored row, or an app-provided export hook?
5. Can a thin observed inventory support export without becoming a mandatory registry?
6. What does "complete export" mean for cloud, local, and offline-created docs?
7. What does "best known export" mean, and is that acceptable anywhere?
8. Which parts of an archive are encrypted?
9. How does a password unlock data without being stored?
10. How does multi-device key access work?
11. How does member sharing wrap or grant Workspace keys?
12. How should import handle id collisions?
13. How much member metadata should an archive carry?
14. What should happen when importing a team Workspace into a personal host?
15. What should happen when importing a personal Workspace into a team host?
16. Which names make the product simpler, and which names create fake precision?

## Candidate Evaluation Criteria

Prefer a candidate design when it:

- Uses fewer product nouns.
- Keeps Workspace as a logical boundary.
- Keeps app graphs app-owned.
- Makes export/import honest.
- Avoids Cloudflare-specific archive assumptions.
- Avoids local SQLite-specific archive assumptions.
- Gives individual users a simple default.
- Allows sharing later without a second data model.
- Allows self-hosting later without changing Workspace identity.
- Explains encryption in terms a careful engineer can reason about.

Reject or revise a candidate when it:

- Makes a Durable Object equal a Workspace.
- Makes one Yjs document equal a Workspace.
- Requires every offline child doc to call the server before it can exist.
- Treats a folder name as the source of identity.
- Hides incomplete export behind confident language.
- Puts live auth policy only inside app data.
- Introduces new nouns without deleting confusion.

## Expected Output From The Iteration

The final design pass should produce:

- A revised Workspace Capsule spec.
- Two concrete product examples: personal and team.
- One concrete Whispering example based on the current app.
- A chosen or explicitly deferred archive root metadata name.
- A chosen or explicitly deferred archive layout.
- A chosen or explicitly deferred enumeration model.
- A chosen or explicitly deferred encryption and unlock model.
- A clear split between deployment control data and portable Workspace data.
- A list of decisions that remain intentionally open.
- No implementation unless explicitly requested.
