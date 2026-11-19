/** Formatting for display only (never for the file format). */
import { dateParts, type CivilDate, type Cents } from '../core';

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
