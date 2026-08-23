/**
 * Chinese pinyin: the flagship deterministic reading provider (ADR-0105).
 *
 * Han is not phonetic, but it is lexically complete: each character has a fixed
 * reading a dictionary resolves (heteronyms by frequency and context, which
 * `pinyin-pro` handles). So pinyin is deterministic and offline, no model call.
 */

import type { Romanizer, Segment } from '@epicenter/ui/markdown';
import type { ReadingProvider } from './registry';

/** A run of Han ideographs (simplified + traditional). Global: rebuilt per call
 * for the stateful `.exec` walk in {@link createPinyinRomanizer}. */
const HAN_RUN = /[一-鿿㐀-䶿豈-﫿]+/g;
/** One Han ideograph. Non-global, safe for `.test`. */
const HAS_HAN = /[一-鿿㐀-䶿豈-﫿]/;
/** Kana or hangul. Their presence marks a run as Japanese or Korean, where Han
 * shared with Chinese takes a non-Mandarin reading (今日 is `kyō`, not the
 * Mandarin reading of 今 + 日). The Chinese provider abstains when they appear
 * so shared Han is never stamped with a wrong pinyin: a missing reading is
 * safe, a wrong one teaches a wrong sound. */
const HAS_KANA_OR_HANGUL = /[぀-ヿ가-힣]/;

type PinyinFn = typeof import('pinyin-pro').pinyin;

/**
 * Per-character pinyin for Han runs; every other run (Latin, punctuation, or any
 * text carrying kana/hangul) passes through with no reading. Concatenating every
 * `segment.text` reproduces the input exactly. Built around a loaded `pinyin`
 * fn so the pinyin-pro dictionary loads lazily (see {@link pinyinProvider}).
 */
export function createPinyinRomanizer(pinyin: PinyinFn): Romanizer {
	return (text) => {
		if (HAS_KANA_OR_HANGUL.test(text)) return [{ text }];
		const segments: Segment[] = [];
		const regex = new RegExp(HAN_RUN);
		let lastIndex = 0;
		let match: RegExpExecArray | null = regex.exec(text);
		while (match !== null) {
			if (match.index > lastIndex) {
				segments.push({ text: text.slice(lastIndex, match.index) });
			}
			const run = match[0];
			const readings = pinyin(run, { type: 'array' });
			let charIndex = 0;
			for (const char of run) {
				segments.push({
					text: char,
					reading: readings[charIndex] || undefined,
				});
				charIndex++;
			}
			lastIndex = match.index + run.length;
			match = regex.exec(text);
		}
		if (lastIndex < text.length) {
			segments.push({ text: text.slice(lastIndex) });
		}
		return segments;
	};
}

/**
 * The provider entry: claims Han runs unless the passage also carries kana or
 * hangul, and loads pinyin-pro on first Chinese message.
 */
export const pinyinProvider: ReadingProvider = {
	id: 'zh-pinyin',
	matches: (text) => HAS_HAN.test(text) && !HAS_KANA_OR_HANGUL.test(text),
	load: async () => {
		const { pinyin } = await import('pinyin-pro');
		return createPinyinRomanizer(pinyin);
	},
};
