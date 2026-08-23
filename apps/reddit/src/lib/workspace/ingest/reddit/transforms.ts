/** Shared transform utilities for Reddit ingest pipeline. */

/** Coerce empty, undefined, or null strings to null. */
export function emptyToNull(value: string | undefined | null): string | null {
	if (!value || value === '') return null;
	return value;
}

/** Parse a date string to ISO format, returning null for empty/invalid values. */
export function parseDateToIso(
	dateStr: string | undefined | null,
): string | null {
	if (!dateStr || dateStr === '') return null;
	const date = new Date(dateStr);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
