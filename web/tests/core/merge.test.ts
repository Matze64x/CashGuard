import { describe, expect, it } from 'vitest';
import {
	cents,
	merge,
	NO_CATEGORY,
	normalizeGroup,
	parseCashGuard,
	serializeCashGuard,
	sortNewestFirst,
	type Account,
	type CashGuardData,
	type Category,
	type CivilDate,
	type ConflictReason,
	type Id,
	type MergeResult,
	type Recurring,
	type Transaction,
	type UtcSeconds,
} from '../../src/core';
import { canonicalString, deepEqual } from '../../src/core/equal';
import { randomDocument, randomEdit } from './random-data';

// --- small builders: ids are short strings, times are small numbers so "later" is easy to read

function tx(id: string, fields: { amount?: number; edited?: number; category?: string; subs?: Transaction[] } = {}): Transaction {
	const t: Transaction = {
		id: id as Id,
		date: '2026-01-01' as CivilDate,
		categoryId: (fields.category ?? '0') as Id,
		amount: cents(fields.amount ?? -100),
		description: `t${id}`,
		added: 0 as UtcSeconds,
		edited: (fields.edited ?? 0) as UtcSeconds,
		...(fields.subs && { subTransactions: fields.subs }),
	};
	return normalizeGroup(t);
}
const cat = (id: string, name = `c${id}`): Category => ({ id: id as Id, name, color: '#000000FF' });
/** An account; its id is its name unless given */
const acc = (name: string, amount: number, edited = 0, id = name): Account => ({ id: id as Id, name, amount: cents(amount), edited: edited as UtcSeconds });
/** A recurring transaction: monthly on the 1st, handled through `handled` (a day in 2026-01) */
const rec = (id: string, fields: Partial<Omit<Recurring, 'handled'>> & { handled?: number | null } = {}): Recurring => {
	const { handled = null, ...rest } = fields;
	return {
		id: id as Id,
		description: `r${id}`,
		categoryId: NO_CATEGORY,
		amount: null,
		accountId: null,
		schedule: { unit: 'month', every: 1, days: [1] },
		start: '2026-01-01' as CivilDate,
		end: null,
		edited: 0 as UtcSeconds,
		...rest,
		handled: handled === null ? null : (`2026-01-${String(handled).padStart(2, '0')}` as CivilDate),
	};
};
const data = (fields: { t?: Transaction[]; c?: Category[]; a?: Account[]; r?: Recurring[] } = {}): CashGuardData => ({
	transactions: sortNewestFirst(fields.t ?? []),
	categories: fields.c ?? [],
	accounts: fields.a ?? [],
	recurring: fields.r ?? [],
});

/** "key:reason" for every conflict, to compare compactly */
function conflictSummary(result: MergeResult): string[] {
	return Object.values(result.conflicts)
		.flat()
		.map((c) => `${c.key}:${c.reason}`);
}

interface Scenario {
	name: string;
	base: CashGuardData | null;
	ours: CashGuardData;
	theirs: CashGuardData;
	expected: CashGuardData;
	conflicts?: `${string}:${ConflictReason}`[];
}

const BASE = data({ t: [tx('1'), tx('2')], c: [cat('7')], a: [acc('Bank', 100)] });
/** BASE with some of its lists replaced */
const variant = (fields: { t?: Transaction[]; c?: Category[]; a?: Account[] }): CashGuardData =>
	data({ t: fields.t ?? [...BASE.transactions], c: fields.c ?? [...BASE.categories], a: fields.a ?? [...BASE.accounts] });

