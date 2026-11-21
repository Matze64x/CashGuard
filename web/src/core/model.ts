import { compareIds, type Id } from './ids';
import { sumCents, type Cents } from './money';
import type { CivilDate, UtcSeconds } from './dates';

export interface Transaction {
	readonly id: Id;
	readonly date: CivilDate;
	readonly categoryId: Id;
	readonly amount: Cents;
	readonly description: string;
	readonly added: UtcSeconds;
	readonly edited: UtcSeconds;
	/**
	 * Present (possibly empty) for a transaction group, absent for a plain transaction.
	 * Sub-transactions never have sub-transactions themselves.
	 */
	readonly subTransactions?: readonly Transaction[];
}

export interface Category {
	readonly id: Id;
	readonly name: string;
	/** "#RRGGBBAA", uppercase */
	readonly color: string;
}

export interface Account {
	readonly id: Id;
	readonly name: string;
	readonly amount: Cents;
	readonly edited: UtcSeconds;
}

/**
 * When a recurring transaction comes: every `every` months on the given days of the month (a day
 * the month doesn't have means its last day), or every `every` weeks on the given weekdays (1 =
 * Monday … 7 = Sunday), counted from the week of `start`. `days` is sorted and has no repeats.
 */
export interface Schedule {
	readonly unit: 'month' | 'week';
	readonly every: number;
	readonly days: readonly number[];
}

/** A template for a transaction that comes again and again, e.g. rent or a savings plan */
export interface Recurring {
	readonly id: Id;
	readonly description: string;
	readonly categoryId: Id;
	/** null: asked each time (e.g. a savings plan whose amount depends on the stock price) */
	readonly amount: Cents | null;
	/** The account whose balance confirming an occurrence updates; null: none. May name an account that was deleted since (then: none). */
	readonly accountId: Id | null;
	readonly schedule: Schedule;
	/** The first day an occurrence can fall on */
	readonly start: CivilDate;
	/** The last day an occurrence can fall on; null: no end */
	readonly end: CivilDate | null;
	/** Occurrences up to and including this day are done (entered or skipped); null: none yet */
	readonly handled: CivilDate | null;
	readonly edited: UtcSeconds;
}

export interface CashGuardData {
	/** Without the implicit "no category" (id 0). */
	readonly categories: readonly Category[];
	readonly accounts: readonly Account[];
	readonly recurring: readonly Recurring[];
	/** Sorted newest first, see `compareTransactions`. */
	readonly transactions: readonly Transaction[];
}

export function isGroup(t: Transaction): t is Transaction & { readonly subTransactions: readonly Transaction[] } {
	return t.subTransactions !== undefined;
}

/**
 * Chronological order, as `operator<` in the C++ client: by date, then by when the transaction
 * was added, then by id. Ids are unique, so this is a strict total order.
 */
export function compareTransactions(a: Transaction, b: Transaction): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	if (a.added !== b.added) return a.added - b.added;
	return compareIds(a.id, b.id);
}

/** Newest first: the order in which the C++ client keeps and saves transactions. */
export function sortNewestFirst(transactions: readonly Transaction[]): Transaction[] {
	return [...transactions].sort((a, b) => compareTransactions(b, a));
}

/**
 * A group with its sub-transactions sorted and its amount set to their sum. As in the C++ client,
 * an empty group keeps its own amount. Throws a RangeError if the sum isn't a safe integer.
 */
export function normalizeGroup(group: Transaction): Transaction {
	if (!isGroup(group)) return group;
	const subTransactions = sortNewestFirst(group.subTransactions);
	const amount = subTransactions.length > 0 ? sumCents(subTransactions.map((t) => t.amount)) : group.amount;
	return { ...group, amount, subTransactions };
}

export function totalAmount(transactions: readonly Transaction[]): Cents {
	return sumCents(transactions.map((t) => t.amount));
}
