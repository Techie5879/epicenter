# Each Epicenter Server Is One Organization

When I started building Epicenter, one of the hardest questions was where organization boundaries go. Who can see what, who is on which team, how access gets scoped. I went down the usual path for a while: an org table, a members table, the Better Auth organization plugin, all the wiring that comes with it.

Then I realized the boundary I wanted already existed. Epicenter Cloud is itself one big organization. Every user on it is a personal user inside that one org. So if you want a different organization boundary, you do not need any of the wiring. You deploy another server.

```
Epicenter Cloud      one server, one organization. everyone on it is a
                     personal user. I run it.

Acme's server        another server, another organization. only Acme's
                     people. Acme runs it, or I run it for them.
```

Each server is one logical organization boundary. Same code, different deployment. It is the same split as GitLab.com and self-hosted GitLab: one piece of software, a public instance and private ones. If Google Drive is a more familiar reference, this is the same distinction it draws between a personal account and a Workspace account.

This was not just the simplest option. It is the one that actually fits how Epicenter works under the hood, and the reason is synchronization.

## Granular access control is hard with Yjs

Epicenter syncs documents with Yjs, which is a CRDT. A document is one shared stream of updates, and there is no such thing as half of it.

```
one Yjs document = one shared update stream
   you get the whole stream, or nothing. no partial visibility.
   so the only natural unit of access is the whole document.
```

That makes fine-grained access control genuinely hard. I cannot say "Bob sees these three fields but not the other two" inside one Yjs document, because the sync protocol has no notion of partial visibility. The unit of access is the whole document, and the check is binary: can you connect to this document's room, or not.

Encryption makes it sharper. Each document is encrypted, so "can you see it" really means "can you decrypt it." The moment a document has more than one reader, I am wrapping a key for each of them, rotating keys when someone leaves, and storing the copies somewhere safe. That is a real key-management project, and it is the kind of thing you do not want to half-build.

So I stopped fighting it. If granular access control fights Yjs, and per-document key management is a project I do not want to own for everyone, then the honest boundary is the coarsest one: the whole server. One deployment, one key, one set of users.

## If you are in the org, you can access everything

Inside an organization, that is the whole rule. If you are on the server, you can access what is on it. There is no per-document ACL, no role matrix, no sharing dialog.

It is not the most high-fidelity way to manage access. It is the most honest one. The boundary is a server, a thing you can point at and reason about, instead of an ACL table I am hoping I wired correctly. And when someone leaves, the organization still has everything, because the content was always on the organization's own server, under the organization's own key.

## This also solves privacy and encryption at once

Splitting organizations by deployment kills two birds with one stone.

Most organizations that care about this level of privacy do not really want to manage their org on someone else's cloud. They would rather run it themselves. I would rather make self-hosting easy than build an admin console, so that lines up well.

And it collapses the encryption problem. Every organization manages its own keys, server-side, in its own deployment. I am not holding a directory of everyone's keys and rotating them on a shared cloud. Acme holds Acme's key in Acme's environment file. I never see it, and I never have to manage it. Key management is hard, and the easiest way to do it well is to not do it for everyone at once.

I will be honest that part of the appeal is that this is just easier for me. One codebase deployed more than once is far less to get wrong than a multi-tenant org system with its own access layer. But it is not only easier. It is also the version I would actually trust.

So "organizations" in Epicenter is not a feature I build. It is a server you run. Epicenter Cloud is the one I run for everyone. If you want your own boundary, the answer is a deployment, and my job is to make that deployment easy. The full design is written up in a spec in the repo if you want the details.
