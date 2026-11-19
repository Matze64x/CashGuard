/**
 * Three-way merge of two versions of the data that were edited independently (e.g. on the phone
 * and on the desktop), relative to the last version both had in common.
 *
 * Records are matched by key: transactions and categories by id, accounts by name. A transaction
 * group is one record including its sub-transactions. For every record:
 * - same on both sides             -> keep it
 * - changed on one side only       -> take that change (including adding or deleting it)
 * - changed differently on both    -> the later `Edited` timestamp wins; reported as a conflict
 * - deleted on one side, changed   -> keep the changed version; reported as a conflict
 *   on the other
 * Categories have no timestamp, and timestamps can tie: then a fixed order of the two versions'
 * contents decides. So the merged data doesn't depend on which device merges (only the order of
 * categories and accounts does: ours first).
 *
 * Afterwards:
 * - a top-level transaction whose id is now a sub-transaction of a merged group (one side moved it
 *   into the group) is dropped in favour of the group, and reported
 * - a category that was deleted but is still used by a merged transaction is restored, and reported
 *
 * Without a common base nothing counts as deleted: both versions are combined.
 *
 * Inputs must be valid on their own (as produced by `parseCashGuard` or the app): unique ids,
 * normalized groups, and a group's `edited` is at least that of its sub-transactions.
 */
import { canonicalString, deepEqual } from './equal';
import { NO_CATEGORY, type Id } from './ids';
import { sortNewestFirst, type Account, type CashGuardData, type Category, type Transaction } from './model';

export type ConflictReason = 'changed-on-both-sides' | 'deleted-and-changed' | 'moved-into-group' | 'deleted-category-in-use';

export interface Conflict<T> {
	readonly reason: ConflictReason;
	/** The record's id, or the account name */
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
	};
}

interface RecordKind<T> {
	/** One unique key per record, in the same order */
	keys(records: readonly T[]): string[];
	/** Positive if `a` was edited later than `b`, negative if earlier, 0 if unknown or equal. */
	compareEdited(a: T, b: T): number;
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
		else if (o === undefined || t === undefined) [kept, reason] = [(o ?? t)!, 'deleted-and-changed'];
		else [kept, reason] = [newer(kind, o, t), 'changed-on-both-sides'];
		if (kept !== undefined) merged.push(kept);
		// account keys of repeated names carry their occurrence after a NUL; report the plain name
		if (reason) conflicts.push({ reason, key: key.split('\0')[0]!, base: b, ours: o, theirs: t, kept: kept! });
	}
	return { merged, conflicts };
}

/**
 * Accounts have no id yet, so they're matched by name. Names aren't necessarily unique, so repeated
 * names get their occurrence appended (after a NUL, which names can't contain). Known limitation:
 * deleting an earlier one of several accounts with the same name shifts the matching.
 */
function accountKeys(accounts: readonly Account[]): string[] {
	const seen = new Map<string, number>();
	return accounts.map(({ name }) => {
		const n = seen.get(name) ?? 0;
		seen.set(name, n + 1);
		return n === 0 ? name : `${name}\0${n}`;
	});
}

/** How records of each kind are matched between versions: one unique key per record, in order. */
export const RECORD_KEYS = {
	transactions: (ts: readonly Transaction[]): string[] => ts.map((t) => t.id),
	categories: (cs: readonly Category[]): string[] => cs.map((c) => c.id),
	accounts: accountKeys,
};

/** Records by key, see `RECORD_KEYS` */
export function byKey<T>(keys: (records: readonly T[]) => string[], records: readonly T[]): Map<string, T> {
	const k = keys(records);
	return new Map(records.map((r, i) => [k[i]!, r]));
}

const TRANSACTIONS: RecordKind<Transaction> = { keys: RECORD_KEYS.transactions, compareEdited: (a, b) => a.edited - b.edited };
const CATEGORIES: RecordKind<Category> = { keys: RECORD_KEYS.categories, compareEdited: () => 0 };
const ACCOUNTS: RecordKind<Account> = { keys: RECORD_KEYS.accounts, compareEdited: (a, b) => a.edited - b.edited };

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

function usedCategoryIds(transactions: readonly Transaction[]): Set<Id> {
	return new Set(transactions.flatMap((t) => [t.categoryId, ...(t.subTransactions ?? []).map((s) => s.categoryId)]));
}

/**
 * Merges `ours` and `theirs`, which both derive from `base` (pass `null` if there is no common
 * version yet).
 */
export function merge(base: CashGuardData | null, ours: CashGuardData, theirs: CashGuardData): MergeResult {
	const b = base ?? { categories: [], accounts: [], transactions: [] };
	const transactions = mergeRecords(TRANSACTIONS, b.transactions, ours.transactions, theirs.transactions);
	const categories = mergeRecords(CATEGORIES, b.categories, ours.categories, theirs.categories);
	const accounts = mergeRecords(ACCOUNTS, b.accounts, ours.accounts, theirs.accounts);
	const mergedTransactions = dropTransactionsMovedIntoGroups(transactions.merged, transactions.conflicts, { base: b, ours, theirs });

	// restore deleted categories that merged transactions still use
	const present = new Set<Id>([NO_CATEGORY, ...categories.merged.map((c) => c.id)]);
	for (const id of usedCategoryIds(mergedTransactions)) {
		if (present.has(id)) continue;
		const find = (data: CashGuardData) => data.categories.find((c) => c.id === id);
		// every merged transaction comes from ours or theirs, which had the category
		const kept = find(ours) ?? find(theirs);
		if (!kept) throw new Error(`Category ${id} is used but exists in neither version; the input is inconsistent`);
		categories.merged.push(kept);
		categories.conflicts.push({ reason: 'deleted-category-in-use', key: id, base: find(b), ours: find(ours), theirs: find(theirs), kept });
		present.add(id);
	}

	return {
		data: { categories: categories.merged, accounts: accounts.merged, transactions: sortNewestFirst(mergedTransactions) },
		conflicts: { transactions: transactions.conflicts, categories: categories.conflicts, accounts: accounts.conflicts },
	};
}
