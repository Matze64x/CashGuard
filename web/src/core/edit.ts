/**
 * Changes to the data, as pure functions (old data in, new data out). They keep the invariants the
 * file format and the merge rely on:
 * - new records get fresh random ids, unique across transactions, sub-transactions and categories
 * - `added` is set once, `edited` on every change; a group's `edited` is at least its subs'
 * - groups are normalized (sum, sub order) and transactions stay sorted newest first
 * - a category in use can't be deleted
 * `now` is passed in, so callers (and tests) control the timestamps.
 */
import type { CivilDate, UtcSeconds } from './dates';
import { deepEqual } from './equal';
import { newId, NO_CATEGORY, type Id } from './ids';
import { addCents, sumCents, type Cents } from './money';
import { normalizeGroup, sortNewestFirst, type Account, type CashGuardData, type Category, type Transaction } from './model';

/** What the user edits of a transaction; ids and timestamps are managed here. */
export interface TransactionDraft {
	readonly date: CivilDate;
	readonly description: string;
	readonly categoryId: Id;
	/** Ignored for groups: their amount is the sum of their sub-transactions */
	readonly amount: Cents;
	/** Present for a group. Subs with an `id` are existing ones, without one they're new. */
	readonly subTransactions?: readonly SubTransactionDraft[];
}

export interface SubTransactionDraft {
	readonly id?: Id;
	readonly date: CivilDate;
	readonly description: string;
	readonly categoryId: Id;
	readonly amount: Cents;
}

export class EditError extends Error {}

function usedIds(data: CashGuardData): Set<string> {
	const ids = new Set<string>(data.categories.map((c) => c.id));
	for (const t of data.transactions) {
		ids.add(t.id);
		for (const s of t.subTransactions ?? []) ids.add(s.id);
	}
	return ids;
}

function checkCategory(data: CashGuardData, categoryId: Id): void {
	if (categoryId !== NO_CATEGORY && !data.categories.some((c) => c.id === categoryId)) throw new EditError(`Unknown category ${categoryId}`);
}

/** Builds the sub-transactions of a group, keeping the stamps of subs that didn't change. */
function buildSubs(data: CashGuardData, drafts: readonly SubTransactionDraft[], previous: readonly Transaction[], now: UtcSeconds, taken: Set<string>): Transaction[] {
	const ids = drafts.flatMap((d) => (d.id === undefined ? [] : [d.id]));
	if (new Set(ids).size !== ids.length) throw new EditError('Two parts have the same id');
	return drafts.map((draft) => {
		checkCategory(data, draft.categoryId);
		const fields = { date: draft.date, description: draft.description, categoryId: draft.categoryId, amount: draft.amount };
		const old = draft.id === undefined ? undefined : previous.find((s) => s.id === draft.id);
		if (old) {
			const unchanged = deepEqual({ date: old.date, description: old.description, categoryId: old.categoryId, amount: old.amount }, fields);
			return unchanged ? old : { ...old, ...fields, edited: now };
		}
		// a sub can't move between groups, so an unknown id is treated as a new sub
		const id = newId(taken);
		taken.add(id);
		return { id, ...fields, added: now, edited: now };
	});
}

/** `taken`: the ids in use, including `base.id`; new subs' ids are added to it */
function build(data: CashGuardData, draft: TransactionDraft, base: Pick<Transaction, 'id' | 'added'>, previousSubs: readonly Transaction[], now: UtcSeconds, taken: Set<string>): Transaction {
	checkCategory(data, draft.categoryId);
	const subTransactions = draft.subTransactions && buildSubs(data, draft.subTransactions, previousSubs, now, taken);
	const transaction: Transaction = {
		id: base.id,
		date: draft.date,
		categoryId: draft.categoryId,
		amount: draft.amount,
		description: draft.description,
		added: base.added,
		edited: now,
		...(subTransactions && { subTransactions }),
	};
	return normalizeGroup(transaction);
}

export function addTransaction(data: CashGuardData, draft: TransactionDraft, now: UtcSeconds): { data: CashGuardData; id: Id } {
	const taken = usedIds(data);
	const id = newId(taken);
	taken.add(id);
	const transaction = build(data, draft, { id, added: now }, [], now, taken);
	return { data: { ...data, transactions: sortNewestFirst([...data.transactions, transaction]) }, id };
}

/** Replaces a transaction's content. Returns the data unchanged if nothing actually changed. */
export function updateTransaction(data: CashGuardData, id: Id, draft: TransactionDraft, now: UtcSeconds): CashGuardData {
	const old = data.transactions.find((t) => t.id === id);
	if (!old) throw new EditError(`Unknown transaction ${id}`);
	const updated = build(data, draft, old, old.subTransactions ?? [], now, usedIds(data));
	if (deepEqual({ ...updated, edited: old.edited }, old)) return data;
	return { ...data, transactions: sortNewestFirst(data.transactions.map((t) => (t.id === id ? updated : t))) };
}

export function deleteTransaction(data: CashGuardData, id: Id): CashGuardData {
	if (!data.transactions.some((t) => t.id === id)) return data;
	return { ...data, transactions: data.transactions.filter((t) => t.id !== id) };
}

/** The draft that reproduces a transaction, as a starting point for editing. */
export function toDraft(t: Transaction): TransactionDraft {
	const sub = (s: Transaction): SubTransactionDraft => ({ id: s.id, date: s.date, description: s.description, categoryId: s.categoryId, amount: s.amount });
	return {
		date: t.date,
		description: t.description,
		categoryId: t.categoryId,
		amount: t.amount,
		...(t.subTransactions && { subTransactions: t.subTransactions.map(sub) }),
	};
}

