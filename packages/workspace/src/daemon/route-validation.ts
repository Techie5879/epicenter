/**
 * Folder name under each project root that holds folder-routed daemon
 * extension subfolders (`<projectDir>/workspaces/<route>/daemon.ts`). The
 * daemon discovery scanner, the daemon client's `getDaemon`, and the
 * project-root detector all key off this name; keeping the constant in
 * exactly one place is the whole point.
 */
export const WORKSPACES_DIRNAME = 'workspaces';

const ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Route names become object keys in `/list` action manifests.
const RESERVED_OBJECT_ROUTE_KEYS = new Set([
	'__proto__',
	'prototype',
	'constructor',
]);

export type DaemonRouteNameIssue = {
	route: string;
	reason: 'invalid' | 'duplicate';
};

export function validateDaemonRouteNames(
	routes: readonly string[],
): DaemonRouteNameIssue | null {
	const seen = new Set<string>();
	for (const route of routes) {
		if (seen.has(route)) return { route, reason: 'duplicate' };
		seen.add(route);
	}
	for (const route of routes) {
		if (!ROUTE_PATTERN.test(route) || RESERVED_OBJECT_ROUTE_KEYS.has(route)) {
			return { route, reason: 'invalid' };
		}
	}
	return null;
}
