/**
 * Shared run-walker for whole-run reading providers (ADR-0105).
 *
 * Most scripts take a reading over a whole run of the script at once (a kana
 * word to its romaji, a Cyrillic word to its transliteration). This walks the
 * text, attaches `read(run)` to each run matching `runPattern`, and passes every
 * other stretch through unread. Per-character providers like pinyin (one reading
 * per glyph) walk runs themselves and do not use this.
 *
 * Concatenating every `segment.text` reproduces the input exactly.
 */

import type { Segment } from '@epicenter/ui/markdown';

export function readRuns(
	text: string,
	runPattern: RegExp,
	read: (run: string) => string,
): Segment[] {
	const segments: Segment[] = [];
	// Force a fresh global regex: `read` runs may be stateful and the caller's
	// pattern may be non-global, which would loop `exec` forever.
	const regex = new RegExp(runPattern, 'g');
	let lastIndex = 0;
	let match: RegExpExecArray | null = regex.exec(text);
	while (match !== null) {
		if (match.index > lastIndex) {
			segments.push({ text: text.slice(lastIndex, match.index) });
		}
		const run = match[0];
		segments.push({ text: run, reading: read(run) || undefined });
		lastIndex = match.index + run.length;
		match = regex.exec(text);
	}
	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex) });
	}
	return segments;
}
