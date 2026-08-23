import { defineConfig } from 'drizzle-kit';
import { LOCAL_DATABASE_URL } from './wrangler-config';

export default defineConfig({
	dialect: 'postgresql',
	schema: '../../packages/server/src/db/schema/index.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
	},
});
