import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read the machine provider file as a flat name->value map. Absent/malformed
 * => {}.
 *
 * The file is untrusted disk like `credentials.json`: the `0600` mode is the
 * protection, not encryption, following the same ADR-0062 lineage. It stays a
 * generic name->value source so any secret backend, including env, `.env`, or
 * this file, projects identically into the flat map ADR-0108's resolver reads.
 */
export function readProviderFile(filePath: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return {};
		}
		const entries = Object.entries(parsed);
		if (entries.some(([, value]) => typeof value !== 'string')) return {};
		return Object.fromEntries(entries) as Record<string, string>;
	} catch {
		return {};
	}
}

/**
 * Write the map at 0600 (dir 0700) only if the file does not already exist.
 * No-op if present.
 */
export function writeProviderFileIfAbsent(
	filePath: string,
	map: Record<string, string>,
): void {
	if (existsSync(filePath)) return;
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	writeFileSync(filePath, JSON.stringify(map, null, 2));
	chmodSync(filePath, 0o600);
}
