import { describe, expect, it } from 'vitest';
import {
	cents,
	EMPTY_DATA,
	planImport,
	sortNewestFirst,
	summarizeChanges,
	totalChanges,
	type Account,
	type CashGuardData,
	type CivilDate,
	type Id,
	type Transaction,
	type UtcSeconds,
} from '../../src/core';
import { randomDocument, randomEdit } from './random-data';

const tx = (id: string, amount = -100, edited = 0): Transaction => ({
	id: id as Id,
	date: '2026-01-01' as CivilDate,
	categoryId: '0' as Id,
	amount: cents(amount),
	description: `t${id}`,
	added: 0 as UtcSeconds,
	edited: edited as UtcSeconds,
});
const acc = (name: string, amount: number, id = name): Account => ({ id: id as Id, name, amount: cents(amount), edited: 0 as UtcSeconds });
const data = (transactions: Transaction[], accounts: Account[] = []): CashGuardData => ({ categories: [], accounts, recurring: [], transactions: sortNewestFirst(transactions) });
const ids = (d: CashGuardData) => d.transactions.map((t) => t.id).sort();

describe('summarizeChanges', () => {
	it('counts added, changed and deleted records of every kind', () => {
		const before = data([tx('1'), tx('2')], [acc('Bank', 1, 'b1'), acc('Bank', 2, 'b2')]);
		const after = data([tx('1', -5), tx('3')], [acc('Bank', 1, 'b1')]);
		expect(summarizeChanges(before, after)).toEqual({
			transactions: { added: 1, changed: 1, deleted: 1 },
			categories: { added: 0, changed: 0, deleted: 0 },
			accounts: { added: 0, changed: 0, deleted: 1 },
			recurring: { added: 0, changed: 0, deleted: 0 },
		});
		expect(totalChanges(summarizeChanges(before, after))).toBe(4);
	});

	it('counts everything as added without a previous version', () => {
		const d = randomDocument(2);
		expect(totalChanges(summarizeChanges(null, d))).toBe(d.transactions.length + d.categories.length + d.accounts.length + d.recurring.length);
	});

	it('finds no changes between equal versions', () => {
		const d = randomDocument(3);
		expect(totalChanges(summarizeChanges(d, structuredClone(d)))).toBe(0);
	});
});

describe('import (additive)', () => {
	it('into an empty app: the file becomes the data', () => {
		const file = randomDocument(4);
		const plan = planImport(EMPTY_DATA, file);
		expect(plan.next).toEqual(file);
		expect(plan.warnings).toEqual([]);
	});

	it('adds what the app lacks and keeps everything else, including what the file lacks', () => {
		const working = data([tx('1'), tx('2'), tx('4')]);
		const plan = planImport(working, data([tx('1'), tx('3')]));
		expect(ids(plan.next)).toEqual(['1', '2', '3', '4']);
		expect(plan.changes.transactions).toEqual({ added: 1, changed: 0, deleted: 0 });
	});

	it('never deletes: an empty or old file changes nothing', () => {
		const working = data([tx('1'), tx('2')]);
		expect(planImport(working, EMPTY_DATA).next).toEqual(working);
		expect(totalChanges(planImport(working, data([tx('1')])).changes)).toBe(0);
	});

	it('merges records with the same id: the later edit wins', () => {
		const plan = planImport(data([tx('1', -5, 1), tx('2', -6, 3)]), data([tx('1', -7, 2), tx('2', -8, 2)]));
		expect(plan.next).toEqual(data([tx('1', -7, 2), tx('2', -6, 3)]));
		expect(plan.changes.transactions).toEqual({ added: 0, changed: 1, deleted: 0 });
	});

	it('random data on both sides: every record of either side is in the result', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const base = randomDocument(seed);
			const ours = randomEdit(base, 1000 + seed);
			const theirs = randomEdit(base, 2000 + seed);
			const plan = planImport(ours, theirs);
			const result = new Set(plan.next.transactions.flatMap((t) => [t.id, ...(t.subTransactions ?? []).map((s) => s.id)]));
			const top = (d: CashGuardData) => d.transactions.map((t) => t.id);
			// (a top-level transaction moved into a group on the other side lives on inside that group)
			for (const id of [...top(ours), ...top(theirs)]) expect(result.has(id)).toBe(true);
			expect(plan.changes.transactions.deleted).toBe(0);
		}
	});
});

describe('import warnings', () => {
	const working = data([tx('1'), tx('2'), tx('3')]);

	it('a file with nothing in common with the data', () => {
		expect(planImport(working, data([tx('100')])).warnings).toEqual(['unrelated-file']);
	});

	it('no warning when one side is empty or they share a transaction', () => {
		expect(planImport(working, EMPTY_DATA).warnings).toEqual([]);
		expect(planImport(EMPTY_DATA, working).warnings).toEqual([]);
		expect(planImport(working, data([tx('3'), tx('7')])).warnings).toEqual([]);
	});
});
