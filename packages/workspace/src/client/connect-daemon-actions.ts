/**
 * `connectDaemonActions`: front door for talking to actions hosted by a running
 * daemon. This is the typed workspace-action handle for vault scripts and
 * app-side automation that want to call a running daemon.
 *
 * Generic `TActions` is the in-process `ActionRegistry`. The runtime returns
 * a flat action proxy backed by a unix-socket `DaemonClient`.
 * `TActions` is type-only: no workspace code runs in the caller process.
 * `DaemonActions<TActions>` rewrites each snake_case action key into the
 * daemon `/run` result shape.
 *
 * @example
 * ```ts
 * import { connectDaemonActions } from '@epicenter/workspace/node';
 * import type { createFujiActions } from '@epicenter/fuji';
 *
 * const fuji = await connectDaemonActions<ReturnType<typeof createFujiActions>>({
 *   route: 'fuji',
 * });
 * await fuji.entries_update({ id, tags: ['untagged'] });
 * ```
 *
 * Daemon-scope calls (peers, list across routes) live on `DaemonClient`
 * directly: construct one with `daemonClient(socketPathFor(projectDir))` and
 * call `.peers()` / `.list()` against the same socket. They are not
 * reachable through this workspace handle.
 */

import { getDaemon } from '../daemon/client.js';
import type { ActionRegistry } from '../shared/actions.js';
import type { ProjectDir } from '../shared/types.js';
import { buildDaemonActions, type DaemonActions } from './daemon-actions.js';
import { findEpicenterDir } from './find-epicenter-dir.js';

/**
 * Connect to a workspace's public actions hosted by a running daemon.
 *
 * `route` is the folder name under `workspaces/`. The daemon prefixes each
 * snake_case action key with `${route}.`, then dispatches the remaining key
 * against that workspace.
 *
 * `projectDir` defaults to walking up from `process.cwd()` for an
 * `workspaces/` directory or a `.epicenter/` directory.
 *
 * Throws `DaemonError.MissingConfig` when the project has no `workspaces/`
 * directory, or `DaemonError.Required` when no daemon is listening on the
 * resolved socket. Start one with `epicenter daemon up`. There is no
 * auto-spawn: explicit lifecycle is the contract.
 */
export async function connectDaemonActions<TActions extends ActionRegistry>({
	route,
	projectDir = findEpicenterDir(),
}: {
	route: string;
	/**
	 * Project root. Defaults to the nearest ancestor of `process.cwd()`
	 * containing `workspaces/` or `.epicenter/`. Throws via `findEpicenterDir`
	 * if no such ancestor exists; pass an explicit `projectDir` to opt out.
	 */
	projectDir?: ProjectDir;
}): Promise<DaemonActions<TActions>> {
	const { data: client, error } = await getDaemon(projectDir);
	if (error) throw error;
	return buildDaemonActions<TActions>(client, route);
}
