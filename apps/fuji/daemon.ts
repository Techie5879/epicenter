/**
 * Fuji daemon extension entrypoint.
 *
 * Composes daemon-only attachments around the shared `openFujiWorkspace`:
 * Yjs log + sync (via `attachDaemonInfrastructure`), SQLite materializer for
 * entries, and Markdown materializer for entries.
 */

import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import {
	attachMarkdownMaterializer,
	slugFilename,
} from '@epicenter/workspace/document/materializer/markdown';
import { attachSqliteMaterializer } from '@epicenter/workspace/document/materializer/sqlite';
import {
	attachDaemonInfrastructure,
	markdownPath,
	openWriterSqlite,
	sqlitePath,
} from '@epicenter/workspace/node';
import { createLogger } from 'wellcrafted/logger';
import { openFujiWorkspace } from './workspace.js';

export default defineDaemonWorkspace({
	async open({
		projectDir,
		route,
		clientId,
		replicaId,
		attachEncryption,
		openWebSocket,
	}) {
		const workspace = openFujiWorkspace(attachEncryption, { clientId });

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

		attachSqliteMaterializer(workspace.ydoc, { db: sqliteDb }).table(
			workspace.tables.entries,
		);
		attachMarkdownMaterializer(workspace.ydoc, {
			dir: markdownPath(projectDir, workspace.ydoc.guid),
		}).table(workspace.tables.entries, { filename: slugFilename('title') });

		return infra;
	},
});
