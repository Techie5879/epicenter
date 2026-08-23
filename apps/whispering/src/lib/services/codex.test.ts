/**
 * Codex Service Tests
 *
 * Verifies the direct ChatGPT OAuth and Responses protocol boundary.
 *
 * Key behaviors:
 * - PKCE exchange returns validated device-local sessions without token leaks
 * - Refresh work is keyed, reusable across rotations, and cleared explicitly
 * - Responses requests use the active session once and parse complete SSE output
 */
import { expect, test } from 'bun:test';
import { expectErr, expectOk } from 'wellcrafted/testing';
import { type CodexOAuthSession, createCodexService } from './codex.js';

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };
type JwtFixture = {
	alg?: string;
	chatgpt_account_id?: string;
	chatgpt_compute_residency?: string;
	email?: string;
	organizations?: Array<{ id: string }>;
	'https://api.openai.com/auth'?: {
		chatgpt_account_id?: string;
		chatgpt_compute_residency?: string;
	};
	requestCount?: number;
};
type EventFixture = {
	type: string;
	delta?: string;
	message?: string;
	error?: { message: string };
};

function setup({
	responses = [],
	now = () => 10_000,
}: {
	responses?: Response[];
	now?: () => number;
} = {}) {
	const calls: FetchCall[] = [];
	const queue = [...responses];
	const fetchRequest = async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ input, init });
		const response = queue.shift();
		if (!response) throw new Error('Unexpected fetch request');
		return response;
	};
	return {
		calls,
		service: createCodexService({ fetch: fetchRequest, now }),
	};
}

function createJwt(payload: JwtFixture) {
	const encode = (value: JwtFixture) =>
		btoa(JSON.stringify(value))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
	return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function createSession(
	overrides: Partial<CodexOAuthSession> = {},
): CodexOAuthSession {
	return {
		accessToken: createJwt({}),
		refreshToken: 'refresh-original',
		expiresAt: 120_000,
		accountId: 'account-original',
		email: 'person@example.com',
		...overrides,
	};
}

function createEventStream(...events: Array<EventFixture | '[DONE]'>) {
	return new Response(
		events
			.map((event) =>
				event === '[DONE]' ? 'data: [DONE]' : `data: ${JSON.stringify(event)}`,
			)
			.join('\n\n'),
		{ headers: { 'Content-Type': 'text/event-stream' } },
	);
}

function completedStream(text = 'Done') {
	return createEventStream(
		{ type: 'response.output_text.delta', delta: text },
		{ type: 'response.completed' },
		'[DONE]',
	);
}

function getRefreshToken(call: FetchCall | undefined) {
	return new URLSearchParams(call?.init?.body?.toString()).get('refresh_token');
}

test('createAuthorization builds the pinned PKCE request', async () => {
	const service = createCodexService({
		randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index),
		sha256: async () => Uint8Array.from([251, 255, 254]).buffer,
	});

	const authorization = expectOk(await service.createAuthorization());

	expect(authorization.verifier).toHaveLength(43);
	expect(authorization.verifier).toMatch(/^[A-Za-z0-9._~-]{43}$/);
	const url = new URL(authorization.authorizeUrl);
	expect(url.origin).toBe('https://auth.openai.com');
	expect(url.pathname).toBe('/oauth/authorize');
	expect(Object.fromEntries(url.searchParams)).toMatchObject({
		response_type: 'code',
		client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
		redirect_uri: 'http://localhost:1455/auth/callback',
		scope: 'openid profile email offline_access',
		code_challenge: '-__-',
		code_challenge_method: 'S256',
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		originator: 'whispering',
		state: authorization.state,
	});
});

