import { describe, expect, test } from 'bun:test';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { collectHiddenMarkerRanges } from './markdown-live-preview.js';

describe('collectHiddenMarkerRanges', () => {
	test('hides a heading marker on an inactive line', () => {
		const doc = '# Heading\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['#']);
	});

	test('keeps a heading marker visible when selection overlaps the line', () => {
		const doc = '# Heading\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('Heading'));

		expect(hiddenText).toEqual([]);
	});

	test('hides emphasis markers on inactive lines', () => {
		const doc = '**bold** and *em*\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['**', '**', '*', '*']);
	});

	test('hides inline-code backticks on inactive lines', () => {
		const doc = '`code`\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['`', '`']);
	});

	test('does not hide fenced-code markers', () => {
		const doc = '```js\nconst value = 1;\n```\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([]);
	});

	test('hides closing heading marks on inactive lines', () => {
		const doc = '## Closing ##\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['##', '##']);
	});

	test('does not hide setext heading markers', () => {
		const doc = 'Title\n=====\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([]);
	});

	test('reveals every marker in a multi-line emphasis span', () => {
		const doc = '*foo\nbar*\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('foo'));

		expect(hiddenText).toEqual([]);
	});

	test('hides inline-link URL syntax on inactive lines', () => {
		const doc = '[label](https://example.com "Title")\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([
			'[',
			']',
			'(',
			'https://example.com',
			'"Title"',
			')',
		]);
	});

	test('leaves multi-line link syntax raw', () => {
		const doc = '[label](https://example.com "two\nline title")\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([]);
	});

	test('leaves nested image syntax raw inside a link label', () => {
		const doc = '[![alt](img.png)](https://example.com)\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['[', ']', '(', 'https://example.com', ')']);
	});

	test('leaves nested autolink syntax raw inside a link label', () => {
		const doc = '[<https://label.example>](https://example.com)\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['[', ']', '(', 'https://example.com', ')']);
	});

	test('does not hide list bullets or blockquote markers', () => {
		const doc = '- item\n> quote\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([]);
	});

	test('multi-range selection reveals every overlapped line', () => {
		const doc = '# One\n# Two\n# Three';
		const hiddenText = collectHiddenText(
			doc,
			EditorSelection.create([
				EditorSelection.cursor(doc.indexOf('One')),
				EditorSelection.cursor(doc.indexOf('Three')),
			]),
		);

		expect(hiddenText).toEqual(['#']);
	});

	test('hides link syntax when a title contains "]("', () => {
		const doc = '[x](u "a](b")\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual(['[', ']', '(', 'u', '"a](b"', ')']);
	});

	test('leaves images, reference links, and autolinks raw', () => {
		const doc = '![alt](image.png)\n[label][ref]\n<https://example.com>\nplain';
		const hiddenText = collectHiddenText(doc, doc.indexOf('plain'));

		expect(hiddenText).toEqual([]);
	});
});

function collectHiddenText(
	doc: string,
	selection: number | EditorSelection,
): string[] {
	const state = EditorState.create({
		doc,
		extensions: [EditorState.allowMultipleSelections.of(true), markdown()],
		selection:
			typeof selection === 'number'
				? EditorSelection.cursor(selection)
				: selection,
	});

	return collectHiddenMarkerRanges(state, [{ from: 0, to: state.doc.length }])
		.toSorted((left, right) => left.from - right.from || left.to - right.to)
		.map((range) => state.doc.sliceString(range.from, range.to));
}
