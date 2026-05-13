/**
 * Asset upload, read, and delete routes.
 *
 * Upload and delete require authentication + paid plan. Read is unauthenticated—
 * the unguessable URL (two 15-char nanoids) is the credential, same model as
 * Google Drive "anyone with the link", Discord CDN, and Supabase Storage.
 *
 * R2 bucket is private (no public domain, no r2.dev). All reads are proxied
 * through this Worker, which sets security headers and supports ETag/range.
 */

import { customAlphabet } from 'nanoid';

/**
 * 15-char alphanumeric ID generator—same spec as `generateGuid` in @epicenter/workspace.
 * Inlined here to avoid pulling workspace (and its Yjs dependency tree) into the
 * Cloudflare Worker bundle, where wrangler can't resolve it.
 */
const generateGuid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 15);

import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeRoute } from 'hono-openapi';
import { defineErrors } from 'wellcrafted/error';
import type { Env } from './app.js';
import { createAutumn } from './autumn.js';
import { FEATURE_IDS } from './billing-plans.js';
import { MAX_ASSET_BYTES } from './constants.js';
import * as schema from './db/schema.js';

const ALLOWED_MIME_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'application/pdf',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const AssetError = defineErrors({
	MissingFile: () => ({
		message: 'Missing file field in multipart body',
	}),
	FileTypeNotAllowed: ({ contentType }: { contentType: string }) => ({
		message: `File type not allowed: ${contentType}`,
		contentType,
		allowed: [...ALLOWED_MIME_TYPES],
	}),
	FileTooLarge: ({ size }: { size: number }) => ({
		message: `File exceeds ${MAX_ASSET_BYTES} byte limit (got ${size})`,
		size,
	}),
	StorageLimitExceeded: () => ({
		message: 'Storage limit exceeded',
	}),
	NotFound: () => ({
		message: 'Asset not found',
	}),
	Forbidden: () => ({
		message: 'Forbidden',
	}),
});

function sanitizeFilename(name: string): string {
	return Array.from(name)
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			return code > 0x1f && code !== 0x7f;
		})
		.join('')
		.replaceAll('"', "'")
		.trim()
		.slice(0, 255);
}

// ---------------------------------------------------------------------------
// Authenticated routes (mounted behind requireAppAccessToken in app.ts)
// ---------------------------------------------------------------------------

