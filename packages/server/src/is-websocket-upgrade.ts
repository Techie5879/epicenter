import type { Context } from 'hono';

/**
 * Whether the current request is a WebSocket upgrade.
 *
 * The HTTP `Upgrade` header carries a case-insensitive token (RFC 9110 §7.8).
 * Real-world clients send `websocket`, `WebSocket`, or `WEBSOCKET`; treat all
 * three the same so route handlers, CORS bypass, and protected-resource
 * failure responses stay aligned with WS-tunnelled bearer credentials.
 */
export function isWebSocketUpgrade(c: Context): boolean {
	return c.req.header('upgrade')?.toLowerCase() === 'websocket';
}
