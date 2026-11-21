/**
 * Three-way merge of two versions of the data that were edited independently (e.g. on the phone
 * and on the desktop), relative to the last version both had in common.
 *
 * Records are matched by id: transactions, categories, accounts and recurring transactions. A transaction
 * group is one record including its sub-transactions. For every record:
 * - same on both sides             -> keep it
 * - changed on one side only       -> take that change (including adding or deleting it)
 * - changed differently on both    -> the later `Edited` timestamp wins; reported as a conflict.
 *                                     An account's name and its balance (amount with `Edited`)
 *                                     merge separately: a rename on one side and a new balance on
 *                                     the other are both kept, without a conflict. Likewise a
 *                                     recurring transaction's template and how far it's handled
 *                                     (its `Edited` time is the template's); how far it's handled
 *                                     merges on its own: a change on one side is kept (also an
 *                                     undo), two different advances take the later, and it never
 *                                     goes back because of a conflict
 * - a recurring transaction deleted on one side, whose template is unchanged on the other (only
 *   occurrences were handled there)    -> deleted, without a conflict
 * - deleted on one side, changed   -> keep the changed version; reported as a conflict
 *   on the other
 * Categories have no timestamp, and timestamps can tie: then a fixed order of the two versions'
 * contents decides. So the merged data doesn't depend on which device merges (only the order of
 * categories and accounts does: ours first).
 *
 * Afterwards:
 * - a top-level transaction whose id is now a sub-transaction of a merged group (one side moved it
 *   into the group) is dropped in favour of the group, and reported
 * - a category that was deleted but is still used by a merged transaction or recurring transaction
 *   is restored, and reported
 *
 * Without a common base nothing counts as deleted: both versions are combined.
 *
 * Inputs must be valid on their own (as produced by `parseCashGuard` or the app): unique ids,
 * normalized groups, and a group's `edited` is at least that of its sub-transactions.
 */
import { canonicalString, deepEqual } from './equal';
import { NO_CATEGORY, type Id } from './ids';
import { sortNewestFirst, type Account, type CashGuardData, type Category, type Recurring, type Transaction } from './model';

export type ConflictReason = 'changed-on-both-sides' | 'deleted-and-changed' | 'moved-into-group' | 'deleted-category-in-use';

export interface Conflict<T> {
	readonly reason: ConflictReason;
	/** The record's id */
	readonly key: string;
	/** The versions of the record; `undefined` where it doesn't exist (not yet, or deleted) */
	readonly base: T | undefined;
	readonly ours: T | undefined;
	readonly theirs: T | undefined;
	/** The version in the result. For 'moved-into-group': the group that now contains the id. */
	readonly kept: T;
}

export interface MergeResult {
	readonly data: CashGuardData;
	readonly conflicts: {
		readonly transactions: readonly Conflict<Transaction>[];
		readonly categories: readonly Conflict<Category>[];
		readonly accounts: readonly Conflict<Account>[];
		readonly recurring: readonly Conflict<Recurring>[];
	};
}

interface RecordKind<T> {
	/** One unique key per record, in the same order */
	keys(records: readonly T[]): string[];
	/** Positive if `a` was edited later than `b`, negative if earlier, 0 if unknown or equal. */
	compareEdited(a: T, b: T): number;
	/**
	 * Both sides' changes to a record combined, if they touch different parts of it; else null.
	 * Without a base (`undefined`), only versions that differ in parts that merge on their own.
	 */
	combine?: (base: T | undefined, ours: T, theirs: T) => T | null;
	/** Adjusts the winner of two conflicting versions (e.g. keeps what must never go back) */
	settle?: (kept: T, ours: T, theirs: T, base: T | undefined) => T;
	/** Whether a deletion on one side simply wins over this change on the other (no conflict) */
	yieldsToDeletion?: (base: T, changed: T) => boolean;
}

/** The winner of two different versions: the later edit, else a fixed order of their contents. */
function newer<T>(kind: RecordKind<T>, a: T, b: T): T {
	const byTime = kind.compareEdited(a, b);
	if (byTime !== 0) return byTime > 0 ? a : b;
	return canonicalString(a) > canonicalString(b) ? a : b;
}

