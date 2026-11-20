/**
 * Filtering and aggregation for exploring the data: what the list, the summaries and the charts
 * show. Pure functions, so the views stay thin and everything here is unit-tested.
 *
 * A group (a transaction split into parts) counts as one transaction with its own date, category,
 * description and total: the parts are details that only show when the transaction is opened.
 */
import { addDays, addMonths, civilDate, dateParts, type CivilDate } from './dates';
import type { Id } from './ids';
import { sumCents, type Cents } from './money';
import type { Category, Transaction } from './model';

export type Kind = 'all' | 'income' | 'expense';

export interface Filter {
	/** First and last day, both inclusive; null: open */
	readonly from: CivilDate | null;
	readonly to: CivilDate | null;
	/** Only these categories (`NO_CATEGORY` for transactions without one); empty: all */
	readonly categories: readonly Id[];
	/** Words that must all appear in the description or the category name */
	readonly text: string;
	readonly kind: Kind;
	/** Range of the amount without its sign (kind decides the sign), inclusive; null: open */
	readonly minAmount: Cents | null;
	readonly maxAmount: Cents | null;
}

export const NO_FILTER: Filter = { from: null, to: null, categories: [], text: '', kind: 'all', minAmount: null, maxAmount: null };

export function isFiltered(filter: Filter): boolean {
	return (
		filter.from !== null ||
		filter.to !== null ||
		filter.categories.length > 0 ||
		filter.text.trim() !== '' ||
		filter.kind !== 'all' ||
		filter.minAmount !== null ||
		filter.maxAmount !== null
	);
}

function matcher(filter: Filter, categories: readonly Category[]): (t: Transaction) => boolean {
	const names = new Map(categories.map((c) => [c.id, c.name.toLocaleLowerCase()]));
	const words = filter.text.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	const wanted = filter.categories.length > 0 ? new Set(filter.categories) : null;
	return (t) => {
		if ((filter.from !== null && t.date < filter.from) || (filter.to !== null && t.date > filter.to)) return false;
		if (wanted && !wanted.has(t.categoryId)) return false;
		if ((filter.kind === 'income' && t.amount <= 0) || (filter.kind === 'expense' && t.amount >= 0)) return false;
		const size = Math.abs(t.amount);
		if ((filter.minAmount !== null && size < filter.minAmount) || (filter.maxAmount !== null && size > filter.maxAmount)) return false;
		if (words.length > 0) {
			const text = `${t.description}\n${names.get(t.categoryId) ?? ''}`.toLocaleLowerCase();
			if (!words.every((w) => text.includes(w))) return false;
		}
		return true;
	};
}

export interface FilterResult {
	/** The matching transactions, in the given order (newest first) */
	readonly transactions: readonly Transaction[];
	readonly total: Cents;
}

export function applyFilter(transactions: readonly Transaction[], categories: readonly Category[], filter: Filter): FilterResult {
	const matching = isFiltered(filter) ? transactions.filter(matcher(filter, categories)) : transactions;
	return { transactions: matching, total: sumCents(matching.map((t) => t.amount)) };
}

// ------------------------------------------------------------------------------------- periods

export interface Period {
	readonly from: CivilDate;
	readonly to: CivilDate;
}

/** The calendar month that contains `date` */
export function monthOf(date: CivilDate): Period {
	const { year, month } = dateParts(date);
	const from = civilDate(year, month, 1);
	return { from, to: addDays(addMonths(from, 1), -1) };
}

/** The calendar year that contains `date` */
export function yearOf(date: CivilDate): Period {
	const { year } = dateParts(date);
	return { from: civilDate(year, 1, 1), to: civilDate(year, 12, 31) };
}

/** Periods to pick from, relative to `today` */
export function periodPresets(today: CivilDate): { label: string; period: Period }[] {
	const month = monthOf(today);
	const year = yearOf(today);
	const lastYear = yearOf(addMonths(year.from, -12));
	return [
		{ label: 'This month', period: month },
		{ label: 'Last month', period: monthOf(addMonths(month.from, -1)) },
		{ label: 'Last 3 months', period: { from: addMonths(month.from, -2), to: month.to } },
		{ label: 'Last 12 months', period: { from: addMonths(month.from, -11), to: month.to } },
		{ label: 'This year', period: year },
		{ label: 'Last year', period: lastYear },
	];
}
