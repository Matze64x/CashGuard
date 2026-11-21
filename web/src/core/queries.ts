/**
 * Filtering and aggregation for exploring the data: what the list, the summaries and the charts
 * show. Pure functions, so the views stay thin and everything here is unit-tested.
 *
 * A group (a transaction split into parts) counts as one transaction with its own date, category,
 * description and total: the parts are details that only show when the transaction is opened.
 */
import { addDays, addMonths, civilDate, dateParts, daysBetween, daysInMonth, type CivilDate } from './dates';
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
export function chartPeriod(
	transactions: readonly Transaction[],
	today: CivilDate,
): { period: Period | null; outside: Transaction[]; /** The oldest date that counts (the period starts at its month) */ oldest: CivilDate | null } {
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
	if (!oldest || !newest) return { period: null, outside, oldest: null };
	return { period: { from: monthOf(oldest).from, to: monthOf(newest > today ? newest : today).to }, outside, oldest };
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

/** Sort order: larger sizes first, ties by key (for a stable order) */
const largestFirst = (sizeA: number, sizeB: number, keyA: string, keyB: string) => sizeB - sizeA || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);

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
		.sort((a, b) => largestFirst(Math.abs(a.total), Math.abs(b.total), a.key, b.key));
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

// ------------------------------------------------------------------------------------- comparisons

export interface PeriodComparison {
	/** The period, cut at `today` if it isn't over yet */
	readonly current: Period;
	/** The same stretch of time right before it */
	readonly previous: Period;
	/** Whether `current` was cut at today */
	readonly cut: boolean;
	/** How many months `current` stands for, for averages per month */
	readonly months: number;
}

/**
 * The period to compare with: the same length right before. Whole months are compared with as many
 * whole months (Mar–May with Dec–Feb), other periods with as many days. A period that isn't over
 * yet is compared like for like: "this month" on the 20th is the 1st–20th, compared with the
 * 1st–20th of the month before. Null if that would leave the supported years.
 */
export function comparePeriod(period: Period, today: CivilDate): PeriodComparison | null {
	const { from, to } = period;
	const cut = from <= today && today < to;
	const end = cut ? today : to;
	try {
		if (monthOf(from).from === from && monthOf(to).to === to) {
			const span = monthNumber(to) - monthNumber(from) + 1;
			// (addMonths clamps to the month's end, e.g. 31.03. → 28.02.)
			const previous = { from: addMonths(from, -span), to: cut ? addMonths(end, -span) : monthOf(addMonths(to, -span)).to };
			return { current: { from, to: end }, previous, cut, months: monthsBetween(from, end).length };
		}
		const days = daysBetween(from, to) + 1;
		const before = addDays(from, -days);
		const elapsed = daysBetween(from, end);
		return { current: { from, to: end }, previous: { from: before, to: addDays(before, elapsed) }, cut, months: (elapsed + 1) / 30.4375 };
	} catch {
		return null;
	}
}

/**
 * How much to scale up what an unfinished period has so far, to estimate its whole: its days over
 * the days with data so far (from its start, or from the `oldest` data if that's later, through
 * today). Null if the period is over (or ends today), hasn't started, or has no data yet.
 */
export function projectionFactor(period: Period, today: CivilDate, oldest: CivilDate | null): number | null {
	if (today < period.from || today >= period.to) return null;
	const start = oldest !== null && oldest > period.from ? oldest : period.from;
	if (start > today) return null;
	return (daysBetween(period.from, period.to) + 1) / (daysBetween(start, today) + 1);
}

/**
 * How to estimate an unfinished period's whole (see `projection`): what it has through `today`
 * plus what usually comes in the rest of it, i.e. on average in the `rests` of the periods before
 * (the same days after "today" in each). Without earlier periods with data: what it has through
 * today scaled up by `factor` to its whole length.
 */
export type ProjectionBasis = { readonly period: Period; readonly today: CivilDate } & (
	| { readonly kind: 'usual'; readonly rests: readonly Period[] }
	| { readonly kind: 'scaled'; readonly factor: number }
);

/** How many earlier periods "usually" averages over: up to 12, as many as fit in 3 years */
const USUAL_PERIODS = 12;
const USUAL_MONTHS = 36;
const USUAL_DAYS = 1096;

/**
 * The basis for projecting `period` (see `ProjectionBasis`), or null if it's over (or ends today),
 * hasn't started, or has no data yet (`oldest`: the first date with data). Earlier periods are
 * shifted like in `comparePeriod`: whole months by as many months (so a year by 12), other periods by
 * as many days; one counts if the data reaches back to its "today". A rest may be empty (31.03.
 * shifted to February), which counts as nothing to come.
 */
