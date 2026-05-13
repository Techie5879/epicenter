import { BEARER_SUBPROTOCOL_PREFIX, parseSubprotocols } from '@epicenter/sync';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { parseBearer } from './app-resource-auth.js';

/**
 * Lift the WebSocket bearer subprotocol into `Authorization: Bearer` so app
 * resource handlers and verification read one canonical input.
 *
 * ## Endpoint family this serves
 *
 * The app resource endpoint family (`/workspace-identity`, `/ai/*`,
 * `/workspaces/*`, `/documents/*`, `/api/billing/*`, `/api/assets/*`)
 * accepts exactly one credential: an OAuth app access token.
 *
 * - HTTP clients send `Authorization: Bearer <accessToken>`.
 * - Browser WebSocket clients cannot set `Authorization` on
 *   `new WebSocket(url)`. They smuggle the token through the handshake as
 *   `Sec-WebSocket-Protocol: epicenter, bearer.<accessToken>`.
 *
 * This middleware lifts a WS subprotocol bearer into `Authorization` and
 * strips it from `Sec-WebSocket-Protocol` so the raw token does not flow
 * past this layer. Mount it only on app resource endpoint families.
 *
 * ## Why this is not a cookie-vs-bearer policer
 *
 * Cookies are the credential for the *hosted auth* endpoint family
 * (`/sign-in`, `/consent`, `/auth/*`); they carry no meaning on app
 * resource routes. The app resource verifier in `app-resource-auth.ts`
 * verifies JWTs directly through the OAuth resource client against JWKS,
 * audience, issuer, and scope. It never consults a Better Auth cookie
 * session, so a stale account cookie cannot accidentally authorize an
 * app resource request, and there is no ambiguity worth rejecting at
 * this layer.
 *
 * ## Rejection cases (HTTP 400 `multiple_credentials`)
 *
 * - More than one `bearer.*` entry in `Sec-WebSocket-Protocol`.
 * - HTTP bearer and WS bearer both present but disagree.
 *
 * Two channels carrying the same token are accepted; the WS entry is
 * still stripped from `Sec-WebSocket-Protocol`.
 *
 * In-place request rewrite uses the same pattern as Hono's `bodyLimit`
 * (`hono/src/middleware/body-limit/index.ts`).
 */
export const normalizeAppAccessToken = createMiddleware(async (c, next) => {
	const headers = c.req.raw.headers;
	const httpBearer = parseBearer(headers.get('authorization'));
	const wsBearer = parseWsBearer(headers.get('sec-websocket-protocol'));

	if (wsBearer.type === 'duplicate') {
		throw new HTTPException(400, { message: 'multiple_credentials' });
	}

	if (
		httpBearer &&
		wsBearer.type === 'single' &&
		httpBearer !== wsBearer.token
	) {
		throw new HTTPException(400, { message: 'multiple_credentials' });
	}

	if (wsBearer.type === 'single') {
		const normalized = new Headers(headers);
		if (!httpBearer) {
			normalized.set('authorization', `Bearer ${wsBearer.token}`);
		}
		if (wsBearer.remaining.length > 0) {
			normalized.set('sec-websocket-protocol', wsBearer.remaining.join(', '));
		} else {
			normalized.delete('sec-websocket-protocol');
		}
		c.req.raw = new Request(c.req.raw, { headers: normalized });
	}

	await next();
});

type WsBearerResult =
	| { type: 'none' }
	| { type: 'single'; token: string; remaining: string[] }
	| { type: 'duplicate' };

function parseWsBearer(value: string | null): WsBearerResult {
	const protocols = parseSubprotocols(value).filter((p) => p !== '');
	const bearers: string[] = [];
	const remaining: string[] = [];
	for (const protocol of protocols) {
		if (protocol.startsWith(BEARER_SUBPROTOCOL_PREFIX)) {
			bearers.push(protocol.slice(BEARER_SUBPROTOCOL_PREFIX.length));
		} else {
			remaining.push(protocol);
		}
	}
	if (bearers.length === 0) return { type: 'none' };
	if (bearers.length > 1) return { type: 'duplicate' };
	return { type: 'single', token: bearers[0]!, remaining };
}
