/**
 * Importing a CashGuard file (manual restore or copy), platform-independent.
 *
 * An import only adds: records the app doesn't have are added, records with the same id are merged
 * (the later edit wins, as in `merge`), and deletions never carry over, since there is no common
 * base to tell a deletion from a record that was never there. Syncing between devices (which does
 * carry deletions) keeps a merge base per device instead.
 */
import { deepEqual } from './equal';
import { byKey, merge, RECORD_KEYS, type MergeResult } from './merge';
import type { CashGuardData } from './model';

export const EMPTY_DATA: CashGuardData = Object.freeze({ categories: [], accounts: [], recurring: [], transactions: [] });

export interface ChangeCounts {
	readonly added: number;
	readonly changed: number;
	readonly deleted: number;
}

export type ChangeSummary = { readonly [K in keyof typeof RECORD_KEYS]: ChangeCounts };

const KINDS = Object.keys(RECORD_KEYS) as (keyof typeof RECORD_KEYS)[];

/** Records of one kind by key, for all kinds at once. */
function keyed(data: CashGuardData) {
	return {
		transactions: byKey(RECORD_KEYS.transactions, data.transactions),
		categories: byKey(RECORD_KEYS.categories, data.categories),
		accounts: byKey(RECORD_KEYS.accounts, data.accounts),
		recurring: byKey(RECORD_KEYS.recurring, data.recurring),
	} as const satisfies { [K in keyof typeof RECORD_KEYS]: Map<string, unknown> };
}

/** What changed from `before` to `after`, counted per record (a group counts as one record). */
export function summarizeChanges(before: CashGuardData | null, after: CashGuardData): ChangeSummary {
	const [b, a] = [keyed(before ?? EMPTY_DATA), keyed(after)];
	const count = (bm: Map<string, unknown>, am: Map<string, unknown>): ChangeCounts => ({
		added: [...am.keys()].filter((k) => !bm.has(k)).length,
		changed: [...am].filter(([k, r]) => bm.has(k) && !deepEqual(bm.get(k), r)).length,
		deleted: [...bm.keys()].filter((k) => !am.has(k)).length,
	});
	return {
		transactions: count(b.transactions, a.transactions),
		categories: count(b.categories, a.categories),
		accounts: count(b.accounts, a.accounts),
		recurring: count(b.recurring, a.recurring),
	};
}

export function totalChanges(summary: ChangeSummary): number {
	return KINDS.reduce((sum, kind) => sum + summary[kind].added + summary[kind].changed + summary[kind].deleted, 0);
}

export type ImportWarning =
	/** Both have transactions, but not one in common: probably a different person's or test file */
	'unrelated-file';

export interface ImportPlan {
	readonly merge: MergeResult;
	/** What the import changes in the working copy (nothing is ever deleted) */
	readonly changes: ChangeSummary;
	/** Signs that this is probably not the right file; the UI should ask before applying */
	readonly warnings: readonly ImportWarning[];
	/** The working copy after applying the import */
	readonly next: CashGuardData;
}

/** Plans importing a file's content (`theirs`) into the working copy; nothing is applied yet. */
export function planImport(working: CashGuardData, theirs: CashGuardData): ImportPlan {
	const result = merge(null, working, theirs);
	const known = new Set(working.transactions.map((t) => t.id));
	const unrelated = known.size > 0 && theirs.transactions.length > 0 && !theirs.transactions.some((t) => known.has(t.id));
	return {
		merge: result,
		changes: summarizeChanges(working, result.data),
		warnings: unrelated ? ['unrelated-file'] : [],
		next: result.data,
	};
}
