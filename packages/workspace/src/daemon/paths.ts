/**
 * Daemon-process path helpers.
 *
 * Per-user runtime: socket, metadata sidecar, log file. All live under the
 * runtime dir (`$XDG_RUNTIME_DIR/epicenter` on Linux, `~/.epicenter/run`
 * elsewhere) or under `~/.epicenter/log/` (persistent log). Keyed by a hash
 * of the daemon's project directory so two daemons on the same machine never
 * collide.
 *
 * For per-workspace data layout (yjs/sqlite/markdown under `<projectDir>/.epicenter/`),
 * see `document/workspace-paths.ts`. Different audience, different rationale.
 *
 * Pure helpers: no side effects, no directory creation. The `daemon up` command
 * owns the `mkdir`/`chmod` work; consumers here are free to call these from
 * anywhere without worrying about filesystem mutation.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function epicenterHome(): string {
	return join(homedir(), '.epicenter');
}

/**
 * Resolve the runtime directory for daemon sockets and metadata.
 *
 * - Linux with `XDG_RUNTIME_DIR` uses `$XDG_RUNTIME_DIR/epicenter` (tmpfs,
 *   reboot-cleaned by the OS).
 * - macOS / Windows / Linux without XDG uses `~/.epicenter/run` (orphan
 *   cleanup at `daemon up` startup substitutes for the missing tmpfs reset).
 */
export function runtimeDir(): string {
	if (process.env.XDG_RUNTIME_DIR) {
		return join(process.env.XDG_RUNTIME_DIR, 'epicenter');
	}
	return join(epicenterHome(), 'run');
}

/**
 * Stable hash of an absolute, fs-resolved project directory path.
 *
 * Truncated to 16 hex chars (64 bits) so the resulting socket path stays
 * comfortably under the 104-char Unix-socket limit on macOS. Symlinks are
 * resolved via `realpathSync` so two equivalent paths always hash the same.
 * The dir must exist; every production caller hashes a resolved project
 * directory that daemon discovery or project lookup has already accepted.
 */
export function dirHash(dir: string): string {
	return createHash('sha256')
		.update(realpathSync(dir))
		.digest('hex')
		.slice(0, 16);
}

/** Unix-socket path for the daemon serving `dir`. */
export function socketPathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.sock`);
}

/** Metadata JSON sidecar for the daemon serving `dir`. */
export function metadataPathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.meta.json`);
}

/** SQLite lease file for the daemon serving `dir`. */
export function leasePathFor(dir: string): string {
	return join(runtimeDir(), `${dirHash(dir)}.lease.sqlite`);
}

/**
 * Log file for the daemon serving `dir`.
 *
 * Always lives under `~/.epicenter/log/` (persistent), never tmpfs, so
 * the operator can read post-mortem logs after a crash or reboot.
 */
export function logPathFor(dir: string): string {
	return join(epicenterHome(), 'log', `${dirHash(dir)}.log`);
}
