import {
	HighlightStyle,
	syntaxHighlighting,
	syntaxTree,
} from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';

type Span = {
	from: number;
	to: number;
};

/**
 * Construct node name to the marker children it hides on inactive lines.
 * Constructs absent from this table never hide anything, which keeps setext
 * underlines, fenced-code backticks, and image, reference-link, and autolink
 * punctuation visible.
 *
 * Hidden ranges must never span a line break: CodeMirror rejects replace
 * decorations that cross lines when they come from a view plugin. Every
 * marker here is single-line by the CommonMark grammar except LinkTitle,
 * which isPreviewableLink covers by leaving multi-line links raw.
 */
const hiddenMarkersByConstruct: Record<string, readonly string[]> = {
	ATXHeading1: ['HeaderMark'],
	ATXHeading2: ['HeaderMark'],
	ATXHeading3: ['HeaderMark'],
	ATXHeading4: ['HeaderMark'],
	ATXHeading5: ['HeaderMark'],
	ATXHeading6: ['HeaderMark'],
	Emphasis: ['EmphasisMark'],
	StrongEmphasis: ['EmphasisMark'],
	InlineCode: ['CodeMark'],
	Link: ['LinkMark', 'URL', 'LinkTitle'],
};

/**
 * Compute the marker spans to hide for the visible ranges. Pure with respect
 * to the editor state: it reads the syntax tree and the selection and returns
 * plain spans, which is the surface the tests assert on.
 *
 * A line is active when any selection range overlaps it. A construct that
 * touches an active line keeps all its markers raw; styling is not handled
 * here at all, it belongs to the syntax highlighter.
 */
export function collectHiddenMarkerRanges(
	state: EditorState,
	visibleRanges: readonly Span[],
): Span[] {
	const activeSpans = state.selection.ranges.map((range) => ({
		from: state.doc.lineAt(range.from).from,
		to: state.doc.lineAt(range.to).to,
	}));
	const isRevealed = (span: Span) =>
		activeSpans.some(
			(active) => active.from <= span.to && span.from <= active.to,
		);

	const tree = syntaxTree(state);
	const ranges: Span[] = [];

	for (const visibleRange of visibleRanges) {
		tree.iterate({
			from: visibleRange.from,
			to: visibleRange.to,
			enter(node) {
				const markers = hiddenMarkersByConstruct[node.type.name];
				if (!markers || isRevealed(node)) return;

				const construct = node.node;
				if (node.type.name === 'Link' && !isPreviewableLink(construct, state)) {
					return;
				}

				for (const markerName of markers) {
					for (const marker of construct.getChildren(markerName)) {
						ranges.push({ from: marker.from, to: marker.to });
					}
				}
			},
		});
	}

	return ranges;
}

/**
 * Live Markdown preview as pure view behavior: inactive lines hide marker
 * punctuation, lines touched by any selection show raw Markdown, and the
 * syntax highlighter styles constructs independently of the selection. The
 * extension never dispatches document changes.
 */
export function markdownLivePreview(): Extension {
	return [
		markdownLivePreviewPlugin,
		syntaxHighlighting(markdownPreviewHighlightStyle),
	];
}

const markdownLivePreviewPlugin = ViewPlugin.define(
	(view) => ({
		decorations: buildDecorations(view),
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.selectionSet ||
				update.viewportChanged ||
				// Background parsing dispatches updates as the tree grows; a
				// changed tree identity means new nodes may need decorating.
				syntaxTree(update.state) !== syntaxTree(update.startState)
			) {
				this.decorations = buildDecorations(update.view);
			}
		},
	}),
	{
		decorations: (plugin) => plugin.decorations,
	},
);

/**
 * Styling rides the highlight tags @lezer/markdown already emits: heading
 * tags apply through children, marker punctuation is processingInstruction,
 * and Link applies link styling through its children, so the visible label
 * is styled while the hidden syntax around it does not matter.
 */
const markdownPreviewHighlightStyle = HighlightStyle.define([
	{ tag: tags.heading1, fontSize: '1.25em', fontWeight: '700' },
	{ tag: tags.heading2, fontSize: '1.15em', fontWeight: '700' },
	{ tag: tags.heading3, fontSize: '1.08em', fontWeight: '700' },
	{ tag: tags.heading4, fontWeight: '700' },
	{ tag: tags.heading5, fontWeight: '700' },
	{ tag: tags.heading6, fontWeight: '700' },
	{ tag: tags.strong, fontWeight: '700' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{
		tag: tags.monospace,
		borderRadius: '0.25rem',
		backgroundColor: 'hsl(var(--muted))',
		padding: '0.05rem 0.25rem',
	},
	{
		tag: tags.link,
		color: 'hsl(var(--primary))',
		textDecoration: 'underline',
		textDecorationColor: 'hsl(var(--primary) / 0.45)',
		textUnderlineOffset: '0.18em',
	},
	{
		tag: tags.processingInstruction,
		color: 'hsl(var(--muted-foreground))',
	},
]);

const hideDecoration = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
	return Decoration.set(
		collectHiddenMarkerRanges(view.state, view.visibleRanges).map((range) =>
			hideDecoration.range(range.from, range.to),
		),
		true,
	);
}

/**
 * Whether a Link's syntax should hide on inactive lines. Reference and
 * shortcut links stay raw (they carry a LinkLabel instead of a URL child),
 * empty labels like [](url) stay raw because they would preview as nothing,
 * and multi-line links stay raw so no hidden range can span a line break.
 */
function isPreviewableLink(link: SyntaxNode, state: EditorState): boolean {
	if (!link.getChild('URL')) return false;

	const [labelOpen, labelClose] = link.getChildren('LinkMark');
	if (!labelOpen || !labelClose || labelOpen.to >= labelClose.from) {
		return false;
	}

	return state.doc.lineAt(link.from).to >= link.to;
}
