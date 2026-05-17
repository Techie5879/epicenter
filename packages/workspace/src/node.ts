/**
 * Node and Bun-only workspace APIs.
 *
 * Keep these exports out of the root `@epicenter/workspace` barrel so browser
 * bundles do not traverse modules that import `node:*` or `bun:*`.
 */

export {
	attachDaemonInfrastructure,
	type AttachDaemonInfrastructureOptions,
	type DaemonInfrastructure,
} from './daemon/attach-daemon-infrastructure.js';
export { connectDaemonActions } from './client/connect-daemon-actions.js';
export type {
	DaemonActionOptions,
	DaemonActions,
} from './client/daemon-actions.js';
export { buildDaemonActions } from './client/daemon-actions.js';
export { epicenterPaths } from './client/epicenter-paths.js';
export { findEpicenterDir } from './client/find-epicenter-dir.js';
export { PeerSnapshot, RunRequest } from './daemon/app.js';
export {
	type DaemonClient,
	DaemonError,
	daemonClient,
	getDaemon,
	pingDaemon,
} from './daemon/client.js';
export {
	claimDaemonLease,
	type DaemonLease,
} from './daemon/lease.js';
export {
	type DaemonMetadata,
	enumerateDaemons,
	readMetadata,
	readMetadataFromPath,
	unlinkMetadata,
	writeMetadata,
} from './daemon/metadata.js';
export {
	dirHash,
	leasePathFor,
	logPathFor,
	metadataPathFor,
	runtimeDir,
	socketPathFor,
} from './daemon/paths.js';
export {
	type StartDaemonWorkspaceAppsOptions,
	type StartDaemonWorkspaceAppsResult,
	startDaemonWorkspaceApps,
} from './workspace-apps/start-daemon-workspace-apps.js';
export { WorkspaceAppError } from './workspace-apps/errors.js';
export {
	RunError,
	type RunResponse,
	type RunSyncStatus,
} from './daemon/run-errors.js';
export { sweepDaemonRuntimeFiles } from './daemon/runtime-files.js';
export {
	type DaemonServer,
	type DaemonServerOptions,
	startDaemonServer,
} from './daemon/server.js';
export { StartupError } from './daemon/startup-errors.js';
export type {
	DaemonRuntime,
	StartedDaemonRoute,
} from './daemon/types.js';
export {
	attachYjsLog,
	type YjsLogAttachment,
} from './document/attach-yjs-log.js';
export {
	attachYjsLogReader,
	type YjsLogReaderAttachment,
} from './document/attach-yjs-log-reader.js';
export {
	type OpenSqliteReaderOptions,
	openSqliteReader,
	type SqliteReader,
} from './document/open-sqlite-reader.js';
export { openWorkspaceSqlite } from './document/open-workspace-sqlite.js';
export {
	openWriterSqlite,
	SqliteWriterError,
} from './document/sqlite-writer.js';
export {
	markdownPath,
	sqlitePath,
	yjsPath,
} from './document/workspace-paths.js';
export { hashClientId } from './shared/client-id.js';
