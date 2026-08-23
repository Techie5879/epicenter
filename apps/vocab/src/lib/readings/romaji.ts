/**
 * Japanese romaji over kana (ADR-0105).
 *
 * Kana is a syllabary, perfectly phonetic, so romaji is a trivial deterministic
 * mapping (`wanakana.toRomaji`). Kana-only by design: this reads は as `wa` but
 * leaves kanji (今日, 天気) unread, because furigana over kanji needs a
 * morphological analyzer with a dictionary (kuroshiro + kuromoji, ~12MB),
 * deliberately deferred. Useful today for readers still learning kana; pair with
 * a kanji provider for full Japanese.
 */

import type { Romanizer } from '@epicenter/ui/markdown';
import type { ReadingProvider } from './registry';
import { readRuns } from './runs';

/** Hiragana, katakana (with the prolonged-sound mark), and halfwidth katakana. */
const KANA_RUN = /[぀-ヿｦ-ﾟ]+/;
const HAS_KANA = /[぀-ヿｦ-ﾟ]/;

type ToRomaji = typeof import('wanakana').toRomaji;

/** Romaji over each kana run; kanji, Latin, and punctuation pass through unread. */
export function createRomajiRomanizer(toRomaji: ToRomaji): Romanizer {
	return (text) => readRuns(text, KANA_RUN, (run) => toRomaji(run));
}

export const romajiProvider: ReadingProvider = {
	id: 'ja-romaji',
	matches: (text) => HAS_KANA.test(text),
	load: async () => {
		const { toRomaji } = await import('wanakana');
		return createRomajiRomanizer(toRomaji);
	},
};
