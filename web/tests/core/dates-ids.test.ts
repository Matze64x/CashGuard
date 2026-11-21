import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMonths,
	civilDate,
	DATE_STYLES,
	formatDateAs,
	MAX_YEAR,
	parseDateInput,
	type CivilDate,
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
		expect(parseFileDate('01.01.1000')).toBe('1000-01-01');
		expect(parseFileDate('31.12.9999')).toBe('9999-12-31');
		expect(parseFileDate('29.02.2400')).toBe('2400-02-29');
	});

	// years below 1000 aren't allowed (JS reads years below 100 as 1900 + year); the file has 4-digit years
	it.each(['29.02.2023', '29.02.1900', '29.02.2100', '31.04.2026', '00.01.2026', '1.1.2026', '01.13.2026', '31.12.0999', '01.01.10000', '01.01.0005', '2026-01-01'])('rejects date %j', (text) => {
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
		for (const text of ['01.01.1970 00:00:00', '29.02.2024 23:59:59', '01.01.1000 00:00:00', '31.12.9999 23:59:59', '01.01.1678 00:00:00']) {
			expect(formatFileDateTime(parseFileDateTime(text)!)).toBe(text);
		}
	});

	it.each(['18.11.2026 24:00:00', '18.11.2026 18:30', '18.11.2026T18:30:00', '30.02.2026 00:00:00', '31.12.0999 23:59:59', '01.01.10000 10:00:00'])('rejects timestamp %j', (text) => {
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

describe('date arithmetic', () => {
	const d = (text: string) => text as CivilDate;
	it('adds days across months and years', () => {
		expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
		expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29');
	});
	it('adds months, clamped to the end of the month', () => {
		expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
		expect(addMonths(d('2024-01-31'), 1)).toBe('2024-02-29');
		expect(addMonths(d('2026-01-15'), -1)).toBe('2025-12-15');
	});
	it('refuses to leave the supported years', () => {
		expect(() => addDays(d(`${MAX_YEAR}-12-31`), 1)).toThrow(RangeError);
	});
});

describe('typed dates', () => {
	const ref = '2026-11-20' as CivilDate;
	it('formats in every style', () => {
		const date = '2026-03-05' as CivilDate;
		expect(DATE_STYLES.map((s) => formatDateAs(date, s))).toEqual(['05.03.2026', '05/03/2026', '03/05/2026', '2026-03-05']);
	});
	it('round-trips every style', () => {
		for (const style of DATE_STYLES) expect(parseDateInput(formatDateAs('2001-02-03' as CivilDate, style), style, ref)).toBe('2001-02-03');
	});
	it('fills in left-out parts from the reference date', () => {
		expect(parseDateInput('5', 'DD.MM.YYYY', ref)).toBe('2026-11-05');
		expect(parseDateInput('5.3.', 'DD.MM.YYYY', ref)).toBe('2026-03-05');
		expect(parseDateInput('5.3.25', 'DD.MM.YYYY', ref)).toBe('2025-03-05');
		expect(parseDateInput('3/5', 'MM/DD/YYYY', ref)).toBe('2026-03-05');
		expect(parseDateInput('5', 'MM/DD/YYYY', ref)).toBe('2026-11-05');
		expect(parseDateInput('3-5', 'YYYY-MM-DD', ref)).toBe('2026-03-05');
	});
	it('always accepts a full ISO date', () => {
		expect(parseDateInput('2025-03-05', 'MM/DD/YYYY', ref)).toBe('2025-03-05');
	});
	it('rejects invalid input', () => {
		for (const text of ['', 'today', '31.2.2026', '1.13.2026', '1.1.300', '1.1.10000', '1.1.2026.1', '5,3'])
			expect(parseDateInput(text, 'DD.MM.YYYY', ref), text).toBeNull();
	});
});