test('exchangeAuthorizationCode validates tokens and uses pinned identity precedence', async () => {
	const accessToken = createJwt({
		chatgpt_account_id: 'access-direct',
		email: 'access@example.com',
	});
	const idToken = createJwt({
		'https://api.openai.com/auth': {
			chatgpt_account_id: 'id-namespaced',
		},
		organizations: [{ id: 'id-organization' }],
		email: 'id@example.com',
	});
	const { calls, service } = setup({
		responses: [
			Response.json({
				access_token: accessToken,
				refresh_token: 'refresh-new',
				id_token: idToken,
				expires_in: 120,
			}),
		],
	});

	const session = expectOk(
		await service.exchangeAuthorizationCode({
			code: 'authorization-code',
			verifier: 'pkce-verifier',
		}),
	);

	expect(session).toEqual({
		accessToken,
		refreshToken: 'refresh-new',
		expiresAt: 130_000,
		accountId: 'id-namespaced',
		email: 'id@example.com',
	});
	expect(calls[0]?.input.toString()).toBe(
		'https://auth.openai.com/oauth/token',
	);
	expect(
		Object.fromEntries(new URLSearchParams(calls[0]?.init?.body?.toString())),
	).toEqual({
		grant_type: 'authorization_code',
		code: 'authorization-code',
		redirect_uri: 'http://localhost:1455/auth/callback',
		client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
		code_verifier: 'pkce-verifier',
	});
});

test('token identity uses direct, namespaced, then organization account claims', async () => {
	const { service } = setup({
		responses: [
			Response.json({
				access_token: createJwt({}),
				refresh_token: 'refresh-direct',
				id_token: createJwt({
					chatgpt_account_id: 'account-direct',
					'https://api.openai.com/auth': {
						chatgpt_account_id: 'account-namespaced',
					},
					organizations: [{ id: 'account-organization' }],
				}),
			}),
			Response.json({
				access_token: createJwt({
					'https://api.openai.com/auth': {
						chatgpt_account_id: 'account-namespaced',
					},
					organizations: [{ id: 'account-organization' }],
				}),
				refresh_token: 'refresh-namespaced',
			}),
			Response.json({
				access_token: createJwt({
					organizations: [{ id: 'account-organization' }],
				}),
				refresh_token: 'refresh-organization',
			}),
		],
	});

	const accountIds: Array<string | undefined> = [];
	for (const suffix of ['direct', 'namespaced', 'organization']) {
		const session = expectOk(
			await service.exchangeAuthorizationCode({
				code: `code-${suffix}`,
				verifier: 'pkce',
			}),
		);
		accountIds.push(session.accountId);
	}

	expect(accountIds).toEqual([
		'account-direct',
		'account-namespaced',
		'account-organization',
	]);
});

test('exchangeAuthorizationCode does not expose malformed token bodies', async () => {
	const leakedAccess = 'secret-access-token';
	const leakedRefresh = 'secret-refresh-token';
	const { service } = setup({
		responses: [
			new Response(`{"access_token":"${leakedAccess}"`),
			Response.json({ refresh_token: leakedRefresh }),
		],
	});

	const malformed = expectErr(
		await service.exchangeAuthorizationCode({ code: 'code', verifier: 'pkce' }),
	);
	const invalid = expectErr(
		await service.exchangeAuthorizationCode({ code: 'code', verifier: 'pkce' }),
	);

	expect(malformed.name).toBe('InvalidTokenResponse');
	expect(invalid.name).toBe('InvalidTokenResponse');
	for (const error of [malformed, invalid]) {
		expect(JSON.stringify(error)).not.toContain(leakedAccess);
		expect(JSON.stringify(error)).not.toContain(leakedRefresh);
	}
});

test('ensureActiveSession refreshes at exactly the 60-second boundary', async () => {
	const refreshedAccessToken = createJwt({});
	const { calls, service } = setup({
		responses: [
			Response.json({
				access_token: refreshedAccessToken,
				refresh_token: 'refresh-new',
				expires_in: 120,
			}),
		],
	});

	const activeSession = createSession({ expiresAt: 70_001 });
	expectOk(await service.ensureActiveSession(activeSession));
	const refreshed = expectOk(
		await service.ensureActiveSession(createSession({ expiresAt: 70_000 })),
	);

	expect(calls).toHaveLength(1);
	expect(refreshed.accessToken).toBe(refreshedAccessToken);
	expect(refreshed.expiresAt).toBe(130_000);
});

