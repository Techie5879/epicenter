import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';

/**
 * Authenticated principal id and workspace partition key.
 *
 * On hosted Cloud, this is the principal Better Auth resolved for the request.
 * On a self-hosted instance, this is the literal {@link INSTANCE_PRINCIPAL_ID}.
 * By definition, every server path, R2 key, Durable Object name, local IndexedDB
 * key, and HKDF derivation label uses this value as the partition key.
 *
 * The instance constant's bytes are pinned. Changing them changes HKDF labels,
 * R2 prefixes, Durable Object names, and IndexedDB keys.
 *
 * The validator is declared first; the type is derived from it via `.infer`
 * so schema and type stay in lockstep under one PascalCase name. Use
 * {@link PrincipalId} directly inside schemas (`principalId: PrincipalId`); at
 * trusted call sites brand a known `string` via {@link asPrincipalId}.
 */
export const PrincipalId = type('string').as<string & Brand<'PrincipalId'>>();
export type PrincipalId = typeof PrincipalId.infer;
/**
 * Syntactic sugar for `value as PrincipalId`. The function body is a single typed
 * cast; the constrained `string` parameter is what earns it over a raw `as`
 * (callers can't accidentally widen to `unknown`). The only place in the
 * codebase where `as PrincipalId` appears.
 */
export const asPrincipalId = (value: string): PrincipalId =>
	value as PrincipalId;

/** Byte-pinned principal id for the single-partition self-hosted instance. */
export const INSTANCE_PRINCIPAL_ID = asPrincipalId('instance');
