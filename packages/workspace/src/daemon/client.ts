/**
 * Hand-rolled typed client for the `epicenter daemon up` daemon. Three surfaces:
 *
 * - {@link pingDaemon}: cheap liveness probe; never throws, never returns
 *   Result. Boolean is the right shape for a fast-path predicate.
 * - {@link daemonClient}: factory returning a typed handle with one method
 *   per route. Each method returns `Promise<Result<T, DomainErr | DaemonError>>`,
 *   merging transport and domain failures into one tagged union the
 *   renderer narrows by `error.name`.
 * - {@link getDaemon}: dispatch decision for `run` / `list` / `peers`.
 *   Returns a typed client on success, or `MissingConfig` / `Required` when
 *   the project has no workspace extensions or has no live daemon.
 *
 * The wire protocol is dead simple: POST a JSON body to a path on the unix
 * socket, get back a `Result<T, DomainErr>` JSON envelope from the handler.
 * No `hc` machinery: every route is one line that names its input/output
 * types directly. Body shapes still validate at the daemon boundary via
 * arktype (`app.ts` + `@hono/standard-validator`), so a stale CLI still
 * gets a typed 400 instead of a confusing downstream cast failure.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { Ok, type Result, tryAsync } from 'wellcrafted/result';
import type { ActionManifest } from '../shared/actions.js';

import type { PeerSnapshot, RunRequest } from './app.js';
import { socketPathFor } from './paths.js';
import type { RunError } from './run-errors.js';
import { WORKSPACES_DIRNAME } from './route-validation.js';

/**
 * Tagged-error variants returned by daemon client surfaces. Domain errors
 * (UsageError, RemoteCallFailed, etc.) live alongside these in a merged union so
 * call sites narrow once on `result.error.name`. No class hierarchy, no
 * throwing across the seam.
 *
 * - `Required`: no daemon is running for this directory; user must `daemon up`.
 * - `Timeout`: the per-call AbortSignal fired before the daemon answered.
 * - `Unreachable`: socket missing, ECONNREFUSED, transport closed.
 * - `HandlerCrashed`: the daemon answered with a non-2xx status. Reserved
 *   for unexpected exceptions; typed domain errors flow through the body
 *   `Result` instead.
 */
export const DaemonError = defineErrors({
	MissingConfig: ({ projectDir }: { projectDir: string }) => ({
		message: `No ${WORKSPACES_DIRNAME}/ directory found in ${projectDir}`,
		projectDir,
	}),
	Required: ({ projectDir }: { projectDir: string }) => ({
		message: `no daemon running for ${projectDir}; start one with \`epicenter daemon up\` first`,
		projectDir,
	}),
	Timeout: ({
		socketPath,
		timeoutMs,
	}: {
		socketPath: string;
		timeoutMs: number;
	}) => ({
		message: `timed out after ${timeoutMs}ms waiting for ${socketPath}`,
		socketPath,
		timeoutMs,
	}),
	Unreachable: ({
		socketPath,
		cause,
	}: {
		socketPath: string;
		cause: unknown;
	}) => ({
		message: `daemon connection failed at ${socketPath}: ${extractErrorMessage(cause)}`,
		socketPath,
		cause,
	}),
	HandlerCrashed: ({
		socketPath,
		cause,
	}: {
		socketPath: string;
		cause: unknown;
	}) => ({
		message: `daemon handler error at ${socketPath}: ${extractErrorMessage(cause)}`,
		socketPath,
		cause,
	}),
});
export type DaemonError = InferErrors<typeof DaemonError>;

/** Default per-call timeout (ms). */
const DEFAULT_CALL_TIMEOUT_MS = 5000;

/** Default ping timeout (ms). Tight on purpose: ping is a fast-path probe. */
const DEFAULT_PING_TIMEOUT_MS = 250;

/**
 * Cheap liveness probe. POSTs `/ping` and resolves `true` iff the daemon
 * answers with 200 within `timeoutMs`. Never throws.
 */
export async function pingDaemon(
	socketPath: string,
	timeoutMs: number = DEFAULT_PING_TIMEOUT_MS,
): Promise<boolean> {
	try {
		const res = await fetch('http://daemon/ping', {
			unix: socketPath,
			method: 'POST',
			signal: AbortSignal.timeout(timeoutMs),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * One round-trip to the daemon. The body of a successful 2xx response is
 * a `Result<TOk, TErr>` envelope produced by the handler; transport
 * failures and unexpected non-2xx responses fold into `DaemonError`.
 *
 * Hostname is a placeholder; routing is done by the unix socket path.
 * Routes without a validator (ping, peers, list) get an empty `{}`
 * body, which Hono's body-parsing tolerates and validators ignore.
 */
async function call<TOk, TErr>(
	socketPath: string,
	timeoutMs: number,
	path: string,
	body: unknown = {},
): Promise<Result<TOk, TErr | DaemonError>> {
	const fetched = await tryAsync({
		try: () =>
			fetch(`http://daemon${path}`, {
				unix: socketPath,
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			}),
		catch: (cause) =>
			cause instanceof Error && cause.name === 'TimeoutError'
				? DaemonError.Timeout({ socketPath, timeoutMs })
				: DaemonError.Unreachable({ socketPath, cause }),
	});
	if (fetched.error !== null) return fetched;
	const res = fetched.data;
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		return DaemonError.HandlerCrashed({
			socketPath,
			cause: text || `HTTP ${res.status}`,
		});
	}
	return (await res.json()) as Result<TOk, TErr>;
}

/**
 * Build a typed handle for a daemon listening on `socketPath`. Each method
 * is a one-liner over {@link call}; the input/output types are named
 * directly here rather than inferred through `hc`. Adding a route is: add
 * a method whose `<TOk, TErr>` matches the handler's body `Result`.
 */
export function daemonClient(
	socketPath: string,
	timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
) {
	return {
		peers: () => call<PeerSnapshot[], never>(socketPath, timeoutMs, '/peers'),
		list: () => call<ActionManifest, never>(socketPath, timeoutMs, '/list'),
		run: (request: RunRequest) =>
			call<unknown, RunError>(socketPath, timeoutMs, '/run', request),
		shutdown: () => call<null, never>(socketPath, timeoutMs, '/shutdown'),
	};
}

/**
 * Public type of the typed daemon handle. Equivalent to the return of
 * {@link daemonClient}.
 */
export type DaemonClient = ReturnType<typeof daemonClient>;

/**
 * Resolve the daemon client for `projectDir`, or surface why we can't.
 *
 *   - `MissingConfig`: no `workspaces/` in `projectDir`. Surfaced distinctly
 *     from `Required` so unconfigured users don't get pointed at
 *     `epicenter daemon up` (which would fail and mislead).
 *   - `Required`: workspace extensions exist but no daemon is running. Renderer
 *     prints the start-with-`daemon up` hint.
 *
 * `run`, `list`, and `peers` are mandatory-daemon commands; if they hit
 * neither variant they have a typed client to dispatch against.
 */
export async function getDaemon(
	projectDir: string,
): Promise<Result<DaemonClient, DaemonError>> {
	const workspacesPath = join(projectDir, WORKSPACES_DIRNAME);
	if (!existsSync(workspacesPath)) {
		return DaemonError.MissingConfig({ projectDir });
	}
	const sock = socketPathFor(projectDir);
	if (!(await pingDaemon(sock))) {
		return DaemonError.Required({ projectDir });
	}
	return Ok(daemonClient(sock));
}
