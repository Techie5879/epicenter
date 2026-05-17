/**
 * Minimal fixture: one daemon route with inline `defineQuery` /
 * `defineMutation` nodes grouped under `actions:`. No sqlite or encryption,
 * no real WebSocket: a hand-stubbed `collaboration` matches the daemon's
 * structural contract so folder-routed daemon startup accepts it.
 *
 * CLI paths are `demo.counter_{get,increment,set}`.
 */

import { defineMutation, defineQuery } from '@epicenter/workspace';
import { defineDaemonWorkspace } from '@epicenter/workspace/daemon';
import Type from 'typebox';
import * as Y from 'yjs';

const ydoc = new Y.Doc({ guid: 'epicenter.demo' });
const state = ydoc.getMap<number>('state');
state.set('count', 0);

const actions = {
	counter_get: defineQuery({
		description: 'Read the current counter value',
		handler: () => state.get('count') ?? 0,
	}),
	counter_increment: defineMutation({
		description: 'Increment the counter by one',
		handler: () => {
			const next = (state.get('count') ?? 0) + 1;
			state.set('count', next);
			return next;
		},
	}),
	counter_set: defineMutation({
		description: 'Overwrite the counter value',
		input: Type.Object({ value: Type.Number() }),
		handler: ({ value }: { value: number }) => {
			state.set('count', value);
			return value;
		},
	}),
};

const collaboration = {
	replicaId: 'fixture',
	connId: 'fixture-conn',
	actions,
	status: { phase: 'connected' as const },
	whenConnected: Promise.resolve(),
	whenDisposed: Promise.resolve(),
	onStatusChange: () => () => {},
	reconnect: () => {},
	peers: {
		list: () => [],
		find: () => undefined,
		observe: () => () => {},
	},
	dispatch: async () => {
		throw new Error('fixture does not dispatch');
	},
	[Symbol.dispose]() {
		ydoc.destroy();
	},
};

export const demo = {
	workspaceId: ydoc.guid,
	collaboration,
	async [Symbol.asyncDispose]() {
		ydoc.destroy();
	},
	ydoc,
};

export default defineDaemonWorkspace({
	open: () => demo,
});