function mergeRecords<T>(kind: RecordKind<T>, base: readonly T[], ours: readonly T[], theirs: readonly T[]): { merged: T[]; conflicts: Conflict<T>[] } {
	// if one side didn't change anything, the other side is the result, exactly (including order)
	if (deepEqual(base, theirs)) return { merged: [...ours], conflicts: [] };
	if (deepEqual(base, ours)) return { merged: [...theirs], conflicts: [] };

	const [baseMap, oursMap, theirsMap] = [base, ours, theirs].map((records) => byKey(kind.keys, records)) as [Map<string, T>, Map<string, T>, Map<string, T>];
	// ours' order first, then records only theirs has, so the result is deterministic
	const keys = new Set([...oursMap.keys(), ...theirsMap.keys()]);
	const merged: T[] = [];
	const conflicts: Conflict<T>[] = [];
	for (const key of keys) {
		const [b, o, t] = [baseMap.get(key), oursMap.get(key), theirsMap.get(key)];
		let kept: T | undefined;
		let reason: ConflictReason | undefined;
		if (deepEqual(o, t) || deepEqual(b, t)) kept = o;
		else if (deepEqual(b, o)) kept = t;
		else if (o === undefined || t === undefined) {
			const changed = (o ?? t)!;
			if (!(b !== undefined && kind.yieldsToDeletion?.(b, changed))) [kept, reason] = [changed, 'deleted-and-changed'];
		} else {
			kept = kind.combine?.(b, o, t) ?? undefined;
			if (kept === undefined) {
				const winner = newer(kind, o, t);
				[kept, reason] = [kind.settle?.(winner, o, t, b) ?? winner, 'changed-on-both-sides'];
			}
		}
		if (kept !== undefined) merged.push(kept);
		if (reason) conflicts.push({ reason, key, base: b, ours: o, theirs: t, kept: kept! });
	}
	return { merged, conflicts };
}

/** How records of each kind are matched between versions: one unique key per record, in order. */
export const RECORD_KEYS = {
	transactions: (ts: readonly Transaction[]): string[] => ts.map((t) => t.id),
	categories: (cs: readonly Category[]): string[] => cs.map((c) => c.id),
	accounts: (as: readonly Account[]): string[] => as.map((a) => a.id),
	recurring: (rs: readonly Recurring[]): string[] => rs.map((r) => r.id),
};

/** Records by key, see `RECORD_KEYS` */
export function byKey<T>(keys: (records: readonly T[]) => string[], records: readonly T[]): Map<string, T> {
	const k = keys(records);
	return new Map(records.map((r, i) => [k[i]!, r]));
}

const TRANSACTIONS: RecordKind<Transaction> = { keys: RECORD_KEYS.transactions, compareEdited: (a, b) => a.edited - b.edited };
const CATEGORIES: RecordKind<Category> = { keys: RECORD_KEYS.categories, compareEdited: () => 0 };
/** Which of two versions to take of a part of a record: the changed one, if only one side changed it */
function pick<V>(base: V, ours: V, theirs: V): { value: V } | null {
	return deepEqual(ours, base) ? { value: theirs } : deepEqual(theirs, base) || deepEqual(ours, theirs) ? { value: ours } : null;
}

/** An account's name, and its balance with the time it was updated, change independently */
function combineAccounts(base: Account | undefined, ours: Account, theirs: Account): Account | null {
	if (!base) return null;
	const balance = (a: Account) => ({ amount: a.amount, edited: a.edited });
	const name = pick(base.name, ours.name, theirs.name);
	const amount = pick(balance(base), balance(ours), balance(theirs));
	return name && amount ? { ...ours, name: name.value, ...amount.value } : null;
}
/** A recurring transaction's template: all but how far it's handled (its `edited` is the template's) */
const template = ({ handled: _, ...rest }: Recurring) => rest;

/**
 * How far a recurring transaction is handled, merged: a change on one side only is kept (an undo
 * too), two different changes take the later (null: nothing handled yet)
 */
function mergeHandled(base: Recurring | undefined, ours: Recurring, theirs: Recurring): Recurring['handled'] {
	const one = base && pick(base.handled, ours.handled, theirs.handled);
	if (one) return one.value;
	return ours.handled === null || (theirs.handled !== null && theirs.handled > ours.handled) ? theirs.handled : ours.handled;
}

/** The template and how far it's handled change independently */
function combineRecurring(base: Recurring | undefined, ours: Recurring, theirs: Recurring): Recurring | null {
	const chosen = base ? pick(template(base), template(ours), template(theirs)) : deepEqual(template(ours), template(theirs)) ? { value: template(ours) } : null;
	return chosen && { ...chosen.value, handled: mergeHandled(base, ours, theirs) };
}

