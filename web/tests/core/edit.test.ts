import { describe, expect, it } from 'vitest';
import {
	addAccount,
	addCategory,
	addTransaction,
	categoryUsage,
	cents,
	deleteAccount,
	deleteCategory,
	deleteTransaction,
	EditError,
	lastUseOf,
	NO_CATEGORY,
	parseCashGuard,
	serializeCashGuard,
	sortNewestFirst,
	suggestDescriptions,
	toDraft,
	updateAccount,
	updateCategory,
	updateTransaction,
	type CashGuardData,
	type CivilDate,
	type Id,
	type TransactionDraft,
	type UtcSeconds,
} from '../../src/core';
import { randomDocument } from './random-data';

const at = (seconds: number) => seconds as UtcSeconds;
const empty: CashGuardData = { categories: [], accounts: [], transactions: [] };
const draft = (fields: Partial<TransactionDraft> = {}): TransactionDraft => ({
	date: '2026-03-01' as CivilDate,
	description: 'Supermarket',
	categoryId: NO_CATEGORY,
	amount: cents(-1250),
	...fields,
});

function isValidFile(data: CashGuardData): boolean {
	return parseCashGuard(serializeCashGuard(data)).ok;
}

describe('transactions', () => {
	it('adds with a fresh id and stamps, keeping the order', () => {
		const first = addTransaction(empty, draft({ date: '2026-01-01' as CivilDate }), at(100));
		const second = addTransaction(first.data, draft(), at(200));
		expect(second.data.transactions.map((t) => t.id)).toEqual([second.id, first.id]);
		expect(second.data.transactions[0]).toMatchObject({ added: 200, edited: 200, amount: -1250, description: 'Supermarket' });
		expect(second.id).not.toBe(first.id);
	});

	it('updates content and edited, but keeps id and added; an unchanged update is a no-op', () => {
		const { data, id } = addTransaction(empty, draft(), at(100));
		const updated = updateTransaction(data, id, draft({ amount: cents(-999) }), at(300));
		expect(updated.transactions[0]).toMatchObject({ id, added: 100, edited: 300, amount: -999 });
		expect(updateTransaction(updated, id, toDraft(updated.transactions[0]!), at(400))).toBe(updated);
	});

	it('groups: the sum is computed, new subs get ids, unchanged subs keep their stamps', () => {
		const sub = (description: string, amount: number) => ({ date: '2026-03-01' as CivilDate, description, categoryId: NO_CATEGORY, amount: cents(amount) });
		const { data, id } = addTransaction(empty, draft({ subTransactions: [sub('Food', -800), sub('Soap', -200)] }), at(100));
		const group = data.transactions[0]!;
		expect(group.amount).toBe(-1000);
		expect(new Set([group.id, ...group.subTransactions!.map((s) => s.id)]).size).toBe(3);

		// change one sub, add another
		const subs = toDraft(group).subTransactions!.map((s) => (s.description === 'Soap' ? { ...s, amount: cents(-300) } : s));
		const updated = updateTransaction(data, id, { ...toDraft(group), subTransactions: [...subs, sub('Deposit', 25)] }, at(500)).transactions[0]!;
		expect(updated.amount).toBe(-1075);
		const byName = Object.fromEntries(updated.subTransactions!.map((s) => [s.description, s]));
		expect(byName['Food']!.edited).toBe(100);
		expect(byName['Soap']!.edited).toBe(500);
		expect(byName['Deposit']).toMatchObject({ added: 500, edited: 500 });
		// the merge relies on this
		expect(updated.edited).toBeGreaterThanOrEqual(Math.max(...updated.subTransactions!.map((s) => s.edited)));
	});

	it('converts between transaction and group, keeping the id', () => {
		const { data, id } = addTransaction(empty, draft(), at(100));
		const asGroup = updateTransaction(data, id, draft({ subTransactions: [{ ...draft(), amount: cents(-5) }] }), at(200));
		expect(asGroup.transactions[0]).toMatchObject({ id, amount: -5 });
		const back = updateTransaction(asGroup, id, draft(), at(300));
		expect(back.transactions[0]!.subTransactions).toBeUndefined();
	});

	it('deletes', () => {
		const { data, id } = addTransaction(empty, draft(), at(100));
		expect(deleteTransaction(data, id).transactions).toEqual([]);
	});

	it('refuses unknown categories and transactions', () => {
		expect(() => addTransaction(empty, draft({ categoryId: '42' as Id }), at(1))).toThrow(EditError);
		expect(() => updateTransaction(empty, '42' as Id, draft(), at(1))).toThrow(EditError);
	});

	it('random documents stay valid files through many edits', () => {
		for (let seed = 1; seed <= 50; seed++) {
			let data = randomDocument(seed);
			const { data: withCategory, id: categoryId } = addCategory(data, 'New', '#112233ff');
			data = withCategory;
			for (const t of data.transactions.slice(0, 5)) data = updateTransaction(data, t.id, { ...toDraft(t), description: 'edited', categoryId }, at(2_000_000_000));
			data = addTransaction(data, draft({ categoryId }), at(2_000_000_001)).data;
			const [victim] = data.transactions;
			if (victim) data = deleteTransaction(data, victim.id);
			expect(isValidFile(data)).toBe(true);
			expect(data.transactions).toEqual(sortNewestFirst(data.transactions));
		}
	});
});

