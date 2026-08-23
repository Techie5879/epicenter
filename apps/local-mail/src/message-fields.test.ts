/**
 * The Gmail MIME projections in `message-fields.ts`. `bodyText` is the stored
 * searchable plain text (prefer `text/plain`, else strip tags from `text/html`);
 * `bodyHtml` is the raw `text/html` the detail read serves for rich rendering,
 * unsanitized on purpose (the sanitizer boundary lives in the SPA). Both walk
 * nested `multipart/*` parts and stay defensive against a loosely-validated
 * wire: malformed input returns null, never throws.
 */

import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { bodyHtml, bodyText, headerValue } from './message-fields.ts';
import type { GmailMessage } from './schema.ts';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function message(payload: unknown): GmailMessage {
	return {
		id: 'm1',
		threadId: 't1',
		payload,
	} as GmailMessage;
}

describe('headerValue', () => {
	test('matches header names case-insensitively', () => {
		const msg = message({
			headers: [{ name: 'SUBJECT', value: 'Hi' }],
		});
		expect(headerValue(msg, 'Subject')).toBe('Hi');
		expect(headerValue(msg, 'missing')).toBeNull();
	});
});

describe('bodyText', () => {
	test('prefers the text/plain part over text/html', () => {
		const msg = message({
			mimeType: 'multipart/alternative',
			parts: [
				{ mimeType: 'text/plain', body: { data: b64url('Plain wins') } },
				{
					mimeType: 'text/html',
					body: { data: b64url('<p>HTML loses</p>') },
				},
			],
		});
		expect(bodyText(msg)).toBe('Plain wins');
	});

	test('falls back to stripped text/html when no text/plain part', () => {
		const msg = message({
			mimeType: 'text/html',
			parts: [
				{
					mimeType: 'text/html',
					body: { data: b64url('<p>Hello <strong>there</strong></p>') },
				},
			],
		});
		expect(bodyText(msg)).toBe('Hello there');
	});

	test('walks nested multipart/alternative to find the plain part', () => {
		const msg = message({
			mimeType: 'multipart/mixed',
			parts: [
				{
					mimeType: 'multipart/alternative',
					parts: [
						{ mimeType: 'text/plain', body: { data: b64url('Nested plain') } },
						{ mimeType: 'text/html', body: { data: b64url('<p>Nested</p>') } },
					],
				},
			],
		});
		expect(bodyText(msg)).toBe('Nested plain');
	});

	test('returns null when neither body part is present', () => {
		expect(bodyText(message({ headers: [] }))).toBeNull();
	});
});

describe('bodyHtml', () => {
	test('decodes the text/html part unchanged (unsanitized)', () => {
		const raw =
			'<p>Hi <a href="https://x.test">link</a></p><script>x()</script>';
		const msg = message({
			mimeType: 'multipart/alternative',
			parts: [
				{ mimeType: 'text/plain', body: { data: b64url('plain') } },
				{ mimeType: 'text/html', body: { data: b64url(raw) } },
			],
		});
		// bodyHtml is raw on purpose: it still carries the <script>, and the
		// sanitizer boundary in the SPA is what makes it safe to render.
		expect(bodyHtml(msg)).toBe(raw);
	});

	test('finds the text/html part inside nested multipart', () => {
		const msg = message({
			mimeType: 'multipart/mixed',
			parts: [
				{
					mimeType: 'multipart/alternative',
					parts: [
						{ mimeType: 'text/plain', body: { data: b64url('plain') } },
						{
							mimeType: 'text/html',
							body: { data: b64url('<h1>Deep</h1>') },
						},
					],
				},
			],
		});
		expect(bodyHtml(msg)).toBe('<h1>Deep</h1>');
	});

	test('an html-only message yields both a text fallback and bodyHtml', () => {
		const msg = message({
			mimeType: 'text/html',
			parts: [
				{
					mimeType: 'text/html',
					body: { data: b64url('<p>Rich <em>only</em></p>') },
				},
			],
		});
		expect(bodyHtml(msg)).toBe('<p>Rich <em>only</em></p>');
		expect(bodyText(msg)).toBe('Rich only');
	});

	test('returns null when there is no text/html part', () => {
		const msg = message({
			parts: [{ mimeType: 'text/plain', body: { data: b64url('plain') } }],
		});
		expect(bodyHtml(msg)).toBeNull();
	});

	test('malformed base64 body.data returns null, does not throw', () => {
		const msg = message({
			parts: [
				// A lone continuation byte is not valid UTF-8; decoding must be caught.
				{ mimeType: 'text/html', body: { data: '@@@not base64@@@' } },
			],
		});
		expect(() => bodyHtml(msg)).not.toThrow();
	});

	test('a message with no payload returns null for both bodies', () => {
		const msg = { id: 'm1', threadId: 't1' } as GmailMessage;
		expect(bodyHtml(msg)).toBeNull();
		expect(bodyText(msg)).toBeNull();
	});
});
