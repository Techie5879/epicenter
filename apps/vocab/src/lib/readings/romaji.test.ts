import { describe, expect, test } from 'bun:test';
import { toRomaji } from 'wanakana';
import { createRomajiRomanizer, romajiProvider } from './romaji.js';

const romanize = createRomajiRomanizer(toRomaji);

describe('romajiRomanizer', () => {
	test('segments cover the whole input in order, lossless', () => {
		const input = '猫はかわいい (cute)';
		expect(
			romanize(input)
				.map((s) => s.text)
				.join(''),
		).toBe(input);
	});

	test('a kana run gets a romaji reading', () => {
		const segments = romanize('ねこ');
		expect(segments).toEqual([{ text: 'ねこ', reading: 'neko' }]);
	});

	test('kanji and Latin get no reading (kana-only)', () => {
		// 日本 is all kanji: no kana, so no reading (furigana needs kuromoji).
		expect(romanize('日本')).toEqual([{ text: '日本' }]);
		expect(romanize('hello')).toEqual([{ text: 'hello' }]);
	});
});

describe('romajiProvider.matches', () => {
	test('claims kana-bearing text, abstains otherwise', () => {
		expect(romajiProvider.matches('ねこ')).toBe(true);
		expect(romajiProvider.matches('猫はかわいい')).toBe(true);
		expect(romajiProvider.matches('日本')).toBe(false);
		expect(romajiProvider.matches('hello')).toBe(false);
	});
});
