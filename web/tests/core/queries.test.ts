import { describe, expect, it } from 'vitest';
import {
	addTransaction,
	applyFilter,
	cents,
	chartPeriod,
	compareTotals,
	lastTwelveMonths,
	isFiltered,
	monthlyByCategory,
	monthlyByYear,
	monthlyTotals,
	monthOf,
	monthsBetween,
	NO_CATEGORY,
	NO_FILTER,
	ofSide,
	periodPresets,
	comparePeriod,
	daysBetween,
	totalsByCategory,
	totalsByDescription,
	yearOf,
	type CashGuardData,
	type CivilDate,
	type Filter,
	type Id,
	type TransactionDraft,
	type UtcSeconds,
} from '../../src/core';

const d = (text: string) => text as CivilDate;
const FOOD = '1' as Id;
const RENT = '2' as Id;
const categories = [
	{ id: FOOD, name: 'Groceries', color: '#00FF00FF' },
	{ id: RENT, name: 'Housing', color: '#0000FFFF' },
];

function build(drafts: TransactionDraft[]): CashGuardData {
	return drafts.reduce((data, draft, i) => addTransaction(data, draft, i as UtcSeconds).data, { categories, accounts: [], transactions: [] } as CashGuardData);
}

const tx = (date: string, description: string, amount: number, categoryId: Id = NO_CATEGORY): TransactionDraft => ({ date: d(date), description, categoryId, amount: cents(amount) });

const data = build([
	tx('2026-01-05', 'Supermarket', -2000, FOOD),
	tx('2026-01-31', 'Rent January', -80000, RENT),
	tx('2026-02-01', 'Salary', 300000),
	{
		...tx('2026-02-10', 'Weekly shop', 0),
		subTransactions: [tx('2026-02-10', 'Food', -4000, FOOD), tx('2026-02-11', 'Bottle deposit', 225)],
	},
]);
const filter = (changes: Partial<Filter>): Filter => ({ ...NO_FILTER, ...changes });
const descriptions = (f: Filter) => applyFilter(data.transactions, categories, f).transactions.map((t) => t.description);

describe('filter', () => {
	it('without a filter shows everything', () => {
		const result = applyFilter(data.transactions, categories, NO_FILTER);
		expect(isFiltered(NO_FILTER)).toBe(false);
		expect(result.transactions).toBe(data.transactions);
		expect(result.total).toBe(-2000 - 80000 + 300000 - 4000 + 225);
	});

	it('filters by period, both ends inclusive', () => {
		expect(descriptions(filter({ from: d('2026-01-31'), to: d('2026-02-01') }))).toEqual(['Salary', 'Rent January']);
		expect(descriptions(filter({ to: d('2026-01-05') }))).toEqual(['Supermarket']);
	});

	it('treats a split transaction as one, by its own date, category, amount and description', () => {
		// a part is on the 11th, but the transaction is on the 10th
		expect(descriptions(filter({ from: d('2026-02-11') }))).toEqual([]);
		// its part is in Groceries, the transaction itself has no category
		expect(descriptions(filter({ categories: [FOOD] }))).toEqual(['Supermarket']);
		expect(descriptions(filter({ categories: [NO_CATEGORY] }))).toEqual(['Weekly shop', 'Salary']);
		// the parts' descriptions aren't searched
		expect(descriptions(filter({ text: 'bottle' }))).toEqual([]);
		const result = applyFilter(data.transactions, categories, filter({ text: 'weekly' }));
		expect(result.total).toBe(-4000 + 225);
	});

	it('filters by kind and by the amount without its sign', () => {
		expect(descriptions(filter({ kind: 'income' }))).toEqual(['Salary']);
		expect(descriptions(filter({ kind: 'expense', minAmount: cents(3000), maxAmount: cents(5000) }))).toEqual(['Weekly shop']);
		expect(descriptions(filter({ minAmount: cents(100000) }))).toEqual(['Salary']);
	});

	it('finds all words in descriptions and category names', () => {
		expect(descriptions(filter({ text: 'rent' }))).toEqual(['Rent January']);
		expect(descriptions(filter({ text: 'RENT housing' }))).toEqual(['Rent January']);
		expect(descriptions(filter({ text: 'groceries' }))).toEqual(['Supermarket']);
		expect(descriptions(filter({ text: 'rent salary' }))).toEqual([]);
	});
});

