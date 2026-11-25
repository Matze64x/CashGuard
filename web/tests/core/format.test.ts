import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	addTransaction,
	cents,
	deleteTransaction,
	FORMAT_VERSION,
	LEGACY_FORMAT_VERSION,
	NO_CATEGORY,
	parseCashGuard,
	serializeCashGuard,
	updateTransaction,
	type CashGuardData,
	type CivilDate,
	type ParseResult,
	type UtcSeconds,
} from '../../src/core';
import { randomDocument } from './random-data';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../../../data/examples/example.json', import.meta.url));

function parsed(content: string): CashGuardData {
	const result = parseCashGuard(content);
	if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
	return result.data;
}

function errorsOf(result: ParseResult): string[] {
	return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}

/** Minimal valid document with the given extra fields for one transaction. */
function doc(transaction: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		Version: FORMAT_VERSION,
		Categories: [{ ID: '7', Name: 'Food', Color: '#FF0000FF' }],
		Accounts: [{ ID: '3', Name: 'Bank', Amount: '+1.00', Edited: '01.01.2026 10:00:00' }],
		Recurring: [],
		Transactions: [
			{
				ID: '1',
				Date: '01.01.2026',
				Category: '7',
				Amount: '-1.00',
				Description: 'x',
				Added: '01.01.2026 10:00:00',
				Edited: '01.01.2026 10:00:00',
				...transaction,
			},
		],
		...extra,
	});
}

describe('round trip (byte-identical to the C++ client)', () => {
	// the same fixtures are checked by the C++ client (ctest), so both clients agree on them
	it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.json')))('fixture %s', (name) => {
		const content = readFileSync(`${FIXTURES}/${name}`, 'utf8');
		expect(serializeCashGuard(parsed(content))).toBe(content);
	});

	it.skipIf(!existsSync(EXAMPLE))('data/examples/example.json', () => {
		const content = readFileSync(EXAMPLE, 'utf8');
		const data = parsed(content);
		expect(data.transactions.length).toBeGreaterThan(1000);
		expect(serializeCashGuard(data)).toBe(content);
	});

	it('random documents: serialize -> parse -> serialize is stable and lossless', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const data = randomDocument(seed);
			const text = serializeCashGuard(data);
			const again = parsed(text);
			expect(again).toEqual(data);
			expect(serializeCashGuard(again)).toBe(text);
		}
	});

	it('escapes strings exactly like rapidjson', () => {
		const data = parsed(doc());
		const description = '\u0001\u001f"\\\n\t\r\b\f/\u007f€🍕\u2028';
		const text = serializeCashGuard({ ...data, transactions: [{ ...data.transactions[0]!, description }] });
		expect(text).toContain('"Description": "\\u0001\\u001F\\"\\\\\\n\\t\\r\\b\\f/\u007f€🍕\u2028"');
	});

	it('does not write category 0', () => {
		const data = parsed(doc());
		const text = serializeCashGuard({ ...data, categories: [...data.categories, { id: NO_CATEGORY, name: 'none', color: '#000000FF' }] });
		expect(text).toBe(serializeCashGuard(data));
	});

	it('empty file is an empty database', () => {
		expect(parsed('')).toEqual({ categories: [], accounts: [], recurring: [], transactions: [] });
	});

	it('sorts transactions newest first and recomputes group amounts', () => {
		const content = JSON.stringify({
			Version: FORMAT_VERSION,
			Categories: [],
			Accounts: [],
			Recurring: [],
			Transactions: [
				{ ID: '5', Date: '01.01.2020', Category: '0', Amount: '+0.00', Description: 'old', Added: '01.01.2020 00:00:00', Edited: '01.01.2020 00:00:00' },
				{
					ID: '6', Date: '01.01.2021', Category: '0', Amount: '+999.00', Description: 'group', Added: '01.01.2021 00:00:00', Edited: '01.01.2021 00:00:00',
					Transactions: [
						{ ID: '8', Date: '01.01.2021', Category: '0', Amount: '-1.00', Description: 'a', Added: '01.01.2021 00:00:00', Edited: '01.01.2021 00:00:00' },
						{ ID: '9', Date: '02.01.2021', Category: '0', Amount: '-2.50', Description: 'b', Added: '01.01.2021 00:00:00', Edited: '01.01.2021 00:00:00' },
					],
				},
			],
		});
		const data = parsed(content);
		expect(data.transactions.map((t) => t.id)).toEqual(['6', '5']);
		expect(data.transactions[0]!.amount).toBe(-350);
		expect(data.transactions[0]!.subTransactions!.map((t) => t.id)).toEqual(['9', '8']);
	});
});

