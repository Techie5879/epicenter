import slugify from '@sindresorhus/slugify';

/** Convert any string to snake_case using slugify. Also known as `toSqlIdentifier`. */
export function snakify(str: string): string {
	return slugify(str, { separator: '_' });
}
