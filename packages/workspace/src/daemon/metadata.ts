/**
 * Server metadata sidecar: the JSON-on-disk record that lets `bindOrRecover`
 * surface a useful "already running (pid=X)" error when a second `daemon up`
 * tries to take the same socket.
 *
 * One `<runtimeDir>/<dirHash>.meta.json` per running server. Written once at
 * startup, unlinked at clean shutdown. Stale-socket recovery in
 * `unix-socket.ts` trusts the socket itself (ping it, recover if dead),
 * not the pid in this file; pid is for human-facing diagnostics only.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { createLogger } from 'wellcrafted/logger';

import { metadataPathFor, runtimeDir } from './paths.js';

const log = createLogger('workspace/daemon/metadata');

/**
 * On-disk shape of `<dirHash>.meta.json`.
 *
 * `dir` is stored as the absolute, fs-resolved path so different cwd-relative
 * project discovery starts resolving to the same project match.
 */
export type DaemonMetadata = {
	pid: number;
	/** Absolute, fs-resolved project directory path. */
	dir: string;
	/** ISO 8601 timestamp. */
	startedAt: string;
	cliVersion: string;
	/** ISO 8601 timestamp for the extension discovery pass. */
	discoveredAt: string;
};

/** Read metadata for `dir`, or `null` if the sidecar is absent or unreadable. */
export function readMetadata(dir: string): DaemonMetadata | null {
	return readMetadataFromPath(metadataPathFor(dir));
}

export function readMetadataFromPath(path: string): DaemonMetadata | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, 'utf8');
		return JSON.parse(raw) as DaemonMetadata;
	} catch (cause) {
		log.debug('failed to read daemon metadata', { path, cause });
		return null;
	}
}

/** Write metadata for `dir` atomically; the server owns the single writer. */
export function writeMetadata(dir: string, meta: DaemonMetadata): void {
	const path = metadataPathFor(dir);
	writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
}

/** Best-effort unlink of the metadata sidecar; silent if already gone. */
export function unlinkMetadata(dir: string): void {
	const path = metadataPathFor(dir);
	if (!existsSync(path)) return;
	try {
		unlinkSync(path);
	} catch (cause) {
		log.debug('failed to unlink server metadata', { path, cause });
	}
}

export function enumerateDaemons(): DaemonMetadata[] {
	const root = runtimeDir();
	if (!existsSync(root)) return [];
	const result: DaemonMetadata[] = [];
	for (const name of readdirSync(root)) {
		if (!name.endsWith('.meta.json')) continue;
		const meta = readMetadataFromPath(join(root, name));
		if (meta) result.push(meta);
	}
	return result;
}