/** Authenticated routes (upload + delete). Mounted behind requireAppAccessToken in app.ts. */
export const assetAuthedRoutes = new Hono<Env>()
	// POST / — Create (upload)
	.post(
		'/',
		describeRoute({
			description: 'Upload an asset (image or PDF)',
			tags: ['assets'],
		}),
		bodyLimit({ maxSize: MAX_ASSET_BYTES }),
		async (c) => {
			// -- Extract + validate file before any external calls --
			const body = await c.req.parseBody();
			const file = body.file;
			if (!(file instanceof File)) {
				return c.json(AssetError.MissingFile(), 400);
			}

			const sanitizedFilename = sanitizeFilename(file.name);

			if (!ALLOWED_MIME_TYPES.has(file.type)) {
				return c.json(
					AssetError.FileTypeNotAllowed({ contentType: file.type }),
					415,
				);
			}

			if (file.size > MAX_ASSET_BYTES) {
				return c.json(AssetError.FileTooLarge({ size: file.size }), 413);
			}

			// -- Billing gate (after validation to avoid wasted calls) --
			const autumn = createAutumn(c.env);
			await autumn.customers.getOrCreate({
				customerId: c.var.user.id,
				email: c.var.user.email ?? undefined,
			});

			const { allowed } = await autumn.check({
				customerId: c.var.user.id,
				featureId: FEATURE_IDS.storageBytes,
				requiredBalance: file.size,
			});
			if (!allowed) {
				return c.json(AssetError.StorageLimitExceeded(), 402);
			}

			// -- Store in R2 + Postgres --
			const assetId = generateGuid();
			const key = `${c.var.user.id}/${assetId}`;

			await c.env.ASSETS_BUCKET.put(key, file.stream(), {
				httpMetadata: {
					contentType: file.type,
					contentDisposition: `inline; filename="${sanitizedFilename}"`,
					cacheControl: 'private, max-age=31536000, immutable',
				},
			});

			try {
				await c.var.db.insert(schema.asset).values({
					id: assetId,
					userId: c.var.user.id,
					contentType: file.type,
					sizeBytes: file.size,
					originalName: sanitizedFilename,
				});
			} catch (dbError) {
				// Compensating delete — don't leave orphaned R2 objects
				await c.env.ASSETS_BUCKET.delete(key).catch((r2Err) =>
					console.error('[upload] R2 cleanup failed:', r2Err),
				);
				throw dbError;
			}

			// Track storage usage (fire-and-forget after response)
			c.var.afterResponse.push(
				autumn.track({
					customerId: c.var.user.id,
					featureId: FEATURE_IDS.storageBytes,
					value: file.size,
				}),
			);

			return c.json(
				{
					id: assetId,
					url: `/api/assets/${c.var.user.id}/${assetId}`,
					contentType: file.type,
					size: file.size,
					originalName: sanitizedFilename,
				},
				201,
			);
		},
	)
	// GET / — List current user's assets
	.get(
		'/',
		describeRoute({
			description: "List the current user's assets",
			tags: ['assets'],
		}),
		async (c) => {
			const assets = await c.var.db
				.select()
				.from(schema.asset)
				.where(eq(schema.asset.userId, c.var.user.id))
				.orderBy(desc(schema.asset.uploadedAt))
				.limit(100);

			return c.json(assets);
		},
	)
	// GET /usage — Current user's total storage in bytes
	.get(
		'/usage',
		describeRoute({
			description: "Get the current user's total storage usage in bytes",
			tags: ['assets'],
		}),
		async (c) => {
			const result = await c.var.db
				.select({
					total: sql<number>`COALESCE(SUM(${schema.asset.sizeBytes}), 0)`,
				})
				.from(schema.asset)
				.where(eq(schema.asset.userId, c.var.user.id));
			const total = result[0]?.total ?? 0;

			return c.json({ totalBytes: total });
		},
	)
	// DELETE /:assetId — Delete (owner only)
	.delete(
		'/:assetId',
		describeRoute({
			description: 'Delete an asset (owner only)',
			tags: ['assets'],
		}),
		async (c) => {
			const { assetId } = c.req.param();

			// Atomic lookup + delete scoped by authenticated user
			const [deleted] = await c.var.db
				.delete(schema.asset)
				.where(
					and(
						eq(schema.asset.id, assetId),
						eq(schema.asset.userId, c.var.user.id),
					),
				)
				.returning({ sizeBytes: schema.asset.sizeBytes });

			if (!deleted) {
				return c.json(AssetError.NotFound(), 404);
			}

			const key = `${c.var.user.id}/${assetId}`;
			await c.env.ASSETS_BUCKET.delete(key);

			// Credit storage back (fire-and-forget after response)
			const autumn = createAutumn(c.env);
			c.var.afterResponse.push(
				autumn.track({
					customerId: c.var.user.id,
					featureId: FEATURE_IDS.storageBytes,
					value: -deleted.sizeBytes,
				}),
			);

			return c.body(null, 204);
		},
	)
	// POST /reconcile — Manual storage billing reconciliation (admin)
	.post(
		'/reconcile',
		describeRoute({
			description: 'Reconcile storage billing with Postgres totals',
			tags: ['assets', 'admin'],
		}),
		async (c) => {
			// Admin gate
			const adminIds = (c.env.ADMIN_USER_IDS ?? '').split(',').filter(Boolean);
			if (!adminIds.includes(c.var.user.id)) {
				return c.json(AssetError.Forbidden(), 403);
			}

			// Left join user → asset so zero-asset users get corrected too
			const userTotals = await c.var.db
				.select({
					userId: schema.user.id,
					totalBytes: sql<number>`COALESCE(SUM(${schema.asset.sizeBytes}), 0)`,
				})
				.from(schema.user)
				.leftJoin(schema.asset, eq(schema.user.id, schema.asset.userId))
				.groupBy(schema.user.id);

			const autumn = createAutumn(c.env);
			let errors = 0;
			const batchSize = 10;

			for (let i = 0; i < userTotals.length; i += batchSize) {
				const batch = userTotals.slice(i, i + batchSize);
				const results = await Promise.allSettled(
					batch.map(({ userId, totalBytes }) =>
						autumn.balances.update({
							customerId: userId,
							featureId: FEATURE_IDS.storageBytes,
							usage: totalBytes,
						}),
					),
				);
				errors += results.filter((r) => r.status === 'rejected').length;
			}

			return c.json({ usersProcessed: userTotals.length, errors });
		},
	);

// ---------------------------------------------------------------------------
// Public routes (mounted without requireAppAccessToken in app.ts)
// ---------------------------------------------------------------------------

/** Public routes (read). Mounted without requireAppAccessToken in app.ts. */
export const assetPublicRoutes = new Hono<Env>()
	// GET /:userId/:assetId — Read (unauthenticated, unguessable URL)
	.get(
		'/:userId/:assetId',
		describeRoute({
			description: 'Read an asset by ID (unauthenticated)',
			tags: ['assets'],
		}),
		async (c) => {
			const { userId, assetId } = c.req.param();
			const key = `${userId}/${assetId}`;

			const object = await c.env.ASSETS_BUCKET.get(key, {
				onlyIf: c.req.raw.headers,
				range: c.req.raw.headers,
			});

			if (object === null) {
				return c.body('Not found', 404);
			}

			// Bodyless object — precondition failed (ETag match → 304)
			if (!('body' in object)) {
				const headers = new Headers();
				object.writeHttpMetadata(headers);
				headers.set('etag', object.httpEtag);
				return new Response(null, { status: 304, headers });
			}

			// Build response headers
			const headers = new Headers();
			object.writeHttpMetadata(headers);
			headers.set('etag', object.httpEtag);
			headers.set('accept-ranges', 'bytes');
			headers.set('x-content-type-options', 'nosniff');
			if (object.uploaded) {
				headers.set('last-modified', object.uploaded.toUTCString());
			}

			// Range request → 206
			const range = object.range;
			if (range) {
				let start: number;
				let end: number;
				if ('suffix' in range) {
					const len = Math.min(range.suffix, object.size);
					start = object.size - len;
					end = object.size - 1;
				} else {
					start = range.offset ?? 0;
					end =
						range.length != null
							? Math.min(start + range.length - 1, object.size - 1)
							: object.size - 1;
				}
				headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
				headers.set('content-length', String(end - start + 1));
				return new Response(object.body, { status: 206, headers });
			}

			headers.set('content-length', String(object.size));
			return new Response(object.body, { status: 200, headers });
		},
	);