test('simultaneous activations with one refresh token share one request', async () => {
	let resolveRefresh: ((response: Response) => void) | undefined;
	const heldRefresh = new Promise<Response>((resolve) => {
		resolveRefresh = resolve;
	});
	let refreshRequests = 0;
	const service = createCodexService({
		now: () => 10_000,
		fetch: async () => {
			refreshRequests += 1;
			return heldRefresh;
		},
	});
	const staleSession = createSession({ expiresAt: 70_000 });

	const first = service.ensureActiveSession(staleSession);
	const second = service.ensureActiveSession(staleSession);
	await Promise.resolve();

	expect(refreshRequests).toBe(1);
	resolveRefresh?.(
		Response.json({
			access_token: createJwt({}),
			refresh_token: 'refresh-new',
			expires_in: 120,
		}),
	);
	const [firstSession, secondSession] = await Promise.all([first, second]);
	expect(expectOk(firstSession).refreshToken).toBe('refresh-new');
	expect(expectOk(secondSession).refreshToken).toBe('refresh-new');
});

test('overlapping activations keep distinct refresh tokens isolated', async () => {
	let resolveAccountA: ((response: Response) => void) | undefined;
	let resolveAccountB: ((response: Response) => void) | undefined;
	const heldResponses = new Map([
		[
			'refresh-a',
			new Promise<Response>((resolve) => {
				resolveAccountA = resolve;
			}),
		],
		[
			'refresh-b',
			new Promise<Response>((resolve) => {
				resolveAccountB = resolve;
			}),
		],
	]);
	const refreshTokens: string[] = [];
	const service = createCodexService({
		now: () => 10_000,
		fetch: async (_input, init) => {
			const refreshToken = new URLSearchParams(init?.body?.toString()).get(
				'refresh_token',
			);
			if (!refreshToken) throw new Error('Missing refresh token');
			refreshTokens.push(refreshToken);
			const response = heldResponses.get(refreshToken);
			if (!response) throw new Error('Unexpected refresh token');
			return response;
		},
	});

	const accountA = service.ensureActiveSession(
		createSession({ refreshToken: 'refresh-a', expiresAt: 70_000 }),
	);
	const accountB = service.ensureActiveSession(
		createSession({ refreshToken: 'refresh-b', expiresAt: 70_000 }),
	);
	await Promise.resolve();

	expect(refreshTokens).toEqual(['refresh-a', 'refresh-b']);
	resolveAccountB?.(
		Response.json({
			access_token: createJwt({ chatgpt_account_id: 'account-b' }),
			refresh_token: 'refresh-b1',
			expires_in: 120,
		}),
	);
	resolveAccountA?.(
		Response.json({
			access_token: createJwt({ chatgpt_account_id: 'account-a' }),
			refresh_token: 'refresh-a1',
			expires_in: 120,
		}),
	);
	expect(expectOk(await accountA).accountId).toBe('account-a');
	expect(expectOk(await accountB).accountId).toBe('account-b');
});

