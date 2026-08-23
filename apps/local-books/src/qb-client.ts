import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import type { QbObject } from './entities.ts';
import type { TokenError, TokenManager } from './token-manager.ts';

/**
 * The QuickBooks Online data-API client: the paginated query API for full pulls
 * and the `/cdc` endpoint for incremental refresh. Handles the wire concerns the
 * sync engine should not care about: bearer auth from the token manager,
 * one-shot refresh on 401, and backoff on 429 (`ThrottleExceeded`) / 5xx.
 *
 * Grounded limits (developer.intuit.com): 500 req/min and 10 concurrent per
 * realm; query/CDC return at most 1000 objects per page; CDC covers a 30-day
 * lookback. On 429 QuickBooks asks callers to wait ~60s.
 */

const QbApiError = defineErrors({
	Network: ({ cause }: { cause: unknown }) => ({
		message: `Network error calling the QuickBooks API: ${String(cause)}`,
		cause,
	}),
	Http: ({ status, body }: { status: number; body: string }) => ({
		message: `QuickBooks API returned ${status}: ${body.slice(0, 500)}`,
		status,
		body,
	}),
	Throttled: ({ retries }: { retries: number }) => ({
		message: `QuickBooks API throttled the request (429) after ${retries} retries.`,
		retries,
	}),
	InvalidResponse: ({ detail }: { detail: string }) => ({
		message: `QuickBooks API response was not the expected JSON shape: ${detail}`,
		detail,
	}),
});
type QbApiError = InferErrors<typeof QbApiError>;

export type QbClientError = QbApiError | TokenError;

/** A page of query results: the objects plus whether more pages may follow. */
type QueryPage = { objects: QbObject[]; hasMore: boolean };

/** CDC changes grouped by entity name. Deletes are included (status: "Deleted"). */
type CdcResult = { changes: Record<string, QbObject[]> };

export type QbClient = {
	readonly realmId: string;
	queryPage(
		entity: string,
		startPosition: number,
	): Promise<Result<QueryPage, QbClientError>>;
	queryAll(entity: string): Promise<Result<QbObject[], QbClientError>>;
	cdc(
		entities: string[],
		changedSince: string,
	): Promise<Result<CdcResult, QbClientError>>;
	/**
	 * Sparse-update one entity (the QuickBooks update POST). `body` carries the
	 * `Id`, the current `SyncToken`, `sparse: true`, the changed fields, and the
	 * entity's mandatory top-level fields, which QuickBooks requires even on a
	 * sparse update (omit one and it answers 400 ValidationFault code 2020, not a
	 * merge). QuickBooks returns the updated object with a bumped `SyncToken`. A
	 * stale `SyncToken` surfaces as an `Http` error (409), never a silent re-apply.
	 */
	update(
		entity: string,
		body: Record<string, unknown>,
	): Promise<Result<QbObject, QbClientError>>;
	/**
	 * Run a computed report live (the Reports API, `GET /reports/<name>`). These
	 * are the GAAP-structured statements QuickBooks owns the computation of (P&L,
	 * balance sheet, ...); there is no CDC for them, so they are read live rather
	 * than mirrored. `params` are passed through as the query string (`start_date`,
	 * `end_date`, `accounting_method`, ...). Returns the report JSON verbatim.
	 */
	report(
		name: string,
		params: Record<string, string>,
	): Promise<Result<Record<string, unknown>, QbClientError>>;
};

type QbClientDeps = {
	config: AppConfig;
	realmId: string;
	tokens: TokenManager;
	log?: (message: string) => void;
};

/** Retry budget for 429 / 5xx / transient network errors. */
const MAX_RETRIES = 5;
/** Wait applied on 429 when the response has no Retry-After. QuickBooks asks ~60s. */
const THROTTLE_WAIT_MS = 60_000;

