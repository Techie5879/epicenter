# Your documents belong to you, not to a workspace

When I was building Epicenter, one of the biggest challenges was the logical separation of accounts. Who owns a document? I took my first answer from Notion, spent a while fighting it, and took my real answer from Google Docs. The whole difference is one decision: Notion makes a single "workspace" own your content and your billing at the same time, and Google keeps those two things apart.

Here is what the Notion-shaped version looked like inside Epicenter. The moment a user signed up, they got a personal "workspace":

```ts
// the personal workspace id, derived straight from the user id
const hash = await sha256Hex(`personal-cloud-workspace:${userId}`);
return { workspaceId: `ws_${hash.slice(0, 32)}` };
```

```ts
// signup hook: every new user becomes an organization of one
await createPersonalCloudWorkspace(store, user);
//   -> one organization row, one member row
```

I leaned on Better Auth's organization plugin to do this, and I want to be fair to it: the plugin is genuinely good. It hands you organizations, members, roles, invitations, and RBAC, all tested, none of it code I have to write or maintain. If you are going to be workspace-first, it is the obvious tool to reach for. So every user became an organization with exactly one member, and every document lived inside that organization. Notion does roughly this. It felt like the grown-up choice.

## The tell: I was asking permission to read my own notes

It worked. It also felt wrong, and it took me a while to say why.

To open one of my own documents, the server resolved my personal workspace from my token and then ran a membership check: am I a member of my own workspace? That check has exactly one way to fail.

```ts
if (workspaceId == null) {
  return { error: {
    name: 'PersonalWorkspaceMissing', status: 409,
    message: 'This is an account provisioning bug; please contact support.',
  }};
}
```

The only way that check fails is if the system itself broke. I was paying a database round-trip, on every document open, to confirm that I am myself. And the id I was looking up, `ws_${sha256(userId)}`, was just my user id run through a hash. It held no information my user id did not already hold. It was a second name for a thing I was already carrying.

That is what workspace-first does when there is only one person in the room. The "workspace" becomes a costume the user wears so the rest of the system has something to talk to. The funny part is that I had already written the right answer down. Before all of this, there was a comment in the codebase explaining why Epicenter used owner-scoped names and not org-scoped ones, and it ended with the line "org tables and Better Auth organization plugin are unnecessary overhead." Past me knew. Then I built the overhead anyway.

## Google already solved this, and it solved it twice

So I went and looked at how Google Docs actually works, and the thing that jumped out is that Google Docs and Google Workspace are two different products, and the split between them is the entire answer.

Consumer Google Docs: a document is owned by a user account. Sharing is a per-document access list, "share this doc with these people." There is no container the document lives inside. Your Drive is just your documents.

Google Workspace is the paid product: a domain like `acme.com`, an admin console, per-seat billing. It administers a set of user accounts. It never becomes the owner of a document. Content ownership lives in one layer, and billing and administration live in another.

Notion fuses those two layers into the workspace. Google keeps them apart. I had copied the fused version, and the personal-workspace-of-one was the bill for it.

So Epicenter went to the Google Docs model. A document is owned by an owner, and for a personal account that owner is just the user:

```
owners/${userId}/rooms/${ydoc.guid}
```

No workspace. No membership check. The token already says who you are, and for your own documents that is the whole authorization story. Sharing, when it comes, follows the same Google Docs shape: the document keeps its name, and an access list grants other owners in.

## What about teams? Google answers that one too

The honest objection is teams. Per-user ownership is great until someone quits and you need their work to stay with the company. Pure per-document access lists cannot answer "the org keeps the docs when the employee leaves."

Google hit this exact wall and added Shared Drives: a place where the organization owns the content, not the user. Notice what they did not do. They did not go back and rebuild consumer Docs around it. Shared Drives is an enterprise feature layered on top. Personal docs stayed personal.

That gives Epicenter a clean three-layer plan, and only the first layer ships now:

```
Layer 3   tenancy and billing      acme.com, seats, admin       (Google Workspace)
Layer 2   shared-drive content     docs an org owns             (Google Shared Drives)
Layer 1   personal content         owner owns the doc + ACL     (Google Docs)
```

Layer 1 is what Epicenter does today: your documents are yours. Layer 2 is org-owned content for the day an enterprise needs work to outlive an employee. Layer 3 is the billing and admin grouping for enterprise seats, and that is where the Better Auth organization plugin comes back, in the job it was actually built for.

The organization plugin was never the mistake. Putting it underneath my documents was. It belongs around accounts, not under content. Get that boundary right and a single-tenant enterprise deployment is just the same software running with one organization in it, instead of a second codebase. Get it wrong, the way I first did, and every solo user pays for an organization they never asked for and will never see.
