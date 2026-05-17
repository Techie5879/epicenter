/**
 * `epicenter daemon ps`: list running `daemon up` daemons (this user, this machine).
 *
 * Enumerates `<runtimeDir>/*.meta.json`, pings each socket to confirm
 * liveness, and renders a compact table. Dead-pid metadata and socket files
 * are opportunistically swept through the shared daemon runtime-file cleanup.
 *
 * No `--json` flag in v1; the spec defers it until a tooling consumer
 * (Conductor panel, shell prompt) asks.
 *
 * See spec: `20260426T235000-cli-up-long-lived-peer.md` § "Process lifecycle".
 */

import {
	enumerateDaemons,
	pingDaemon,
	socketPathFor,
	sweepDaemonRuntimeFiles,
} from '@epicenter/workspace/node';
import { cmd } from '../util/cmd.js';

const PING_TIMEOUT_MS = 250;

// `ps` shows a liveness column and sweeps obviously-dead entries it sees;
// the kernel-level `kill -0` predicate stays small and inline rather than
// re-exported from metadata.ts (no startup-time correctness gate uses it).
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		return (cause as NodeJS.ErrnoException).code === 'EPERM';
	}
}

type PsRow = {
	dir: string;
	pid: number;
	uptime: string;
	discoveredAt: string;
};

function humanUptime(startedAt: string): string {
	const ms = Date.now() - new Date(startedAt).getTime();
	if (Number.isNaN(ms) || ms < 0) return '0s';
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	const restMin = min % 60;
	return `${hr}h${restMin}m`;
}

export const psCommand = cmd({
	command: 'ps',
	describe:
		'List running `epicenter daemon up` daemons (this user, this machine).',
	handler: async () => {
		const rows: PsRow[] = [];
		for (const meta of enumerateDaemons()) {
			// Dead pid: orphan, unlink metadata + socket and skip.
			if (!isProcessAlive(meta.pid)) {
				sweepDaemonRuntimeFiles(meta.dir);
				continue;
			}
			// Pid alive but socket unresponsive: also orphan.
			const responsive = await pingDaemon(
				socketPathFor(meta.dir),
				PING_TIMEOUT_MS,
			);
			if (!responsive) {
				sweepDaemonRuntimeFiles(meta.dir);
				continue;
			}
			rows.push({
				dir: meta.dir,
				pid: meta.pid,
				uptime: humanUptime(meta.startedAt),
				discoveredAt: meta.discoveredAt,
			});
		}

		if (rows.length === 0) {
			process.stderr.write('no daemons running\n');
			return;
		}
		// `console.table` is the spec-mentioned renderer; it writes to stdout.
		console.table(rows);
	},
});
