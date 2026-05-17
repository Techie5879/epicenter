/**
 * Opensidian workspace playground: markdown and SQLite materializers around
 * the folder-routed daemon extension contract.
 *
 * Run with:
 *
 * ```bash
 * epicenter daemon up -C playground/opensidian-e2e
 * ```
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileContentDocGuid } from '@epicenter/filesystem';
import {
	attachTimeline,
	createDisposableCache,
	defineActions,
	defineMutation,
	openCollaboration,
	roomWsUrl,
} from '@epicenter/workspace';
import {
	defineDaemonWorkspace,
	type DaemonWorkspaceContext,
} from '@epicenter/workspace/daemon';
import { attachMarkdownMaterializer } from '@epicenter/workspace/document/materializer/markdown';
import { attachSqliteMaterializer } from '@epicenter/workspace/document/materializer/sqlite';
import { toSlugFilename } from '@epicenter/workspace/markdown';
import { attachYjsLog, epicenterPaths } from '@epicenter/workspace/node';
import { opensidianTables } from 'opensidian';
import Type from 'typebox';
import * as Y from 'yjs';
import { prepareMarkdownFiles } from '../../prepare-markdown-files';

const SERVER_URL = process.env.EPICENTER_SERVER ?? 'https://api.epicenter.so';
const MARKDOWN_DIR = join(import.meta.dir, 'data');
const MATERIALIZER_DIR = join(import.meta.dir, '.epicenter', 'materializer');
const WORKSPACE_ID = 'opensidian';

mkdirSync(MATERIALIZER_DIR, { recursive: true });

async function openOpensidianPlayground({
	replicaId,
	attachEncryption,
	openWebSocket,
}: DaemonWorkspaceContext) {
	const ydoc = new Y.Doc({ guid: WORKSPACE_ID, gc: false });
	const encryption = attachEncryption(ydoc);
	const tables = encryption.attachTables(opensidianTables);
	const kv = encryption.attachKv({});

	const persistence = attachYjsLog(ydoc, {
		filePath: epicenterPaths.persistence(WORKSPACE_ID),
	});

	const contentDir = join(
		epicenterPaths.home(),
		'persistence',
		WORKSPACE_ID,
		'content',
	);
	const fileContentDocs = createDisposableCache(
		(fileId: string) => {
			const contentYdoc = new Y.Doc({
				guid: fileContentDocGuid({
					workspaceId: WORKSPACE_ID,
					fileId: fileId as never,
				}),
				gc: false,
			});
			const contentPersistence = attachYjsLog(contentYdoc, {
				filePath: join(contentDir, `${contentYdoc.guid}.db`),
			});
			return {
				ydoc: contentYdoc,
				content: attachTimeline(contentYdoc),
				persistence: contentPersistence,
				[Symbol.dispose]() {
					contentYdoc.destroy();
				},
			};
		},
		{ gcTime: 5_000 },
	);

	async function readContent(rowId: string): Promise<string | undefined> {
		await using handle = fileContentDocs.open(rowId);
		return handle.content.read();
	}

	const actions = defineActions({
		markdown_prepare: defineMutation({
			title: 'Prepare Markdown Files',
			description:
				'Add unique IDs to markdown files missing them in YAML frontmatter',
			input: Type.Object({ directory: Type.String() }),
			handler: async ({ directory }) => prepareMarkdownFiles(directory),
		}),
	});

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl(SERVER_URL, ydoc.guid),
		openWebSocket,
		replicaId,
		actions,
	});

	const whenReady = collaboration.whenConnected;
	const markdown = attachMarkdownMaterializer(ydoc, {
		dir: MARKDOWN_DIR,
		waitFor: whenReady,
	}).table(tables.files, {
		filename: (row) =>
			row.type === 'folder'
				? `${row.id}.md`
				: toSlugFilename(row.name.replace(/\.md$/i, ''), row.id),
		toMarkdown: async (row) => {
			if (row.type === 'folder') {
				return {
					frontmatter: { id: row.id, name: row.name, type: 'folder' },
					body: undefined,
				};
			}
			let body: string | undefined;
			try {
				body = await readContent(row.id);
			} catch {
				// Content doc not yet available (sync pending).
			}
			return {
				frontmatter: {
					id: row.id,
					name: row.name,
					parentId: row.parentId,
					size: row.size,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					trashedAt: row.trashedAt,
				},
				body,
			};
		},
	});

	const sqlite = attachSqliteMaterializer(ydoc, {
		db: new Database(join(MATERIALIZER_DIR, 'opensidian.db')),
		waitFor: whenReady,
	}).table(tables.files, { fts: ['name'] });

	return {
		workspaceId: ydoc.guid,
		whenReady,
		actions,
		collaboration,
		async [Symbol.asyncDispose]() {
			fileContentDocs[Symbol.dispose]();
			ydoc.destroy();
			await collaboration.whenDisposed;
		},
		id: WORKSPACE_ID,
		ydoc,
		tables,
		kv,
		encryption,
		persistence,
		fileContentDocs,
		markdown,
		sqlite,
	};
}

export type OpensidianPlaygroundRuntime = Awaited<
	ReturnType<typeof openOpensidianPlayground>
>;

export default defineDaemonWorkspace({
	open: openOpensidianPlayground,
});
