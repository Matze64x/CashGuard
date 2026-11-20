import { describe, expect, it } from 'vitest';
import {
	addTransaction,
	applyFilter,
	cents,
	isFiltered,
	monthOf,
	NO_CATEGORY,
	NO_FILTER,
	periodPresets,
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
