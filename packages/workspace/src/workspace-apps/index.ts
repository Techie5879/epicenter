/**
 * Folder-routed daemon extension discovery and startup. Node/Bun-only.
 *
 * Each `<projectDir>/workspaces/<route>/daemon.ts` is one daemon extension.
 * See `specs/20260516T180000-folder-routed-daemon-extensions.md`.
 */

export {
	DAEMON_ENTRY_FILENAME,
	discoverWorkspaceApps,
	type WorkspaceAppEntry,
	WORKSPACES_DIRNAME,
} from './discover.js';
export { WorkspaceAppError } from './errors.js';
export {
	type StartDaemonWorkspaceAppsOptions,
	type StartDaemonWorkspaceAppsResult,
	startDaemonWorkspaceApps,
} from './start-daemon-workspace-apps.js';
