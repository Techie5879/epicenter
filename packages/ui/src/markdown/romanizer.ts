/**
 * Romanization as a one-shot, language-agnostic strategy injected into the
 * markdown renderer.
 *
 * A {@link Romanizer} splits a run of text into segments and attaches a
 * `reading` to the ones that have one (pinyin for Chinese, romaji for Japanese,
 * and so on). It runs once per settled message, off the streaming path, so it
 * can be as heavy as a language needs. An app injects its romanizer; the
 * renderer stays generic and renders a `<ruby>` for every segment with a
 * `reading`.
 *
 * Invariant: concatenating every `segment.text` reproduces the input exactly,
 * so reading-less runs (Latin, punctuation, whitespace) pass through verbatim.
 */

/** One run of text, with a `reading` when it romanizes (absent = render as-is). */
export type Segment = { text: string; reading?: string };

/** Split text into segments, attaching a reading to the ones that have one. */
export type Romanizer = (text: string) => Segment[];

/** The default: one reading-less segment, so text passes through untouched. */
export const identityRomanizer: Romanizer = (text) => [{ text }];
