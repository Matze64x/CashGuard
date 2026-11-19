import { describe, expect, it } from 'vitest';
import {
	civilDate,
	compareIds,
	formatFileDate,
	formatFileDateTime,
	newId,
	parseFileDate,
	parseFileDateTime,
	parseId,
	type Id,
} from '../../src/core';

describe('dates', () => {
	it('parses and formats file dates', () => {
		expect(parseFileDate('29.02.2024')).toBe('2024-02-29');
		expect(formatFileDate(civilDate(2024, 2, 29))).toBe('29.02.2024');
		expect(parseFileDate('29.02.2000')).toBe('2000-02-29');
		expect(parseFileDate('01.01.1678')).toBe('1678-01-01');
		expect(parseFileDate('31.12.2261')).toBe('2261-12-31');
	});

	// outside 1678..2261 the C++ client corrupts dates (std::chrono::system_clock overflow)
	it.each(['29.02.2023', '29.02.1900', '31.04.2026', '00.01.2026', '1.1.2026', '01.13.2026', '31.12.1677', '01.01.2262', '01.01.0005', '2026-01-01'])('rejects date %j', (text) => {
		expect(parseFileDate(text)).toBeNull();
	});

	it('civil dates compare chronologically as strings', () => {
		expect(civilDate(2025, 12, 31) < civilDate(2026, 1, 1)).toBe(true);
		expect(civilDate(2026, 1, 9) < civilDate(2026, 1, 10)).toBe(true);
	});

	it('parses timestamps as UTC', () => {
		expect(parseFileDateTime('01.01.1970 00:00:00')).toBe(0);
		expect(parseFileDateTime('18.11.2026 18:30:00')).toBe(Date.UTC(2026, 10, 18, 18, 30, 0) / 1000);
		expect(parseFileDateTime('31.12.1969 23:59:59')).toBe(-1);
	});

	it('round-trips timestamps', () => {
		for (const text of ['01.01.1970 00:00:00', '29.02.2024 23:59:59', '01.01.1678 00:00:00', '31.12.2261 23:59:59']) {
			expect(formatFileDateTime(parseFileDateTime(text)!)).toBe(text);
		}
	});

	it.each(['18.11.2026 24:00:00', '18.11.2026 18:30', '18.11.2026T18:30:00', '30.02.2026 00:00:00', '01.01.2300 10:00:00'])('rejects timestamp %j', (text) => {
		expect(parseFileDateTime(text)).toBeNull();
	});
});

describe('ids', () => {
	it('accepts canonical uint64 values', () => {
		expect(parseId('0')).toBe('0');
		expect(parseId('18446744073709551615')).toBe('18446744073709551615');
	});

	it.each(['18446744073709551616', '-1', '007', '', '1.0', ' 1', '1e3'])('rejects %j', (text) => {
		expect(parseId(text)).toBeNull();
	});

	it('compares numerically', () => {
		const ids = ['10', '9', '18446744073709551615', '100', '0'] as Id[];
		expect([...ids].sort(compareIds)).toEqual(['0', '9', '10', '100', '18446744073709551615']);
	});

	it('generates unique non-zero ids', () => {
		const taken = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			const id = newId(taken);
			expect(parseId(id)).toBe(id);
			expect(id).not.toBe('0');
			taken.add(id);
		}
		expect(taken.size).toBe(1000);
	});
});
