/**
 * Bind a request handler to a unix socket via `Bun.serve`. Filesystem
 * hardening lives here; route definitions live in `app.ts`.
 *
 * - Parent directory `mkdirSync` (recursive) with mode `0700`.
 * - Socket file `chmod 0600` immediately after `Bun.serve` returns.
 * - `Bun.serve.stop()` auto-unlinks the socket file on graceful shutdown;
 *   `runtime-files.ts` owns manual orphan-sweep helpers.
 *
 * Wire format and security model are deliberately internal; see
 * `specs/20260426T235000-cli-up-long-lived-peer.md` § "IPC wire protocol"
 * and § "Security model". The CLI is the only sanctioned client.
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { type Result, trySync } from 'wellcrafted/result';

import { readMetadata } from './metadata.js';
import { sweepDaemonRuntimeFiles } from './runtime-files.js';
import {
	StartupError,
	type StartupError as StartupErrorType,
} from './startup-errors.js';

export type BindUnixSocketOptions = {
	socketPath: string;
	fetch: (
		request: Request,
		server: Bun.Server<undefined>,
	) => Response | Promise<Response>;
};
export type BindOrRecoverOptions = BindUnixSocketOptions & {
	projectDir: string;
	isSocketResponsive: (
		socketPath: string,
		timeoutMs?: number,
	) => Promise<boolean>;
};

/**
 * Bind `fetch` to a unix socket at `socketPath`. Returns the Bun
 * listener so the daemon body owns lifecycle.
 */
export function bindUnixSocket({
	socketPath,
	fetch,
}: BindUnixSocketOptions): Bun.Server<undefined> {
	mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });

	const server = Bun.serve({
		unix: socketPath,
		fetch,
	});

	chmodSync(socketPath, 0o600);

	return server;
}

/**
 * Bind after the caller has already claimed the project daemon lease. A
 * responsive socket still wins to avoid clobbering a live daemon from an older
 * build that did not participate in the lease protocol.
 *
 *   1. Socket file absent: bind clean.
 *   2. Socket file present, ping answers: live daemon owns the dir;
 *      return `AlreadyRunning(pid)` from the metadata sidecar.
 *   3. Socket file present, ping silent: orphan from a crashed daemon.
 *      Sweep socket + metadata, then bind.
 *
 * `Bun.serve({ unix })` overwrites an existing socket file without
 * raising `EADDRINUSE`, so the "try-bind, recover on EADDRINUSE"
 * pattern from POSIX TCP doesn't apply here.
 *
 * `isSocketResponsive` is injected so this module doesn't depend on
 * `client.ts` (the import cycle would be ugly) and tests can stub the probe.
 */
export async function bindOrRecover({
	socketPath,
	projectDir,
	fetch,
	isSocketResponsive,
}: BindOrRecoverOptions): Promise<
	Result<Bun.Server<undefined>, StartupErrorType>
> {
	if (existsSync(socketPath)) {
		if (await isSocketResponsive(socketPath, 250)) {
			return StartupError.AlreadyRunning({
				pid: readMetadata(projectDir)?.pid,
			});
		}
		sweepDaemonRuntimeFiles(projectDir);
	}

	return trySync({
		try: () => bindUnixSocket({ socketPath, fetch }),
		catch: (cause) => StartupError.BindFailed({ cause }),
	});
}
