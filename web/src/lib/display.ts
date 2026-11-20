/** Formatting for display only (never for the file format). */
import { civilDate, formatDateAs, type CivilDate, type Cents, type UtcSeconds } from '../core';
import { settings } from './settings.svelte';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuro(amount: Cents): string {
	// division is fine here: the result is only displayed, never stored or calculated with
	return euro.format(amount / 100);
}

/** A date in the user's chosen style (reactive: re-renders when the setting changes). */
export function formatDate(date: CivilDate): string {
	return formatDateAs(date, settings.dateStyle);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** The local calendar day of a timestamp, in the user's chosen style. */
export function formatDay(time: UtcSeconds): string {
	const d = new Date(time * 1000);
	return formatDate(civilDate(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}
