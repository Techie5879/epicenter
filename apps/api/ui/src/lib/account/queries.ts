/**
 * TanStack Query bindings for the account page.
 *
 * Better Auth owns the account and passkey rows, and its client already returns
 * the `{ data, error }` shape Wellcrafted's `defineQuery` consumes, so these
 * queries expose those rows directly: there is no view model, the page reads
 * Better Auth fields at the point of use. The signed-in profile comes from
 * {@link session} (also the Better Auth client), and the provider list is the
 * static {@link SOCIAL_PROVIDERS}. The page invalidates a single list key after
 * the matching link/unlink/passkey change.
 */

import { defineKeys } from 'wellcrafted/query';
import { authClient } from '$lib/auth/client';
import { defineQuery } from '$lib/query/client';

export const accountKeys = defineKeys({
	linked: ['account', 'linked'],
	passkeys: ['account', 'passkeys'],
});

export const account = {
	linked: defineQuery({
		queryKey: accountKeys.linked,
		queryFn: () => authClient.listAccounts(),
	}),

	passkeys: defineQuery({
		queryKey: accountKeys.passkeys,
		queryFn: () => authClient.passkey.listUserPasskeys(),
	}),
};
