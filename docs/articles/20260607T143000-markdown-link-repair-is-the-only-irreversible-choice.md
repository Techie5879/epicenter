# In a Folder of Markdown Notes, the Link Syntax Is the Only Thing You Can't Undo

Pick plain relative path links for your notes and you can change your mind about everything else later: identity, frontmatter, indexes, tooling. Pick a custom `note:` scheme and you have rewritten every file the day you regret it. The link syntax inside the body is the one decision that is expensive to reverse, and it is also the easy one to get right.

You probably already trust this pattern for code. Open your editor settings:

```jsonc
"javascript.updateImportsOnFileMove.enabled": "always",
"typescript.updateImportsOnFileMove.enabled": "always",
```

Move a `.ts` file in the Explorer and VS Code rewrites every import that pointed at it. Markdown has the exact same feature, and it ships turned off:

```jsonc
"markdown.updateLinksOnFileMove.enabled": "always"
```

With that one line, renaming `best-mic-setup.md` to `studio-mic-setup.md` rewrites both the moved file's outbound links and every inbound `[Mic Setup](./best-mic-setup.md)` in the rest of the folder. VS Code indexes markdown links the same way it indexes TypeScript symbols, so "update on move" is the same machinery as "rename symbol."

## Three link shapes, and only one your tools already read

A note that points at another note can spell that link three ways:

```
[Mic Setup](./best-mic-setup.md)                   plain path:  VS Code clicks it, ripgrep follows it
[Mic Setup](note:01JX7Z9K...)                       custom id:   dead link in VS Code, needs a resolver
[Mic Setup](epicenter://vault/notes/01JX7Z9K...)   uri:         same problem, fancier hostname
```

The custom id and the URI are rename-proof: the target never moves because the id never changes. That is real, and it is why Denote and Obsidian lean on id-style links. But both are dead weight to a plain Markdown reader. VS Code renders `note:01JX...` as inert text with no preview and no go-to-definition. A coding agent can grep the id but cannot open the file without a resolver you have to build and keep fed. The plain path is the only form all three of your readers understand for free: the editor, the agent, and your own app.

So the trade is honest. Id-links never break but are hostile to normal tools. Path links are native to every tool but break when the file is renamed. The question is just how expensive that breakage is, and the answer is: less than it looks.

## Renames cluster exactly where breakage is free

Watch when a note actually gets renamed. It is renamed when its name is still wrong, which is when it is young, which is when nothing points at it yet.

```
note age:        young ───────────────────────────► mature
slug churn:      HIGH (still naming it)                LOW (name settled)
inbound links:   ~0 (nothing points here yet)          growing
                 ▲                                      ▲
                 renames happen HERE                    links accumulate HERE
                 breakage cost = 0                      renames have ~stopped
```

The dangerous quadrant, renaming a heavily linked note, is the rare one. The common rename fixes a one-day-old draft that nothing references. So the cost of "path links break on rename" is concentrated in the moment it costs nothing.

For the rare case that does cost something, three different tools already repair it. VS Code does it on Explorer renames with the setting above. A coding agent does it with `rg -l` plus a replace, because it has the whole folder in front of it. And your own app, if it owns the rename, repairs links in the same command that does the move.

## The filename prefix is the identity, and the repair key

Here is the part that makes path links safe enough to commit to. Give every captured note a timestamp prefix, the way every screenshot and voice memo on your machine is already named:

```
20260607T143000-why-local-first-wins.md
└──────┬──────┘ └─────────┬────────┘
   IDENTITY            SLUG
   immutable           a hint; rename it freely, leave it "untitled" forever
```

This is the Denote scheme: the creation timestamp is the file's identifier, and the title-slug after it is a label you are free to change. You would want this prefix even if you never linked two notes, because naming a fresh voice dump is friction and a timestamp is the obvious default. That it also pins identity is a bonus you do not pay for.

And because the prefix lives inside the link, repair stays deterministic even when VS Code is not the one renaming:

```
rename   20260607T143000-why-local-first-wins.md  ->  20260607T143000-the-local-first-bet.md
         └──────┬──────┘ prefix unchanged = identity preserved

repair   for each body, replace the old link target with the new one.
         the prefix says which file each link meant, so there is no "did they mean this note?" guess.
```

A title-only filename cannot do that. Rename `mic-setup.md` to `studio-mic.md` and a repair tool has to guess which note an old link meant. With the prefix, the link `[x](./20260607T143000-anything.md)` still names exactly one file no matter what the slug says.

## What to actually do

Turn on `markdown.updateLinksOnFileMove.enabled` at the user level so it follows you across machines through Settings Sync, and commit it in the repo's `.vscode/settings.json` so the behavior travels with the folder to every clone and every collaborator. Write links as plain relative paths. Let captured notes carry a timestamp prefix and let the slug after it be as rough as you like. Do not invent a `note:` scheme, do not sprinkle opaque ids into frontmatter, and do not build a link registry: the editor, ripgrep, and your app already give you three independent ways to repair the rare rename that matters.

The reason this works is not cleverness. It is that the only choice you cannot cheaply walk back, the link syntax in the body, is also the choice that makes VS Code and a coding agent happiest. The easy call and the irreversible call are the same call. Make it once and defer the rest.
