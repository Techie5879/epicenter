/**
 * An in-memory stand-in for the QuickBooks Online API, faithful to the shapes
 * the engine depends on: the paginated query API (full pull), the `/cdc`
 * change-since endpoint with soft-deletes (`status: "Deleted"`), and the OAuth2
 * token endpoint. Lets the test suite drive the real command paths end-to-end
 * without a live sandbox, and records which endpoints were hit so a test can
 * prove an incremental run did NOT re-pull.
 *
 * This is a test helper, not engine code: it may use Date.now()/Math.random().
 */

type StoredObject = {
	obj: Record<string, unknown>;
	updatedAt: number;
	deleted: boolean;
	deletedAt: number;
};

export type MockQbServer = {
	apiBase: string;
	tokenUrl: string;
	realmId: string;
	hits: {
		query: number;
		cdc: number;
		token: number;
		update: number;
		report: number;
	};
	/** Every update (sparse-update POST) body received, in order, for assertions. */
	updates: { entity: string; body: Record<string, unknown> }[];
	/** Insert or update a live object; stamps a fresh LastUpdatedTime. */
	put(entity: string, obj: Record<string, unknown>): void;
	/** Read a stored object back (post-write assertions). */
	get(entity: string, id: string): Record<string, unknown> | null;
	/** Soft-delete: future CDC calls report it with status "Deleted". */
	remove(entity: string, id: string): void;
	/** Count of live (non-deleted) objects, what a full pull would return. */
	liveCount(entity: string): number;
	/** Reject this access token with 401 (to exercise refresh-on-401). */
	rejectAccessToken(token: string): void;
	/** Make the next `n` data requests return 429 (to exercise backoff). */
	fail429(n: number): void;
	stop(): void;
};

/**
 * The mandatory top-level fields QuickBooks demands on an entity update even in
 * sparse mode: omit one and QB answers 400 ValidationFault code 2020 ("Required
 * parameter <field> is missing"), never a merge. Faithful to the live behavior
 * that broke `recategorize` (Purchase without PaymentType/AccountRef, Bill
 * without VendorRef), so a Line-only sparse body is rejected here just as it was
 * against the real sandbox.
 */
const UPDATE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
	Purchase: ['PaymentType', 'AccountRef'],
	Bill: ['VendorRef'],
};

function nowIso(ms: number): string {
	return new Date(ms).toISOString();
}

function metaUpdated(
	obj: Record<string, unknown>,
	ms: number,
): Record<string, unknown> {
	const existingMeta =
		(obj.MetaData as Record<string, unknown> | undefined) ?? {};
	return { ...obj, MetaData: { ...existingMeta, LastUpdatedTime: nowIso(ms) } };
}

