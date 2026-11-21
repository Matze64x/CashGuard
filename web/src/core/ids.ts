import type { Brand } from './brand';

/**
 * An unsigned 64-bit identifier in canonical decimal form (no sign, no leading zeros).
 * IDs exceed the precision of JS numbers, and are never calculated with, so they stay strings.
 */
export type Id = Brand<string, 'Id'>;

const UINT64_MAX = (1n << 64n) - 1n;
const ID_PATTERN = /^(0|[1-9]\d*)$/;

/** Category id 0 means "no category". It is implicit and never written to the file. */
export const NO_CATEGORY = '0' as Id;

export function parseId(text: string): Id | null {
	if (!ID_PATTERN.test(text) || text.length > 20) return null;
	if (BigInt(text) > UINT64_MAX) return null;
	return text as Id;
}

/** Numeric comparison (as the C++ client compares uint64), without converting to a number. */
export function compareIds(a: Id, b: Id): number {
	if (a.length !== b.length) return a.length - b.length;
	return a < b ? -1 : a > b ? 1 : 0;
}

/** A random non-zero id, uniformly distributed over uint64, that is not in `taken`. */
export function newId(taken: ReadonlySet<string> = new Set()): Id {
	const buffer = new BigUint64Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		const value = buffer[0]!;
		const id = value.toString() as Id;
		if (value !== 0n && !taken.has(id)) return id;
	}
}

/** The UTF-8 bytes of a string (lone surrogates as U+FFFD, like TextEncoder) */
function utf8(text: string): number[] {
	const bytes: number[] = [];
	for (const ch of text) {
		let c = ch.codePointAt(0)!;
		if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
		if (c < 0x80) bytes.push(c);
		else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
		else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
	}
	return bytes;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/**
 * The ids accounts get when a file from before account ids (cgt_0.4.0) is read: derived from their
 * names, so every device and both clients give an account the same id, and versions of the file
 * upgraded on different devices still merge. A repeated name counts its occurrences: the second
 * "Cash" is keyed "Cash", NUL, "1". The id is the 64-bit FNV-1a hash of the key's UTF-8 bytes (0
 * becomes 1). The C++ client does the same (`legacy_account_id`).
 */
export function legacyAccountIds(names: readonly string[]): Id[] {
	const seen = new Map<string, number>();
	return names.map((name) => {
		const n = seen.get(name) ?? 0;
		seen.set(name, n + 1);
		let hash = FNV_OFFSET;
		for (const byte of utf8(n === 0 ? name : `${name}\0${n}`)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64_MAX;
		return (hash === 0n ? '1' : hash.toString()) as Id;
	});
}
