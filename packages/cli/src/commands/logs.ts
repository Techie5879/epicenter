/**
 * `epicenter logs`: tail the rotating log file for a running daemon.
 *
 * Default: print the last 50 lines and exit (mirrors `tail` defaults).
 * `--follow`: stream new bytes via `node:fs.watch`, reopening on rotation
 * (the watch event for `.log` to `.log.1` rename surfaces as `'rename'`).
 *
 * Uses the discovered project by default. `-C <dir>` changes the discovery
 * start point.
 *
 * See spec: `20260426T235000-cli-up-long-lived-peer.md` § "Logging".
 */

import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	watch,
} from 'node:fs';
import { basename, dirname } from 'node:path';
import { logPathFor } from '@epicenter/workspace/node';
import { cmd } from '../util/cmd.js';
import { projectOption } from '../util/common-options.js';

const DEFAULT_TAIL_LINES = 50;
const FOLLOW_POLL_MS = 100;

/**
 * Read the last `n` lines of `path` and return them joined by `\n` with a
 * trailing newline (matching `tail -n` output). Returns the empty string
 * when the file is missing or empty.
 *
 * Implementation note: `readFileSync` is fine here. The log is bounded
 * to the daemon log rotation threshold before rotation, so worst-case memory
 * is small and predictable.
 */
function tailLines(path: string, n: number): string {
	if (!existsSync(path)) return '';
	const buf = readFileSync(path, 'utf8');
	if (buf.length === 0) return '';
	const lines = buf.split('\n');
	// `split` of "a\nb\n" gives ['a','b',''], so drop the trailing empty if present.
	if (lines[lines.length - 1] === '') lines.pop();
	return `${lines.slice(-n).join('\n')}\n`;
}

/**
 * Stream new bytes appended to `path` to `process.stdout`. Reopens the
 * file when watch reports `'rename'` (the rotation event from
 * daemon log rotation). The returned function cancels the watcher.
 */
function followLog(path: string): () => void {
	let fd = existsSync(path) ? openSync(path, 'r') : -1;
	let pos = fd >= 0 ? statSync(path).size : 0;

	const drain = () => {
		if (fd < 0) return;
		const size = (() => {
			try {
				return statSync(path).size;
			} catch {
				return -1;
			}
		})();
		if (size < 0) return;
		// File was truncated under us; reopen from start.
		if (size < pos) {
			closeSync(fd);
			fd = openSync(path, 'r');
			pos = 0;
		}
		const buf = Buffer.alloc(64 * 1024);
		while (pos < size) {
			const bytes = readSync(fd, buf, 0, buf.length, pos);
			if (bytes <= 0) break;
			process.stdout.write(buf.subarray(0, bytes));
			pos += bytes;
		}
	};

	// Watch the parent dir to catch rename and recreate.
	const watcher = watch(dirname(path), (eventType, fn) => {
		if (fn !== basename(path)) return;
		if (eventType === 'rename') {
			// File was rotated away or recreated; reopen.
			if (fd >= 0) {
				try {
					closeSync(fd);
				} catch {
					// best effort
				}
				fd = -1;
			}
			if (existsSync(path)) {
				fd = openSync(path, 'r');
				pos = 0;
				drain();
			}
			return;
		}
		// 'change': new bytes appended.
		drain();
	});
	const poll = setInterval(drain, FOLLOW_POLL_MS);
	// Best-effort initial drain (any bytes that arrived between open and watch).
	drain();
	return () => {
		watcher.close();
		clearInterval(poll);
		if (fd >= 0) {
			try {
				closeSync(fd);
			} catch {
				// best effort
			}
		}
	};
}

export const logsCommand = cmd({
	command: 'logs',
	describe: 'Tail the log file for a running daemon.',
	builder: {
		C: projectOption,
		follow: {
			type: 'boolean',
			alias: 'f',
			default: false,
			description: 'Stream new lines as they are appended.',
		},
	},
	handler: async (argv) => {
		const logPath = logPathFor(argv.C);

		if (!existsSync(logPath) || statSync(logPath).size === 0) {
			process.stderr.write(`(log file empty or missing: ${logPath})\n`);
			if (!argv.follow) return;
		} else {
			process.stdout.write(tailLines(logPath, DEFAULT_TAIL_LINES));
		}

		if (!argv.follow) return;

		const stop = followLog(logPath);
		const stopAndExit = () => {
			stop();
			process.exit(0);
		};
		process.once('SIGINT', stopAndExit);
		process.once('SIGTERM', stopAndExit);
		// Park.
		await new Promise<void>(() => {
			/* never resolves */
		});
	},
});