const RECURRING: RecordKind<Recurring> = {
	keys: RECORD_KEYS.recurring,
	compareEdited: (a, b) => a.edited - b.edited,
	combine: combineRecurring,
	settle: (kept, ours, theirs, base) => ({ ...kept, handled: mergeHandled(base, ours, theirs) }),
	// handling occurrences of a template the other side deleted doesn't keep it
	yieldsToDeletion: (base, changed) => deepEqual(template(base), template(changed)),
};

const ACCOUNTS: RecordKind<Account> = { keys: RECORD_KEYS.accounts, compareEdited: (a, b) => a.edited - b.edited, combine: combineAccounts };

/** Removes top-level transactions whose id is now a sub-transaction of a merged group. */
function dropTransactionsMovedIntoGroups(
	merged: Transaction[],
	conflicts: Conflict<Transaction>[],
	versions: { base: CashGuardData; ours: CashGuardData; theirs: CashGuardData },
): Transaction[] {
	const groupOfSub = new Map<Id, Transaction>();
	for (const group of merged) {
		for (const sub of group.subTransactions ?? []) {
			if (groupOfSub.has(sub.id)) throw new Error(`Transaction ${sub.id} ended up in two groups; moving between groups isn't supported by the merge`);
			groupOfSub.set(sub.id, group);
		}
	}
	return merged.filter((t) => {
		const group = groupOfSub.get(t.id);
		if (!group) return true;
		const topLevel = (data: CashGuardData) => data.transactions.find((x) => x.id === t.id);
		// replaces a conflict the record may already have, since this one decides what's kept
		const earlier = conflicts.findIndex((c) => c.key === t.id);
		if (earlier !== -1) conflicts.splice(earlier, 1);
		conflicts.push({ reason: 'moved-into-group', key: t.id, base: topLevel(versions.base), ours: topLevel(versions.ours), theirs: topLevel(versions.theirs), kept: group });
		return false;
	});
}

function usedCategoryIds(transactions: readonly Transaction[], recurring: readonly Recurring[]): Set<Id> {
	return new Set([...transactions.flatMap((t) => [t.categoryId, ...(t.subTransactions ?? []).map((s) => s.categoryId)]), ...recurring.map((r) => r.categoryId)]);
}

/**
 * Merges `ours` and `theirs`, which both derive from `base` (pass `null` if there is no common
 * version yet).
 */
export function merge(base: CashGuardData | null, ours: CashGuardData, theirs: CashGuardData): MergeResult {
	const b = base ?? { categories: [], accounts: [], recurring: [], transactions: [] };
	const transactions = mergeRecords(TRANSACTIONS, b.transactions, ours.transactions, theirs.transactions);
	const categories = mergeRecords(CATEGORIES, b.categories, ours.categories, theirs.categories);
	const accounts = mergeRecords(ACCOUNTS, b.accounts, ours.accounts, theirs.accounts);
	const recurring = mergeRecords(RECURRING, b.recurring, ours.recurring, theirs.recurring);
	const mergedTransactions = dropTransactionsMovedIntoGroups(transactions.merged, transactions.conflicts, { base: b, ours, theirs });

	// restore deleted categories that merged transactions or recurring transactions still use
	const present = new Set<Id>([NO_CATEGORY, ...categories.merged.map((c) => c.id)]);
	for (const id of usedCategoryIds(mergedTransactions, recurring.merged)) {
		if (present.has(id)) continue;
		const find = (data: CashGuardData) => data.categories.find((c) => c.id === id);
		// every merged record comes from ours or theirs, which had the category
		const kept = find(ours) ?? find(theirs);
		if (!kept) throw new Error(`Category ${id} is used but exists in neither version; the input is inconsistent`);
		categories.merged.push(kept);
		categories.conflicts.push({ reason: 'deleted-category-in-use', key: id, base: find(b), ours: find(ours), theirs: find(theirs), kept });
		present.add(id);
	}

	return {
		data: { categories: categories.merged, accounts: accounts.merged, recurring: recurring.merged, transactions: sortNewestFirst(mergedTransactions) },
		conflicts: { transactions: transactions.conflicts, categories: categories.conflicts, accounts: accounts.conflicts, recurring: recurring.conflicts },
	};
}
