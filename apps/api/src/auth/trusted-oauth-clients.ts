import { EPICENTER_TRUSTED_OAUTH_CLIENTS } from '@epicenter/constants/oauth';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';

const trustedOAuthScopes = [
	'openid',
	'profile',
	'email',
	'offline_access',
	'workspaces:open',
];
const authorizationCodeGrantTypes = ['authorization_code'];
const codeResponseTypes = ['code'];

export const trustedOAuthClientIds = new Set(
	EPICENTER_TRUSTED_OAUTH_CLIENTS.map((client) => client.clientId),
);

let trustedOAuthClientsSeed: Promise<void> | null = null;

function projectTrustedOAuthClientToRow<
	const TClient extends {
		clientId: string;
		name: string;
		runtime: (typeof EPICENTER_TRUSTED_OAUTH_CLIENTS)[number]['runtime'];
		redirectUris: readonly string[];
	},
>(client: TClient, now = new Date()) {
	return {
		id: client.clientId,
		clientId: client.clientId,
		disabled: false,
		skipConsent: true,
		scopes: [...trustedOAuthScopes],
		createdAt: now,
		updatedAt: now,
		name: client.name,
		redirectUris: [...client.redirectUris],
		tokenEndpointAuthMethod: 'none',
		grantTypes: [...authorizationCodeGrantTypes],
		responseTypes: [...codeResponseTypes],
		public: true,
		type: toOAuthClientType(client.runtime),
		requirePKCE: true,
	} satisfies typeof schema.oauthClient.$inferInsert;
}

export async function ensureTrustedOAuthClients(
	db: NodePgDatabase<typeof schema>,
) {
	trustedOAuthClientsSeed ??= upsertTrustedOAuthClients(db);
	try {
		await trustedOAuthClientsSeed;
	} catch (error) {
		trustedOAuthClientsSeed = null;
		throw error;
	}
}

async function upsertTrustedOAuthClients(db: NodePgDatabase<typeof schema>) {
	for (const client of EPICENTER_TRUSTED_OAUTH_CLIENTS) {
		const row = projectTrustedOAuthClientToRow(client);
		await db
			.insert(schema.oauthClient)
			.values(row)
			.onConflictDoUpdate({
				target: schema.oauthClient.clientId,
				set: {
					disabled: false,
					skipConsent: true,
					scopes: row.scopes,
					updatedAt: row.updatedAt,
					name: row.name,
					redirectUris: row.redirectUris,
					tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
					grantTypes: row.grantTypes,
					responseTypes: row.responseTypes,
					public: true,
					type: row.type,
					requirePKCE: true,
				},
			});
	}
}

function toOAuthClientType(
	runtime: (typeof EPICENTER_TRUSTED_OAUTH_CLIENTS)[number]['runtime'],
) {
	switch (runtime) {
		case 'browser':
		case 'extension':
			return 'user-agent-based';
		case 'device':
			return 'native';
	}
}
