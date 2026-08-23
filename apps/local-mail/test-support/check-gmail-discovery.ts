/**
 * Gmail API drift check.
 *
 * `gmail-client.ts` is a hand-written fetch client and `schema.ts` validates
 * only the fields this package actually reads. That is deliberate (partial,
 * permissive schemas that tolerate unknown Gmail fields), but it means nothing
 * catches Gmail *removing*, *moving*, or *retyping* something we depend on until
 * a live sync fails. Worse, our read fields are all optional, so a removed field
 * still passes `Value.Check` and silently reaches a reader as `undefined`. This
 * check closes that gap without generating exact schemas: it fetches Gmail's
 * machine-readable Discovery document and asserts that every method and every
 * schema field path we depend on is still present, and still the type we expect.
 *
 *   bun run apps/local-mail/test-support/check-gmail-discovery.ts
 *
 * It is a network call against a Google endpoint, so it is NOT part of `bun
 * test` (which is hermetic and offline). It runs on a schedule instead (see
 * `.github/workflows/local-mail.gmail-drift.yml`) and can be run by hand. Exits
 * non-zero, listing each drift, when the contract no longer holds.
 *
 * The schema half derives its contract by walking the actual `schema.ts` TypeBox
 * objects (which are JSON Schema at runtime), so `schema.ts` stays the single
 * source of the fields we read: adding a field there automatically extends this
 * check, with no second list to keep in sync. The only hand-maintained pieces
 * are the small, stable set of methods we call (the client builds those paths as
 * string templates, so there is nothing to derive) and the root-schema name map.
 * No stored fixture: a saved copy of the Discovery doc would be exactly the
 * duplicate contract this design avoids.
 *
 * https://developers.google.com/discovery/v1/reference
 */

import type { TSchema } from 'typebox';
import {
	GmailLabelSchema,
	GmailMessageSchema,
	HistoryPageSchema,
	HistoryRecordSchema,
	ListLabelsResponseSchema,
	ListMessageIdsResponseSchema,
	ProfileResponseSchema,
} from '../src/schema.ts';

const DISCOVERY_URL = 'https://gmail.googleapis.com/$discovery/rest?version=v1';

/**
 * The Gmail methods `gmail-client.ts` calls, by their fully-qualified Discovery
 * id (which encodes the resource path, so a moved endpoint fails here too) plus
 * the HTTP verb the client sends. Hand-maintained on purpose: the client builds
 * request paths as string templates, so there is no schema to walk; adding a
 * method is a deliberate, rare, visible act.
 */
const RELIED_ON_METHODS: {
	id: string;
	httpMethod: string;
	consumer: string;
}[] = [
	{ id: 'gmail.users.getProfile', httpMethod: 'GET', consumer: 'getProfile' },
	{
		id: 'gmail.users.messages.list',
		httpMethod: 'GET',
		consumer: 'listMessageIds',
	},
	{ id: 'gmail.users.messages.get', httpMethod: 'GET', consumer: 'getMessage' },
	{
		id: 'gmail.users.messages.modify',
		httpMethod: 'POST',
		consumer: 'modifyMessage',
	},
	{
		id: 'gmail.users.messages.trash',
		httpMethod: 'POST',
		consumer: 'trashMessage',
	},
	{
		id: 'gmail.users.messages.untrash',
		httpMethod: 'POST',
		consumer: 'untrashMessage',
	},
	{
		id: 'gmail.users.history.list',
		httpMethod: 'GET',
		consumer: 'listHistory',
	},
	{ id: 'gmail.users.labels.list', httpMethod: 'GET', consumer: 'listLabels' },
];

/**
 * Each response schema `gmail-client.ts` validates, paired with the Discovery
 * schema it maps to. This is the whole schema-side contract: the field paths are
 * derived by walking these objects, not re-listed. Our schemas nest inline (a
 * message payload is a `Type.Object`, not a named type); Discovery normalizes
 * into named `$ref`s, so the walk resolves refs on the Discovery side as it goes.
 */
const SCHEMA_ROOTS: { schema: TSchema; discovery: string; consumer: string }[] =
	[
		{
			schema: GmailMessageSchema,
			discovery: 'Message',
			consumer: 'getMessage',
		},
		{
			schema: ListMessageIdsResponseSchema,
			discovery: 'ListMessagesResponse',
			consumer: 'listMessageIds',
		},
		{ schema: GmailLabelSchema, discovery: 'Label', consumer: 'listLabels' },
		{
			schema: ListLabelsResponseSchema,
			discovery: 'ListLabelsResponse',
			consumer: 'listLabels',
		},
		{
			schema: HistoryPageSchema,
			discovery: 'ListHistoryResponse',
			consumer: 'listHistory',
		},
		{
			schema: HistoryRecordSchema,
			discovery: 'History',
			consumer: 'listHistory',
		},
		{
			schema: ProfileResponseSchema,
			discovery: 'Profile',
			consumer: 'getProfile',
		},
	];

