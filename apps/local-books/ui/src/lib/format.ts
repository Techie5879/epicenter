// Presentation helpers for the books surface. None of this invents state; it only
// makes the mirror's own bytes (QuickBooks ids, ISO timestamps, extracted scalar
// columns) scannable for a human.

import type { EntityColumn } from './types';

const moneyFmt = new Intl.NumberFormat(undefined, {
	style: 'currency',
	currency: 'USD',
});
const numberFmt = new Intl.NumberFormat();

/** Format one extracted-column cell by its declared SQLite type. */
export function formatCell(value: unknown, column: EntityColumn): string {
	if (value === null || value === undefined) return '';
	if (column.type === 'REAL') {
		const n = Number(value);
		return Number.isFinite(n) ? moneyFmt.format(n) : String(value);
	}
	if (column.type === 'INTEGER') {
		// QuickBooks booleans arrive as json_extract 0/1; render the flag columns as
		// yes/no, other integers as plain numbers.
		if (column.name === 'active') return value === 1 ? 'yes' : 'no';
		const n = Number(value);
		return Number.isFinite(n) ? numberFmt.format(n) : String(value);
	}
	return String(value);
}

/** A short, human-readable column header from the snake_case column name. */
export function columnLabel(name: string): string {
	return name.replace(/_/g, ' ');
}

/** "2m ago" style relative time for the sync status. */
export function relativeTime(iso: string | null): string {
	if (!iso) return 'never';
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return 'never';
	const seconds = Math.round((Date.now() - then) / 1000);
	if (seconds < 10) return 'just now';
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

/** Compact ISO timestamp for detail rows: date + short time, local. */
export function shortTimestamp(iso: string | null): string {
	if (!iso) return '-';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(date);
}

export { numberFmt };
