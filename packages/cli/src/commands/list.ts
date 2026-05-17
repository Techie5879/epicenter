/**
 * `epicenter list [route.action_key]`: render actions exposed by this project.
 *
 * The daemon returns route-qualified snake_case action keys for every opened
 * workspace extension. The CLI only filters and renders that manifest.
 *
 * Per-peer schema introspection is a script concern. The CLI lists the local
 * daemon's route-qualified action surface only.
 *
 * `epicenter list` requires a running daemon for the discovered project.
 * Without `daemon up`, the handler errors with a hint pointing at
 * `epicenter daemon up`.
 */

import type { ActionManifest } from '@epicenter/workspace';
import { type DaemonError, getDaemon } from '@epicenter/workspace/node';
import Type, { type TSchema } from 'typebox';
import type { Result } from 'wellcrafted/result';

import { cmd } from '../util/cmd.js';
import { projectOption } from '../util/common-options.js';
import {
	formatOptions,
	type OutputFormat,
	output,
} from '../util/format-output.js';

export const listCommand = cmd({
	command: 'list [path]',
	describe: 'Tree view of exposed queries and mutations on this device',
	builder: (yargs) =>
		yargs
			.positional('path', {
				type: 'string',
				describe: 'Optional route-qualified key to narrow the view',
			})
			.option('C', projectOption)
			.options(formatOptions),
	handler: async (argv) => {
		const path = argv.path ?? '';

		const { data: daemon, error: daemonErr } = await getDaemon(argv.C);
		if (daemonErr) {
			console.error(daemonErr.message);
			process.exitCode = 1;
			return;
		}
		const result = await daemon.list();
		renderResult(result, path, argv.format);
	},
});

function renderResult(
	result: Result<ActionManifest, DaemonError>,
	path: string,
	format: OutputFormat | undefined,
): void {
	if (result.error !== null) {
		switch (result.error.name) {
			case 'MissingConfig':
			case 'Required':
			case 'Timeout':
			case 'Unreachable':
			case 'HandlerCrashed':
				console.error(`error: ${result.error.message}`);
				process.exitCode = 1;
				return;
		}
		return;
	}
	if (format) {
		renderJson(result.data, path, format);
		return;
	}
	renderText(result.data, path);
}

function renderJson(
	entries: ActionManifest,
	path: string,
	format: OutputFormat,
): void {
	const action = path ? entries[path] : undefined;
	if (action) {
		output(toActionDescriptor(action, path), { format });
		return;
	}

	const subset = filterByPath(entries, path);
	const rows = Object.entries(subset).map(([p, meta]) =>
		toActionDescriptor(meta, p),
	);
	if (path && rows.length === 0) {
		fail(`"${path}" is not defined.`);
		return;
	}
	output(rows, { format });
}

function renderText(entries: ActionManifest, path: string): void {
	const subset = filterByPath(entries, path);
	const matches = Object.keys(subset).length;

	if (path && matches === 0) {
		fail(`"${path}" is not defined.`);
		return;
	}

	if (matches === 0) {
		console.log('(no actions exposed)');
		return;
	}

	const leaf = path ? entries[path] : undefined;
	if (leaf && matches === 1) {
		printActionDetail(path, leaf);
		return;
	}
	printTree(subset, path);
}

function fail(message: string): void {
	console.error(`error: ${message}`);
	process.exitCode = 1;
}

export function filterByPath(
	entries: ActionManifest,
	path: string,
): ActionManifest {
	if (!path) return entries;
	const pfx = `${path}.`;
	const out: ActionManifest = {};
	for (const [p, meta] of Object.entries(entries)) {
		if (p === path || p.startsWith(pfx)) out[p] = meta;
	}
	return out;
}

type ActionDescriptor = {
	path: string;
	type: string;
	description?: string;
	input?: unknown;
};

function toActionDescriptor(
	action: ActionManifest[string],
	path: string,
): ActionDescriptor {
	const desc: ActionDescriptor = { path, type: action.type };
	if (action.description) desc.description = action.description;
	if (action.input) desc.input = action.input;
	return desc;
}

type TreeNode = {
	name: string;
	children: Map<string, TreeNode>;
	action?: ActionManifest[string];
};

function printTree(entries: ActionManifest, prefix: string): void {
	const pfx = prefix ? `${prefix}.` : '';
	const root: TreeNode = { name: '', children: new Map() };
	for (const [path, action] of Object.entries(entries)) {
		const rest = prefix ? path.slice(pfx.length) : path;
		if (!rest) continue;
		const parts = rest.split('.');
		let node = root;
		for (const [idx, seg] of parts.entries()) {
			let child = node.children.get(seg);
			if (!child) {
				child = { name: seg, children: new Map() };
				node.children.set(seg, child);
			}
			node = child;
			if (idx === parts.length - 1) node.action = action;
		}
	}
	printChildren(root, '');
}

function printChildren(node: TreeNode, prefix: string): void {
	const children = [...node.children.values()];
	children.forEach((child, idx) => {
		const isLast = idx === children.length - 1;
		const branch = isLast ? '└── ' : '├── ';
		const label = child.action
			? `${child.name}  (${child.action.type})${
					child.action.description ? `  ${child.action.description}` : ''
				}`
			: child.name;
		console.log(`${prefix}${branch}${label}`);
		if (child.children.size > 0) {
			printChildren(child, prefix + (isLast ? '    ' : '│   '));
		}
	});
}

function printActionDetail(path: string, action: ActionManifest[string]): void {
	console.log(`${path}  (${action.type})`);
	if (action.description) {
		console.log('');
		console.log(`  ${action.description}`);
	}
	if (action.input) {
		console.log('');
		console.log('  Input fields (pass as JSON):');
		for (const line of describeInput(action.input)) console.log(`    ${line}`);
	}
}

function describeInput(schema: TSchema): string[] {
	if (!Type.IsObject(schema)) return ['(non-object input schema)'];
	const required = new Set(schema.required ?? []);
	const lines: string[] = [];
	for (const [key, field] of Object.entries(schema.properties)) {
		const fieldSchema = field as TSchema & {
			type?: string;
			description?: string;
		};
		const typeLabel = fieldSchema.type ?? 'value';
		const req = required.has(key) ? 'required' : 'optional';
		const desc = fieldSchema.description ? `  ${fieldSchema.description}` : '';
		lines.push(`${key}: ${typeLabel}  (${req})${desc}`);
	}
	return lines;
}
