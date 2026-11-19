import type { Brand } from './brand';

/**
 * An amount of money in euro cents. Always a safe integer, so all additions and subtractions
 * are exact (doubles represent every integer up to 2^53 exactly, i.e. ~90 trillion EUR).
 * Fractions (averages, percentages) must never be stored as `Cents`.
 */
export type Cents = Brand<number, 'Cents'>;

export function isSafeCents(value: number): boolean {
	return Number.isSafeInteger(value);
}

export function cents(value: number): Cents {
	if (!isSafeCents(value)) throw new RangeError(`Not a safe integer amount of cents: ${value}`);
	// normalize -0 so formatting and equality never see it
	return (value === 0 ? 0 : value) as Cents;
}

export function addCents(a: Cents, b: Cents): Cents {
	return cents(a + b);
}

/** Exact sum; checks every intermediate step, so an overflow can't cancel out unnoticed. */
export function sumCents(values: Iterable<Cents>): Cents {
	let total = cents(0);
	for (const v of values) total = addCents(total, v);
	return total;
}

// sign, euros, optional separator with one or two cent digits
const AMOUNT_PATTERN = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Parses an amount the way the C++ client (`to_amount`) interprets the canonical forms:
 * - "+12.34" -> 1234, "-12.34" -> -1234
 * - **no sign means negative** ("12.34" -> -1234), matching the C++ client
 * - a single cent digit is tens ("+1.5" -> 150); "," is accepted as separator
 * - "" -> 0
 * Unlike the C++ client, trailing garbage or more than two cent digits are rejected (returns null)
 * instead of being partially parsed. Parsing works on the text, never through floating point.
 */
export function parseAmount(text: string): Cents | null {
	if (text === '') return cents(0);
	const match = AMOUNT_PATTERN.exec(text);
	if (!match) return null;
	const [, sign, euroDigits, centDigits = ''] = match;
	const magnitude = Number(euroDigits) * 100 + Number(centDigits.padEnd(2, '0'));
	if (!isSafeCents(magnitude)) return null;
	return cents(sign === '+' ? magnitude : -magnitude);
}

/** Canonical file representation, identical to `Amount::to_string` in the C++ client: "+12.34", "-0.05", "+0.00". */
export function formatAmount(value: Cents): string {
	const abs = Math.abs(value);
	return `${value < 0 ? '-' : '+'}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}
