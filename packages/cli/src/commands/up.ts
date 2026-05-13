/**
 * `epicenter up`: start the long-lived foreground daemon for one project.
 *
 * Loads every daemon route declared by `epicenter.config.ts` and exposes a
 * Unix-socket IPC channel for that project. `peers`, `list`, and `run`
 * dispatch to this daemon over IPC; without `up` they error with a hint
 * pointing back here.
 *
 * One daemon per project; that daemon serves every route in the config.
 * Resource isolation between routes is expressed by splitting them into
 * different config dirs, not by a flag.
 *
 * Foreground by design; backgrounding is the user's job (see Invariant 5
 * in the design spec).
 *
 * See spec: `20260426T235000-cli-up-long-lived-peer.md` § "Process lifecycle",
 * § "Logging", § "Invariants".
 */

import { realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	claimDaemonLease,
	type DaemonMetadata,
	type DaemonServer,
	StartupError,
	type StartupError as StartupErrorType,
	startDaemonServer,
	unlinkMetadata,
	writeMetadata,
} from '@epicenter/workspace/node';
import { Ok, type Result, trySync } from 'wellcrafted/result';
/**
 * Read once at module load. Bun resolves the JSON import relative to this
 * file at build/run time, so no runtime fs work happens per `up` invocation.
 */
import packageJson from '../../package.json' with { type: 'json' };
import {
	CONFIG_FILENAME,
	type DaemonConfigError,
	disposeStartedDaemonRoutes,
	type LoadedDaemonConfig,
	loadDaemonConfig,
	type StartedDaemonRoute,
	startDaemonRoutes,
} from '../load-config.js';
import { cmd } from '../util/cmd.js';
import { projectOption } from '../util/common-options.js';

const CLI_VERSION = packageJson.version;

/**
 * Sync-status / awareness lines write directly to stderr so they reach the
 * operator regardless of `--quiet`; the brief calls these out as "print
 * regardless of --quiet". `--quiet` only suppresses awareness join/leave
 * lines (handled at their call sites), not these.
 */
function logSyncStatus(message: string): void {
	process.stderr.write(`${message}\n`);
}

export type UpOptions = {
	projectDir: string;
	quiet: boolean;
	cliVersion?: string;
};

/**
 * Handle returned by {@link runUp}. The daemon body is exposed as a
 * standalone async function (no `process.exit`) so unit tests can drive
 * startup, exercise the IPC handler in-process, and call `teardown()` to
 * release resources without spawning a child.
 *
 * - `runtimes` is every hosted daemon runtime the config declares; the daemon
 *   serves them all and routes IPC requests by route.
 * - `metadata` is what was written to disk.
 * - `teardown()` closes the server, asyncDisposes the config, and unlinks
 *   metadata + socket. Idempotent.
 */
export type UpHandle = {
	runtimes: StartedDaemonRoute[];
	config: LoadedDaemonConfig;
	metadata: DaemonMetadata;
	socketPath: string;
	teardown: () => Promise<void>;
};

/**
 * Daemon body. Idempotently sets up disk state, loads every hosted daemon runtime,
 * binds the IPC socket, and returns a handle. The
 * yargs `handler` calls this, prints the operator-facing banner, installs
 * SIGINT/SIGTERM, and parks the process; tests call it directly and
 * assert on the returned handle.
 *
 * A SQLite daemon lease claims ownership before user config import. After that,
 * host factories perform local setup and `startDaemonServer` binds the route
 * app to the socket.
 */
export async function runUp(
	options: UpOptions,
): Promise<Result<UpHandle, DaemonConfigError | StartupErrorType>> {
	const requestedProjectDir = resolve(options.projectDir);
	const configPath = join(requestedProjectDir, CONFIG_FILENAME);

	if (!(await Bun.file(configPath).exists())) {
		return DaemonConfigError.MissingFile({ configPath });
	}

	const projectDir = realpathSync(requestedProjectDir);
	const leaseResult = claimDaemonLease(projectDir);
	if (leaseResult.error !== null) return leaseResult;
	const lease = leaseResult.data;

	const configMtime = readConfigMtime(projectDir);
	const metadata: DaemonMetadata = {
		pid: process.pid,
		dir: projectDir,
		startedAt: new Date().toISOString(),
		cliVersion: options.cliVersion ?? CLI_VERSION,
		configMtime,
	};

	let metadataWritten = false;
	let runtimes: StartedDaemonRoute[] = [];
	let daemonServer: DaemonServer | null = null;
	let teardownPromise: Promise<void> | null = null;
	const teardown = (): Promise<void> => {
		if (teardownPromise) return teardownPromise;
		teardownPromise = (async () => {
			let closeError: unknown;
			try {
				if (daemonServer) await daemonServer.close();
			} catch (cause) {
				closeError = cause;
			}
			await safeDisposeStartedRoutes(runtimes);
			if (metadataWritten) unlinkMetadata(projectDir);
			lease.release();
			if (closeError) throw closeError;
		})();
		return teardownPromise;
	};

	const loadResult = await loadDaemonConfig(projectDir);
	if (loadResult.error) {
		await teardown();
		return loadResult;
	}
	const config = loadResult.data;

	const startResult = await startDaemonRoutes(config);
	if (startResult.error) {
		await teardown();
		return startResult;
	}
	runtimes = startResult.data;
	const serverResult = await startDaemonServer({
		lease,
		routes: runtimes,
		triggerShutdown: () => void teardown(),
	});
	if (serverResult.error) {
		await teardown();
		return serverResult;
	}
	daemonServer = serverResult.data;

	const metadataResult = trySync({
		try: () => writeMetadata(projectDir, metadata),
		catch: (cause) => StartupError.MetadataWriteFailed({ cause }),
	});
	if (metadataResult.error) {
		await teardown();
		return metadataResult;
	}
	metadataWritten = true;

	return Ok({
		runtimes,
		config,
		metadata,
		socketPath: lease.socketPath,
		teardown,
	});
}

