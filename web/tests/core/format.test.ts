import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, NO_CATEGORY, parseCashGuard, serializeCashGuard, type CashGuardData, type ParseResult } from '../../src/core';
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
		Accounts: [{ Name: 'Bank', Amount: '+1.00', Edited: '01.01.2026 10:00:00' }],
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
		expect(parsed('')).toEqual({ categories: [], accounts: [], transactions: [] });
	});

	it('sorts transactions newest first and recomputes group amounts', () => {
		const content = JSON.stringify({
			Version: FORMAT_VERSION,
			Categories: [],
			Accounts: [],
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
		expect(errorsOf(parseCashGuard(doc({}, { Version: 'cgt_0.3.0' })))).toEqual(['Version: Unsupported version "cgt_0.3.0", expected "cgt_0.4.0"']);
		expect(errorsOf(parseCashGuard(doc({ Amount: 'lots' })))).toEqual(['Transactions[0].Amount: Invalid amount: "lots"']);
		expect(errorsOf(parseCashGuard(doc({ Amount: 12 })))).toEqual(['Transactions[0].Amount: Must be a string']);
		expect(errorsOf(parseCashGuard(doc({ Date: '31.02.2026' })))).toEqual(['Transactions[0].Date: Invalid date (expected DD.MM.YYYY, years 1678–2261): "31.02.2026"']);
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
			'Transactions[0].Date: Invalid date (expected DD.MM.YYYY, years 1678–2261): "soon"',
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
		const result = parseCashGuard(doc({ Note: 'hi' }, { Recurring: [] }));
		expect(result.ok).toBe(true);
		expect(result.warnings.map((w) => w.path)).toEqual(['Recurring', 'Transactions[0].Note']);
	});
});
