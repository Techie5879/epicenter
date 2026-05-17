/**
 * Honeycrisp workspace contract: schema, branded IDs, shared opener, and
 * cross-table action factory.
 *
 * Distribution: this file is the `@epicenter/honeycrisp` package root export.
 * It stays browser-safe because the SPA, daemon, and scripts all import it.
 * The table shapes here are the wire contract for sync; forking a column
 * shape breaks sync compatibility with peers running the canonical schema.
 * Recipes (browser.ts, daemon.ts) compose around this opener and are yours
 * to edit freely.
 */

import {
	DateTimeString,
	defineActions,
	defineMutation,
	defineTable,
	docGuid,
	type InferTableRow,
	type LocalOwner,
	type Tables,
} from '@epicenter/workspace';
import { type } from 'arktype';
import Type from 'typebox';
import type { Brand } from 'wellcrafted/brand';
import * as Y from 'yjs';

export const HONEYCRISP_WORKSPACE_ID = 'epicenter.honeycrisp';

// ─── Branded IDs ──────────────────────────────────────────────────────────────

/**
 * Branded note ID: nanoid generated when a note is created.
 *
 * Prevents accidental mixing with other string IDs at compile time.
 */
export type NoteId = string & Brand<'NoteId'>;
export const NoteId = type('string').pipe((s): NoteId => s as NoteId);

/**
 * Branded folder ID: nanoid generated when a folder is created.
 *
 * Prevents accidental mixing with other string IDs at compile time.
 */
export type FolderId = string & Brand<'FolderId'>;
export const FolderId = type('string').pipe((s): FolderId => s as FolderId);

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * Folders table: organizational containers for notes.
 *
 * Each folder has a name, optional emoji icon, and sort order for manual
 * reordering in the sidebar. Notes reference folders via `folderId`.
 */
const foldersTable = defineTable(
	type({
		id: FolderId,
		name: 'string',
		'icon?': 'string | undefined',
		sortOrder: 'number',
		_v: '1',
	}),
);
export type Folder = InferTableRow<typeof foldersTable>;

const noteBase = type({
	id: NoteId,
	'folderId?': FolderId.or('undefined'),
	title: 'string',
	preview: 'string',
	pinned: 'boolean',
	createdAt: DateTimeString,
	updatedAt: DateTimeString,
});

/**
 * Notes table: individual notes with rich-text bodies.
 *
 * Each note belongs to an optional folder (unfiled if `folderId` is undefined),
 * has a title auto-populated from the first line of content, a preview for the
 * list view, and can be pinned to appear at the top of the note list.
 *
 * v2 adds `deletedAt` for soft delete: notes move to "Recently Deleted"
 * instead of being permanently destroyed. The field is `undefined` for active
 * notes and a `DateTimeString` for deleted ones. Also adds optional `wordCount`
 * (computed on each editor update, `undefined` for legacy notes).
 *
 * The Y.XmlFragment document (`body`) lives in a separate Y.Doc per note.
 * The browser workspace setup constructs it and bumps `updatedAt` via
 * `onLocalUpdate`.
 */
const notesTable = defineTable(
	noteBase.merge({
		_v: '1',
	}),
	noteBase.merge({
		'deletedAt?': DateTimeString.or('undefined'),
		'wordCount?': 'number | undefined',
		_v: '2',
	}),
).migrate((row) => {
	switch (row._v) {
		case 1:
			return { ...row, deletedAt: undefined, _v: 2 };
		case 2:
			return row;
	}
});
export type Note = InferTableRow<typeof notesTable>;

// ─── Table map ─────────────────────────────────────────────────────────────────

export const honeycrispTables = { folders: foldersTable, notes: notesTable };
export type HoneycrispTables = Tables<typeof honeycrispTables>;
type AttachHoneycrispEncryption = LocalOwner['attachEncryption'];

