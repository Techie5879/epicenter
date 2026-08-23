/**
 * Print a strong instance bearer token, persisting nothing (ADR-0075).
 *
 * The instance authenticates one operator-supplied static bearer. Run this once,
 * capture the printed value, and supply it as `INSTANCE_TOKEN` (an env var on Bun,
 * a `wrangler secret put INSTANCE_TOKEN` secret on Cloudflare), then paste it into
 * the client's instance setting (`{ baseURL, token }`). Re-run to rotate. The box
 * never mints or stores the token; the operator owns the secret, which is exactly
 * what lets the instance run on either runtime.
 *
 *   bun run gen-token
 *
 * The output is 43 base64url characters (256 bits), well above the boot entropy
 * gate, so a generated token always clears `assertStrongToken`.
 */

import { generateInstanceToken } from '@epicenter/auth';

console.log(generateInstanceToken());
