// The one place email HTML is made safe to render. `getMessageDetail` ships
// `unsafeBodyHtml` (the raw `text/html` part) across the wire; nothing may reach
// an `{@html}` sink without passing through `sanitizeEmailHtml` first. Email
// HTML is hostile: it carries scripts, event handlers, and remote assets that
// are tracking pixels. DOMPurify strips the executable surface (scripts,
// `on*` handlers, `javascript:` URIs) by default; the hook below adds this
// app's two privacy rules: no remote-asset loads, and links that open in a new
// tab without leaking the opener.
//
// This runs in the browser only (the SPA is `ssr: false`), so DOMPurify has a
// real DOM; no jsdom shim is needed at runtime.

import DOMPurify from 'dompurify';

// Registered once at module load. DOMPurify hooks are global to the instance,
// and this module is its only configurer, so a single registration keeps every
// call consistent and never stacks duplicate hooks.
DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
	// Block remote-asset loads: every attribute here can fetch a URL the sender
	// controls, which is a read receipt. Stripping them keeps layout while
	// refusing the network request.
	for (const attr of ['src', 'srcset', 'background', 'poster', 'lowsrc']) {
		if (node.hasAttribute(attr)) node.removeAttribute(attr);
	}
	// Inline styles stay (that is where email layout lives), but not ones that
	// pull a remote asset via `url(...)` (background-image, list-style-image).
	const style = node.getAttribute('style');
	if (style && /url\s*\(/i.test(style)) node.removeAttribute('style');
	// Links leave the app in a new tab and never hand the opener a reference.
	if (node.tagName === 'A') {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

/** Sanitize one email HTML body for rendering. The return value is the only
 * string in the app permitted to reach an `{@html}` sink. */
export function sanitizeEmailHtml(html: string): string {
	return DOMPurify.sanitize(html, {
		// `<style>`/`<link>` can pull remote CSS (another asset load) and are
		// dropped; the rest of DOMPurify's safe-tag defaults stand.
		FORBID_TAGS: ['style', 'link', 'base'],
	});
}