export function projectionBasis(period: Period, today: CivilDate, oldest: CivilDate | null): ProjectionBasis | null {
	const factor = projectionFactor(period, today, oldest);
	if (factor === null || oldest === null) return null;
	const { from, to } = period;
	const wholeMonths = monthOf(from).from === from && monthOf(to).to === to;
	const span = wholeMonths ? monthNumber(to) - monthNumber(from) + 1 : daysBetween(from, to) + 1;
	const count = Math.min(USUAL_PERIODS, Math.max(1, Math.floor((wholeMonths ? USUAL_MONTHS : USUAL_DAYS) / span)));
	const rests: Period[] = [];
	try {
		for (let k = 1; k <= count; k++) {
			const shift = (date: CivilDate) => (wholeMonths ? addMonths(date, -span * k) : addDays(date, -span * k));
			const before = shift(today);
			if (before < oldest) break;
			// (addMonths clamps to the month's end, e.g. 31.03. → 28.02., so take the month's end)
			rests.push({ from: addDays(before, 1), to: wholeMonths ? monthOf(shift(to)).to : shift(to) });
		}
	} catch {
		// left the supported years: the periods so far are all there is
	}
	return rests.length > 0 ? { period, today, kind: 'usual', rests } : { period, today, kind: 'scaled', factor };
}

/**
 * Estimates for the end of a period, per group of `transactions` (the ones to consider, of any
 * date; `keyOf` groups them, e.g. by category, each group of one sign): given a group's total in
 * the period, its estimate (see `ProjectionBasis`), or null if that's beyond what cents can hold
 * exactly. What is already entered for after today counts once: as the rest, if it's more than
 * what usually comes (else it's part of that). A group's usual rest averages only over the earlier
 * periods since its first transaction, so a new category isn't diluted by the time before it.
 */
export function projection<K>(
	basis: ProjectionBasis,
	transactions: readonly Transaction[],
	keyOf: (t: Transaction) => K,
): (key: K, total: Cents) => Cents | null {
	const { today, period } = basis;
	const rests = basis.kind === 'usual' ? basis.rests : [];
	const groups = new Map<K, { first: CivilDate; entered: number; rest: number }>();
	for (const t of transactions) {
		const key = keyOf(t);
		let group = groups.get(key);
		if (!group) groups.set(key, (group = { first: t.date, entered: 0, rest: 0 }));
		if (t.date < group.first) group.first = t.date;
		if (today < t.date && t.date <= period.to) group.entered += t.amount;
		for (const rest of rests) if (rest.from <= t.date && t.date <= rest.to) group.rest += t.amount;
	}
	return (key, total) => {
		const group = groups.get(key);
		const entered = group?.entered ?? 0;
		const throughToday = total - entered;
		let value: number;
		if (basis.kind === 'scaled') value = throughToday * basis.factor + entered;
		else {
			// the rests the group existed in (by their end): all its transactions in rests are in these
			const counted = group ? rests.filter((rest) => rest.to >= group.first).length : 0;
			const usual = counted === 0 ? 0 : group!.rest / counted;
			value = throughToday + (Math.abs(entered) > Math.abs(usual) ? entered : usual);
		}
		// to whole cents, halves away from 0 (alike for both signs)
		const rounded = Math.sign(value) * Math.round(Math.abs(value));
		return Number.isSafeInteger(rounded) ? cents(rounded) : null;
	};
}

/** The last 12 complete months before `today`'s month */
export function lastTwelveMonths(today: CivilDate): Period {
	const thisMonth = monthOf(today).from;
	return { from: addMonths(thisMonth, -12), to: addDays(thisMonth, -1) };
}

export interface Comparison<K> {
	readonly key: K;
	readonly current: Cents;
	readonly previous: Cents;
}

/** Totals of two periods side by side, largest (in either period) first */
export function compareTotals<K extends string>(current: readonly Share<K>[], previous: readonly Share<K>[]): Comparison<K>[] {
	const rows = new Map<K, { current: Cents; previous: Cents }>();
	for (const s of current) rows.set(s.key, { current: s.total, previous: cents(0) });
	for (const s of previous) rows.set(s.key, { current: rows.get(s.key)?.current ?? cents(0), previous: s.total });
	const size = (r: { current: Cents; previous: Cents }) => Math.max(Math.abs(r.current), Math.abs(r.previous));
	return [...rows].map(([key, r]) => ({ key, ...r })).sort((a, b) => largestFirst(size(a), size(b), a.key, b.key));
}

/**
 * Per category, the totals per bucket (e.g. "2026-03" for months or "2026" for years): `bucketOf`
 * gives a date's bucket, `buckets` the ones to sum up (others are left out).
 */
export function categoryTotalsOverTime(transactions: readonly Transaction[], buckets: readonly string[], bucketOf: (date: CivilDate) => string): Map<Id, Cents[]> {
	const index = new Map(buckets.map((b, i) => [b, i]));
	const sums = new Map<Id, number[]>();
	for (const t of transactions) {
		const i = index.get(bucketOf(t.date));
		if (i === undefined) continue;
		let values = sums.get(t.categoryId);
		if (!values) sums.set(t.categoryId, (values = buckets.map(() => 0)));
		values[i]! += t.amount;
	}
	return new Map([...sums].map(([id, values]) => [id, values.map(cents)]));
}
