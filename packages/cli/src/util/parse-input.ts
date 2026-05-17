import { readFileSync } from 'node:fs';
import { extractErrorMessage } from 'wellcrafted/error';

/**
 * Parse JSON input from CLI sources.
 *
 * Priority: positional (inline JSON or `@file`) > stdin. Returns `undefined`
 * when no source is populated. Throws `Error` with a human-readable message
 * on invalid JSON or missing `@file`.
 *
 * The error-shape discrimination that `wellcrafted`'s Result-types would
 * carry isn't useful here; the sole caller in `run.ts` rethrows
 * `error.message` verbatim. Plain `throw` at a CLI boundary is the simpler
 * equivalent.
 */
export function parseJsonInput<T = unknown>({
	positional,
	stdinContent,
}: {
	/** Positional argument: inline JSON, or `@file.json` (curl convention) */
	positional?: string;
	/** Stdin content (undefined = no piped input) */
	stdinContent?: string;
}): T | undefined {
	if (positional) {
		if (positional.startsWith('@')) {
			const filePath = positional.slice(1);
			return readJsonFile<T>(filePath);
		}
		return parseJson<T>(positional);
	}
	if (stdinContent) {
		return parseJson<T>(stdinContent);
	}
	return undefined;
}

function parseJson<T>(input: string): T {
	try {
		return JSON.parse(input) as T;
	} catch (error) {
		throw new Error(`Invalid JSON: ${extractErrorMessage(error)}`);
	}
}

function readJsonFile<T>(filePath: string): T {
	let content: string;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`File not found: ${filePath}`);
		}
		throw new Error(
			`Error reading file '${filePath}': ${extractErrorMessage(error)}`,
		);
	}
	return parseJson<T>(content);
}

/**
 * Read piped stdin content (for CLI use). Returns undefined when stdin
 * is a TTY (interactive terminal, no pipe).
 *
 * Caveat: if stdin reports non-TTY but no writer is connected (pathological
 * CI/Docker TTY-allocation shapes), `Bun.stdin.text()` blocks until the OS
 * closes the fd. This is rare; the fix is environmental (redirect
 * `</dev/null`) rather than adding per-invocation latency for the common
 * healthy-pipe case.
 */
export async function readStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;
	const text = await Bun.stdin.text();
	return text.trim() || undefined;
}
