#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
/**
 * Compile the Bun mail engine into a single self-contained binary and place it
 * where Tauri's `bundle.externalBin` expects it.
 *
 * The desktop app cannot spawn `bun src/bin.ts app` from a source checkout: a
 * packaged `.app` has no repo beside it and `bun` may not be on the end user's
 * PATH (ADR-0116 keeps the whole mail engine in Bun, so it must ship as a
 * binary). `bun build --compile` bakes the engine (CLI, sync, OAuth, SQLite,
 * MCP) into one executable; the SPA is shipped separately as a Tauri resource
 * and located at runtime via `LOCAL_MAIL_UI_DIST` (see `src/app.ts`).
 *
 * Tauri resolves an `externalBin` entry `binaries/local-mail-engine` by looking
 * for `binaries/local-mail-engine-<target-triple>` on disk and stripping the
 * triple when it copies the binary into the bundle. So the output is named with
 * the host triple, which we read from `rustc` (always present in a Tauri build).
 */
import { $ } from 'bun';

const appDir = join(import.meta.dir, '..');

/** The host target triple, e.g. `aarch64-apple-darwin`, read from rustc so it
 * matches exactly what Tauri appends to the `externalBin` name. */
async function hostTargetTriple(): Promise<string> {
	const verbose = await $`rustc -vV`.text();
	const host = verbose
		.split('\n')
		.find((line) => line.startsWith('host: '))
		?.slice('host: '.length)
		.trim();
	if (!host) {
		throw new Error('could not read host target triple from `rustc -vV`');
	}
	return host;
}

const triple = await hostTargetTriple();
const outfile = join(
	appDir,
	'src-tauri',
	'binaries',
	`local-mail-engine-${triple}`,
);
await mkdir(dirname(outfile), { recursive: true });

console.error(`Compiling mail engine sidecar -> ${outfile}`);
await $`bun build --compile --outfile ${outfile} ${join(appDir, 'src', 'bin.ts')}`;
console.error('Sidecar built.');
