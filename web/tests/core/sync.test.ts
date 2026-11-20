import { describe, expect, it } from 'vitest';
import {
	cents,
	EMPTY_DATA,
	INITIAL_SYNC_STATE,
	needsWrite,
	planFileSync,
	planImport,
	sortNewestFirst,
	summarizeChanges,
	totalChanges,
	unexportedChanges,
	type Account,
	type CashGuardData,
	type CivilDate,
	type Id,
	type SyncState,
	type Transaction,
	type UtcSeconds,
} from '../../src/core';
import { randomDocument, randomEdit } from './random-data';

const tx = (id: string, amount = -100, edited = 0): Transaction => ({
	id: id as Id,
	date: '2026-01-01' as CivilDate,
	categoryId: '0' as Id,
	amount: cents(amount),
	description: `t${id}`,
	added: 0 as UtcSeconds,
	edited: edited as UtcSeconds,
});
const acc = (name: string, amount: number): Account => ({ name, amount: cents(amount), edited: 0 as UtcSeconds });
const data = (transactions: Transaction[], accounts: Account[] = []): CashGuardData => ({ categories: [], accounts, transactions: sortNewestFirst(transactions) });
const ids = (d: CashGuardData) => d.transactions.map((t) => t.id).sort();

/** The state after importing `file` into an empty app */
const imported = (file: CashGuardData): SyncState => planImport(INITIAL_SYNC_STATE, file).next;
/** The state after exporting the working copy */
const exported = (state: SyncState): SyncState => ({ ...state, exported: state.working });

describe('summarizeChanges', () => {
	it('counts added, changed and deleted records of every kind', () => {
		const before = data([tx('1'), tx('2')], [acc('Bank', 1), acc('Bank', 2)]);
		const after = data([tx('1', -5), tx('3')], [acc('Bank', 1)]);
		expect(summarizeChanges(before, after)).toEqual({
			transactions: { added: 1, changed: 1, deleted: 1 },
			categories: { added: 0, changed: 0, deleted: 0 },
			accounts: { added: 0, changed: 0, deleted: 1 },
		});
		expect(totalChanges(summarizeChanges(before, after))).toBe(4);
	});

	it('counts everything as added without a previous version', () => {
		const d = randomDocument(2);
		expect(totalChanges(summarizeChanges(null, d))).toBe(d.transactions.length + d.categories.length + d.accounts.length);
	});

	it('finds no changes between equal versions', () => {
		const d = randomDocument(3);
		expect(totalChanges(summarizeChanges(d, structuredClone(d)))).toBe(0);
	});
});

describe('sync flow', () => {
	it('first import: the file becomes working copy and base', () => {
		const file = randomDocument(4);
		const plan = planImport(INITIAL_SYNC_STATE, file);
		expect(plan.next).toEqual({ working: file, base: file, exported: null });
		expect(plan.warnings).toEqual([]);
		expect(totalChanges(unexportedChanges(plan.next))).toBe(0);
	});

	it('local edits count as unexported until they are exported', () => {
		const state = { ...imported(data([tx('1')])), working: data([tx('1'), tx('2')]) };
		expect(totalChanges(unexportedChanges(state))).toBe(1);
		expect(totalChanges(unexportedChanges(exported(state)))).toBe(0);
	});

	it('changes from the other device arrive and local ones stay', () => {
		const state = { ...imported(data([tx('1'), tx('2')])), working: data([tx('1', -5, 1), tx('2')]) };
		const plan = planImport(state, data([tx('1'), tx('2'), tx('3')]));
		expect(plan.next.working).toEqual(data([tx('1', -5, 1), tx('2'), tx('3')]));
		expect(plan.next.base).toEqual(data([tx('1'), tx('2'), tx('3')]));
	});

	it('importing an old file again keeps all local edits (the export never reached the file)', () => {
		const file = data([tx('1'), tx('2')]);
		const state = exported({ ...imported(file), working: data([tx('1'), tx('2', -5, 1), tx('3')]) });
		const plan = planImport(state, file);
		expect(plan.next.working).toEqual(state.working);
		expect(totalChanges(plan.changes)).toBe(0);
	});

	it('a deletion on the other device after the export reached it sticks (export becomes the base)', () => {
		// added 3 and changed 2 here, exported, the other device saved it and then deleted 3
		const state = exported({ ...imported(data([tx('1'), tx('2')])), working: data([tx('1'), tx('2', -5, 1), tx('3')]) });
		const plan = planImport(state, data([tx('1'), tx('2', -5, 1)]));
		expect(ids(plan.next.working)).toEqual(['1', '2']);
		expect(plan.merge.conflicts.transactions).toEqual([]);
	});

	it('an edit on the other device after the export reached it wins without a conflict', () => {
		const state = exported({ ...imported(data([tx('1'), tx('2')])), working: data([tx('1', -5, 1), tx('2', -6, 1)]) });
		const plan = planImport(state, data([tx('1', -7, 2), tx('2', -6, 1)]));
		expect(plan.next.working).toEqual(data([tx('1', -7, 2), tx('2', -6, 1)]));
		expect(plan.merge.conflicts.transactions).toEqual([]);
	});

	it('the same, but the edited record was the only one exported: still right, reported as a conflict', () => {
		// no record in the file matches the export exactly, so there's no proof it contains the export
		const state = exported({ ...imported(data([tx('1')])), working: data([tx('1', -5, 1)]) });
		const plan = planImport(state, data([tx('1', -7, 2)]));
		expect(plan.next.working).toEqual(data([tx('1', -7, 2)]));
		expect(plan.merge.conflicts.transactions.map((c) => c.reason)).toEqual(['changed-on-both-sides']);
	});

	it('accepted cost: if the export only added a record that the other device deleted, it comes back', () => {
		const state = exported({ ...imported(data([tx('1')])), working: data([tx('1'), tx('2')]) });
		const plan = planImport(state, data([tx('1')]));
		// nothing in the file shows that it contains the export, so the old base is used
		expect(ids(plan.next.working)).toEqual(['1', '2']);
	});

	it('random edits on both sides: the import keeps every local change the file does not touch', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const file = randomDocument(seed);
			const ours = randomEdit(file, 1000 + seed);
			const theirs = randomEdit(file, 2000 + seed);
			const plan = planImport({ working: ours, base: file, exported: null }, theirs);
			expect(plan.next).toEqual({ working: plan.merge.data, base: theirs, exported: null });
		}
	});
});

