/**
 * The signed-in user, from the Better Auth client, the same source the account
 * page uses for linked accounts and passkeys. Both the sign-in and account
 * pages read it to show who this browser holds. `data` is `null` when signed
 * out. This replaced the `session` half of the old `/sign-in/context` endpoint.
 */

import { defineKeys } from 'wellcrafted/query';
import { authClient } from '$lib/auth/client';
import { defineQuery } from '$lib/query/client';

export const sessionKeys = defineKeys({
	session: ['session'],
});

export const session = defineQuery({
	queryKey: sessionKeys.session,
	queryFn: () => authClient.getSession(),
});
