/**
 * Daemon-side runtime types.
 *
 * `DaemonRuntime` is the contract every opened daemon extension returns:
 * async dispose plus the hosted `Collaboration<TActions>` that owns identity,
 * actions, sync, and peers.
 *
 * `DaemonServedRoute` is the narrowed route handler contract for the socket
 * app. `StartedDaemonRoute` is the lifecycle-owning route shape opened from a
 * folder-routed daemon extension.
 */

import type { Result } from 'wellcrafted/result';
import type { SyncStatus } from '../document/internal/sync-supervisor.js';
import type { Collaboration } from '../document/open-collaboration.js';
import type { PresenceEntry } from '../document/presence.js';
import type { DispatchError } from '../document/rpc.js';
import type { ActionRegistry } from '../shared/actions.js';
import type { MaybePromise } from '../shared/types.js';

/**
 * Collaboration fields the daemon socket app reads while serving `/peers`,
 * `/list`, and `/run`.
 */
export type DaemonServedCollaboration<
	TActions extends ActionRegistry = ActionRegistry,
> = {
	actions: TActions;
	peers: {
		list(): PresenceEntry[];
	};
	status: SyncStatus;
	dispatch(
		action: string,
		input: unknown,
		options: { to: string; signal: AbortSignal },
	): Promise<Result<unknown, DispatchError>>;
};

/**
 * One routed runtime as served by the daemon socket app.
 *
 * Full started routes can pass through structurally, but route handlers do not
 * depend on lifecycle fields such as async disposal.
 */
export type DaemonServedRoute<
	TActions extends ActionRegistry = ActionRegistry,
> = {
	route: string;
	runtime: {
		collaboration: DaemonServedCollaboration<TActions>;
	};
};

/**
 * Fields the daemon looks at on each started runtime.
 */
export type DaemonRuntime<TActions extends ActionRegistry = ActionRegistry> = {
	/** Called by the daemon at exit. */
	[Symbol.asyncDispose](): MaybePromise<void>;

	/**
	 * The hosted collaboration. Identity, action registry, sync status, and
	 * the peers surface for cross-route dispatch all live here.
	 */
	readonly collaboration: Collaboration<TActions>;
};

/** One routed daemon runtime hosted by the daemon. */
export type StartedDaemonRoute = {
	route: string;
	runtime: DaemonRuntime;
};
