/**
 * Folder-routed daemon extension discovery.
 *
 * `discoverWorkspaceApps(projectDir)` scans `<projectDir>/workspaces/*`,
 * skips dotfile folders and folders without a `daemon.ts`, validates each
 * daemon folder name as a route, rejects case-insensitive collisions, and
 * returns the paths the loader needs.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Ok, type Result } from 'wellcrafted/result';

import {
	validateDaemonRouteNames,
	WORKSPACES_DIRNAME,
} from '../daemon/route-validation.js';
import type { ProjectDir } from '../shared/types.js';
import {
	WorkspaceAppError,
	type WorkspaceAppError as WorkspaceAppErrorType,
} from './errors.js';

export { WORKSPACES_DIRNAME };
export const DAEMON_ENTRY_FILENAME = 'daemon.ts';

/**
 * One discovered daemon extension folder, resolved against
 * `<projectDir>/workspaces/<route>`.
 *
 * - `route` is the folder name and the daemon's routing identity.
 * - `daemonEntryPath` is the resolved path to `daemon.ts`. The host imports
 *   this module on startup.
 */
export type WorkspaceAppEntry = {
	route: string;
	daemonEntryPath: string;
};

/**
 * Scan `<projectDir>/workspaces/*` and resolve one entry per extension folder.
 *
 * Returns an empty list when the project has no `workspaces/` directory yet.
 */
export function discoverWorkspaceApps(
	projectDir: ProjectDir | string,
): Result<WorkspaceAppEntry[], WorkspaceAppErrorType> {
	const projectRoot = resolve(projectDir);
	const workspacesDir = join(projectRoot, WORKSPACES_DIRNAME);

	const folderNames = readWorkspacesDir(workspacesDir);
	if (folderNames === null) return Ok([]);

	const entries: WorkspaceAppEntry[] = [];
	for (const folderName of folderNames) {
		if (folderName.startsWith('.')) continue;

		const workspaceDir = join(workspacesDir, folderName);
		const folderStat = safeStat(workspaceDir);
		if (folderStat === null || !folderStat.isDirectory()) {
			return WorkspaceAppError.WorkspaceFolderInvalid({
				folderName,
				workspaceDir,
				reason: 'not-a-directory',
			});
		}

		const nameIssue = validateDaemonRouteNames([folderName]);
		if (nameIssue !== null) {
			return WorkspaceAppError.WorkspaceFolderInvalid({
				folderName,
				workspaceDir,
				reason: 'invalid-name',
			});
		}

		const daemonEntryPath = join(workspaceDir, DAEMON_ENTRY_FILENAME);
		const daemonStat = safeStat(daemonEntryPath);
		if (daemonStat === null) continue;
		if (!daemonStat.isFile()) continue;

		entries.push({
			route: folderName,
			daemonEntryPath,
		});
	}

	const collision = findCaseInsensitiveCollision(entries);
	if (collision !== null) {
		return WorkspaceAppError.WorkspaceFolderCollision(collision);
	}

	return Ok(entries);
}

function readWorkspacesDir(workspacesDir: string): string[] | null {
	try {
		return readdirSync(workspacesDir);
	} catch (cause) {
		if (isErrnoCode(cause, 'ENOENT')) return null;
		throw cause;
	}
}

function safeStat(path: string) {
	try {
		return statSync(path);
	} catch (cause) {
		if (isErrnoCode(cause, 'ENOENT')) return null;
		throw cause;
	}
}

function isErrnoCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		(cause as { code?: unknown }).code === code
	);
}

function findCaseInsensitiveCollision(
	entries: readonly WorkspaceAppEntry[],
): { route: string; folderNames: string[] } | null {
	const buckets = new Map<string, string[]>();
	for (const entry of entries) {
		const key = entry.route.toLowerCase();
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(entry.route);
		} else {
			buckets.set(key, [entry.route]);
		}
	}
	for (const [route, folderNames] of buckets) {
		if (folderNames.length > 1) return { route, folderNames };
	}
	return null;
}