// ------------------------------------------------------------------------------------- categories

export function addCategory(data: CashGuardData, name: string, color: string): { data: CashGuardData; id: Id } {
	const id = newId(usedIds(data));
	return { data: { ...data, categories: [...data.categories, { id, name, color: color.toUpperCase() }] }, id };
}

/** Returns the data unchanged if nothing actually changed. */
export function updateCategory(data: CashGuardData, id: Id, changes: Partial<Pick<Category, 'name' | 'color'>>): CashGuardData {
	const old = data.categories.find((c) => c.id === id);
	if (!old) throw new EditError(`Unknown category ${id}`);
	const color = changes.color?.toUpperCase();
	const updated = { ...old, ...changes, ...(color && { color }) };
	if (deepEqual(updated, old)) return data;
	return { ...data, categories: data.categories.map((c) => (c === old ? updated : c)) };
}

/** How many transactions (including sub-transactions) use each category. */
export function categoryUsage(data: CashGuardData): Map<Id, number> {
	const usage = new Map<Id, number>();
	for (const t of data.transactions) {
		for (const x of [t, ...(t.subTransactions ?? [])]) usage.set(x.categoryId, (usage.get(x.categoryId) ?? 0) + 1);
	}
	return usage;
}

export function deleteCategory(data: CashGuardData, id: Id): CashGuardData {
	const used = categoryUsage(data).get(id) ?? 0;
	if (used > 0) throw new EditError(`The category is used by ${used} transaction${used === 1 ? '' : 's'}`);
	return { ...data, categories: data.categories.filter((c) => c.id !== id) };
}

// ------------------------------------------------------------------------------------- accounts
// Accounts have no ids yet, so they're addressed by position. Changes pass the account they mean
// (`expected`): if a sync moved another one to that position meanwhile, they throw instead of
// changing the wrong account.

function accountAt(data: CashGuardData, index: number, expected: Account | undefined): Account {
	const account = data.accounts[index];
	if (!account) throw new EditError(`Unknown account ${index}`);
	if (expected && !deepEqual(account, expected)) throw new EditError(`The account “${expected.name}” changed meanwhile; please try again.`);
	return account;
}

export function addAccount(data: CashGuardData, name: string, amount: Cents, now: UtcSeconds): CashGuardData {
	return { ...data, accounts: [...data.accounts, { name, amount, edited: now }] };
}

/**
 * `edited` records when the balance was last updated, so only a changed amount stamps it. Returns
 * the data unchanged if nothing actually changed.
 */
export function updateAccount(data: CashGuardData, index: number, changes: Partial<Pick<Account, 'name' | 'amount'>>, now: UtcSeconds, expected?: Account): CashGuardData {
	const old = accountAt(data, index, expected);
	const amountChanged = changes.amount !== undefined && changes.amount !== old.amount;
	const updated: Account = { ...old, ...changes, edited: amountChanged ? now : old.edited };
	if (deepEqual(updated, old)) return data;
	return { ...data, accounts: data.accounts.map((a, i) => (i === index ? updated : a)) };
}

/** The amount a draft adds to the total (a group: the sum of its parts). */
export function draftTotal(draft: TransactionDraft): Cents {
	return draft.subTransactions ? sumCents(draft.subTransactions.map((s) => s.amount)) : draft.amount;
}

/** Changes an account's balance by `by`, e.g. by a payment just entered. */
export function adjustAccount(data: CashGuardData, index: number, expected: Account, by: Cents, now: UtcSeconds): CashGuardData {
	const account = accountAt(data, index, expected);
	return updateAccount(data, index, { amount: addCents(account.amount, by) }, now);
}

export function deleteAccount(data: CashGuardData, index: number, expected?: Account): CashGuardData {
	accountAt(data, index, expected);
	return { ...data, accounts: data.accounts.filter((_, i) => i !== index) };
}

// ------------------------------------------------------------------------------------- suggestions

/** Descriptions used before that contain `text` (case-insensitive), most used first. */
export function suggestDescriptions(data: CashGuardData, text: string, limit = 8): string[] {
	const needle = text.trim().toLocaleLowerCase();
	const counts = new Map<string, number>();
	for (const t of data.transactions) {
		for (const x of [t, ...(t.subTransactions ?? [])]) {
			if (x.description && x.description.toLocaleLowerCase().includes(needle)) counts.set(x.description, (counts.get(x.description) ?? 0) + 1);
		}
	}
	const startsWith = (d: string) => (d.toLocaleLowerCase().startsWith(needle) ? 0 : 1);
	return [...counts]
		.filter(([d]) => d !== text)
		.sort(([a, ca], [b, cb]) => startsWith(a) - startsWith(b) || cb - ca || a.localeCompare(b))
		.slice(0, limit)
		.map(([d]) => d);
}

/** Category and amount of the latest transaction with exactly this description, to prefill a new one. */
export function lastUseOf(data: CashGuardData, description: string): { categoryId: Id; amount: Cents } | null {
	// transactions are sorted newest first
	for (const t of data.transactions) {
		for (const x of [t, ...(t.subTransactions ?? [])]) {
			if (x.description === description) return { categoryId: x.categoryId, amount: x.amount };
		}
	}
	return null;
}
