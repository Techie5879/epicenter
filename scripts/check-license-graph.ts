#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
/**
 * License-graph guard.
 *
 * The MIT toolkit packages must never transitively depend on an AGPL package.
 * This walks every workspace package's `dependencies` + `peerDependencies` and
 * fails if any MIT-licensed package can reach an AGPL-licensed one.
 *
 * Run: `bun run check:licenses`
 */
import { Glob } from 'bun';

const MIT_COMPATIBLE =
	/^(MIT|ISC|0BSD|BSD-2-Clause|BSD-3-Clause|Apache-2.0|CC0-1.0)$/;
const AGPL = /AGPL/i;

type Pkg = { name: string; license: string; deps: string[] };

const byName = new Map<string, Pkg>();
for (const rel of new Glob('{packages,apps}/*/package.json').scanSync('.')) {
	const j = JSON.parse(readFileSync(rel, 'utf8'));
	if (!j.name) continue;
	const deps = [
		...Object.keys(j.dependencies ?? {}),
		...Object.keys(j.peerDependencies ?? {}),
	].filter((d) => d.startsWith('@epicenter/'));
	byName.set(j.name, { name: j.name, license: j.license ?? '(none)', deps });
}

function reaches(start: Pkg): { name: string; path: string[] } | null {
	const seen = new Set<string>();
	const stack = start.deps.map((d) => ({ name: d, path: [start.name, d] }));
	while (stack.length) {
		const { name, path } = stack.pop()!;
		if (seen.has(name)) continue;
		seen.add(name);
		const p = byName.get(name);
		if (!p) continue; // external dep, not a workspace package
		if (AGPL.test(p.license)) return { name, path };
		for (const d of p.deps) stack.push({ name: d, path: [...path, d] });
	}
	return null;
}

const violations: string[] = [];
for (const pkg of byName.values()) {
	if (!MIT_COMPATIBLE.test(pkg.license)) continue;
	const hit = reaches(pkg);
	if (hit)
		violations.push(
			`  ${pkg.name} (${pkg.license}) -> AGPL ${hit.name}\n    via: ${hit.path.join(' -> ')}`,
		);
}

if (violations.length) {
	console.error(
		`License-graph violation: MIT packages must not depend on AGPL packages.\n${violations.join('\n')}`,
	);
	process.exit(1);
}

const mit = [...byName.values()]
	.filter((p) => MIT_COMPATIBLE.test(p.license))
	.map((p) => p.name)
	.sort();
console.log(
	`License graph OK. ${mit.length} MIT-compatible packages, none reach AGPL:\n  ${mit.join(', ')}`,
);