test('a settled refresh remains reusable while an earlier response is held', async () => {
	let resolveFirstResponse: ((response: Response) => void) | undefined;
	const heldResponse = new Promise<Response>((resolve) => {
		resolveFirstResponse = resolve;
	});
	let refreshRequests = 0;
	let completionRequests = 0;
	const refreshedAccessToken = createJwt({});
	const service = createCodexService({
		now: () => 10_000,
		fetch: async (input) => {
			if (input.toString().endsWith('/oauth/token')) {
				refreshRequests += 1;
				return Response.json({
					access_token: refreshedAccessToken,
					refresh_token: 'refresh-r1',
					expires_in: 120,
				});
			}
			completionRequests += 1;
			return completionRequests === 1
				? heldResponse
				: completedStream('Second');
		},
	});
	const staleSession = createSession({ expiresAt: 70_000 });
	const params = {
		model: 'gpt-5.3-codex-spark',
		systemPrompt: 'Rewrite clearly.',
		userPrompt: 'Input text',
	};

	const firstSession = expectOk(
		await service.ensureActiveSession(staleSession),
	);
	const firstCompletion = service.complete({
		...params,
		session: firstSession,
	});
	while (completionRequests === 0) await Promise.resolve();
	const secondSession = expectOk(
		await service.ensureActiveSession(staleSession),
	);
	const secondResult = expectOk(
		await service.complete({ ...params, session: secondSession }),
	);

	expect(secondResult).toBe('Second');
	expect(refreshRequests).toBe(1);
	expect(firstSession.accessToken).toBe(refreshedAccessToken);
	expect(secondSession.accessToken).toBe(refreshedAccessToken);
	resolveFirstResponse?.(completedStream('First'));
	expect(expectOk(await firstCompletion)).toBe('First');
});

test('stale callers follow settled refresh rotation from R0 through R2', async () => {
	let currentTime = 10_000;
	const refreshTokens: Array<string | null> = [];
	const rotatingService = createCodexService({
		now: () => currentTime,
		fetch: async (_input, init) => {
			const refreshToken = new URLSearchParams(init?.body?.toString()).get(
				'refresh_token',
			);
			refreshTokens.push(refreshToken);
			if (refreshToken === 'refresh-r0') {
				return Response.json({
					access_token: createJwt({}),
					refresh_token: 'refresh-r1',
					expires_in: 120,
				});
			}
			if (refreshToken === 'refresh-r1') {
				return Response.json({
					access_token: createJwt({}),
					refresh_token: 'refresh-r2',
					expires_in: 120,
				});
			}
			throw new Error('Unexpected refresh token');
		},
	});
	const staleSession = createSession({
		refreshToken: 'refresh-r0',
		expiresAt: 70_000,
	});

	expect(
		expectOk(await rotatingService.ensureActiveSession(staleSession))
			.refreshToken,
	).toBe('refresh-r1');
	currentTime = 70_000;
	expect(
		expectOk(await rotatingService.ensureActiveSession(staleSession))
			.refreshToken,
	).toBe('refresh-r2');

	expect(refreshTokens).toEqual(['refresh-r0', 'refresh-r1']);
});

test('clearSessionCache stops stale callers from reusing settled credentials', async () => {
	let requestCount = 0;
	const refreshTokens: Array<string | null> = [];
	const service = createCodexService({
		now: () => 10_000,
		fetch: async (_input, init) => {
			requestCount += 1;
			refreshTokens.push(
				new URLSearchParams(init?.body?.toString()).get('refresh_token'),
			);
			return Response.json({
				access_token: createJwt({ requestCount }),
				refresh_token: `refresh-r${requestCount}`,
				expires_in: 120,
			});
		},
	});
	const staleSession = createSession({
		refreshToken: 'refresh-r0',
		expiresAt: 70_000,
	});

	await service.ensureActiveSession(staleSession);
	service.clearSessionCache();
	const second = expectOk(await service.ensureActiveSession(staleSession));

	expect(second.refreshToken).toBe('refresh-r2');
	expect(refreshTokens).toEqual(['refresh-r0', 'refresh-r0']);
});

test('failed refreshes are evicted before a retry', async () => {
	const refreshedAccessToken = createJwt({});
	const { calls, service } = setup({
		responses: [
			new Response(null, { status: 500 }),
			Response.json({ access_token: refreshedAccessToken, expires_in: 120 }),
		],
	});
	const staleSession = createSession({ expiresAt: 70_000 });

	expect(expectErr(await service.ensureActiveSession(staleSession)).name).toBe(
		'TokenRefreshFailed',
	);
	expect(
		expectOk(await service.ensureActiveSession(staleSession)).accessToken,
	).toBe(refreshedAccessToken);
	expect(calls).toHaveLength(2);
});