function retryAfterMs(response: Response): number | null {
	const header = response.headers.get('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	return Number.isFinite(seconds) ? seconds * 1000 : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createQbClient(deps: QbClientDeps): QbClient {
	const { config, realmId, tokens } = deps;
	const log = deps.log ?? (() => {});
	const pageSize = config.pageSize;

	const backoffMs = (attempt: number) =>
		Math.min(THROTTLE_WAIT_MS, 500 * 2 ** attempt);

	async function request(
		path: string,
		params: Record<string, string>,
		write?: { body: unknown },
	): Promise<Result<unknown, QbClientError>> {
		const url = new URL(`${config.apiBase}/v3/company/${realmId}/${path}`);
		for (const [key, value] of Object.entries(params))
			url.searchParams.set(key, value);
		url.searchParams.set('minorversion', config.minorVersion);

		let attempt = 0;
		let refreshed = false;

		while (true) {
			const token = await tokens.getValidAccessToken();
			if (token.error) return token;

			let response: Response;
			try {
				response = await fetch(url.toString(), {
					method: write ? 'POST' : 'GET',
					headers: {
						Authorization: `Bearer ${token.data}`,
						Accept: 'application/json',
						...(write ? { 'Content-Type': 'application/json' } : {}),
					},
					body: write ? JSON.stringify(write.body) : undefined,
				});
			} catch (cause) {
				if (attempt < MAX_RETRIES) {
					attempt += 1;
					await sleep(backoffMs(attempt));
					continue;
				}
				return QbApiError.Network({ cause });
			}

			if (response.ok) {
				const json = await response.json().catch(() => null);
				if (json === null || typeof json !== 'object') {
					return QbApiError.InvalidResponse({
						detail: 'body was not a JSON object',
					});
				}
				return Ok(json);
			}

			if (response.status === 401 && !refreshed) {
				refreshed = true;
				const forced = await tokens.forceRefresh();
				if (forced.error) return forced;
				continue;
			}

			if (response.status === 429) {
				if (attempt >= MAX_RETRIES)
					return QbApiError.Throttled({ retries: attempt });
				attempt += 1;
				const wait = retryAfterMs(response) ?? THROTTLE_WAIT_MS;
				log(
					`QuickBooks throttled (429); waiting ${wait}ms before retry ${attempt}/${MAX_RETRIES}.`,
				);
				await sleep(wait);
				continue;
			}

			if (response.status >= 500) {
				if (attempt >= MAX_RETRIES) {
					const body = await response.text().catch(() => '');
					return QbApiError.Http({ status: response.status, body });
				}
				attempt += 1;
				await sleep(backoffMs(attempt));
				continue;
			}

			const body = await response.text().catch(() => '');
			return QbApiError.Http({ status: response.status, body });
		}
	}

	function extractQueryArray(json: unknown, entity: string): QbObject[] {
		const queryResponse = (json as { QueryResponse?: Record<string, unknown> })
			.QueryResponse;
		const arr = queryResponse?.[entity];
		return Array.isArray(arr) ? (arr as QbObject[]) : [];
	}

	const client: QbClient = {
		realmId,

		async queryPage(entity, startPosition) {
			const query = `select * from ${entity} startposition ${startPosition} maxresults ${pageSize}`;
			const { data, error } = await request('query', { query });
			if (error) return { data: null, error };
			const objects = extractQueryArray(data, entity);
			return Ok({ objects, hasMore: objects.length === pageSize });
		},

		async queryAll(entity) {
			const all: QbObject[] = [];
			let startPosition = 1;
			while (true) {
				const { data, error } = await client.queryPage(entity, startPosition);
				if (error) return { data: null, error };
				all.push(...data.objects);
				if (!data.hasMore) break;
				startPosition += pageSize;
			}
			return Ok(all);
		},

		async cdc(entities, changedSince) {
			const { data, error } = await request('cdc', {
				entities: entities.join(','),
				changedSince,
			});
			if (error) return { data: null, error };

			const changes: Record<string, QbObject[]> = {};
			const cdcResponse = (data as { CDCResponse?: unknown }).CDCResponse;
			if (Array.isArray(cdcResponse)) {
				for (const block of cdcResponse) {
					const queryResponses = (block as { QueryResponse?: unknown })
						.QueryResponse;
					if (!Array.isArray(queryResponses)) continue;
					for (const qr of queryResponses) {
						for (const entity of entities) {
							const arr = (qr as Record<string, unknown>)[entity];
							if (Array.isArray(arr)) {
								changes[entity] ??= [];
								changes[entity].push(...(arr as QbObject[]));
							}
						}
					}
				}
			}
			return Ok({ changes });
		},

		async update(entity, body) {
			// The update endpoint is the entity name lowercased; the response wraps
			// the saved object under its capitalized name (e.g. `{ Purchase: {...} }`).
			const { data, error } = await request(entity.toLowerCase(), {}, { body });
			if (error) return { data: null, error };
			const updated = (data as Record<string, unknown>)[entity];
			if (!updated || typeof updated !== 'object') {
				return QbApiError.InvalidResponse({
					detail: `update response missing the ${entity} object`,
				});
			}
			return Ok(updated as QbObject);
		},

		async report(name, params) {
			// `request` guarantees an Ok value is a non-null object (it emits
			// InvalidResponse itself otherwise), so no recheck is needed here.
			const { data, error } = await request(`reports/${name}`, params);
			if (error) return { data: null, error };
			return Ok(data as Record<string, unknown>);
		},
	};

	return client;
}