/**
 * Yargs `up` command. Thin glue: parses argv, calls {@link runUp}, prints
 * the operator-facing banner + initial peers snapshot, wires SIGINT/SIGTERM,
 * subscribes to awareness/status across every loaded workspace, and parks
 * until a signal triggers teardown.
 */
export const upCommand = cmd({
	command: 'up',
	describe:
		'Bring this config online as a long-lived peer for every hosted daemon route (foreground).',
	builder: {
		C: projectOption,
		quiet: {
			type: 'boolean',
			default: false,
			description:
				'Suppress awareness join/leave lines (sync state changes still print)',
		},
	},
	handler: async (argv) => {
		const options: UpOptions = {
			projectDir: argv.C,
			quiet: argv.quiet,
		};

		const { data: handle, error } = await runUp(options);
		if (error) {
			process.stderr.write(`${error.message}\n`);
			process.exit(1);
		}

		const routes = handle.runtimes.map((entry) => entry.route).join(', ');
		logSyncStatus(`online (routes=[${routes}])`);

		for (const entry of handle.runtimes) {
			printPeersSnapshot(entry);
			subscribeAwareness(entry, options.quiet);
			subscribeSyncStatus(entry);
		}

		const onSignal = () => {
			void handle.teardown().then(
				() => process.exit(0),
				() => process.exit(1),
			);
		};
		process.once('SIGINT', onSignal);
		process.once('SIGTERM', onSignal);

		// Park: don't exit. SIGINT/SIGTERM handler clears stdin so node can drain.
		process.stdin.resume();
	},
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readConfigMtime(absDir: string): number {
	const configPath = join(absDir, CONFIG_FILENAME);
	try {
		return statSync(configPath).mtimeMs;
	} catch {
		return 0;
	}
}

async function safeDisposeStartedRoutes(
	runtimes: readonly StartedDaemonRoute[],
): Promise<void> {
	try {
		await disposeStartedDaemonRoutes(runtimes);
	} catch {
		// Best-effort cleanup; the daemon is exiting anyway.
	}
}

function printPeersSnapshot(entry: StartedDaemonRoute): void {
	const peers = entry.runtime.awareness.peers();
	if (peers.size === 0) {
		process.stderr.write(`${entry.route}: no peers connected\n`);
		return;
	}
	for (const [clientID, state] of peers) {
		process.stderr.write(
			`${entry.route}: peer ${state.peer.id} (clientID=${clientID}, name=${state.peer.name})\n`,
		);
	}
}

function subscribeAwareness(entry: StartedDaemonRoute, quiet: boolean): void {
	const awareness = entry.runtime.awareness;
	let prev = new Map(awareness.peers());
	awareness.observe(() => {
		const next = awareness.peers();
		for (const [clientID, state] of next) {
			if (!prev.has(clientID)) {
				if (!quiet) {
					process.stderr.write(
						`${entry.route}: ${state.peer.id} joined (clientID=${clientID})\n`,
					);
				}
			}
		}
		for (const [clientID, state] of prev) {
			if (!next.has(clientID)) {
				if (!quiet) {
					process.stderr.write(
						`${entry.route}: ${state.peer.id} left (clientID=${clientID})\n`,
					);
				}
			}
		}
		prev = new Map(next);
	});
}

function subscribeSyncStatus(entry: StartedDaemonRoute): void {
	const sync = entry.runtime.sync;
	sync.onStatusChange((status) => {
		if (status.phase === 'connecting') {
			logSyncStatus(`${entry.route}: connecting (retry ${status.retries})`);
		} else if (status.phase === 'connected') {
			logSyncStatus(`${entry.route}: connected`);
		} else if (status.phase === 'offline') {
			logSyncStatus(`${entry.route}: offline`);
		}
	});
}