describe('validation', () => {
	it('accepts the minimal document', () => {
		expect(errorsOf(parseCashGuard(doc()))).toEqual([]);
	});

	it('reports problems with their location instead of throwing', () => {
		expect(errorsOf(parseCashGuard('{'))[0]).toMatch(/^: Not valid JSON/);
		expect(errorsOf(parseCashGuard('[]'))).toEqual([': The file must contain a JSON object']);
		expect(errorsOf(parseCashGuard(doc({}, { Version: 'cgt_0.3.0' })))).toEqual(['Version: Unsupported version "cgt_0.3.0", expected "cgt_0.6.0"']);
		expect(errorsOf(parseCashGuard(doc({}, { Version: 'cgt_0.10.0' })))).toEqual([
			'Version: The file was written by a newer version of CashGuard (format "cgt_0.10.0"). Update the app (restart it) to open it.',
		]);
		// half of a UTF-16 pair can only come from an escape; a whole pair is fine
		expect(errorsOf(parseCashGuard(doc({ Description: '\ud800' })))).toEqual(['Transactions[0].Description: Must not contain an invalid character (a lone surrogate escape)']);
		expect(errorsOf(parseCashGuard(doc({ Description: 'x\udc00' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(doc({ Description: '💶' })))).toEqual([]);
		expect(errorsOf(parseCashGuard(doc({ Amount: 'lots' })))).toEqual(['Transactions[0].Amount: Invalid amount: "lots"']);
		expect(errorsOf(parseCashGuard(doc({ Amount: 12 })))).toEqual(['Transactions[0].Amount: Must be a string']);
		expect(errorsOf(parseCashGuard(doc({ Date: '31.02.2026' })))).toEqual(['Transactions[0].Date: Invalid date (expected DD.MM.YYYY, years 1000–9999): "31.02.2026"']);
		expect(errorsOf(parseCashGuard(doc({ Category: '8' })))).toEqual(['Transactions[0].Category: Unknown category id 8']);
		expect(errorsOf(parseCashGuard(doc({ Description: undefined })))).toEqual(['Transactions[0].Description: Missing']);
		expect(errorsOf(parseCashGuard(doc({}, { Accounts: undefined })))).toEqual(['Accounts: Missing']);
		expect(errorsOf(parseCashGuard(doc({}, { Version: undefined })))).toEqual(['Version: Missing']);
		expect(errorsOf(parseCashGuard(doc({}, { Version: 4 })))).toEqual(['Version: Must be a string']);
		expect(errorsOf(parseCashGuard(doc({}, { Accounts: ['x'] })))).toEqual(['Accounts[0]: Must be an object']);
		expect(errorsOf(parseCashGuard(doc({ Transactions: {} })))).toEqual(['Transactions[0].Transactions: Must be an array']);
		expect(errorsOf(parseCashGuard(doc({ Description: 'a\u0000b' })))).toEqual(['Transactions[0].Description: Must not contain a NUL character']);
		expect(errorsOf(parseCashGuard(' '))[0]).toMatch(/^: Not valid JSON/);
	});

	it('reports a group whose amounts add up beyond the safe range instead of throwing', () => {
		const sub = (id: string) => ({ ID: id, Date: '01.01.2026', Category: '7', Amount: '+90071992547409.91', Description: 's', Added: '01.01.2026 10:00:00', Edited: '01.01.2026 10:00:00' });
		expect(errorsOf(parseCashGuard(doc({ Transactions: [sub('2'), sub('3')] })))).toEqual([
			'Transactions[0].Transactions: The sub-transaction amounts add up to an amount that is too large',
		]);
	});

	it('checks sub-transactions even if their group is invalid, and reports every problem', () => {
		const sub = (id: string, category: string) => ({ ID: id, Date: '01.01.2026', Category: category, Amount: '-1.00', Description: 's', Added: '01.01.2026 10:00:00', Edited: '01.01.2026 10:00:00' });
		expect(errorsOf(parseCashGuard(doc({ Date: 'soon', Transactions: [sub('1', '7'), sub('2', '99'), sub('2', '98')] })))).toEqual([
			'Transactions[0].Date: Invalid date (expected DD.MM.YYYY, years 1000–9999): "soon"',
			'Transactions[0].Transactions[0].ID: Duplicate transaction id 1',
			'Transactions[0].Transactions[1].Category: Unknown category id 99',
			'Transactions[0].Transactions[2].ID: Duplicate transaction id 2',
			'Transactions[0].Transactions[2].Category: Unknown category id 98',
		]);
	});

	it('normalizes colors to uppercase', () => {
		const data = parsed(doc({}, { Categories: [{ ID: '7', Name: 'Food', Color: '#ff00aaff' }] }));
		expect(data.categories[0]!.color).toBe('#FF00AAFF');
	});

	it('reports duplicate ids, also between groups and their sub-transactions', () => {
		const sub = { ID: '1', Date: '01.01.2026', Category: '7', Amount: '-1.00', Description: 's', Added: '01.01.2026 10:00:00', Edited: '01.01.2026 10:00:00' };
		expect(errorsOf(parseCashGuard(doc({ Transactions: [sub] })))).toEqual(['Transactions[0].Transactions[0].ID: Duplicate transaction id 1']);
		const categories = [{ ID: '7', Name: 'a', Color: '#000000FF' }, { ID: '7', Name: 'b', Color: '#000000FF' }];
		expect(errorsOf(parseCashGuard(doc({}, { Categories: categories })))).toEqual(['Categories[1].ID: Duplicate category id 7']);
		const account = { ID: '3', Name: 'Bank', Amount: '+1.00', Edited: '01.01.2026 10:00:00' };
		expect(errorsOf(parseCashGuard(doc({}, { Accounts: [account, { ...account, Name: 'Cash' }] })))).toEqual(['Accounts[1].ID: Duplicate account id 3']);
		expect(errorsOf(parseCashGuard(doc({}, { Accounts: [{ ...account, ID: undefined }] })))).toEqual(['Accounts[0].ID: Missing']);
	});

	it('reads files from before account ids: ids derived from the names, alike on every device', () => {
		const account = { Name: 'Bank', Amount: '+1.00', Edited: '01.01.2026 10:00:00' };
		const accounts = [account, { ...account, Name: 'Café 💶' }, { ...account, Amount: '+2.00' }];
		const legacy = parsed(doc({}, { Version: LEGACY_FORMAT_VERSION, Accounts: accounts, Recurring: undefined }));
		// FNV-1a 64 of "Bank", "Café 💶" and the second "Bank" ("Bank", NUL, "1"); the C++ client agrees (conformance test)
		expect(legacy.accounts.map((a) => [a.id, a.name, a.amount])).toEqual([
			['13925658533498293399', 'Bank', 100],
			['13691665715867055498', 'Café 💶', 100],
			['3087832629438022316', 'Bank', 200],
		]);
		// written in the current version, with the ids
		expect(serializeCashGuard(legacy)).toContain(`"Version": "${FORMAT_VERSION}"`);
		expect(parsed(serializeCashGuard(legacy))).toEqual(legacy);
		// an id in a legacy file is ignored
		expect(parseCashGuard(doc({}, { Version: LEGACY_FORMAT_VERSION, Accounts: [{ ...account, ID: '3' }], Recurring: undefined })).warnings).toEqual([
			{ path: 'Accounts[0].ID', message: 'Ignored: in files of version cgt_0.4.0, account ids come from the names' },
		]);
	});

	// (the C++ client upgrades them alike: conformance test)
	it.each(readdirSync(`${FIXTURES}/legacy`).filter((name) => name.endsWith('.json') && !name.endsWith('.upgraded.json')))('upgrades the older version in legacy/%s', (name) => {
		const upgraded = readFileSync(`${FIXTURES}/legacy/${name.replace(/\.json$/, '.upgraded.json')}`, 'utf8');
		expect(serializeCashGuard(parsed(readFileSync(`${FIXTURES}/legacy/${name}`, 'utf8')))).toBe(upgraded);
	});

	it('reads files from before recurring transactions', () => {
		const before = parsed(doc({}, { Version: 'cgt_0.5.0', Recurring: undefined }));
		expect(before.recurring).toEqual([]);
		expect(serializeCashGuard(before)).toContain('"Recurring": []');
		expect(parseCashGuard(doc({}, { Version: 'cgt_0.5.0' })).warnings.map((w) => w.path)).toEqual(['Recurring']);
		expect(errorsOf(parseCashGuard(doc({}, { Recurring: undefined })))).toEqual(['Recurring: Missing']);
	});

	it('reads and checks recurring transactions', () => {
		const template = {
			ID: '9', Description: 'Savings plan', Category: '7', Amount: '', Account: '', Every: '1', Unit: 'month', Days: '1,8,15,22',
			Start: '01.12.2026', End: '', Handled: '', Edited: '01.01.2026 10:00:00',
		};
		const one = (changes: Record<string, unknown>) => doc({}, { Recurring: [{ ...template, ...changes }] });
		expect(parsed(one({})).recurring).toEqual([
			{
				id: '9', description: 'Savings plan', categoryId: '7', amount: null, accountId: null, schedule: { unit: 'month', every: 1, days: [1, 8, 15, 22] },
				start: '2026-12-01', end: null, handled: null, edited: Date.UTC(2026, 0, 1, 10) / 1000,
			},
		]);
		expect(parsed(one({ Amount: '-50.00', Account: '3', Unit: 'week', Days: '1,7', Every: '2', End: '31.12.2027', Handled: '07.12.2026' })).recurring[0]).toMatchObject({
			amount: -5000, accountId: '3', schedule: { unit: 'week', every: 2, days: [1, 7] }, end: '2027-12-31', handled: '2026-12-07',
		});
		expect(errorsOf(parseCashGuard(one({ Days: '8,1' })))).toEqual(['Recurring[0].Days: Invalid days (expected e.g. "1,15", 1–31, ascending): "8,1"']);
		expect(errorsOf(parseCashGuard(one({ Days: '1,1' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(one({ Days: '32' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(one({ Unit: 'week', Days: '8' })))).toEqual(['Recurring[0].Days: Invalid weekdays (expected e.g. "1,5", 1 = Monday … 7 = Sunday, ascending): "8"']);
		expect(errorsOf(parseCashGuard(one({ Unit: 'day' })))).toEqual(['Recurring[0].Unit: Invalid unit (expected month or week): "day"']);
		expect(errorsOf(parseCashGuard(one({ Every: '0' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(one({ Every: '1000' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(one({ End: '30.11.2026' })))).toEqual(['Recurring[0].End: Must not be before the start']);
		expect(errorsOf(parseCashGuard(one({ Amount: 'x' })))).toEqual(['Recurring[0].Amount: Invalid amount (or empty: asked each time): "x"']);
		expect(errorsOf(parseCashGuard(one({ Start: '' })))).toHaveLength(1);
		expect(errorsOf(parseCashGuard(one({ Handled: undefined })))).toEqual(['Recurring[0].Handled: Missing']);
		expect(errorsOf(parseCashGuard(doc({}, { Recurring: [template, template] })))).toEqual(['Recurring[1].ID: Duplicate recurring transaction id 9']);
		// a category deleted meanwhile (e.g. in the C++ client, which doesn't know templates): no category
		const orphan = parseCashGuard(one({ Category: '8' }));
		expect(orphan.ok && orphan.data.recurring[0]!.categoryId).toBe(NO_CATEGORY);
		expect(orphan.warnings).toEqual([{ path: 'Recurring[0].Category', message: 'Unknown category id 8; it will use no category' }]);
	});

	it('rejects nested groups and the reserved category id 0', () => {
		const nested = { ID: '2', Date: '01.01.2026', Category: '7', Amount: '-1.00', Description: 's', Added: '01.01.2026 10:00:00', Edited: '01.01.2026 10:00:00', Transactions: [] };
		expect(errorsOf(parseCashGuard(doc({ Transactions: [nested] })))).toEqual(['Transactions[0].Transactions[0].Transactions: Sub-transactions cannot have sub-transactions']);
		expect(errorsOf(parseCashGuard(doc({}, { Categories: [{ ID: '0', Name: 'x', Color: '#000000FF' }] })))).toContain('Categories[0].ID: Category id 0 is reserved for "no category"');
	});

	it('reports a nested group only as an error, not also as an unknown key', () => {
		const nested = { ID: '2', Date: '01.01.2026', Category: '7', Amount: '-1.00', Description: 's', Added: '01.01.2026 10:00:00', Edited: '01.01.2026 10:00:00', Transactions: [] };
		expect(parseCashGuard(doc({ Transactions: [nested] })).warnings).toEqual([]);
	});

	it('warns about unknown keys (they are dropped on save)', () => {
		const result = parseCashGuard(doc({ Note: 'hi' }, { Budgets: [] }));
		expect(result.ok).toBe(true);
		expect(result.warnings.map((w) => w.path)).toEqual(['Budgets', 'Transactions[0].Note']);
	});
});

describe('formatting after edits (each transaction’s text is kept per object)', () => {
	it('gives the same text as formatting fresh data, after random edits', () => {
		const parsed = parseCashGuard(readFileSync(`${FIXTURES}/edge-cases.json`, 'utf8'));
		if (!parsed.ok) throw new Error('fixture');
		let data: CashGuardData = parsed.data;
		serializeCashGuard(data);
		let seed = 7;
		const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
		const date = () => `20${10 + random(16)}-${String(1 + random(12)).padStart(2, '0')}-${String(1 + random(28)).padStart(2, '0')}` as CivilDate;
		for (let i = 0; i < 200; i++) {
			const now = (1_900_000_000 + i) as UtcSeconds;
			const pick = data.transactions[random(data.transactions.length)]!;
			const draft = { date: date(), description: `edit ${i}`, categoryId: NO_CATEGORY, amount: cents(random(10_000) - 5_000) };
			switch (random(4)) {
				case 0:
					data = addTransaction(data, draft, now).data;
					break;
				case 1:
					data = deleteTransaction(data, pick.id);
					break;
				case 2:
					data = updateTransaction(data, pick.id, pick.subTransactions ? { ...draft, subTransactions: pick.subTransactions.map((s) => ({ ...s, amount: cents(s.amount + 1) })) } : draft, now);
					break;
				default:
					data = addTransaction(data, { ...draft, subTransactions: [{ ...draft, amount: cents(1) }, { ...draft, amount: cents(-250) }] }, now).data;
			}
			if (i % 20 === 0 || i === 199) expect(serializeCashGuard(data)).toBe(serializeCashGuard(structuredClone(data)));
		}
	});

	it('sorts transactions that aren’t in order', () => {
		const parsed = parseCashGuard(readFileSync(`${FIXTURES}/edge-cases.json`, 'utf8'));
		if (!parsed.ok) throw new Error('fixture');
		const shuffled = { ...parsed.data, transactions: [...parsed.data.transactions].reverse() };
		expect(serializeCashGuard(shuffled)).toBe(serializeCashGuard(parsed.data));
	});
});
