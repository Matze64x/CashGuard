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

export interface CategoryUse {
	/** Transactions, including sub-transactions */
	readonly transactions: number;
	readonly recurring: number;
}

/** How many transactions and recurring transactions use each category (only used ones are listed). */
export function categoryUsage(data: CashGuardData): Map<Id, CategoryUse> {
	const usage = new Map<Id, CategoryUse>();
	const count = (id: Id, kind: keyof CategoryUse) => {
		const use = usage.get(id) ?? { transactions: 0, recurring: 0 };
		usage.set(id, { ...use, [kind]: use[kind] + 1 });
	};
	for (const t of data.transactions) for (const x of [t, ...(t.subTransactions ?? [])]) count(x.categoryId, 'transactions');
	for (const r of data.recurring) count(r.categoryId, 'recurring');
	return usage;
}

/** "3 transactions and 1 recurring transaction" */
export function describeUse({ transactions, recurring }: CategoryUse): string {
	const n = (count: number, what: string) => `${count} ${what}${count === 1 ? '' : 's'}`;
	return [transactions > 0 && n(transactions, 'transaction'), recurring > 0 && n(recurring, 'recurring transaction')].filter(Boolean).join(' and ');
}

export function deleteCategory(data: CashGuardData, id: Id): CashGuardData {
	const use = categoryUsage(data).get(id);
	if (use) throw new EditError(`The category is used by ${describeUse(use)}`);
	return { ...data, categories: data.categories.filter((c) => c.id !== id) };
}

// ------------------------------------------------------------------------------------- accounts

function accountWith(data: CashGuardData, id: Id): { account: Account; index: number } {
	const index = data.accounts.findIndex((a) => a.id === id);
	if (index < 0) throw new EditError('The account no longer exists; it may have been deleted on another device.');
	return { account: data.accounts[index]!, index };
}

export function addAccount(data: CashGuardData, name: string, amount: Cents, now: UtcSeconds): CashGuardData {
	const id = newId(new Set(data.accounts.map((a) => a.id)));
	return { ...data, accounts: [...data.accounts, { id, name, amount, edited: now }] };
}

/**
 * `edited` records when the balance was last updated, so only a changed amount stamps it. Returns
 * the data unchanged if nothing actually changed. `expected`: the account as the user saw it when
 * entering the changes; if a sync changed it meanwhile, this throws instead of overwriting that.
 */
export function updateAccount(data: CashGuardData, id: Id, changes: Partial<Pick<Account, 'name' | 'amount'>>, now: UtcSeconds, expected?: Account): CashGuardData {
	const { account: old, index } = accountWith(data, id);
	if (expected && !deepEqual(old, expected)) throw new EditError(`The account “${expected.name}” changed meanwhile; please try again.`);
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
export function adjustAccount(data: CashGuardData, id: Id, by: Cents, now: UtcSeconds): CashGuardData {
	const { account } = accountWith(data, id);
	return updateAccount(data, id, { amount: addCents(account.amount, by) }, now);
}

export function deleteAccount(data: CashGuardData, id: Id): CashGuardData {
	accountWith(data, id);
	return { ...data, accounts: data.accounts.filter((a) => a.id !== id) };
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
