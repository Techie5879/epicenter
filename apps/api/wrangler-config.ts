/**
 * Local database URL from `wrangler.jsonc` Hyperdrive config.
 *
 * ## Database URL Strategy (3 layers)
 *
 * | Layer      | Source                              | Permissions         | Used By                    |
 * |------------|-------------------------------------|---------------------|----------------------------|
 * | Local      | `wrangler.jsonc` localConnectionString | Full admin (local) | `db:push`, `db:studio`     |
 * | Migration  | Infisical `DATABASE_URL`            | DDL + DML           | `db:migrate`               |
 * | Runtime    | Hyperdrive `env.HYPERDRIVE`         | DML only (R/W)      | `app.ts` in production     |
 *
 * This module only reads the local connection string from `wrangler.jsonc`.
 * Call sites read `process.env.DATABASE_URL` (set by `infisical run` for
 * `:remote` commands) and fall back to this constant for `:local` commands.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type } from 'arktype';
import { parse as parseJSONC } from 'jsonc-parser';

const HyperdriveEntry = type({ localConnectionString: 'string' });
const WranglerConfig = type('string')
	.pipe((s) => parseJSONC(s) as Record<string, unknown>)
	.to({
		hyperdrive: [HyperdriveEntry, '...', HyperdriveEntry.array()],
	});

const jsoncString = readFileSync(
	fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)),
	'utf-8',
);

/** Local database URL parsed from `wrangler.jsonc` Hyperdrive config. */
export const LOCAL_DATABASE_URL =
	WranglerConfig.assert(jsoncString).hyperdrive[0].localConnectionString;
