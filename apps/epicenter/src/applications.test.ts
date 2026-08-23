/**
 * Compiled Application Declaration Tests
 *
 * Verifies this desktop release declares only Whispering and that its built-in
 * route agrees with the release declaration.
 */

import { expect, test } from 'bun:test';
import { COMPILED_APPLICATIONS } from './applications.ts';
import { BUILT_IN_ROUTES } from './routes.ts';

test('the desktop release compiles only Whispering', () => {
	expect(COMPILED_APPLICATIONS).toEqual([
		{ id: 'whispering', title: 'Whispering' },
	]);
});

test('the Whispering declaration matches its built-in route', () => {
	const { id, title } = BUILT_IN_ROUTES.whispering;
	expect(COMPILED_APPLICATIONS[0]).toEqual({ id, title });
});
