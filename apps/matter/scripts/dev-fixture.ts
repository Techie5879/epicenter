/**
 * The dev loop: prepare a DISPOSABLE sandbox, then open Matter on it.
 *
 * Matter writes your edits back to disk, so opening the committed sample directly
 * would dirty the git tree the moment you touch a cell. This copies the sample
 * fixture into a gitignored sandbox (`apps/matter/.dev-vault`) and launches the
 * app, so every edit, and the `matter.sqlite` mirror it drops next to
 * `matter.json`, lands on throwaway files.
 *
 *   bun run dev:fixture          # copy the sample fresh, then open Matter
 *   bun run dev:fixture --keep   # reuse the existing sandbox (keep what you typed)
 *
 * Open the printed sandbox path in Matter's folder picker. The app persists open
 * folders by path, so you only pick it once: the stable sandbox path keeps working
 * across resets and reloads. Real folders open the exact same way, so the app needs
 * no dev-only code to know about the sandbox.
 *
 * Fresh-copies on every launch by default, so you always start from known state.
 * The sample lives at `examples/matter/sample-vault/drafts` and covers every
 * conformance category (valid, invalid, unparseable, no-frontmatter), so one
 * fixture is enough.
 */

import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const repoRoot = resolve(appRoot, '../..');
const source = join(repoRoot, 'examples/matter/sample-vault/drafts');
const sandbox = join(appRoot, '.dev-vault');

const keep = Bun.argv.includes('--keep');

if (!existsSync(source)) {
	console.error(`Sample fixture is missing: ${source}`);
	process.exit(1);
}

if (keep && existsSync(sandbox)) {
	console.log(`Reusing Matter sandbox (--keep): ${sandbox}`);
} else {
	await rm(sandbox, { recursive: true, force: true });
	await cp(source, sandbox, { recursive: true });
	console.log(`Seeded Matter sandbox from the sample: ${sandbox}`);
}

console.log(
	`Open this folder in Matter's picker (you only pick it once): ${sandbox}`,
);

// Stream the dev server to this terminal and exit with its code (no throw on a
// non-zero exit like Ctrl+C), matching the house dev-launcher in apps/api/scripts.
const dev = await Bun.$`bun run tauri dev`.nothrow();
process.exit(dev.exitCode);