const scenarios: Scenario[] = [
	{ name: 'nothing changed', base: BASE, ours: BASE, theirs: BASE, expected: BASE },
	{
		name: 'only ours changed a transaction',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		theirs: BASE,
		expected: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
	},
	{
		name: 'only theirs changed a transaction',
		base: BASE,
		ours: BASE,
		theirs: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
	},
	{
		name: 'both sides changed different transactions',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		theirs: variant({ t: [tx('1'), tx('2', { amount: -6, edited: 1 })] }),
		expected: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2', { amount: -6, edited: 1 })] }),
	},
	{
		name: 'both sides made the same change',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		theirs: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
	},
	{
		name: 'both changed the same transaction: theirs is newer',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		theirs: variant({ t: [tx('1', { amount: -6, edited: 2 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -6, edited: 2 }), tx('2')] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'both changed the same transaction: ours is newer',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 3 }), tx('2')] }),
		theirs: variant({ t: [tx('1', { amount: -6, edited: 2 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -5, edited: 3 }), tx('2')] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'both changed the same transaction at the same time: a fixed order of the contents decides',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 2 }), tx('2')] }),
		theirs: variant({ t: [tx('1', { amount: -6, edited: 2 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -6, edited: 2 }), tx('2')] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'both sides added transactions',
		base: BASE,
		ours: variant({ t: [tx('1'), tx('2'), tx('3')] }),
		theirs: variant({ t: [tx('1'), tx('2'), tx('4')] }),
		expected: variant({ t: [tx('1'), tx('2'), tx('3'), tx('4')] }),
	},
	{
		name: 'ours deleted, theirs unchanged: deleted',
		base: BASE,
		ours: variant({ t: [tx('2')] }),
		theirs: BASE,
		expected: variant({ t: [tx('2')] }),
	},
	{
		name: 'both deleted the same transaction',
		base: BASE,
		ours: variant({ t: [tx('2')] }),
		theirs: variant({ t: [tx('2')] }),
		expected: variant({ t: [tx('2')] }),
	},
	{
		name: 'ours deleted, theirs changed: the change is kept',
		base: BASE,
		ours: variant({ t: [tx('2')] }),
		theirs: variant({ t: [tx('1', { amount: -6, edited: 1 }), tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -6, edited: 1 }), tx('2')] }),
		conflicts: ['1:deleted-and-changed'],
	},
	{
		name: 'ours changed, theirs deleted: the change is kept',
		base: BASE,
		ours: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		theirs: variant({ t: [tx('2')] }),
		expected: variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] }),
		conflicts: ['1:deleted-and-changed'],
	},
	{
		name: 'a group is one unit: changes to different subs on both sides conflict',
		base: data({ t: [tx('1', { subs: [tx('11'), tx('12')] })] }),
		ours: data({ t: [tx('1', { edited: 1, subs: [tx('11', { amount: -1, edited: 1 }), tx('12')] })] }),
		theirs: data({ t: [tx('1', { edited: 2, subs: [tx('11'), tx('12', { amount: -2, edited: 2 })] })] }),
		expected: data({ t: [tx('1', { edited: 2, subs: [tx('11'), tx('12', { amount: -2, edited: 2 })] })] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'a group converted back to a transaction on one side, a sub edited on the other',
		base: data({ t: [tx('1', { subs: [tx('11')] })] }),
		ours: data({ t: [tx('1', { edited: 3 })] }),
		theirs: data({ t: [tx('1', { edited: 2, subs: [tx('11', { amount: -2, edited: 2 })] })] }),
		expected: data({ t: [tx('1', { edited: 3 })] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'the same transaction converted into a group on both sides (different subs)',
		base: data({ t: [tx('1')] }),
		ours: data({ t: [tx('1', { edited: 1, subs: [tx('11')] })] }),
		theirs: data({ t: [tx('1', { edited: 2, subs: [tx('12')] })] }),
		expected: data({ t: [tx('1', { edited: 2, subs: [tx('12')] })] }),
		conflicts: ['1:changed-on-both-sides'],
	},
	{
		name: 'a group dissolved on one side (subs kept as transactions), edited on the other -> the group wins',
		base: data({ t: [tx('1', { subs: [tx('11'), tx('12')] })] }),
		ours: data({ t: [tx('11'), tx('12')] }),
		theirs: data({ t: [tx('1', { edited: 1, amount: -1, subs: [tx('11'), tx('12')] })] }),
		expected: data({ t: [tx('1', { edited: 1, amount: -1, subs: [tx('11'), tx('12')] })] }),
		conflicts: ['1:deleted-and-changed', '12:moved-into-group', '11:moved-into-group'],
	},
	{
		name: 'a transaction moved into a group on one side, edited on the other -> the group wins',
		base: data({ t: [tx('1', { subs: [tx('11')] }), tx('3')] }),
		ours: data({ t: [tx('1', { edited: 1, subs: [tx('11'), tx('3')] })] }),
		theirs: data({ t: [tx('1', { subs: [tx('11')] }), tx('3', { amount: -9, edited: 1 })] }),
		expected: data({ t: [tx('1', { edited: 1, subs: [tx('11'), tx('3')] })] }),
		conflicts: ['3:moved-into-group'],
	},
	{
		name: 'a transaction converted into a group on one side',
		base: BASE,
		ours: variant({ t: [tx('1', { edited: 1, subs: [tx('11')] }), tx('2')] }),
		theirs: BASE,
		expected: variant({ t: [tx('1', { edited: 1, subs: [tx('11')] }), tx('2')] }),
	},
	{
		name: 'categories: renamed on both sides -> a fixed order of the contents decides (no timestamps)',
		base: BASE,
		ours: variant({ c: [cat('7', 'Food')] }),
		theirs: variant({ c: [cat('7', 'Groceries')] }),
		expected: variant({ c: [cat('7', 'Groceries')] }),
		conflicts: ['7:changed-on-both-sides'],
	},
	{
		name: 'categories: deleted on one side, renamed on the other -> the renamed one is kept',
		base: BASE,
		ours: variant({ c: [] }),
		theirs: variant({ c: [cat('7', 'Food')] }),
		expected: variant({ c: [cat('7', 'Food')] }),
		conflicts: ['7:deleted-and-changed'],
	},
	{
		name: 'categories: deleted while the other side starts using it in a sub-transaction -> restored',
		base: BASE,
		ours: variant({ c: [] }),
		theirs: variant({ t: [tx('1'), tx('2', { edited: 1, subs: [tx('21', { category: '7' })] })] }),
		expected: variant({ t: [tx('1'), tx('2', { edited: 1, subs: [tx('21', { category: '7' })] })] }),
		conflicts: ['7:deleted-category-in-use'],
	},
	{
		name: 'categories: deleted on one side while the other side starts using it -> restored',
		base: BASE,
		ours: variant({ c: [] }),
		theirs: variant({ t: [tx('1'), tx('2'), tx('3', { category: '7' })] }),
		expected: variant({ t: [tx('1'), tx('2'), tx('3', { category: '7' })] }),
		conflicts: ['7:deleted-category-in-use'],
	},
	{
		name: 'categories: added on both sides',
		base: BASE,
		ours: variant({ c: [cat('7'), cat('8')] }),
		theirs: variant({ c: [cat('7'), cat('9')] }),
		expected: variant({ c: [cat('7'), cat('8'), cat('9')] }),
	},
	{
		name: 'accounts: changed on both sides -> newer wins',
		base: BASE,
		ours: variant({ a: [acc('Bank', 150, 5)] }),
		theirs: variant({ a: [acc('Bank', 170, 6)] }),
		expected: variant({ a: [acc('Bank', 170, 6)] }),
		conflicts: ['Bank:changed-on-both-sides'],
	},
	{
		name: 'accounts: deleted on one side, changed on the other -> the change is kept',
		base: BASE,
		ours: variant({ a: [] }),
		theirs: variant({ a: [acc('Bank', 170, 6)] }),
		expected: variant({ a: [acc('Bank', 170, 6)] }),
		conflicts: ['Bank:deleted-and-changed'],
	},
	{
		name: 'accounts: a rename on one side and a new balance on the other -> both kept',
		base: BASE,
		ours: variant({ a: [acc('Checking', 100, 0, 'Bank')] }),
		theirs: variant({ a: [acc('Bank', 170, 6)] }),
		expected: variant({ a: [acc('Checking', 170, 6, 'Bank')] }),
	},
	{
		name: 'accounts: renamed differently on both sides -> one name wins, the balance change is kept',
		base: BASE,
		ours: variant({ a: [acc('Checking', 100, 0, 'Bank')] }),
		theirs: variant({ a: [acc('Giro', 170, 6, 'Bank')] }),
		expected: variant({ a: [acc('Giro', 170, 6, 'Bank')] }),
		conflicts: ['Bank:changed-on-both-sides'],
	},
	{
		name: 'recurring: handled further on both sides -> the later',
		base: data({ r: [rec('5', { handled: 1 })] }),
		ours: data({ r: [rec('5', { handled: 8 })] }),
		theirs: data({ r: [rec('5', { handled: 15 })] }),
		expected: data({ r: [rec('5', { handled: 15 })] }),
	},
	{
		name: 'recurring: a changed template on one side and handled occurrences on the other -> both kept',
		base: data({ r: [rec('5')] }),
		ours: data({ r: [rec('5', { amount: cents(-500), edited: 1 as UtcSeconds })] }),
		theirs: data({ r: [rec('5', { handled: 1 })] }),
		expected: data({ r: [rec('5', { amount: cents(-500), handled: 1, edited: 1 as UtcSeconds })] }),
	},
	{
		name: 'recurring: an undone occurrence on one side is kept, also when the other side changed the template',
		base: data({ r: [rec('5', { handled: 10 })] }),
		ours: data({ r: [rec('5', { handled: 5 })] }),
		theirs: data({ r: [rec('5', { description: 'Flat', handled: 10, edited: 2 as UtcSeconds })] }),
		expected: data({ r: [rec('5', { description: 'Flat', handled: 5, edited: 2 as UtcSeconds })] }),
	},
	{
		name: 'recurring: changed differently on both sides -> the newer template wins, handled merges on its own',
		base: data({ r: [rec('5')] }),
		ours: data({ r: [rec('5', { description: 'Rent', handled: 8, edited: 1 as UtcSeconds })] }),
		theirs: data({ r: [rec('5', { description: 'Flat', edited: 2 as UtcSeconds })] }),
		expected: data({ r: [rec('5', { description: 'Flat', handled: 8, edited: 2 as UtcSeconds })] }),
		conflicts: ['5:changed-on-both-sides'],
	},
	{
		name: 'recurring: deleted on one side, only handled on the other -> deleted',
		base: data({ r: [rec('5', { handled: 1 })] }),
		ours: data({ r: [] }),
		theirs: data({ r: [rec('5', { handled: 8 })] }),
		expected: data({ r: [] }),
	},
	{
		name: 'recurring: deleted on one side, template changed on the other -> the change is kept',
		base: data({ r: [rec('5')] }),
		ours: data({ r: [] }),
		theirs: data({ r: [rec('5', { description: 'Flat', edited: 2 as UtcSeconds })] }),
		expected: data({ r: [rec('5', { description: 'Flat', edited: 2 as UtcSeconds })] }),
		conflicts: ['5:deleted-and-changed'],
	},
	{
		name: 'recurring: no common base, the same template handled differently -> the later, no conflict',
		base: null,
		ours: data({ r: [rec('5', { handled: 8 })] }),
		theirs: data({ r: [rec('5', { handled: 1 })] }),
		expected: data({ r: [rec('5', { handled: 8 })] }),
	},
	{
		name: 'recurring: a category deleted on one side but used by a template on the other is restored',
		base: data({ c: [cat('7')] }),
		ours: data({ c: [] }),
		theirs: data({ c: [cat('7')], r: [rec('5', { categoryId: '7' as Id })] }),
		expected: data({ c: [cat('7')], r: [rec('5', { categoryId: '7' as Id })] }),
		conflicts: ['7:deleted-category-in-use'],
	},
	{
		name: 'accounts: a rename alone is kept',
		base: BASE,
		ours: variant({ a: [acc('Checking', 100, 0, 'Bank')] }),
		theirs: BASE,
		expected: variant({ a: [acc('Checking', 100, 0, 'Bank')] }),
	},
	{
		name: 'accounts: same-named accounts are told apart by id',
		base: data({ a: [acc('Bank', 1, 0, 'b1'), acc('Bank', 2, 0, 'b2')] }),
		ours: data({ a: [acc('Bank', 2, 0, 'b2')] }),
		theirs: data({ a: [acc('Bank', 1, 0, 'b1'), acc('Bank', 5, 1, 'b2')] }),
		expected: data({ a: [acc('Bank', 5, 1, 'b2')] }),
	},
	{
		name: 'no common base: both versions are combined, nothing counts as deleted',
		base: null,
		ours: data({ t: [tx('1')], c: [cat('7')] }),
		theirs: data({ t: [tx('2')], a: [acc('Bank', 1)] }),
		expected: data({ t: [tx('1'), tx('2')], c: [cat('7')], a: [acc('Bank', 1)] }),
	},
	{
		name: 'no common base and different versions of a record -> newer wins',
		base: null,
		ours: data({ t: [tx('1', { amount: -1, edited: 1 })], c: [cat('7', 'Food')], a: [acc('Bank', 1, 2)] }),
		theirs: data({ t: [tx('1', { amount: -2, edited: 2 })], c: [cat('7', 'Groceries')], a: [acc('Bank', 3, 1)] }),
		expected: data({ t: [tx('1', { amount: -2, edited: 2 })], c: [cat('7', 'Groceries')], a: [acc('Bank', 1, 2)] }),
		conflicts: ['1:changed-on-both-sides', '7:changed-on-both-sides', 'Bank:changed-on-both-sides'],
	},
	{
		name: 'an unchanged side returns the other side exactly, including the order of categories and accounts',
		base: BASE,
		ours: BASE,
		theirs: data({ t: [...BASE.transactions], c: [cat('9'), cat('7')], a: [acc('Cash', 1), acc('Bank', 100)] }),
		expected: data({ t: [...BASE.transactions], c: [cat('9'), cat('7')], a: [acc('Cash', 1), acc('Bank', 100)] }),
	},
];

describe('merge scenarios', () => {
	it.each(scenarios)('$name', ({ base, ours, theirs, expected, conflicts = [] }) => {
		const result = merge(base, ours, theirs);
		expect(result.data).toEqual(expected);
		expect(conflictSummary(result)).toEqual(conflicts);
	});

	it('reports both versions and the kept one', () => {
		const ours = variant({ t: [tx('1', { amount: -5, edited: 1 }), tx('2')] });
		const theirs = variant({ t: [tx('2')] });
		const changed = ours.transactions.find((t) => t.id === '1');
		const original = BASE.transactions.find((t) => t.id === '1');
		expect(merge(BASE, ours, theirs).conflicts.transactions).toEqual([
			{ reason: 'deleted-and-changed', key: '1', base: original, ours: changed, theirs: undefined, kept: changed },
		]);
	});

	it('the no-category id is never restored as a category', () => {
		const result = merge(BASE, variant({ t: [tx('3', { category: NO_CATEGORY })] }), BASE);
		expect(result.data.categories).toEqual(BASE.categories);
	});
});

describe('merge properties (random documents and edits)', () => {
	const cases = Array.from({ length: 300 }, (_, i) => {
		const base = randomDocument(i + 1);
		return { base, ours: randomEdit(base, 10_000 + i), theirs: randomEdit(base, 20_000 + i) };
	});

	it('merging with an unchanged side is a no-op', () => {
		for (const { base, ours, theirs } of cases) {
			const sameAsOurs = merge(base, ours, base);
			expect(sameAsOurs.data).toEqual(ours);
			expect(conflictSummary(sameAsOurs)).toEqual([]);
			expect(merge(base, base, theirs).data).toEqual(theirs);
			expect(merge(ours, ours, ours).data).toEqual(ours);
		}
	});

	it('the result is always a valid file', () => {
		for (const { base, ours, theirs } of cases) {
			const result = parseCashGuard(serializeCashGuard(merge(base, ours, theirs).data));
			expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
		}
	});

	it('the result is in canonical order', () => {
		for (const { base, ours, theirs } of cases) {
			const { transactions } = merge(base, ours, theirs).data;
			expect(transactions).toEqual(sortNewestFirst(transactions));
		}
	});

	it('every change made on only one side survives, unless a conflict names it', () => {
		const check = <T>(key: (r: T) => string, base: readonly T[], changing: readonly T[], other: readonly T[], merged: readonly T[], conflictKeys: Set<string>) => {
			const [b, c, o, m] = [base, changing, other, merged].map((rs) => new Map(rs.map((r) => [key(r), r])));
			for (const k of new Set([...b!.keys(), ...c!.keys()])) {
				if (deepEqual(o!.get(k), b!.get(k)) && !conflictKeys.has(k)) expect(m!.get(k)).toEqual(c!.get(k));
			}
		};
		for (const { base, ours, theirs } of cases) {
			for (const [changing, other] of [[ours, theirs], [theirs, ours]] as const) {
				const { data: m, conflicts } = merge(base, ours, theirs);
				const keys = new Set(Object.values(conflicts).flatMap((list: readonly { key: string }[]) => list.map((c) => c.key)));
				check((t: Transaction) => t.id, base.transactions, changing.transactions, other.transactions, m.transactions, keys);
				check((c: Category) => c.id, base.categories, changing.categories, other.categories, m.categories, keys);
				check((a: Account) => a.id, base.accounts, changing.accounts, other.accounts, m.accounts, keys);
				check((r: Recurring) => r.id, base.recurring, changing.recurring, other.recurring, m.recurring, keys);
			}
		}
	});

	it('a record both sides changed differently is always reported', () => {
		for (const { base, ours, theirs } of cases) {
			const { conflicts } = merge(base, ours, theirs);
			const reported = new Set<string>([...conflicts.transactions, ...conflicts.categories].map((c) => c.key));
			const byId = <T extends { id: Id }>(rs: readonly T[]) => new Map<string, T>(rs.map((r) => [r.id, r]));
			for (const kind of ['transactions', 'categories'] as const) {
				const [b, o, t] = [base, ours, theirs].map((d) => byId<Transaction | Category>(d[kind]));
				for (const id of new Set([...o!.keys(), ...t!.keys()])) {
					const [vb, vo, vt] = [b!.get(id), o!.get(id), t!.get(id)];
					if (!deepEqual(vo, vb) && !deepEqual(vt, vb) && !deepEqual(vo, vt)) expect(reported.has(id), `${kind} ${id}`).toBe(true);
				}
			}
		}
	});

	it('nothing vanishes silently: a missing record was deleted by one side, or a conflict names it', () => {
		for (const { base, ours, theirs } of cases) {
			const { data: m, conflicts } = merge(base, ours, theirs);
			const conflictKeys = new Set<string>(conflicts.transactions.map((c) => c.key));
			const inResult = new Set<string>(m.transactions.flatMap((t) => [t.id, ...(t.subTransactions ?? []).map((s) => s.id)]));
			const byId = (d: CashGuardData) => new Map(d.transactions.map((t) => [t.id as string, t]));
			const [b, o, t] = [byId(base), byId(ours), byId(theirs)];
			for (const id of new Set([...o.keys(), ...t.keys()])) {
				const deletedByOne = (!o.has(id) && deepEqual(t.get(id), b.get(id))) || (!t.has(id) && deepEqual(o.get(id), b.get(id)));
				expect(inResult.has(id) || deletedByOne || conflictKeys.has(id), `transaction ${id}`).toBe(true);
			}
		}
	});

	it('every kept version of a conflict is in the result and comes from one of the sides', () => {
		for (const { base, ours, theirs } of cases) {
			const { data: m, conflicts } = merge(base, ours, theirs);
			for (const c of conflicts.transactions) {
				expect(m.transactions).toContainEqual(c.kept);
				if (c.reason !== 'moved-into-group') expect([c.ours, c.theirs]).toContainEqual(c.kept);
			}
			for (const c of conflicts.categories) {
				expect(m.categories).toContainEqual(c.kept);
				expect([c.ours, c.theirs]).toContainEqual(c.kept);
			}
			for (const c of conflicts.accounts) {
				expect(m.accounts).toContainEqual(c.kept);
				expect([c.ours, c.theirs]).toContainEqual(c.kept);
			}
			// a recurring transaction's template comes from one side; how far it's handled merges on its own
			const template = (r: Recurring | undefined) => r && { ...r, handled: null };
			for (const c of conflicts.recurring) {
				expect(m.recurring).toContainEqual(c.kept);
				expect([c.ours, c.theirs].map(template)).toContainEqual(template(c.kept));
			}
		}
	});

	it('how far a recurring transaction is handled: one side’s change is kept, else the later of both', () => {
		let checked = 0;
		for (const { base, ours, theirs } of cases) {
			const { data: m } = merge(base, ours, theirs);
			const byId = (d: CashGuardData) => new Map(d.recurring.map((r) => [r.id, r]));
			const [b, o, t] = [byId(base), byId(ours), byId(theirs)];
			for (const r of m.recurring) {
				const [vb, vo, vt] = [b.get(r.id), o.get(r.id), t.get(r.id)];
				if (!vo || !vt) continue;
				checked++;
				const later = [vo.handled, vt.handled].reduce((x, y) => (x === null || (y !== null && y > x) ? y : x));
				const expected = vb && vo.handled === vb.handled ? vt.handled : vb && vt.handled === vb.handled ? vo.handled : later;
				expect(r.handled, r.id).toBe(expected);
			}
		}
		expect(checked).toBeGreaterThan(100);
	});

	it('the merged data does not depend on which side merges (up to the order of categories and accounts)', () => {
		const canonical = (d: CashGuardData) => ({
			transactions: d.transactions,
			categories: d.categories.map(canonicalString).sort(),
			accounts: d.accounts.map(canonicalString).sort(),
			recurring: d.recurring.map(canonicalString).sort(),
		});
		for (const { base, ours, theirs } of cases) {
			expect(canonical(merge(base, ours, theirs).data)).toEqual(canonical(merge(base, theirs, ours).data));
		}
	});
});