export function startMockQbServer(
	options: { realmId?: string; now?: () => number } = {},
): MockQbServer {
	const realmId = options.realmId ?? '4620816365000000000';
	// Timestamp source for LastUpdatedTime / deletedAt. Tests inject a controlled
	// clock so it shares a timeline with the cursor the engine stores; the default
	// is a monotonic wall clock (so subprocess runs using real Date.now() align).
	let last = 0;
	const wallMonotonic = () => {
		const candidate = Math.max(Date.now(), last + 1);
		last = candidate;
		return candidate;
	};
	const now = options.now ?? wallMonotonic;
	const tick = () => now();

	const entities = new Map<string, Map<string, StoredObject>>();
	const hits = { query: 0, cdc: 0, token: 0, update: 0, report: 0 };
	const updates: { entity: string; body: Record<string, unknown> }[] = [];
	const rejectedTokens = new Set<string>();
	let pending429 = 0;

	const store = (entity: string) => {
		let map = entities.get(entity);
		if (!map) {
			map = new Map();
			entities.set(entity, map);
		}
		return map;
	};

	function put(entity: string, obj: Record<string, unknown>): void {
		const ms = tick();
		const id = String(obj.Id);
		store(entity).set(id, {
			// Every QB object carries a SyncToken (optimistic-concurrency version);
			// default it to "0" so fixtures need not spell it out.
			obj: metaUpdated({ SyncToken: '0', ...obj, Id: id }, ms),
			updatedAt: ms,
			deleted: false,
			deletedAt: 0,
		});
	}

	function remove(entity: string, id: string): void {
		const ms = tick();
		const current = store(entity).get(id);
		if (!current) return;
		current.deleted = true;
		current.deletedAt = ms;
	}

	function parseQuery(sql: string): {
		entity: string;
		startPosition: number;
		maxResults: number;
	} {
		const from = /from\s+(\w+)/i.exec(sql);
		const start = /startposition\s+(\d+)/i.exec(sql);
		const max = /maxresults\s+(\d+)/i.exec(sql);
		return {
			entity: from?.[1] ?? '',
			startPosition: start ? Number(start[1]) : 1,
			maxResults: max ? Number(max[1]) : 1000,
		};
	}

	function authProblem(request: Request): Response | null {
		const auth = request.headers.get('authorization') ?? '';
		const token = auth.replace(/^Bearer\s+/i, '');
		if (!token) {
			return Response.json({ fault: 'AUTHENTICATION' }, { status: 401 });
		}
		if (rejectedTokens.has(token)) {
			return Response.json({ fault: 'AUTHENTICATION' }, { status: 401 });
		}
		return null;
	}

	function throttleProblem(): Response | null {
		if (pending429 > 0) {
			pending429 -= 1;
			return Response.json(
				{ fault: { error: [{ code: '003001', message: 'ThrottleExceeded' }] } },
				{ status: 429, headers: { 'retry-after': '0' } },
			);
		}
		return null;
	}

	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);

			// OAuth2 token endpoint (authorization-code + refresh).
			if (
				url.pathname === '/oauth2/v1/tokens/bearer' &&
				request.method === 'POST'
			) {
				hits.token += 1;
				const accessToken = `access-${Math.random().toString(36).slice(2)}`;
				return Response.json({
					token_type: 'bearer',
					access_token: accessToken,
					refresh_token: `refresh-${Math.random().toString(36).slice(2)}`,
					expires_in: 3600,
					x_refresh_token_expires_in: 8726400,
				});
			}

			// Query API (full pull).
			const queryMatch = url.pathname === `/v3/company/${realmId}/query`;
			if (queryMatch) {
				const throttled = throttleProblem();
				if (throttled) return throttled;
				const denied = authProblem(request);
				if (denied) return denied;

				hits.query += 1;
				const { entity, startPosition, maxResults } = parseQuery(
					url.searchParams.get('query') ?? '',
				);
				const live = [...store(entity).values()]
					.filter((s) => !s.deleted)
					.sort((a, b) => a.updatedAt - b.updatedAt)
					.map((s) => s.obj);
				const page = live.slice(
					startPosition - 1,
					startPosition - 1 + maxResults,
				);
				const queryResponse: Record<string, unknown> = {
					startPosition,
					maxResults: page.length,
					totalCount: live.length,
				};
				if (page.length > 0) queryResponse[entity] = page;
				return Response.json({
					QueryResponse: queryResponse,
					time: nowIso(now()),
				});
			}

			// CDC (incremental).
			const cdcMatch = url.pathname === `/v3/company/${realmId}/cdc`;
			if (cdcMatch) {
				const throttled = throttleProblem();
				if (throttled) return throttled;
				const denied = authProblem(request);
				if (denied) return denied;

				hits.cdc += 1;
				const requested = (url.searchParams.get('entities') ?? '')
					.split(',')
					.filter(Boolean);
				const changedSince = Date.parse(
					url.searchParams.get('changedSince') ?? '',
				);
				const blocks = requested.map((entity) => {
					const changed: Record<string, unknown>[] = [];
					for (const s of store(entity).values()) {
						if (s.deleted) {
							if (s.deletedAt > changedSince) {
								changed.push({
									Id: s.obj.Id,
									status: 'Deleted',
									MetaData: { LastUpdatedTime: nowIso(s.deletedAt) },
								});
							}
						} else if (s.updatedAt > changedSince) {
							changed.push(s.obj);
						}
					}
					const queryResponse: Record<string, unknown> = {
						startPosition: 1,
						maxResults: changed.length,
						totalCount: changed.length,
					};
					if (changed.length > 0) queryResponse[entity] = changed;
					return queryResponse;
				});
				return Response.json({
					CDCResponse: [{ QueryResponse: blocks }],
					time: nowIso(now()),
				});
			}

			// Reports API (live computed statement), e.g. GET /v3/company/<realm>/reports/ProfitAndLoss.
			const reportMatch = new RegExp(
				`^/v3/company/${realmId}/reports/([A-Za-z]+)$`,
			).exec(url.pathname);
			if (request.method === 'GET' && reportMatch) {
				const throttled = throttleProblem();
				if (throttled) return throttled;
				const denied = authProblem(request);
				if (denied) return denied;

				hits.report += 1;
				const name = reportMatch[1];
				// A minimal but shaped report: echoes the period so a test can prove
				// the params were passed through.
				return Response.json({
					Header: {
						ReportName: name,
						StartPeriod: url.searchParams.get('start_date'),
						EndPeriod: url.searchParams.get('end_date'),
						ReportBasis: url.searchParams.get('accounting_method') ?? 'Accrual',
					},
					Rows: { Row: [] },
				});
			}

			// Entity update (sparse-update POST), e.g. POST /v3/company/<realm>/purchase.
			const writeMatch = new RegExp(`^/v3/company/${realmId}/([a-z]+)$`).exec(
				url.pathname,
			);
			const entityLc = writeMatch?.[1];
			if (
				request.method === 'POST' &&
				entityLc &&
				entityLc !== 'query' &&
				entityLc !== 'cdc'
			) {
				const throttled = throttleProblem();
				if (throttled) return throttled;
				const denied = authProblem(request);
				if (denied) return denied;

				hits.update += 1;
				const entity = entityLc.charAt(0).toUpperCase() + entityLc.slice(1);
				const body = (await request.json()) as Record<string, unknown>;
				updates.push({ entity, body });

				// A sparse update still carries the entity's mandatory top-level fields;
				// a Line-only body is a 400 ValidationFault (code 2020), never a merge.
				const missing = (UPDATE_REQUIRED_FIELDS[entity] ?? []).find(
					(field) => body[field] == null,
				);
				if (missing) {
					return Response.json(
						{
							Fault: {
								type: 'ValidationFault',
								Error: [
									{
										Message: `Required parameter ${missing} is missing`,
										code: '2020',
									},
								],
							},
						},
						{ status: 400 },
					);
				}

				const id = String(body.Id);
				const stored = store(entity).get(id);
				if (!stored || stored.deleted) {
					return Response.json(
						{ Fault: { Error: [{ Message: 'Object Not Found' }] } },
						{ status: 400 },
					);
				}
				// Optimistic concurrency: a stale SyncToken is rejected, never applied.
				const currentToken = String(stored.obj.SyncToken ?? '0');
				if (body.SyncToken != null && String(body.SyncToken) !== currentToken) {
					return Response.json(
						{
							Fault: {
								type: 'ValidationFault',
								Error: [{ Message: 'Stale Object Error', code: '5010' }],
							},
						},
						{ status: 409 },
					);
				}
				const ms = tick();
				const fields = { ...body };
				delete fields.sparse;
				delete fields.SyncToken;
				const nextToken = String(Number(currentToken) + 1);
				const merged = metaUpdated(
					{ ...stored.obj, ...fields, SyncToken: nextToken },
					ms,
				);
				stored.obj = merged;
				stored.updatedAt = ms;
				return Response.json({ [entity]: merged, time: nowIso(ms) });
			}

			return new Response('Not found', { status: 404 });
		},
	});

	const apiBase = `http://localhost:${server.port}`;
	return {
		apiBase,
		tokenUrl: `${apiBase}/oauth2/v1/tokens/bearer`,
		realmId,
		hits,
		updates,
		put,
		get: (entity, id) => store(entity).get(id)?.obj ?? null,
		remove,
		liveCount: (entity) =>
			[...store(entity).values()].filter((s) => !s.deleted).length,
		rejectAccessToken: (token) => rejectedTokens.add(token),
		fail429: (n) => {
			pending429 = n;
		},
		stop: () => server.stop(true),
	};
}

