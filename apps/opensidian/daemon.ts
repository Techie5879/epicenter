/**
 * Opensidian daemon extension entrypoint.
 *
 * Opens the shared Opensidian workspace in a node runtime and adds daemon
 * infrastructure (Yjs log + sync). Daemon-side `actions: {}` is intentional:
 * Opensidian's file and shell actions need browser services and stay in the
 * app runtime.
 */

import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import { attachDaemonInfrastructure } from '@epicenter/workspace/node';
import { openOpensidianWorkspace } from './workspace.js';

export default defineDaemonWorkspace({
	async open({
		projectDir,
		clientId,
		replicaId,
		attachEncryption,
		openWebSocket,
	}) {
		const workspace = openOpensidianWorkspace(attachEncryption, { clientId });
		const infra = attachDaemonInfrastructure(workspace.ydoc, {
			projectDir,
			openWebSocket,
			replicaId,
			actions: {},
		});
		return { ...workspace, ...infra };
	},
});
