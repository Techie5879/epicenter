import type { Options } from 'yargs';

const outputFormats = ['json', 'jsonl'] as const;
export type OutputFormat = (typeof outputFormats)[number];

type FormatOptions = {
	/** Override format (default: json, auto-pretty for TTY) */
	format?: OutputFormat;
};

/** Format a single value as JSON: pretty on TTY unless `format: 'jsonl'`. */
function formatJson(value: unknown, { format }: FormatOptions = {}): string {
	const shouldPretty = format !== 'jsonl' && (process.stdout.isTTY ?? false);
	return JSON.stringify(value, null, shouldPretty ? 2 : undefined);
}

/** Format an array as JSONL: one JSON value per line. */
function formatJsonl(values: unknown[]): string {
	return values.map((v) => JSON.stringify(v)).join('\n');
}

/** Output data to stdout with appropriate formatting. */
export function output(value: unknown, { format }: FormatOptions = {}): void {
	if (format === 'jsonl') {
		if (!Array.isArray(value)) {
			throw new Error('JSONL format requires an array value');
		}
		console.log(formatJsonl(value));
	} else {
		console.log(formatJson(value, { format }));
	}
}

/** Yargs options for the shared format flag. */
export const formatOptions = {
	format: {
		type: 'string',
		choices: outputFormats,
		description: 'Output format (default: json, auto-pretty for TTY)',
	},
} satisfies Record<'format', Options>;
