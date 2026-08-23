/**
 * Cyrillic to Latin transliteration (ADR-0105).
 *
 * Cyrillic is alphabetic and close to 1:1 with sound, so a rule-based
 * transliteration (`transliteration.transliterate`) is a genuine pronunciation
 * aid, not just a spelling map. Covers Russian, Ukrainian, and the other
 * Cyrillic-script languages with one provider.
 */

import type { Romanizer } from '@epicenter/ui/markdown';
import type { ReadingProvider } from './registry';
import { readRuns } from './runs';

/** Cyrillic and Cyrillic Supplement. */
const CYRILLIC_RUN = /[Ѐ-ӿ]+/;
const HAS_CYRILLIC = /[Ѐ-ӿ]/;

type Transliterate = typeof import('transliteration').transliterate;

/** Latin transliteration over each Cyrillic run; other runs pass through unread. */
export function createCyrillicRomanizer(
	transliterate: Transliterate,
): Romanizer {
	return (text) => readRuns(text, CYRILLIC_RUN, (run) => transliterate(run));
}

export const cyrillicProvider: ReadingProvider = {
	id: 'cyrillic-latin',
	matches: (text) => HAS_CYRILLIC.test(text),
	load: async () => {
		const { transliterate } = await import('transliteration');
		return createCyrillicRomanizer(transliterate);
	},
};
