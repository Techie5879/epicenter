# Not Everything Belongs in the Synced Workspace

A local-first substrate makes the synced Yjs workspace the obvious home for every record, and that is the trap. Sync is not free. A CRDT keeps tombstones forever, replicates every write, and stands ready to resolve conflicts that some data never has. Before a new kind of record goes into the synced workspace, ask what sync buys it. For a conversation log the answer is often nothing, and the same app can correctly keep one log in the synced doc and another on the device alone.

There are three homes, and you pick by who writes and who reads.

## Device-local when it is single-writer and device-scoped

Tab-manager keeps its entire chat on the device, in one IndexedDB database, out of the synced workspace. The reasoning is written into the store itself: transcripts are single-writer, device-scoped logs; a tool approval granted on one device is not permission on another; and a future local-model turn may never touch the server at all. Put that in a CRDT and it pays tombstone and sync costs for a conflict that cannot happen, because only one writer ever appends.

The conversation list is not a second table to keep in step. It derives from the messages: a conversation exists once its first message lands, its title and timestamps come from the messages, and deleting it removes the rows. One owner, no denormalized mirror to reconcile.

Reach for device-local when the log has a single writer per entity, carries device-scoped state like approvals, or has a path that never reaches the server.

## Synced when more than one reader needs it live

Zhongwen and opensidian store chat in the workspace doc instead, as `conversations` and `chatMessages` tables, because a second device opening the same workspace should see the history. In zhongwen the client writes each finished assistant message into the synced table, so another device watching the same conversation sees replies appear as they land. When multi-device live view is the feature, sync is doing real work: it is the transport, the persistence, and the conflict-free merge in one layer.

The mechanism for synced chat is in motion right now. The current shape is root-doc tables; in-flight work moves each conversation into its own synced child doc that the server streams into directly, which folds the separate streaming channel back into sync. That choice, tables versus child doc, is a separate decision from this one. The placement question, synced versus device-local, turns on whether another reader needs the data, not on which synced container holds it.

Reach for the synced doc when a different tab, device, or the server itself has to read or write the log live.

## A file when it is a durable, human-editable artifact

The third home is a markdown file, materialized from the workspace. A log that a person should be able to grep, diff in git, rename, or open in another editor wants to be a file, not a row. The substrate already materializes tables to markdown and back, so "store it as a note" is a real option rather than a metaphor. The cost is that a file is coarse: you get a document, not per-field cells, and you give up the typed column that the grid and the SQLite index read.

Reach for a file when the artifact's value is being a plain, portable document a human edits directly.

## The rule

Default to the device, not the doc. Putting a record in the synced workspace is the move you justify, not the one you fall into. A single-writer, device-scoped log belongs on the device. A log a second reader needs live belongs in the synced doc. A log that should be a portable document belongs in a file. The same app can hold all three, and the choice is made once, in writing, next to the schema, so the next conversation feature does not have to rediscover it.
