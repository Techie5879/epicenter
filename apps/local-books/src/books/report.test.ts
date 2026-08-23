/**
 * `fetchReport` driven against the mock QuickBooks Reports endpoint: the live
 * passthrough (a call hits the Reports API, no mirror, no cache) with the period
 * params passed through. The CLI `report` verb is a thin adapter over this.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConfig } from '../../test/helpers.ts';
import { startMockQbServer } from '../../test/mock-qb-server.ts';
import { createFileTokenStore } from '../token-store.ts';
import type { TokenSet } from '../tokens.ts';
import { createQbAccess } from './qb-access.ts';
import { fetchReport } from './report.ts';

const NOW = Date.parse('2026-02-01T00:00:00.000Z');
const now = () => NOW;

async function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'local-books-'));
	const mock = startMockQbServer({ now });
	const tokenFile = join(dir, 'credentials.json');
	const config = makeConfig({
		dataDir: dir,
		apiBase: mock.apiBase,
		tokenUrl: mock.tokenUrl,
		credentialsPath: tokenFile,
	});
	const store = createFileTokenStore(tokenFile);
	const token: TokenSet = {
		realmId: mock.realmId,
		environment: 'sandbox',
		accessToken: 'access-seed',
		refreshToken: 'refresh-seed',
		accessTokenExpiresAt: new Date(NOW + 86_400_000).toISOString(),
		refreshTokenExpiresAt: new Date(NOW + 8_726_400_000).toISOString(),
		obtainedAt: new Date(NOW).toISOString(),
	};
	await store.set(token);

	const openQb = createQbAccess({ config, realmId: mock.realmId, store, now });
	return {
		mock,
		openQb,
		cleanup: () => {
			mock.stop();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe('fetchReport', () => {
	test('runs a report live against QuickBooks and passes the period through', async () => {
		const { mock, openQb, cleanup } = await setup();

		const { data, error } = await fetchReport({
			openQb,
			input: {
				report: 'ProfitAndLoss',
				start_date: '2026-01-01',
				end_date: '2026-03-31',
			},
		});

		expect(error).toBeNull();
		expect(mock.hits.report).toBe(1);
		expect(data?.report).toBe('ProfitAndLoss');
		const header = (
			data?.data as {
				Header: { ReportName: string; StartPeriod: string };
			}
		).Header;
		expect(header.ReportName).toBe('ProfitAndLoss');
		expect(header.StartPeriod).toBe('2026-01-01');
		cleanup();
	});
});