/** Minimal but realistic QuickBooks Invoice shape for fixtures. */
export function makeInvoice(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Id: id,
		DocNumber: `INV-${id}`,
		TxnDate: '2026-01-15',
		TotalAmt: 100 + Number(id),
		Balance: 0,
		CustomerRef: { value: '1', name: 'Acme' },
		Line: [
			{
				Amount: 100 + Number(id),
				DetailType: 'SalesItemLineDetail',
				SalesItemLineDetail: { ItemRef: { value: '1', name: 'Services' } },
			},
		],
		...overrides,
	};
}

/**
 * Minimal but realistic QuickBooks Purchase (an expense): one account-based
 * expense line whose `AccountRef` is the category the `recategorize` verb moves.
 */
export function makePurchase(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Id: id,
		SyncToken: '0',
		TxnDate: '2026-01-15',
		TotalAmt: 340,
		PaymentType: 'CreditCard',
		AccountRef: { value: '35', name: 'Mercury Checking' },
		Line: [
			{
				Id: '1',
				Amount: 340,
				DetailType: 'AccountBasedExpenseLineDetail',
				AccountBasedExpenseLineDetail: {
					AccountRef: { value: '60', name: 'Uncategorized Expense' },
				},
			},
		],
		...overrides,
	};
}

/**
 * Minimal but realistic QuickBooks Bill (a vendor bill): its mandatory
 * `VendorRef` plus one account-based expense line whose `AccountRef` is the
 * category the `recategorize` verb moves. The `VendorRef` is what a Line-only
 * sparse update drops, which is the bug this fixture guards.
 */
export function makeBill(
	id: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Id: id,
		SyncToken: '0',
		TxnDate: '2026-01-15',
		TotalAmt: 500,
		VendorRef: { value: '56', name: 'Norton Lumber and Building Materials' },
		Line: [
			{
				Id: '1',
				Amount: 500,
				DetailType: 'AccountBasedExpenseLineDetail',
				AccountBasedExpenseLineDetail: {
					AccountRef: { value: '60', name: 'Uncategorized Expense' },
				},
			},
		],
		...overrides,
	};
}