test('refresh rotation cycles return a sanitized error', async () => {
	let currentTime = 10_000;
	const service = createCodexService({
		now: () => currentTime,
		fetch: async (_input, init) => {
			const refreshToken = new URLSearchParams(init?.body?.toString()).get(
				'refresh_token',
			);
			return Response.json({
				access_token: createJwt({}),
				refresh_token:
					refreshToken === 'private-refresh-r0'
						? 'private-refresh-r1'
						: 'private-refresh-r0',
				expires_in: 60,
			});
		},
	});
	const staleSession = createSession({
		refreshToken: 'private-refresh-r0',
		expiresAt: 70_000,
	});

	await service.ensureActiveSession(staleSession);
	currentTime = 10_001;
	await service.ensureActiveSession(staleSession);
	const error = expectErr(await service.ensureActiveSession(staleSession));

	expect(error.name).toBe('InvalidTokenResponse');
	expect(JSON.stringify(error)).not.toContain('private-refresh-r0');
	expect(JSON.stringify(error)).not.toContain('private-refresh-r1');
});

test('complete sends Spark input as a message list and parses SSE data', async () => {
	const { calls, service } = setup({
		responses: [
			new Response(
				[
					'event: response.output_text.delta\r\n',
					'data: {"type":\r\n',
					'data: "response.output_text.delta","delta":"Fast "}\r\n\r\n',
					'data: {"type":"response.output_text.delta","delta":"result"}\n\n',
					'data: {"type":"response.completed"}\r\n\r\n',
					'data: [DONE]',
				].join(''),
				{ headers: { 'Content-Type': 'text/event-stream' } },
			),
		],
	});
	const session = createSession();
	const controller = new AbortController();

	const text = expectOk(
		await service.complete({
			session,
			model: 'gpt-5.3-codex-spark',
			systemPrompt: 'Rewrite clearly.',
			userPrompt: 'Input text',
			signal: controller.signal,
		}),
	);

	expect(text).toBe('Fast result');
	expect(calls[0]?.input.toString()).toBe(
		'https://chatgpt.com/backend-api/codex/responses',
	);
	expect(calls[0]?.init?.signal).toBe(controller.signal);
	expect(JSON.parse(calls[0]?.init?.body?.toString() ?? '')).toEqual({
		model: 'gpt-5.3-codex-spark',
		instructions: 'Rewrite clearly.',
		input: [
			{
				role: 'user',
				content: [{ type: 'input_text', text: 'Input text' }],
			},
		],
		store: false,
		stream: true,
	});
});

test('complete derives residency from only the active access token', async () => {
	const { calls, service } = setup({
		responses: [completedStream(), completedStream(), completedStream()],
	});
	const namespacedToken = createJwt({
		chatgpt_compute_residency: 'direct-loses',
		'https://api.openai.com/auth': { chatgpt_compute_residency: 'eu' },
	});
	const params = {
		model: 'gpt-5.3-codex-spark',
		systemPrompt: 'Rewrite clearly.',
		userPrompt: 'Input text',
	};

	await service.complete({
		...params,
		session: createSession({ accessToken: namespacedToken }),
	});
	await service.complete({
		...params,
		session: createSession({
			accessToken: createJwt({
				chatgpt_compute_residency: 'direct-fallback',
				'https://api.openai.com/auth': {
					chatgpt_compute_residency: 'no_constraint',
				},
			}),
		}),
	});
	await service.complete({
		...params,
		session: createSession({ accessToken: 'malformed-active-token' }),
	});

	expect(
		calls.map((call) =>
			new Headers(call.init?.headers).get('x-openai-internal-codex-residency'),
		),
	).toEqual(['eu', null, null]);
});

