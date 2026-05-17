/**
 * Shared workspace shape for the two-peer cross-peer sync repro.
 *
 * Each peer's `daemon.ts` calls `openNotes(ctx-derived-args)` so both peers
 * agree on the workspace id, the table schema, and the action set; the only
 * thing that differs between peers is the `replicaId` (the daemon ctx default
 * is `${route}-daemon`, but cross-peer sync requires distinct replicaIds for
 * the same workspace, so each peer hard-codes its own).
 */

import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import {
	attachTables,
	defineMutation,
	defineQuery,
	defineTable,
	openCollaboration,
	roomWsUrl,
} from '@epicenter/workspace';
import type { OpenWebSocket } from '@epicenter/workspace';
import { type } from 'arktype';
import Type from 'typebox';
import * as Y from 'yjs';

const WORKSPACE_ID = 'epicenter.notes-repro';

// `_v: '1'` here is arktype syntax for the literal NUMBER 1 (numeric strings
// in arktype's type position resolve to number literals). The `set()` call
// below passes `_v: 1`: same value, two different syntax conventions.
const Note = defineTable(type({ id: 'string', body: 'string', _v: '1' }));

export function openNotes({
	replicaId,
	openWebSocket,
}: {
	replicaId: string;
	openWebSocket: OpenWebSocket;
}) {
	const ydoc = new Y.Doc({ guid: WORKSPACE_ID });
	const tables = attachTables(ydoc, { notes: Note });

	const actions = {
		notes: {
			list: defineQuery({
				description: 'List all notes',
				handler: () => tables.notes.getAllValid(),
			}),
			add: defineMutation({
				description: 'Add a note',
				input: Type.Object({ body: Type.String() }),
				handler: ({ body }) =>
					tables.notes.set({ id: crypto.randomUUID(), body, _v: 1 }),
			}),
		},
	};

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl(EPICENTER_API_URL, ydoc.guid),
		openWebSocket,
		replicaId,
		actions,
	});

	return {
		workspaceId: ydoc.guid,
		actions,
		collaboration,
		whenReady: collaboration.whenConnected,
		async [Symbol.asyncDispose]() {
			ydoc.destroy();
			await collaboration.whenDisposed;
		},
	};
}