/**
 * Compute the deterministic guid of a note's rich-text body sub-doc.
 * Browser editors, daemon materializers, and wipe paths reach this through
 * the `workspace.noteBodyDocGuid(noteId)` method so every layer points at
 * the same Y.Doc identity.
 *
 * Kept private so callers go through the workspace bundle (which already
 * knows its own `ydoc.guid`) rather than re-deriving `workspaceId` by hand.
 */
function noteBodyDocGuid({
	workspaceId,
	noteId,
}: {
	workspaceId: string;
	noteId: NoteId;
}): string {
	return docGuid({
		workspaceId,
		collection: 'notes',
		rowId: noteId,
		field: 'body',
	});
}

/**
 * Open the canonical Honeycrisp workspace: a Y.Doc keyed by
 * `HONEYCRISP_WORKSPACE_ID` with encrypted Honeycrisp tables and kv attached.
 *
 * Browser code composes browser-only attachments (IndexedDB, BroadcastChannel,
 * collaboration) around `workspace.ydoc`. Daemon code composes daemon-only
 * attachments (Yjs log, SQLite, Markdown materializers, collaboration) around
 * the same `workspace.ydoc`.
 *
 * Pass `clientId` to pin the Y.Doc clientID; daemons hash `projectDir` so two
 * daemons in different project directories produce distinct update streams.
 */
export function openHoneycrispWorkspace(
	attachEncryption: AttachHoneycrispEncryption,
	options: { clientId?: number } = {},
) {
	const ydoc = createHoneycrispYdoc();
	if (options.clientId !== undefined) {
		ydoc.clientID = options.clientId;
	}
	return attachHoneycrispWorkspace(ydoc, attachEncryption);
}

export type HoneycrispWorkspace = ReturnType<typeof openHoneycrispWorkspace>;

function createHoneycrispYdoc(): Y.Doc {
	return new Y.Doc({ guid: HONEYCRISP_WORKSPACE_ID, gc: false });
}

function attachHoneycrispWorkspace(
	ydoc: Y.Doc,
	attachEncryption: AttachHoneycrispEncryption,
) {
	const encryption = attachEncryption(ydoc);
	const tables = encryption.attachTables(honeycrispTables);
	const kv = encryption.attachKv({});
	/**
	 * Single source of truth for the Honeycrisp action surface. Browser and
	 * daemon both pass this directly to `openCollaboration({ actions })`, so
	 * the action handlers (and their inputs/outputs) are guaranteed identical
	 * across layers without a second `createHoneycrispActions(tables)` call.
	 */
	const actions = createHoneycrispActions(tables);

	return {
		ydoc,
		encryption,
		tables,
		kv,
		actions,
		batch: (fn: () => void) => ydoc.transact(fn),
		noteBodyDocGuid(noteId: NoteId) {
			return noteBodyDocGuid({ workspaceId: ydoc.guid, noteId });
		},
	};
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Cross-table mutations layered on workspace tables.
 *
 * Includes operations that touch multiple tables in a single logical action
 * (e.g. folder deletion with note re-parenting). Simple single-table CRUD
 * stays in the Svelte state files.
 */
export function createHoneycrispActions(tables: HoneycrispTables) {
	return defineActions({
		/**
		 * Delete a folder and move all its notes to unfiled.
		 *
		 * Re-parents every note in the folder (sets `folderId` to undefined)
		 * and deletes the folder row. Selection clearing is handled by the
		 * Svelte state layer (folders) via URL search params.
		 */
		folders_delete: defineMutation({
			description: 'Delete a folder and re-parent its notes to unfiled',
			input: Type.Object({ folderId: Type.String() }),
			handler: ({ folderId: rawId }) => {
				const folderId = rawId as FolderId;
				const folderNotes = tables.notes
					.getAllValid()
					.filter((n) => n.folderId === folderId);
				for (const note of folderNotes) {
					tables.notes.update(note.id, { folderId: undefined });
				}
				tables.folders.delete(folderId);
			},
		}),
	});
}
export type HoneycrispActions = ReturnType<typeof createHoneycrispActions>;
