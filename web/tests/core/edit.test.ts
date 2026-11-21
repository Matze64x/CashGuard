import { describe, expect, it } from 'vitest';
import {
	addAccount,
	addCategory,
	addTransaction,
	adjustAccount,
	categoryUsage,
	cents,
	deleteAccount,
	deleteCategory,
	deleteTransaction,
	draftTotal,
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
const empty: CashGuardData = { categories: [], accounts: [], recurring: [], transactions: [] };
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
		expect(categoryUsage(used).get(id)).toEqual({ transactions: 1, recurring: 0 });
		expect(() => deleteCategory(used, id)).toThrow('used by 1 transaction');
		expect(deleteCategory(renamed, id).categories).toEqual([]);
	});

	it('only a changed balance stamps an account', () => {
		const data = addAccount(empty, 'Bank', cents(100), at(1));
		const { id } = data.accounts[0]!;
		expect(id).toMatch(/^[1-9]\d*$/);
		expect(updateAccount(data, id, { name: 'Checking' }, at(2)).accounts[0]).toEqual({ id, name: 'Checking', amount: 100, edited: 1 });
		expect(updateAccount(data, id, { amount: cents(150) }, at(3)).accounts[0]).toEqual({ id, name: 'Bank', amount: 150, edited: 3 });
		expect(deleteAccount(data, id).accounts).toEqual([]);
		// a second one gets another id
		expect(addAccount(data, 'Bank', cents(1), at(2)).accounts[1]!.id).not.toBe(id);
	});

	it('refuses to change an account that is gone, or that a sync changed meanwhile', () => {
		const data = addAccount(empty, 'Bank', cents(100), at(1));
		const seen = data.accounts[0]!;
		const synced = updateAccount(data, seen.id, { amount: cents(5) }, at(2));
		expect(() => updateAccount(synced, seen.id, { amount: cents(1) }, at(3), seen)).toThrow(EditError);
		expect(updateAccount(data, seen.id, { amount: cents(1) }, at(3), seen).accounts[0]!.amount).toBe(1);
		const gone = deleteAccount(data, seen.id);
		expect(() => updateAccount(gone, seen.id, { amount: cents(1) }, at(3))).toThrow(EditError);
		expect(() => deleteAccount(gone, seen.id)).toThrow(EditError);
	});

	it('returns the same data for changes that change nothing (no undo entry)', () => {
		const withAccount = addAccount(empty, 'Bank', cents(100), at(1));
		expect(updateAccount(withAccount, withAccount.accounts[0]!.id, { name: 'Bank', amount: cents(100) }, at(2))).toBe(withAccount);
		const { data, id } = addCategory(empty, 'Food', '#00ff00ff');
		expect(updateCategory(data, id, { name: 'Food', color: '#00FF00FF' })).toBe(data);
		expect(deleteTransaction(data, '42' as Id)).toBe(data);
	});

	it('adjusts a balance by a payment', () => {
		const data = addAccount(addAccount(empty, 'Bank', cents(100), at(1)), 'Wallet', cents(20), at(1));
		const [bank, wallet] = data.accounts;
		const paid = adjustAccount(data, wallet!.id, cents(-30), at(4));
		expect(paid.accounts).toEqual([bank, { ...wallet, amount: -10, edited: 4 }]);
		expect(() => adjustAccount(data, '42' as Id, cents(-30), at(4))).toThrow(EditError);
	});

	it('totals a draft, also one split into parts', () => {
		const base = { date: '2026-01-01' as CivilDate, description: '', categoryId: NO_CATEGORY };
		expect(draftTotal({ ...base, amount: cents(-5) })).toBe(-5);
		expect(draftTotal({ ...base, amount: cents(0), subTransactions: [{ ...base, amount: cents(-5) }, { ...base, amount: cents(2) }] })).toBe(-3);
	});
});

describe('changed elsewhere meanwhile', () => {
	it('refuses to overwrite a transaction or category changed since editing started', () => {
		let { data } = addTransaction(empty, draft({ description: 'Bread' }), at(1));
		const seen = data.transactions[0]!;
		expect(updateTransaction(data, seen.id, draft({ description: 'Rolls' }), at(2), seen).transactions[0]!.description).toBe('Rolls');
		const elsewhere = updateTransaction(data, seen.id, draft({ description: 'Cake' }), at(2));
		expect(() => updateTransaction(elsewhere, seen.id, draft({ description: 'Rolls' }), at(3), seen)).toThrow('“Cake” was changed elsewhere meanwhile');
		expect(() => updateTransaction(deleteTransaction(data, seen.id), seen.id, draft(), at(3), seen)).toThrow('no longer exists');

		data = addCategory(data, 'Food', '#112233FF').data;
		const category = data.categories[0]!;
		const renamed = updateCategory(data, category.id, { name: 'Groceries' });
		expect(() => updateCategory(renamed, category.id, { color: '#445566FF' }, category)).toThrow(EditError);
		expect(updateCategory(data, category.id, { color: '#445566FF' }, category).categories[0]!.color).toBe('#445566FF');
	});
});

describe('text the file format rejects', () => {
	it('becomes valid: a lone surrogate turns into U+FFFD, NUL is dropped', () => {
		const half = 'Caf\ud83d!\0';
		let { data } = addTransaction(empty, draft({ description: half, subTransactions: [{ date: '2026-01-01' as CivilDate, description: '\udc00x', categoryId: NO_CATEGORY, amount: cents(-1) }] }), at(1));
		data = addCategory(data, half, '#112233FF').data;
		data = addAccount(data, half, cents(0), at(1));
		data = updateAccount(data, data.accounts[0]!.id, { name: 'ok\ud800' }, at(2));
		data = updateCategory(data, data.categories[0]!.id, { name: '\udfff' });
		expect(isValidFile(data)).toBe(true);
		expect(data.transactions[0]!.description).toBe('Caf\ufffd!');
		expect(data.transactions[0]!.subTransactions![0]!.description).toBe('\ufffdx');
		expect(data.accounts[0]!.name).toBe('ok\ufffd');
		expect(data.categories[0]!.name).toBe('\ufffd');
		// a whole emoji stays
		expect(addTransaction(empty, draft({ description: '😀' }), at(1)).data.transactions[0]!.description).toBe('😀');
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