describe('import warnings', () => {
	const state = imported(data([tx('1'), tx('2'), tx('3'), tx('4'), tx('5'), tx('6')]));

	it('an empty file', () => {
		expect(planImport(state, EMPTY_DATA).warnings).toEqual(['empty-file', 'many-deletions']);
	});

	it('a file with nothing in common with the last import', () => {
		expect(planImport(state, data([tx('100')])).warnings).toEqual(['unrelated-file', 'many-deletions']);
	});

	it('an old copy that removes many transactions', () => {
		expect(planImport(state, data([tx('1')])).warnings).toEqual(['many-deletions']);
	});

	it('no warning for normal changes', () => {
		expect(planImport(state, data([tx('1'), tx('2'), tx('3'), tx('4'), tx('5'), tx('7')])).warnings).toEqual([]);
		expect(planImport(INITIAL_SYNC_STATE, EMPTY_DATA).warnings).toEqual([]);
	});
});

describe('planFileSync (desktop: the app reads and writes the file itself)', () => {
	const synced = imported(data([tx('1'), tx('2')]));

	it('nothing to do while neither side changed', () => {
		expect(planFileSync(synced, data([tx('1'), tx('2')]))).toEqual({ kind: 'unchanged' });
	});

	it('only the working copy changed: write it', () => {
		expect(planFileSync({ ...synced, working: data([tx('1')]) }, data([tx('1'), tx('2')]))).toEqual({ kind: 'write' });
	});

	it('the file changed unremarkably: import automatically, nothing to write back', () => {
		const result = planFileSync(synced, data([tx('1'), tx('2'), tx('3')]));
		expect(result).toMatchObject({ kind: 'import', automatic: true });
		if (result.kind === 'import') expect(needsWrite(result.plan.next)).toBe(false);
	});

	it('both changed: import automatically, then write the merged result back', () => {
		const result = planFileSync({ ...synced, working: data([tx('1'), tx('2'), tx('4')]) }, data([tx('1'), tx('2'), tx('3')]));
		expect(result).toMatchObject({ kind: 'import', automatic: true });
		if (result.kind === 'import') {
			expect(ids(result.plan.next.working)).toEqual(['1', '2', '3', '4']);
			expect(needsWrite(result.plan.next)).toBe(true);
		}
	});

	it('conflicts or warnings: ask the user', () => {
		const conflicting = planFileSync({ ...synced, working: data([tx('1', -5, 1), tx('2')]) }, data([tx('1', -7, 2), tx('2')]));
		expect(conflicting).toMatchObject({ kind: 'import', automatic: false });
		expect(planFileSync(synced, EMPTY_DATA)).toMatchObject({ kind: 'import', automatic: false });
	});

	it('the first sync without a base is an import', () => {
		expect(planFileSync(INITIAL_SYNC_STATE, data([tx('1')]))).toMatchObject({ kind: 'import', automatic: true });
	});
});
