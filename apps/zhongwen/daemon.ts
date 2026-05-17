/**
 * Zhongwen daemon extension entrypoint.
 *
 * Opens the shared Zhongwen workspace in a node runtime and adds daemon
 * infrastructure (Yjs log + sync). The current extension exposes no daemon
 * actions.
 */

import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import { attachDaemonInfrastructure } from '@epicenter/workspace/node';
import { openZhongwenWorkspace } from './workspace.js';

export default defineDaemonWorkspace({
	async open({
		projectDir,
		clientId,
		replicaId,
		attachEncryption,
		openWebSocket,
	}) {
		const workspace = openZhongwenWorkspace(attachEncryption, { clientId });
		const infra = attachDaemonInfrastructure(workspace.ydoc, {
			projectDir,
			openWebSocket,
			replicaId,
			actions: {},
		});
		return { ...workspace, ...infra };
	},
});
