/**
 * Honeycrisp daemon extension entrypoint.
 *
 * Composes daemon-only attachments around the shared
 * `openHoneycrispWorkspace`: Yjs log + sync (via
 * `attachDaemonInfrastructure`), SQLite materializer for folders and notes,
 * and Markdown materializer for notes.
 */

import {
	attachDaemonInfrastructure,
	markdownPath,
	openWriterSqlite,
	sqlitePath,
} from '@epicenter/workspace/node';
import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import {
	attachMarkdownMaterializer,
	slugFilename,
} from '@epicenter/workspace/document/materializer/markdown';
import { attachSqliteMaterializer } from '@epicenter/workspace/document/materializer/sqlite';
import { createLogger } from 'wellcrafted/logger';
import { openHoneycrispWorkspace } from './workspace.js';

export default defineDaemonWorkspace({
	async open({
		projectDir,
		route,
		clientId,
		replicaId,
		attachEncryption,
		openWebSocket,
	}) {
		const workspace = openHoneycrispWorkspace(attachEncryption, { clientId });

		const infra = attachDaemonInfrastructure(workspace.ydoc, {
			projectDir,
			openWebSocket,
			replicaId,
			actions: workspace.actions,
		});

		const sqliteDb = openWriterSqlite({
			filePath: sqlitePath(projectDir, workspace.ydoc.guid),
			log: createLogger(`${route}-sqlite`),
		});
		workspace.ydoc.once('destroy', () => sqliteDb.close());

		const sqlite = attachSqliteMaterializer(workspace.ydoc, { db: sqliteDb });
		sqlite.table(workspace.tables.folders);
		sqlite.table(workspace.tables.notes);

		attachMarkdownMaterializer(workspace.ydoc, {
			dir: markdownPath(projectDir, workspace.ydoc.guid),
		}).table(workspace.tables.notes, { filename: slugFilename('title') });

		return infra;
	},
});
