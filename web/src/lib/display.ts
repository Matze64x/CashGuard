/** Formatting for display only (never for the file format). */
import { dateParts, type CivilDate, type Cents, type UtcSeconds } from '../core';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuro(amount: Cents): string {
	// division is fine here: the result is only displayed, never stored or calculated with
	return euro.format(amount / 100);
}

export function formatDate(date: CivilDate): string {
	const { year, month, day } = dateParts(date);
	return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** The local calendar day of a timestamp, e.g. "18.11.2026". */
export function formatDay(time: UtcSeconds): string {
	return new Date(time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
