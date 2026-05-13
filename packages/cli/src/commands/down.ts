/**
 * `epicenter down`: stop a running `up` daemon.
 *
 * Default: shut down the daemon for the discovered project via IPC
 * `shutdown` (1 s budget).
 * If the daemon doesn't reply in time (hung handler, unresponsive socket),
 * fall back to `SIGTERM` against the recorded pid. `--all` enumerates every
 * daemon for the current user and shuts them down in parallel.
 *
 * No confirmation prompt: daemons are kill-friendly by design.
 *
 * See spec: `20260426T235000-cli-up-long-lived-peer.md` § "Process lifecycle".
 */

import { resolve } from 'node:path';
import {
	type DaemonMetadata,
	daemonClient,
	enumerateDaemons,
	readMetadata,
	socketPathFor,
	unlinkMetadata,
} from '@epicenter/workspace/node';
import { cmd } from '../util/cmd.js';
import { projectOption } from '../util/common-options.js';

const SHUTDOWN_TIMEOUT_MS = 1000;

// SIGTERM fallback only fires when the IPC shutdown didn't ack; we still
// guard the kill on pid liveness to avoid signaling a recycled pid.
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (cause) {
		return (cause as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export type DownOptions = {
	projectDir: string;
	all: boolean;
};

/** Outcome of stopping a single daemon. */
export type DownOutcome =
	| { kind: 'graceful'; pid: number; dir: string }
	| { kind: 'sigterm'; pid: number; dir: string }
	| { kind: 'absent'; dir: string };

/**
 * Result returned by {@link runDown}. The CLI handler renders this; tests
 * assert on the shape directly.
 */
export type DownResult = {
	outcomes: DownOutcome[];
};

/**
 * Stop a single daemon by metadata. Tries IPC `shutdown` first; falls back
 * to `SIGTERM` after {@link SHUTDOWN_TIMEOUT_MS} ms or on any non-ok reply.
 *
 * Returns `'graceful'` when the daemon acknowledged the shutdown, `'sigterm'`
 * when we had to fall through, and (only the caller decides) `'absent'`
 * when there was no metadata to begin with.
 */
async function shutdownOne(meta: DaemonMetadata): Promise<DownOutcome> {
	const sock = socketPathFor(meta.dir);
	const { error } = await daemonClient(sock, SHUTDOWN_TIMEOUT_MS).shutdown();
	if (!error) {
		return { kind: 'graceful', pid: meta.pid, dir: meta.dir };
	}

	// IPC didn't ack; fall back to SIGTERM if the pid is alive.
	if (isProcessAlive(meta.pid)) {
		try {
			process.kill(meta.pid, 'SIGTERM');
		} catch {
			// pid raced to exit between the alive check and the kill;
			// equivalent to graceful from our perspective.
		}
	}
	// Best-effort sweep; graceful shutdown would have removed these.
	unlinkMetadata(meta.dir);
	return { kind: 'sigterm', pid: meta.pid, dir: meta.dir };
}

/**
 * Daemon-stop body. Pure function over disk + IPC; the yargs handler wraps
 * this with terminal formatting. Tests inject `shutdown` and `kill` to stay
 * unit-level.
 *
 * Behavior:
 *   - `--all`: enumerate `<runtimeDir>/*.meta.json`, shut each down in
 *     parallel.
 *   - default: shut down the daemon for the project, or report `'absent'`
 *     if no metadata exists.
 */
export async function runDown(options: DownOptions): Promise<DownResult> {
	if (options.all) {
		const outcomes = await Promise.all(
			enumerateDaemons().map((m) => shutdownOne(m)),
		);
		return { outcomes };
	}

	const projectDir = resolve(options.projectDir);
	const meta = readMetadata(projectDir);
	if (!meta) {
		return { outcomes: [{ kind: 'absent', dir: projectDir }] };
	}
	const outcome = await shutdownOne(meta);
	return { outcomes: [outcome] };
}

export const downCommand = cmd({
	command: 'down',
	describe: 'Stop a running `epicenter up` daemon.',
	builder: {
		C: projectOption,
		all: {
			type: 'boolean',
			default: false,
			description: 'Stop every running daemon for this user.',
		},
	},
	handler: async (argv) => {
		const options: DownOptions = {
			projectDir: argv.C,
			all: argv.all,
		};

		const result = await runDown(options);

		if (options.all) {
			const stopped = result.outcomes.filter((o) => o.kind !== 'absent').length;
			process.stdout.write(
				`stopped ${stopped} daemon${stopped === 1 ? '' : 's'}\n`,
			);
			return;
		}

		const [outcome] = result.outcomes;
		if (!outcome || outcome.kind === 'absent') {
			process.stderr.write(
				`no daemon running for ${outcome?.dir ?? options.projectDir}\n`,
			);
			return;
		}
		if (outcome.kind === 'graceful') {
			process.stdout.write(`stopped (pid=${outcome.pid})\n`);
		} else {
			process.stderr.write(
				`shutdown timed out, sent SIGTERM (pid=${outcome.pid})\n`,
			);
		}
	},
});
