import {
	EditorSelection,
	type EditorState,
	type SelectionRange,
} from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';

/**
 * Build the selection-preserving document change for a Markdown marker toggle.
 */
export function toggleMarkdownMarkerChange(state: EditorState, marker: string) {
	return state.changeByRange((range) =>
		markerChangeForRange(state, range, marker),
	);
}

function markerChangeForRange(
	state: EditorState,
	range: SelectionRange,
	marker: string,
) {
	if (range.empty) {
		return {
			changes: { from: range.from, insert: `${marker}${marker}` },
			range: EditorSelection.cursor(range.from + marker.length),
		};
	}

	const selected = state.sliceDoc(range.from, range.to);
	if (
		hasExactMarkerAt(state, range.from, marker) &&
		hasExactMarkerAt(state, range.to - marker.length, marker) &&
		selected.length >= marker.length * 2
	) {
		return {
			changes: [
				{ from: range.from, to: range.from + marker.length },
				{ from: range.to - marker.length, to: range.to },
			],
			range: EditorSelection.range(range.from, range.to - marker.length * 2),
		};
	}

	const hasOuterMarkers =
		range.from >= marker.length &&
		hasExactMarkerAt(state, range.from - marker.length, marker) &&
		hasExactMarkerAt(state, range.to, marker);
	if (hasOuterMarkers) {
		return {
			changes: [
				{ from: range.from - marker.length, to: range.from },
				{ from: range.to, to: range.to + marker.length },
			],
			range: EditorSelection.range(
				range.from - marker.length,
				range.to - marker.length,
			),
		};
	}

	return {
		changes: [
			{ from: range.from, insert: marker },
			{ from: range.to, insert: marker },
		],
		range: EditorSelection.range(
			range.from + marker.length,
			range.to + marker.length,
		),
	};
}

function hasExactMarkerAt(
	state: EditorState,
	from: number,
	marker: string,
): boolean {
	const to = from + marker.length;
	return (
		state.sliceDoc(from, to) === marker &&
		state.sliceDoc(from - 1, from) !== marker[0] &&
		state.sliceDoc(to, to + 1) !== marker[0]
	);
}

function toggleMarkdownMarker(marker: string): Command {
	return (view) => {
		view.dispatch({
			...toggleMarkdownMarkerChange(view.state, marker),
			scrollIntoView: true,
			userEvent: 'input',
		});
		return true;
	};
}

export const markdownShortcutKeymap: KeyBinding[] = [
	{ key: 'Mod-b', run: toggleMarkdownMarker('**'), preventDefault: true },
	{ key: 'Mod-i', run: toggleMarkdownMarker('*'), preventDefault: true },
	{ key: 'Mod-e', run: toggleMarkdownMarker('`'), preventDefault: true },
];
