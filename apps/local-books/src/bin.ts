#!/usr/bin/env bun

import { runCli } from './cli.ts';

try {
	const exitCode = await runCli(process.argv.slice(2));
	process.exit(exitCode);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);
	process.exit(1);
}