describe('periods', () => {
	it('finds months and years', () => {
		expect(monthOf(d('2024-02-15'))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
		expect(monthOf(d('2026-12-31'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
		expect(yearOf(d('2026-06-01'))).toEqual({ from: '2026-01-01', to: '2026-12-31' });
	});

	it('offers presets relative to today', () => {
		const presets = Object.fromEntries(periodPresets(d('2026-01-20')).map((p) => [p.label, p.period]));
		expect(presets['Last month']).toEqual({ from: '2025-12-01', to: '2025-12-31' });
		expect(presets['Last 3 months']).toEqual({ from: '2025-11-01', to: '2026-01-31' });
		expect(presets['Last 12 months']).toEqual({ from: '2025-02-01', to: '2026-01-31' });
		expect(presets['Last year']).toEqual({ from: '2025-01-01', to: '2025-12-31' });
	});
});

describe('months', () => {
	it('lists the months of a period', () => {
		expect(monthsBetween(d('2025-11-15'), d('2026-02-01'))).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
		expect(monthsBetween(d('2026-03-31'), d('2026-03-31'))).toEqual(['2026-03-01']);
	});

	it('spans the data up to today', () => {
		expect(chartPeriod(data.transactions, d('2026-04-02'))).toEqual({ period: { from: '2026-01-01', to: '2026-04-30' }, outside: [] });
		expect(chartPeriod(data.transactions, d('2025-01-01')).period).toEqual({ from: '2026-01-01', to: '2026-02-28' });
		expect(chartPeriod([], d('2026-01-01'))).toEqual({ period: null, outside: [] });
	});

	it('leaves out dates that are probably typos', () => {
		const typos = build([tx('2026-01-05', 'ok', -1), tx('2026-02-05', 'ok', -1), tx('1926-02-05', 'old typo', -1), tx('2062-02-05', 'future typo', -1), tx('2261-12-31', 'last day', -1)]);
		const { period, outside } = chartPeriod(typos.transactions, d('2026-03-01'));
		expect(period).toEqual({ from: '2026-01-01', to: '2026-03-31' });
		expect(outside.map((t) => t.description).sort()).toEqual(['future typo', 'last day', 'old typo']);
		// next year's planned transactions are fine
		expect(chartPeriod(build([tx('2027-06-01', 'planned', -1)]).transactions, d('2026-03-01')).period).toEqual({ from: '2027-06-01', to: '2027-06-30' });
	});

	it('handles the last supported month', () => {
		expect(monthOf(d('2261-12-31'))).toEqual({ from: '2261-12-01', to: '2261-12-31' });
		expect(monthsBetween(d('2261-11-02'), d('2261-12-31'))).toEqual(['2261-11-01', '2261-12-01']);
	});

	it('sums income and expenses per month, with the balance of everything', () => {
		const months = monthsBetween(d('2025-12-01'), d('2026-03-01'));
		const food = applyFilter(data.transactions, categories, filter({ text: 'supermarket' })).transactions;
		expect(monthlyTotals(data.transactions, data.transactions, months)).toEqual([
			{ month: '2025-12-01', income: 0, expenses: 0, balance: 0 },
			{ month: '2026-01-01', income: 0, expenses: -82000, balance: -82000 },
			{ month: '2026-02-01', income: 300000, expenses: -3775, balance: -82000 + 300000 - 3775 },
			{ month: '2026-03-01', income: 0, expenses: 0, balance: -82000 + 300000 - 3775 },
		]);
		// only the matching transactions are summed; the balance stays the real one
		expect(monthlyTotals(food, data.transactions, months)[1]).toEqual({ month: '2026-01-01', income: 0, expenses: -2000, balance: -82000 });
	});
});

describe('breakdowns', () => {
	it('sums per category and per description, largest first', () => {
		expect(totalsByCategory(data.transactions)).toEqual([
			{ key: NO_CATEGORY, total: 300000 - 3775, count: 2 },
			{ key: RENT, total: -80000, count: 1 },
			{ key: FOOD, total: -2000, count: 1 },
		]);
		const more = build([tx('2026-01-01', 'Bakery', -300, FOOD), tx('2026-01-02', 'Bakery', -200, FOOD), tx('2026-01-03', 'Market', -400, FOOD)]);
		expect(totalsByDescription(more.transactions)).toEqual([
			{ key: 'Bakery', total: -500, count: 2 },
			{ key: 'Market', total: -400, count: 1 },
		]);
	});

	it('sums per month and category, with the rest as other', () => {
		const months = monthsBetween(d('2026-01-01'), d('2026-02-01'));
		const { byCategory, other } = monthlyByCategory(data.transactions, months, [RENT, FOOD]);
		expect(byCategory.get(RENT)).toEqual([-80000, 0]);
		expect(byCategory.get(FOOD)).toEqual([-2000, 0]);
		expect(other).toEqual([0, 300000 - 3775]);
	});
});

describe('sides', () => {
	it('splits expenses from income; zero amounts are neither', () => {
		const mixed = build([tx('2026-01-01', 'in', 100), tx('2026-01-02', 'out', -100), tx('2026-01-03', 'zero', 0)]);
		expect(ofSide(mixed.transactions, 'expense').map((t) => t.description)).toEqual(['out']);
		expect(ofSide(mixed.transactions, 'income').map((t) => t.description)).toEqual(['in']);
	});
});

describe('comparisons', () => {
	it('finds the period before: whole months by months, others by days', () => {
		const later = d('2100-01-01');
		const before = (from: string, to: string) => comparePeriod({ from: d(from), to: d(to) }, later)?.previous;
		expect(before('2026-03-01', '2026-05-31')).toEqual({ from: '2025-12-01', to: '2026-02-28' });
		expect(before('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
		expect(before('2024-03-01', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
		expect(before('2026-04-01', '2026-04-30')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
		expect(before('2026-03-10', '2026-03-19')).toEqual({ from: '2026-02-28', to: '2026-03-09' });
		// starts mid-month, ends at a month's end: by days
		expect(before('2024-03-15', '2024-03-31')).toEqual({ from: '2024-02-27', to: '2024-03-14' });
		expect(comparePeriod({ from: d('1678-01-01'), to: d('1678-12-31') }, later)).toBeNull();
		expect(lastTwelveMonths(d('2026-03-15'))).toEqual({ from: '2025-03-01', to: '2026-02-28' });
	});

	it('compares an unfinished period like for like', () => {
		const today = d('2026-11-20');
		expect(comparePeriod({ from: d('2026-11-01'), to: d('2026-11-30') }, today)).toEqual({
			current: { from: '2026-11-01', to: '2026-11-20' },
			previous: { from: '2026-10-01', to: '2026-10-20' },
			cut: true,
			months: 1,
		});
		const year = comparePeriod({ from: d('2026-01-01'), to: d('2026-12-31') }, today)!;
		expect(year.previous).toEqual({ from: '2025-01-01', to: '2025-11-20' });
		expect(year.months).toBe(11);
		// 31 days, 10 of them over: compared with the first 10 of the 31 days before
		const days = comparePeriod({ from: d('2026-11-11'), to: d('2026-12-11') }, today)!;
		expect(days.previous).toEqual({ from: '2026-10-11', to: '2026-10-20' });
		expect(days.months).toBeCloseTo(10 / 30.4375);
		// not started yet, or over: as it is
		expect(comparePeriod({ from: d('2027-01-01'), to: d('2027-01-31') }, today)?.cut).toBe(false);
		expect(daysBetween(d('2024-02-28'), d('2024-03-01'))).toBe(2);
	});

	it('puts two periods side by side', () => {
		const now = [{ key: 'a', total: cents(-500), count: 1 }, { key: 'b', total: cents(-100), count: 1 }];
		const before = [{ key: 'b', total: cents(-900), count: 2 }, { key: 'c', total: cents(-50), count: 1 }];
		expect(compareTotals(now, before)).toEqual([
			{ key: 'b', current: -100, previous: -900 },
			{ key: 'a', current: -500, previous: 0 },
			{ key: 'c', current: 0, previous: -50 },
		]);
	});

	it('sums the months of each year', () => {
		const byYear = monthlyByYear(data.transactions, [2025, 2026]);
		expect(byYear.get(2025)).toEqual(Array(12).fill(0));
		expect(byYear.get(2026)!.slice(0, 3)).toEqual([-82000, 300000 - 3775, 0]);
	});
});
