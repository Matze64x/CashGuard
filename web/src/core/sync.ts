/**
 * Sync state of a working copy against the synced file, platform-independent.
 *
 * - `working` is what the user edits.
 * - `base` is the last version of the synced file that was merged into the working copy (null
 *   before the first import). Importing the file merges it into the working copy and makes it the
 *   new base.
 * - `exported` is the working copy as of the last export (null if nothing was exported since the
 *   last import). An export may never reach the synced file (e.g. "Save to Files" was cancelled),
 *   so it only becomes the base of the next import if the imported file shows it contains the
 *   export: some record the export added or changed is in the file exactly as exported. Otherwise
 *   the old base is used, and importing an old file can't look like it deleted everything since.
 *   Remaining cost: if an export's only change was a record that the other device then deleted, the
 *   record comes back (it looks like a local addition). That errs towards keeping data.
 */
import { deepEqual } from './equal';
import { byKey, merge, RECORD_KEYS, type MergeResult } from './merge';
import type { CashGuardData } from './model';

export interface SyncState {
	readonly working: CashGuardData;
	readonly base: CashGuardData | null;
	readonly exported: CashGuardData | null;
}

export const EMPTY_DATA: CashGuardData = Object.freeze({ categories: [], accounts: [], recurring: [], transactions: [] });

export const INITIAL_SYNC_STATE: SyncState = Object.freeze({ working: EMPTY_DATA, base: null, exported: null });

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

/** Changes in the working copy that haven't been exported yet. */
export function unexportedChanges(state: SyncState): ChangeSummary {
	return summarizeChanges(state.exported ?? state.base, state.working);
}

/** Whether `theirs` contains at least one record that `exported` added or changed relative to `base`. */
function containsExport(base: CashGuardData | null, exported: CashGuardData, theirs: CashGuardData): boolean {
	const [b, e, t] = [keyed(base ?? EMPTY_DATA), keyed(exported), keyed(theirs)];
	return KINDS.some((kind) => {
		const [bm, em, tm] = [b[kind] as Map<string, unknown>, e[kind] as Map<string, unknown>, t[kind] as Map<string, unknown>];
		return [...em].some(([k, r]) => !deepEqual(bm.get(k), r) && deepEqual(tm.get(k), r));
	});
}

export type ImportWarning =
	/** The file contains no data at all, but the working copy does */
	| 'empty-file'
	/** The file has nothing in common with the last imported version: probably a different file */
	| 'unrelated-file'
	/** The import would remove many transactions: maybe an old copy of the file */
	| 'many-deletions';

export interface ImportPlan {
	readonly merge: MergeResult;
	/** What the import changes in the working copy */
	readonly changes: ChangeSummary;
	/** Signs that this is probably not the right file; the UI should ask before applying */
	readonly warnings: readonly ImportWarning[];
	/** The state after applying the import */
	readonly next: SyncState;
}

function importWarnings(state: SyncState, theirs: CashGuardData, changes: ChangeSummary): ImportWarning[] {
	const warnings: ImportWarning[] = [];
	const total = (d: CashGuardData) => d.transactions.length + d.categories.length + d.accounts.length + d.recurring.length;
	if (total(theirs) === 0 && total(state.working) > 0) warnings.push('empty-file');
	else if (state.base && state.base.transactions.length > 0) {
		const known = new Set(state.base.transactions.map((t) => t.id));
		if (!theirs.transactions.some((t) => known.has(t.id))) warnings.push('unrelated-file');
	}
	const deleted = changes.transactions.deleted;
	if (deleted >= 5 && deleted >= state.working.transactions.length * 0.2) warnings.push('many-deletions');
	return warnings;
}

/** Plans importing the synced file's current content (`theirs`); nothing is applied yet. */
export function planImport(state: SyncState, theirs: CashGuardData): ImportPlan {
	const base = state.exported && containsExport(state.base, state.exported, theirs) ? state.exported : state.base;
	const result = merge(base, state.working, theirs);
	const changes = summarizeChanges(state.working, result.data);
	return {
		merge: result,
		changes,
		warnings: importWarnings(state, theirs, changes),
		next: { working: result.data, base: theirs, exported: null },
	};
}

/**
 * What to do with the synced file when the app can read and write it directly (desktop app):
 * - 'unchanged': the file and the working copy are both still at the base
 * - 'write': only the working copy changed; write it to the file
 * - 'import': the file changed; merge it in (automatically if the merge is unremarkable, else ask
 *   the user), then write the result if it differs from the file
 */
export type FileSyncPlan =
	| { readonly kind: 'unchanged' }
	| { readonly kind: 'write' }
	| { readonly kind: 'import'; readonly plan: ImportPlan; readonly automatic: boolean };

export function planFileSync(state: SyncState, file: CashGuardData): FileSyncPlan {
	if (state.base && deepEqual(file, state.base)) return deepEqual(state.working, state.base) ? { kind: 'unchanged' } : { kind: 'write' };
	const plan = planImport(state, file);
	const automatic = plan.warnings.length === 0 && Object.values(plan.merge.conflicts).every((list) => list.length === 0);
	return { kind: 'import', plan, automatic };
}

/** Whether the working copy has content the file doesn't (after an import, the file is the base). */
export function needsWrite(state: SyncState): boolean {
	return !deepEqual(state.working, state.base);
}
