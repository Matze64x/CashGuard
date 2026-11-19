import { describe, expect, it } from 'vitest';
import { addCents, cents, formatAmount, parseAmount, sumCents } from '../../src/core';

describe('parseAmount', () => {
	it.each([
		['+12.34', 1234],
		['-12.34', -1234],
		['12.34', -1234], // no sign = negative, like the C++ client
		['+1.5', 150], // one cent digit = tens
		['+1,05', 105],
		['+7', 700],
		['-0.05', -5],
		['+0.00', 0],
		['', 0],
		['+90071992547409.91', 9007199254740991],
	])('%s -> %d', (text, expected) => {
		expect(parseAmount(text)).toBe(expected);
	});

	it.each(['+12.345', '+12.', 'abc', '+', '++1', '1e5', ' +1.00', '+1.00 ', '+90071992547409.92', '+0x10'])('rejects %j', (text) => {
		expect(parseAmount(text)).toBeNull();
	});

	it('never produces -0', () => {
		expect(Object.is(parseAmount('-0.00'), 0)).toBe(true);
	});

	it('is exact where float math is not', () => {
		// parseFloat('1.13') * 100 === 112.99999999999999
		expect(parseAmount('+1.13')).toBe(113);
		expect(parseAmount('+4.35')).toBe(435);
	});
});

describe('formatAmount', () => {
	it.each([
		[1234, '+12.34'],
		[-1234, '-12.34'],
		[0, '+0.00'],
		[-5, '-0.05'],
		[100, '+1.00'],
		[9007199254740991, '+90071992547409.91'],
	])('%d -> %s', (value, expected) => {
		expect(formatAmount(cents(value))).toBe(expected);
	});

	it('round-trips every canonical amount', () => {
		for (const value of [-100001, -99, -1, 0, 1, 99, 100, 123456789]) {
			expect(parseAmount(formatAmount(cents(value)))).toBe(value);
		}
	});
});

describe('arithmetic', () => {
	it('sums exactly', () => {
		const tenCents = cents(10);
		let total = cents(0);
		for (let i = 0; i < 1000; i++) total = addCents(total, tenCents);
		expect(total).toBe(10000);
		expect(sumCents([cents(10), cents(20)])).toBe(30);
	});

	it('refuses fractions and unsafe values', () => {
		expect(() => cents(1.5)).toThrow(RangeError);
		expect(() => cents(2 ** 53)).toThrow(RangeError);
		expect(() => addCents(cents(2 ** 53 - 1), cents(1))).toThrow(RangeError);
		// an intermediate overflow must not cancel out
		expect(() => sumCents([cents(2 ** 53 - 1), cents(2), cents(-2)])).toThrow(RangeError);
	});
});
