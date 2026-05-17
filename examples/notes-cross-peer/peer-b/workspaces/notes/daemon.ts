/**
 * Peer-B daemon for the cross-peer sync repro. Uses a hard-coded `replicaId`
 * so peer-B is distinguishable from peer-A in the same workspace.
 */

import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import { openNotes } from '../../../notes';

export default defineDaemonWorkspace({
	open: ({ openWebSocket }) =>
		openNotes({
			replicaId: 'notes-repro-peer-b',
			openWebSocket,
		}),
});
