/**
 * Daemon-side persistence + sync infrastructure for a single workspace doc.
 *
 * `attachDaemonInfrastructure(ydoc, opts)` is the recipe every folder-routed
 * daemon extension needs: persist the Y.Doc update log to disk under
 * `yjsPath(projectDir, guid)`, join the room at
 * `roomWsUrl(apiUrl, guid)`, and own the ordered async dispose
 * (destroy first so writes flush before sockets close, then await both
 * `whenDisposed` promises).
 *
 * The helper takes the ydoc and the daemon ctx capabilities directly so the
 * caller stays explicit about its `actions` choice: app workspaces with
 * browser-only actions pass `{}` to refuse them on the daemon side, while
 * workspaces with daemon-safe actions pass `workspace.actions`.
 *
 * Returns the parts the host reads (`collaboration`) plus the side-effectful
 * `yjsLog` handle and an `[Symbol.asyncDispose]` that encodes the destroy
 * order. Callers usually spread the result into their `DaemonRuntime` and
 * compose materializers around the same ydoc.
 */

import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import type * as Y from 'yjs';

import {
	attachYjsLog,
	type YjsLogAttachment,
} from '../document/attach-yjs-log.js';
import type { OpenWebSocket } from '../document/internal/sync-supervisor.js';
import {
	type Collaboration,
	openCollaboration,
} from '../document/open-collaboration.js';
import { roomWsUrl } from '../document/transport.js';
import { yjsPath } from '../document/workspace-paths.js';
import type { ActionRegistry } from '../shared/actions.js';
import type { ProjectDir } from '../shared/types.js';

export type AttachDaemonInfrastructureOptions<TActions extends ActionRegistry> =
	{
		projectDir: ProjectDir;
		openWebSocket: OpenWebSocket;
		replicaId: string;
		actions: TActions;
		/** Defaults to `EPICENTER_API_URL`. Override for self-hosted hubs. */
		apiUrl?: string;
	};

export type DaemonInfrastructure<TActions extends ActionRegistry> = {
	yjsLog: YjsLogAttachment;
	collaboration: Collaboration<TActions>;
	[Symbol.asyncDispose](): Promise<void>;
};

export function attachDaemonInfrastructure<TActions extends ActionRegistry>(
	ydoc: Y.Doc,
	{
		projectDir,
		openWebSocket,
		replicaId,
		actions,
		apiUrl = EPICENTER_API_URL,
	}: AttachDaemonInfrastructureOptions<TActions>,
): DaemonInfrastructure<TActions> {
	const yjsLog = attachYjsLog(ydoc, {
		filePath: yjsPath(projectDir, ydoc.guid),
	});

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl(apiUrl, ydoc.guid),
		openWebSocket,
		replicaId,
		actions,
	});

	return {
		yjsLog,
		collaboration,
		async [Symbol.asyncDispose]() {
			ydoc.destroy();
			await Promise.all([collaboration.whenDisposed, yjsLog.whenDisposed]);
		},
	};
}