test('complete sends account and subscription headers', async () => {
	const { calls, service } = setup({ responses: [completedStream()] });
	const session = createSession();

	expectOk(
		await service.complete({
			session,
			model: 'gpt-5.3-codex-spark',
			systemPrompt: 'System',
			userPrompt: 'User',
		}),
	);

	expect(Object.fromEntries(new Headers(calls[0]?.init?.headers))).toEqual({
		accept: 'text/event-stream',
		authorization: `Bearer ${session.accessToken}`,
		'chatgpt-account-id': 'account-original',
		'content-type': 'application/json',
		originator: 'whispering',
	});
});

test('complete never refreshes the already-active session', async () => {
	const calls: FetchCall[] = [];
	const service = createCodexService({
		now: () => Number.MAX_SAFE_INTEGER,
		fetch: async (input, init) => {
			calls.push({ input, init });
			return completedStream();
		},
	});

	expectOk(
		await service.complete({
			session: createSession({ expiresAt: 0 }),
			model: 'gpt-5.3-codex-spark',
			systemPrompt: 'System',
			userPrompt: 'User',
		}),
	);

	expect(calls).toHaveLength(1);
	expect(calls[0]?.input.toString()).toBe(
		'https://chatgpt.com/backend-api/codex/responses',
	);
});

test('complete sanitizes rejected and failed Responses errors', async () => {
	const privateBody = 'private-response-body';
	const { service } = setup({
		responses: [
			new Response(privateBody, { status: 403 }),
			createEventStream({
				type: 'response.failed',
				error: { message: privateBody },
			}),
			createEventStream({ type: 'error', message: privateBody }),
		],
	});
	const params = {
		session: createSession(),
		model: 'gpt-5.3-codex-spark',
		systemPrompt: 'System',
		userPrompt: 'User',
	};

	const rejected = expectErr(await service.complete(params));
	const failed = expectErr(await service.complete(params));
	const errored = expectErr(await service.complete(params));

	expect(rejected.name).toBe('RequestFailed');
	expect(failed.name).toBe('GenerationFailed');
	expect(errored.name).toBe('GenerationFailed');
	expect(JSON.stringify([rejected, failed, errored])).not.toContain(
		privateBody,
	);
});

test('complete rejects malformed and incomplete SSE streams', async () => {
	const { service } = setup({
		responses: [
			new Response('data: {not json\n\n'),
			createEventStream(
				{ type: 'response.output_text.delta', delta: 'Partial' },
				'[DONE]',
			),
		],
	});
	const params = {
		session: createSession(),
		model: 'gpt-5.3-codex-spark',
		systemPrompt: 'System',
		userPrompt: 'User',
	};

	expect(expectErr(await service.complete(params)).name).toBe(
		'InvalidResponse',
	);
	expect(expectErr(await service.complete(params)).name).toBe(
		'InvalidResponse',
	);
});

test('complete rejects a completed SSE stream with no text', async () => {
	const { service } = setup({
		responses: [createEventStream({ type: 'response.completed' }, '[DONE]')],
	});

	const error = expectErr(
		await service.complete({
			session: createSession(),
			model: 'gpt-5.3-codex-spark',
			systemPrompt: 'System',
			userPrompt: 'User',
		}),
	);

	expect(error.name).toBe('EmptyResponse');
});

test('refresh requests preserve missing replacement identity and token fields', async () => {
	const accessToken = createJwt({});
	const { calls, service } = setup({
		responses: [Response.json({ access_token: accessToken, expires_in: 120 })],
	});
	const staleSession = createSession({ expiresAt: 70_000 });

	const refreshed = expectOk(await service.ensureActiveSession(staleSession));

	expect(refreshed).toEqual({
		...staleSession,
		accessToken,
		expiresAt: 130_000,
	});
	expect(getRefreshToken(calls[0])).toBe('refresh-original');
});