describe('categories and accounts', () => {
	it('adds, renames and recolors categories; a used one cannot be deleted', () => {
		const { data, id } = addCategory(empty, 'Food', '#ff0000ff');
		const renamed = updateCategory(data, id, { name: 'Groceries', color: '#00ff00ff' });
		expect(renamed.categories).toEqual([{ id, name: 'Groceries', color: '#00FF00FF' }]);
		const used = addTransaction(renamed, draft({ categoryId: id }), at(1)).data;
		expect(categoryUsage(used).get(id)).toBe(1);
		expect(() => deleteCategory(used, id)).toThrow('used by 1 transaction');
		expect(deleteCategory(renamed, id).categories).toEqual([]);
	});

	it('only a changed balance stamps an account', () => {
		const data = addAccount(empty, 'Bank', cents(100), at(1));
		expect(updateAccount(data, 0, { name: 'Checking' }, at(2)).accounts[0]).toEqual({ name: 'Checking', amount: 100, edited: 1 });
		expect(updateAccount(data, 0, { amount: cents(150) }, at(3)).accounts[0]).toEqual({ name: 'Bank', amount: 150, edited: 3 });
		expect(deleteAccount(data, 0).accounts).toEqual([]);
	});

	it('refuses to change an account that another one replaced at its position', () => {
		const data = addAccount(empty, 'Bank', cents(100), at(1));
		const seen = data.accounts[0]!;
		const synced = addAccount({ ...data, accounts: [] }, 'Wallet', cents(5), at(2));
		expect(() => updateAccount(synced, 0, { amount: cents(1) }, at(3), seen)).toThrow(EditError);
		expect(() => deleteAccount(synced, 0, seen)).toThrow(EditError);
		expect(updateAccount(data, 0, { amount: cents(1) }, at(3), seen).accounts[0]!.amount).toBe(1);
	});

	it('returns the same data for changes that change nothing (no undo entry)', () => {
		const withAccount = addAccount(empty, 'Bank', cents(100), at(1));
		expect(updateAccount(withAccount, 0, { name: 'Bank', amount: cents(100) }, at(2))).toBe(withAccount);
		const { data, id } = addCategory(empty, 'Food', '#00ff00ff');
		expect(updateCategory(data, id, { name: 'Food', color: '#00FF00FF' })).toBe(data);
		expect(deleteTransaction(data, '42' as Id)).toBe(data);
	});
});

describe('invalid groups', () => {
	it('refuses parts sharing an id', () => {
		const { data, id } = addTransaction(empty, draft({ subTransactions: [draft(), draft()] }), at(1));
		const subId = data.transactions[0]!.subTransactions![0]!.id;
		expect(() => updateTransaction(data, id, draft({ subTransactions: [draft({ id: subId } as never), draft({ id: subId } as never)] }), at(2))).toThrow(EditError);
	});
});

describe('suggestions', () => {
	const data = [
		draft({ description: 'Supermarket', amount: cents(-10), date: '2026-01-01' as CivilDate }),
		draft({ description: 'Supermarket', amount: cents(-20), date: '2026-02-01' as CivilDate }),
		draft({ description: 'Super Sushi', date: '2026-01-05' as CivilDate }),
		draft({ description: 'The supermarket at the station', date: '2026-01-06' as CivilDate }),
	].reduce((d, t, i) => addTransaction(d, t, at(i)).data, empty);

	it('suggests matching descriptions, prefix matches and frequent ones first', () => {
		expect(suggestDescriptions(data, 'super')).toEqual(['Supermarket', 'Super Sushi', 'The supermarket at the station']);
		expect(suggestDescriptions(data, 'station')).toEqual(['The supermarket at the station']);
		// the exact text itself isn't suggested
		expect(suggestDescriptions(data, 'Supermarket')).toEqual(['The supermarket at the station']);
	});

	it('prefills from the latest use of a description', () => {
		expect(lastUseOf(data, 'Supermarket')).toEqual({ categoryId: NO_CATEGORY, amount: -20 });
		expect(lastUseOf(data, 'Unknown')).toBeNull();
	});
});
