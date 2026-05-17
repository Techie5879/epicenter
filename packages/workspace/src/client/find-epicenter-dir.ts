/**
 * Walk up the filesystem from `start` (default `process.cwd()`) until we
 * hit the first directory that contains `workspaces/` or a `.epicenter/`
 * directory. That directory is the project root.
 *
 * This is the canonical way to mint a `ProjectDir`: every other consumer
 * (daemon path helpers, script factories, `connectDaemonActions`) accepts
 * `ProjectDir` so the brand acts as proof that the path was discovered via
 * this function and points at a real vault root. Plain `string` paths
 * (e.g., `process.cwd()`) won't satisfy `ProjectDir` without an explicit
 * cast.
 *
 * Used by `connectDaemonActions` and per-app script factories so vault scripts
 * don't have to pass `projectDir` explicitly: running a script from anywhere
 * inside the vault tree resolves the same daemon socket the surrounding
 * `epicenter daemon up` is bound to.
 *
 * Throws if no marker is found before reaching the filesystem root.
 * Catching is deliberate: callers that want a "run anywhere, cold-sync
 * from cloud" mode pass an explicit `projectDir` (typically `process.cwd()`)
 * to opt out of the throw.
 *
 * @param start Where to begin walking up. Defaults to `process.cwd()` so
 *   the caller's invocation directory drives discovery.
 * @returns The project root, branded as `ProjectDir`.
 * @throws If no `workspaces/` or `.epicenter/` is found before the filesystem
 *   root.
 *
 * @example
 * ```ts
 * // From inside a vault script:
 * const projectDir = findEpicenterDir();
 * // '/Users/braden/Code/my-vault' as ProjectDir
 *
 * // Explicit start:
 * findEpicenterDir('/Users/braden/Code/my-vault/scripts');
 * ```
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { WORKSPACES_DIRNAME } from '../daemon/route-validation.js';
import type { ProjectDir } from '../shared/types.js';

export function findEpicenterDir(start: string = process.cwd()): ProjectDir {
	let current = resolve(start);
	while (true) {
		const hasWorkspaces = existsSync(join(current, WORKSPACES_DIRNAME));
		const hasDir = existsSync(join(current, '.epicenter'));
		if (hasWorkspaces || hasDir) return current as ProjectDir;
		const parent = dirname(current);
		if (parent === current) {
			throw new Error(
				`findEpicenterDir: no ${WORKSPACES_DIRNAME}/ or .epicenter/ directory found ` +
					`walking up from ${start}`,
			);
		}
		current = parent;
	}
}
