/**
 * `epicenter peers`: presence view of who's connected right now.
 *
 * Shows the identity fields needed to target a peer with `run --peer`:
 * replica id, subject, and the session-local connection id.
 *
 * `epicenter peers` requires a running daemon for the discovered project.
 * Without `daemon up`, the handler errors with a hint pointing at
 * `epicenter daemon up`.
 *
 * Prints `no peers connected` to stderr when every workspace is empty (text
 * mode only; JSON mode always emits a valid array, even if empty).
 */

import { getDaemon, type PeerSnapshot } from '@epicenter/workspace/node';
import { cmd } from '../util/cmd.js';
import { projectOption } from '../util/common-options.js';
import {
	formatOptions,
	type OutputFormat,
	output,
} from '../util/format-output.js';

export const peersCommand = cmd({
	command: 'peers',
	describe: 'List connected peers (presence)',
	builder: {
		C: projectOption,
		...formatOptions,
	},
	handler: async (argv) => {
		const { data: daemon, error: daemonErr } = await getDaemon(argv.C);
		if (daemonErr) {
			console.error(daemonErr.message);
			process.exitCode = 1;
			return;
		}
		const { data: rows, error } = await daemon.peers();
		if (error) {
			console.error(`error: ${error.message}`);
			process.exitCode = 1;
			return;
		}
		emit(rows, argv.format);
	},
});

function emit(rows: PeerSnapshot[], format: OutputFormat | undefined): void {
	if (format === 'json' || format === 'jsonl') {
		output(rows, { format });
		return;
	}

	if (rows.length === 0) {
		console.error('no peers connected');
		return;
	}

	const byRoute = new Map<string, PeerSnapshot[]>();
	for (const row of rows) {
		const list = byRoute.get(row.route);
		if (list) list.push(row);
		else byRoute.set(row.route, [row]);
	}

	let i = 0;
	for (const [route, group] of byRoute) {
		if (i > 0) console.log('');
		console.log(route);
		console.table(
			group.map(toRow).sort((a, b) => a.connId.localeCompare(b.connId)),
		);
		i++;
	}
}

function toRow(snap: PeerSnapshot) {
	return {
		connId: snap.connId,
		subject: snap.subject,
		replicaId: snap.replicaId,
	};
}
