/** Formatting for display only (never for the file format). */
import { civilDate, dateParts, formatDateAs, monthOf, yearOf, type CivilDate, type Cents, type UtcSeconds } from '../core';
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

/** A period for a chip or heading: "November 2026", "2026", "01.03.2026 – 15.03.2026", "from …", "until …" ('' if open). */
export function describePeriod(from: CivilDate | null, to: CivilDate | null): string {
	if (from && to) {
		const month = monthOf(from);
		if (month.from === from && month.to === to) {
			const { year, month: m } = dateParts(from);
			return new Date(year, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
		}
		const year = yearOf(from);
		if (year.from === from && year.to === to) return String(dateParts(from).year);
		// whole months: "Oct – Nov 2026", "Nov 2025 – Feb 2026"
		if (monthOf(from).from === from && monthOf(to).to === to) {
			const short = (date: CivilDate, withYear: boolean) => {
				const { year: y, month: m } = dateParts(date);
				// en-US: "Sep" (en-GB writes "Sept")
				return new Date(y, m - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
			};
			const sameYear = dateParts(from).year === dateParts(to).year;
			return `${short(from, !sameYear)} – ${short(to, true)}`;
		}
		return `${formatDate(from)} – ${formatDate(to)}`;
	}
	if (from) return `from ${formatDate(from)}`;
	return to ? `until ${formatDate(to)}` : '';
}

/** An amount range (without sign) for a chip: "10,00 € – 50,00 €", "at least 10,00 €", "at most 50,00 €" ('' if open). */
export function describeAmountRange(min: Cents | null, max: Cents | null): string {
	if (min !== null && max !== null) return `${formatEuro(min)} – ${formatEuro(max)}`;
	if (min !== null) return `at least ${formatEuro(min)}`;
	return max !== null ? `at most ${formatEuro(max)}` : '';
}
