/**
 * Source-shape lock for the Fuji workspace boundary.
 *
 * This test reads the touched files as text and asserts that `workspace.ts`
 * owns the shared opener while the browser and optional daemon extension files
 * compose runtime around it. It deliberately does not exercise runtime behavior;
 * behavior tests live in workspace.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fujiDir = dirname(fileURLToPath(import.meta.url));

const workspaceSource = readFileSync(join(fujiDir, 'workspace.ts'), 'utf8');
const browserSource = readFileSync(
	join(fujiDir, 'browser.ts'),
	'utf8',
);
const daemonSource = readFileSync(join(fujiDir, 'daemon.ts'), 'utf8');

describe('Fuji workspace architecture', () => {
	test('workspace.ts owns the shared opener', () => {
		expect(workspaceSource).toContain('export function openFujiWorkspace');
		expect(workspaceSource).not.toContain('export function createFujiYdoc');
		expect(workspaceSource).not.toContain(
			'export function attachFujiWorkspace',
		);
	});

	test('browser composes browser runtime around the shared opener', () => {
		expect(browserSource).toContain('openFujiWorkspace');
		expect(browserSource).not.toContain('new Y.Doc({ guid: FUJI_WORKSPACE_ID');
		expect(browserSource).not.toContain('connectDaemonActions');
		expect(browserSource).not.toContain('runPath');
	});

	test('daemon composes daemon runtime around the shared opener', () => {
		expect(daemonSource).toContain('openFujiWorkspace');
		expect(daemonSource).toContain('{ clientId }');
		expect(daemonSource).toContain('replicaId');
		expect(daemonSource).toContain('attachDaemonInfrastructure');
		expect(daemonSource).toContain('attachSqliteMaterializer');
		expect(daemonSource).toContain('attachMarkdownMaterializer');
	});
});
