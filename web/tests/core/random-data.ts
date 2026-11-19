/** Deterministic random CashGuard documents for property and conformance tests. */
import {
	cents,
	civilDate,
	dateParts,
	MAX_YEAR,
	MIN_YEAR,
	type Cents,
	type CivilDate,
	NO_CATEGORY,
	normalizeGroup,
	sortNewestFirst,
	type CashGuardData,
	type Category,
	type Id,
	type Transaction,
	type UtcSeconds,
} from '../../src/core';

/** mulberry32: small seeded PRNG, good enough for test data. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Text pieces that stress escaping and UTF-8. Excluded on purpose:
// - U+0000: the C++ client reads strings as C strings and would truncate at NUL
// - lone surrogates: not representable in UTF-8
const PIECES = [
	'Supermarket', 'Rent', 'a', ' ', '"', '\\', '/', '\n', '\t', '\r', '\b', '\f', '\u0001', '\u001f', '\u007f',
	'Müsli', 'Crème brûlée', '寿司', 'Ελληνικά', '🍕', '👨‍👩‍👧', ' ', ' ', '&<>', '%s', '{}', '[]', ':', ',',
];

export function randomDocument(seed: number): CashGuardData {
	const rnd = seededRandom(seed);
	const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
	const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
	const text = (): string => Array.from({ length: int(0, 6) }, () => pick(PIECES)).join('');

	const usedIds = new Set<string>();
	const id = (): Id => {
		for (;;) {
			// mix small, large and maximal ids; numeric ordering must hold for all of them
			const kind = int(0, 3);
			const value =
				kind === 0 ? BigInt(int(1, 1000)) : kind === 1 ? (1n << 64n) - BigInt(int(1, 1000)) : BigInt(int(1, 2 ** 31)) * BigInt(int(1, 2 ** 31)) + BigInt(int(0, 2 ** 20));
			const s = value.toString();
			if (!usedIds.has(s)) {
				usedIds.add(s);
				return s as Id;
			}
		}
	};
	// the whole supported range, with extra weight on its boundaries and on leap days
	const year = (): number => pick([MIN_YEAR, MAX_YEAR, 2000, 2024, int(MIN_YEAR, MAX_YEAR), int(MIN_YEAR, MAX_YEAR)]);
	const date = (): CivilDate => {
		for (;;) {
			try {
				return civilDate(year(), int(1, 12), pick([1, 28, 29, 30, 31, int(1, 31)]));
			} catch {
				// invalid day for that month, try again
			}
		}
	};
	const timestamp = (): UtcSeconds => {
		const { year: y, month, day } = dateParts(date());
		return (Date.UTC(y, month - 1, day) / 1000 + pick([0, 86399, int(0, 86399)])) as UtcSeconds;
	};
	// group sums must stay safe, so the extreme values only appear in accounts
	const amount = (): Cents => cents(pick([0, int(-100, 100), int(-1e7, 1e7), int(-1e12, 1e12)]));
	const accountAmount = (): Cents => cents(pick([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, int(-1e12, 1e12)]));

	const categories: Category[] = Array.from({ length: int(0, 8) }, () => ({
		id: id(),
		name: text(),
		color: '#' + Array.from({ length: 8 }, () => pick([...'0123456789ABCDEF'])).join(''),
	}));
	const categoryIds = [NO_CATEGORY, ...categories.map((c) => c.id)];

	const transaction = (sameDateAs?: Transaction): Transaction => {
		const added = timestamp();
		return {
			id: id(),
			// sometimes share date and added time, so ordering has to fall back to the id
			date: sameDateAs && rnd() < 0.5 ? sameDateAs.date : date(),
			categoryId: pick(categoryIds),
			amount: amount(),
			description: text(),
			added: sameDateAs && rnd() < 0.3 ? sameDateAs.added : added,
			edited: rnd() < 0.8 ? added : timestamp(),
		};
	};

	const transactions: Transaction[] = [];
	for (let i = 0, n = int(0, 40); i < n; i++) {
		const previous = transactions[transactions.length - 1];
		const t = transaction(previous);
		if (rnd() < 0.2) {
			const subs: Transaction[] = [];
			for (let j = 0, m = int(0, 5); j < m; j++) subs.push(transaction(subs[subs.length - 1]));
			transactions.push(normalizeGroup({ ...t, subTransactions: subs }));
		} else transactions.push(t);
	}

	return {
		categories,
		accounts: Array.from({ length: int(0, 5) }, () => ({ name: text(), amount: accountAmount(), edited: timestamp() })),
		transactions: sortNewestFirst(transactions),
	};
}
