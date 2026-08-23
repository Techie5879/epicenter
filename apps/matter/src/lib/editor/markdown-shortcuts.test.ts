/**
 * Markdown Shortcut Tests
 *
 * Verifies the document changes behind Matter's editor formatting shortcuts:
 * wrapping, unwrapping, cursor insertion, nested markers, and multiple ranges.
 */

import { describe, expect, test } from 'bun:test';
import {
	EditorSelection,
	EditorState,
	type SelectionRange,
} from '@codemirror/state';
import { toggleMarkdownMarkerChange } from './markdown-shortcuts.js';

describe('toggleMarkdownMarkerChange', () => {
	test('wraps a selection', () => {
		const next = apply('hello', EditorSelection.range(0, 5), '**');

		expect(next.doc.toString()).toBe('**hello**');
		expect(next.selection.main.from).toBe(2);
		expect(next.selection.main.to).toBe(7);
	});

	test('inserts paired markers at a cursor', () => {
		const next = apply('hello', EditorSelection.cursor(0), '**');

		expect(next.doc.toString()).toBe('****hello');
		expect(next.selection.main.head).toBe(2);
	});

	test('unwraps markers included in the selection', () => {
		const next = apply('**hello**', EditorSelection.range(0, 9), '**');

		expect(next.doc.toString()).toBe('hello');
		expect(next.selection.main.from).toBe(0);
		expect(next.selection.main.to).toBe(5);
	});

	test('unwraps markers around the selection', () => {
		const next = apply('**hello**', EditorSelection.range(2, 7), '**');

		expect(next.doc.toString()).toBe('hello');
		expect(next.selection.main.from).toBe(0);
		expect(next.selection.main.to).toBe(5);
	});

	test('wraps italic markers inside bold markers', () => {
		const next = apply('**hello**', EditorSelection.range(2, 7), '*');

		expect(next.doc.toString()).toBe('***hello***');
		expect(next.selection.main.from).toBe(3);
		expect(next.selection.main.to).toBe(8);
	});

	test('wraps italic markers around a bold selection', () => {
		const next = apply('**hello**', EditorSelection.range(0, 9), '*');

		expect(next.doc.toString()).toBe('***hello***');
		expect(next.selection.main.from).toBe(1);
		expect(next.selection.main.to).toBe(10);
	});

	test('updates multiple ranges in one transaction', () => {
		const next = apply(
			'one two',
			EditorSelection.create([
				EditorSelection.range(0, 3),
				EditorSelection.range(4, 7),
			]),
			'*',
		);

		expect(next.doc.toString()).toBe('*one* *two*');
		expect(
			next.selection.ranges.map((range) => [range.from, range.to]),
		).toEqual([
			[1, 4],
			[7, 10],
		]);
	});
});

function apply(
	doc: string,
	selection: EditorSelection | SelectionRange,
	marker: string,
): EditorState {
	const state = EditorState.create({
		doc,
		extensions: [EditorState.allowMultipleSelections.of(true)],
		selection:
			'ranges' in selection ? selection : EditorSelection.create([selection]),
	});
	return state.update(toggleMarkdownMarkerChange(state, marker)).state;
}
