/**
 * Shared project-root option for commands that address a local daemon.
 *
 * By default commands discover the nearest Epicenter project from the
 * current working directory. `-C <dir>` changes the discovery start point.
 */

import { resolve } from 'node:path';

import { findEpicenterDir } from '@epicenter/workspace/node';
import type { Options } from 'yargs';

function resolveProjectDir(start: string): string {
	try {
		return findEpicenterDir(start);
	} catch {
		return resolve(start);
	}
}

export const projectOption = {
	type: 'string',
	description: 'Start directory for Epicenter project discovery',
	default: () => process.cwd(),
	defaultDescription: 'current working directory',
	coerce: resolveProjectDir,
} satisfies Options;