type DiscoveryMethod = { id?: string; httpMethod?: string; path?: string };
type DiscoveryResource = {
	methods?: Record<string, DiscoveryMethod>;
	resources?: Record<string, DiscoveryResource>;
};
/** A Discovery schema node: a named object, a `$ref`, an array, or a primitive. */
type DiscoveryNode = {
	$ref?: string;
	type?: string;
	properties?: Record<string, DiscoveryNode>;
	items?: DiscoveryNode;
};
type DiscoveryDoc = {
	revision?: string;
	resources?: Record<string, DiscoveryResource>;
	schemas?: Record<string, DiscoveryNode>;
};

/** The subset of a TypeBox node this walk reads: standard JSON Schema keywords. */
type TypeBoxNode = {
	type?: string;
	properties?: Record<string, TSchema>;
	items?: TSchema;
};

/** Flatten the nested resource tree into one map of method id -> method. */
function collectMethods(
	resources: Record<string, DiscoveryResource>,
	out: Map<string, DiscoveryMethod>,
): void {
	for (const resource of Object.values(resources)) {
		for (const method of Object.values(resource.methods ?? {})) {
			if (method.id) out.set(method.id, method);
		}
		if (resource.resources) collectMethods(resource.resources, out);
	}
}

/**
 * Walk one of our TypeBox schemas against its Discovery counterpart, asserting
 * every field we read is still present and (for primitives) still the same type.
 * `seen` dedupes named Discovery schemas so a shape reachable by many paths (a
 * `Message` embedded in every history record) is reported once, not per path.
 */
function walkSchema(
	tb: TSchema,
	disc: DiscoveryNode | undefined,
	path: string,
	schemas: Record<string, DiscoveryNode>,
	seen: Set<string>,
	drift: string[],
): void {
	if (!disc) {
		drift.push(`${path} is gone`);
		return;
	}
	if (disc.$ref) {
		const resolved = schemas[disc.$ref];
		if (!resolved) {
			drift.push(`${path} -> schema ${disc.$ref} is gone`);
			return;
		}
		if (seen.has(disc.$ref)) return;
		seen.add(disc.$ref);
		walkSchema(tb, resolved, path, schemas, seen, drift);
		return;
	}

	const node = tb as TypeBoxNode;
	if (node.type === 'object' && node.properties) {
		if (!disc.properties) {
			drift.push(`${path} is no longer an object`);
			return;
		}
		for (const [key, child] of Object.entries(node.properties)) {
			walkSchema(
				child,
				disc.properties[key],
				`${path}.${key}`,
				schemas,
				seen,
				drift,
			);
		}
		return;
	}
	if (node.type === 'array' && node.items) {
		if (!disc.items) {
			drift.push(`${path} is no longer an array`);
			return;
		}
		walkSchema(node.items, disc.items, `${path}[]`, schemas, seen, drift);
		return;
	}
	// A primitive (Type.String/Number/...). Type.Any() has no `type`, so there is
	// nothing to assert (e.g. `payload.parts`, which we store but never read into).
	if (
		typeof node.type === 'string' &&
		disc.type !== undefined &&
		disc.type !== node.type
	) {
		drift.push(`${path} is now ${disc.type}, we expect ${node.type}`);
	}
}

async function main(): Promise<void> {
	const response = await fetch(DISCOVERY_URL, {
		headers: { Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(
			`Discovery fetch returned ${response.status} ${response.statusText}`,
		);
	}
	const doc = (await response.json()) as DiscoveryDoc;
	console.log(`Gmail Discovery revision ${doc.revision ?? '(unknown)'}`);

	const drift: string[] = [];

	const methods = new Map<string, DiscoveryMethod>();
	collectMethods(doc.resources ?? {}, methods);
	for (const { id, httpMethod, consumer } of RELIED_ON_METHODS) {
		const method = methods.get(id);
		if (!method) {
			drift.push(`method ${id} is gone (used by client.${consumer})`);
			continue;
		}
		if (method.httpMethod !== httpMethod) {
			drift.push(
				`method ${id} is now ${method.httpMethod}, expected ${httpMethod} (client.${consumer})`,
			);
		}
	}

	const schemas = doc.schemas ?? {};
	const seen = new Set<string>();
	for (const { schema, discovery, consumer } of SCHEMA_ROOTS) {
		walkSchema(
			schema,
			{ $ref: discovery },
			`${discovery} (client.${consumer})`,
			schemas,
			seen,
			drift,
		);
	}

	if (drift.length > 0) {
		console.error(
			`\nGmail API drift detected (${drift.length}); update gmail-client.ts / schema.ts:`,
		);
		for (const problem of drift) console.error(`  - ${problem}`);
		process.exit(1);
	}

	console.log(
		`OK: all ${RELIED_ON_METHODS.length} methods and ${SCHEMA_ROOTS.length} response schemas we rely on are present and correctly typed.`,
	);
}

try {
	await main();
	process.exit(0);
} catch (err) {
	console.error(
		`DRIFT CHECK FAILED: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
}
