/**
 * Filtering and aggregation for exploring the data: what the list, the summaries and the charts
 * show. Pure functions, so the views stay thin and everything here is unit-tested.
 *
 * A group (a transaction split into parts) counts as one transaction with its own date, category,
 * description and total: the parts are details that only show when the transaction is opened.
 */
import { addMonths, civilDate, dateParts, daysInMonth, type CivilDate } from './dates';
import type { Id } from './ids';
import { cents, sumCents, type Cents } from './money';
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
	return { from: civilDate(year, month, 1), to: civilDate(year, month, daysInMonth(year, month)) };
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

// ------------------------------------------------------------------------------------- months

/** The first days of the months from the one containing `from` to the one containing `to` */
export function monthsBetween(from: CivilDate, to: CivilDate): CivilDate[] {
	const start = monthNumber(from);
	return Array.from({ length: Math.max(0, monthNumber(to) - start + 1) }, (_, i) => civilDate(Math.floor((start + i) / 12), ((start + i) % 12) + 1, 1));
}

/** Months since year 0, for month arithmetic */
const monthNumber = (date: CivilDate) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Transactions this far apart from all others are probably typos, e.g. 1926 for 2026 */
const OUTLIER_GAP_MONTHS = 5 * 12;

/**
 * The months a chart should cover: from the oldest transaction to the newest one (or `today`, if
 * later). Dates that are probably typos are left out and listed in `outside`: everything before a
 * gap of more than 5 years without transactions, and anything more than 2 years in the future.
 * `period` is null without (other) transactions.
 */
export function chartPeriod(transactions: readonly Transaction[], today: CivilDate): { period: Period | null; outside: Transaction[] } {
	const latest = monthNumber(today) + 24;
	// oldest first, without the far future
	const dated = [...transactions].reverse();
	const future = dated.filter((t) => monthNumber(t.date) > latest);
	const kept = dated.filter((t) => monthNumber(t.date) <= latest);
	let first = 0;
	for (let i = 0; i < kept.length - 1; i++) {
		if (monthNumber(kept[i + 1]!.date) - monthNumber(kept[i]!.date) > OUTLIER_GAP_MONTHS) first = i + 1;
	}
	const outside = [...kept.slice(0, first), ...future];
	const oldest = kept[first]?.date;
	const newest = kept.at(-1)?.date;
	if (!oldest || !newest) return { period: null, outside };
	return { period: { from: monthOf(oldest).from, to: monthOf(newest > today ? newest : today).to }, outside };
}

export interface MonthTotals {
	/** The month's first day */
	readonly month: CivilDate;
	/** Sum of the positive amounts */
	readonly income: Cents;
	/** Sum of the negative amounts (negative) */
	readonly expenses: Cents;
	/** The balance of `all` transactions at the end of the month */
	readonly balance: Cents;
}

/**
 * Income and expenses per month of the `matching` transactions, and the running balance of `all`
 * transactions (the real balance, independent of any filter). Both lists are newest first.
 */
export function monthlyTotals(matching: readonly Transaction[], all: readonly Transaction[], months: readonly CivilDate[]): MonthTotals[] {
	// by "YYYY-MM": cheap, this runs for every transaction
	const index = new Map(months.map((m, i) => [m.slice(0, 7), i]));
	const income = months.map(() => 0);
	const expenses = months.map(() => 0);
	for (const t of matching) {
		const i = index.get(t.date.slice(0, 7));
		if (i === undefined) continue;
		if (t.amount > 0) income[i]! += t.amount;
		else expenses[i]! += t.amount;
	}
	// running balance: everything up to each month's end, walking `all` from its oldest end
	let next = all.length - 1;
	let balance = 0;
	return months.map((month, i) => {
		const key = month.slice(0, 7);
		while (next >= 0 && all[next]!.date.slice(0, 7) <= key) balance += all[next--]!.amount;
		return { month, income: cents(income[i]!), expenses: cents(expenses[i]!), balance: cents(balance) };
	});
}

// ------------------------------------------------------------------------------------- breakdowns

export type Side = 'expense' | 'income';

/** The expenses (negative amounts) or the income (positive amounts) */
export function ofSide(transactions: readonly Transaction[], side: Side): Transaction[] {
	return transactions.filter((t) => (side === 'expense' ? t.amount < 0 : t.amount > 0));
}

export interface Share<K> {
	readonly key: K;
	readonly total: Cents;
	readonly count: number;
}

/** Totals per key (e.g. category), largest amount (without sign) first; ties by key */
function totalsBy<K extends string>(transactions: readonly Transaction[], keyOf: (t: Transaction) => K): Share<K>[] {
	const totals = new Map<K, { total: number; count: number }>();
	for (const t of transactions) {
		const entry = totals.get(keyOf(t)) ?? { total: 0, count: 0 };
		entry.total += t.amount;
		entry.count++;
		totals.set(keyOf(t), entry);
	}
	return [...totals]
		.map(([key, { total, count }]) => ({ key, total: cents(total), count }))
		.sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const totalsByCategory = (transactions: readonly Transaction[]): Share<Id>[] => totalsBy(transactions, (t) => t.categoryId);
export const totalsByDescription = (transactions: readonly Transaction[]): Share<string>[] => totalsBy(transactions, (t) => t.description);

/**
 * Per month (see `monthlyTotals`), the totals of the given categories, plus the rest of the
 * categories summed up as `other`.
 */
export function monthlyByCategory(
	transactions: readonly Transaction[],
	months: readonly CivilDate[],
	categories: readonly Id[],
): { byCategory: Map<Id, Cents[]>; other: Cents[] } {
	const index = new Map(months.map((m, i) => [m.slice(0, 7), i]));
	const byCategory = new Map(categories.map((id) => [id, months.map(() => 0)]));
	const other = months.map(() => 0);
	for (const t of transactions) {
		const i = index.get(t.date.slice(0, 7));
		if (i === undefined) continue;
		(byCategory.get(t.categoryId) ?? other)[i]! += t.amount;
	}
	return { byCategory: new Map([...byCategory].map(([id, values]) => [id, values.map(cents)])), other: other.map(cents) };
}
