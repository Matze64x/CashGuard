/** Deterministic random CashGuard data for property, merge and conformance tests. */
import {
	cents,
	civilDate,
	dateParts,
	MAX_YEAR,
	MIN_YEAR,
	NO_CATEGORY,
	normalizeGroup,
	sortNewestFirst,
	type Account,
	type CashGuardData,
	type Category,
	type Cents,
	type CivilDate,
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

/** Random building blocks drawing from one PRNG. New ids avoid `usedIds`. */
function generator(seed: number, usedIds = new Set<string>()) {
	const rnd = seededRandom(seed);
	const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
	const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
	const text = (): string => Array.from({ length: int(0, 6) }, () => pick(PIECES)).join('');

	// mostly random 64-bit values like in the apps, so independent edits practically never collide;
	// mixed with small and maximal ones, since numeric ordering must hold for all of them
	const id = (): Id => {
		for (;;) {
			const kind = int(0, 3);
			const value =
				kind === 0
					? BigInt(int(1, 2 ** 20))
					: kind === 1
						? (1n << 64n) - BigInt(int(1, 2 ** 20))
						: (BigInt(int(0, 2 ** 31)) << 32n) + BigInt(int(1, 2 ** 32 - 1));
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
	const color = (): string => '#' + Array.from({ length: 8 }, () => pick([...'0123456789ABCDEF'])).join('');
	const category = (): Category => ({ id: id(), name: text(), color: color() });
	const account = (): Account => ({ id: id(), name: pick([text(), 'Bank', 'Cash']), amount: accountAmount(), edited: timestamp() });

	const transaction = (categoryIds: readonly Id[], sameDateAs?: Transaction): Transaction => {
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
	const group = (categoryIds: readonly Id[], base: Transaction): Transaction => {
		const subs: Transaction[] = [];
		for (let j = 0, m = int(0, 5); j < m; j++) subs.push(transaction(categoryIds, subs[subs.length - 1]));
		// like the apps: a group's edited time is at least that of its sub-transactions
		return normalizeGroup({ ...base, edited: Math.max(base.edited, ...subs.map((x) => x.edited)) as UtcSeconds, subTransactions: subs });
	};

	return { rnd, int, pick, text, timestamp, amount, accountAmount, category, account, transaction, group };
}

export function randomDocument(seed: number): CashGuardData {
	const g = generator(seed);
	const categories = Array.from({ length: g.int(0, 8) }, g.category);
	const categoryIds = [NO_CATEGORY, ...categories.map((c) => c.id)];
	const transactions: Transaction[] = [];
	for (let i = 0, n = g.int(0, 40); i < n; i++) {
		const t = g.transaction(categoryIds, transactions[transactions.length - 1]);
		transactions.push(g.rnd() < 0.2 ? g.group(categoryIds, t) : t);
	}
	return {
		categories,
		accounts: Array.from({ length: g.int(0, 5) }, g.account),
		transactions: sortNewestFirst(transactions),
	};
}

function usedCategories(transactions: readonly Transaction[]): Set<Id> {
	return new Set(transactions.flatMap((t) => [t.categoryId, ...(t.subTransactions ?? []).map((s) => s.categoryId)]));
}

/**
 * Applies a few random edits, like a user would: add, change and delete transactions, groups and
 * their sub-transactions, categories and accounts. The result is always valid on its own; in
 * particular, only unused categories are deleted, and every edit moves the `edited` time forward.
 */
export function randomEdit(data: CashGuardData, seed: number): CashGuardData {
	const usedIds = new Set<string>([...data.categories.map((c) => c.id), ...data.transactions.flatMap((t) => [t.id, ...(t.subTransactions ?? []).map((s) => s.id)])]);
	const g = generator(seed, usedIds);
	let { categories, accounts, transactions } = data;
	const categoryIds = () => [NO_CATEGORY, ...categories.map((c) => c.id)];
	const lastSecond = Date.UTC(MAX_YEAR, 11, 31, 23, 59, 59) / 1000;
	const later = (time: number): UtcSeconds => Math.min(time + g.int(1, 10 ** 6), lastSecond) as UtcSeconds;
	/** Marks a transaction as edited now: after its own and its subs' last edit. */
	const touch = (t: Transaction): Transaction =>
		normalizeGroup({ ...t, edited: later(Math.max(t.edited, ...(t.subTransactions ?? []).map((x) => x.edited))) });
	const replaceAt = <T>(items: readonly T[], i: number, item: T): T[] => items.map((x, j) => (j === i ? item : x));
	const removeAt = <T>(items: readonly T[], i: number): T[] => items.filter((_, j) => j !== i);

	for (let n = g.int(1, 6); n > 0; n--) {
		const ti = g.int(0, transactions.length - 1);
		const t = transactions[ti];
		const subs = t?.subTransactions;
		const si = g.int(0, (subs?.length ?? 0) - 1);
		switch (g.int(0, 14)) {
			case 0:
				transactions = [...transactions, g.transaction(categoryIds())];
				break;
			case 1:
				if (t) transactions = removeAt(transactions, ti);
				break;
			case 2: // for a group only the description matters, its amount is the sum of its subs
				if (t) transactions = replaceAt(transactions, ti, touch({ ...t, amount: subs ? t.amount : g.amount(), description: g.text() }));
				break;
			case 3:
				if (t) transactions = replaceAt(transactions, ti, touch({ ...t, categoryId: g.pick(categoryIds()) }));
				break;
			case 4: // convert a transaction into a group (keeps its id, gets new subs, like the C++ client)
				if (t && !subs) transactions = replaceAt(transactions, ti, touch(g.group(categoryIds(), t)));
				break;
			case 5: // convert a group back into a transaction (keeps its id, drops the subs, like the C++ client)
				if (t && subs) {
					const { subTransactions: _, ...plain } = t;
					transactions = replaceAt(transactions, ti, touch(plain));
				}
				break;
			case 6:
				if (t && subs) transactions = replaceAt(transactions, ti, touch({ ...t, subTransactions: [...subs, g.transaction(categoryIds())] }));
				break;
			case 7: {
				const sub = subs?.[si];
				if (t && subs && sub) {
					const changed = { ...sub, amount: g.amount(), edited: later(sub.edited) };
					transactions = replaceAt(transactions, ti, touch({ ...t, subTransactions: replaceAt(subs, si, changed) }));
				}
				break;
			}
			case 8:
				if (t && subs?.[si]) transactions = replaceAt(transactions, ti, touch({ ...t, subTransactions: removeAt(subs, si) }));
				break;
			case 9:
				categories = [...categories, g.category()];
				break;
			case 10: {
				const ci = g.int(0, categories.length - 1);
				const c = categories[ci];
				if (c) categories = replaceAt(categories, ci, { ...c, name: g.text() });
				break;
			}
			case 11: {
				const used = usedCategories(transactions);
				const unused = categories.filter((c) => !used.has(c.id));
				if (unused.length > 0) {
					const victim = g.pick(unused);
					categories = categories.filter((c) => c !== victim);
				}
				break;
			}
			case 12:
				accounts = [...accounts, g.account()];
				break;
			case 13: {
				const ai = g.int(0, accounts.length - 1);
				const a = accounts[ai];
				if (a) accounts = replaceAt(accounts, ai, { ...a, amount: g.accountAmount(), edited: later(a.edited) });
				break;
			}
			case 14: {
				const ai = g.int(0, accounts.length - 1);
				const a = accounts[ai];
				if (a) accounts = g.rnd() < 0.5 ? removeAt(accounts, ai) : replaceAt(accounts, ai, { ...a, name: g.text(), edited: later(a.edited) });
				break;
			}
		}
	}
	return { categories, accounts, transactions: sortNewestFirst(transactions) };
}
