import type { Brand } from './brand';

/**
 * A calendar date without time or timezone, stored as "YYYY-MM-DD" so that string comparison
 * is chronological. Deliberately not a JS `Date`, which would shift with the local timezone.
 */
export type CivilDate = Brand<string, 'CivilDate'>;

/** A point in time as whole seconds since the Unix epoch, UTC (like the C++ client's `Added`/`Edited`). */
export type UtcSeconds = Brand<number, 'UtcSeconds'>;

/**
 * Years both clients can represent. The C++ client converts dates and timestamps to
 * `std::chrono::system_clock` (int64 nanoseconds: 21.09.1677 .. 11.04.2262) and silently
 * corrupts anything outside, so whole years within that range are allowed.
 */
export const MIN_YEAR = 1678;
export const MAX_YEAR = 2261;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidDate(year: number, month: number, day: number): boolean {
	if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return false;
	if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1) return false;
	return day <= (month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!);
}

/** The number of days in a month (1–12) */
export function daysInMonth(year: number, month: number): number {
	return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

function pad(value: number, width = 2): string {
	return value.toString().padStart(width, '0');
}

function makeDate(year: number, month: number, day: number): CivilDate {
	return `${year}-${pad(month)}-${pad(day)}` as CivilDate;
}

export function civilDate(year: number, month: number, day: number): CivilDate {
	if (!isValidDate(year, month, day)) throw new RangeError(`Invalid date: ${year}-${month}-${day}`);
	return makeDate(year, month, day);
}

export function dateParts(date: CivilDate): { year: number; month: number; day: number } {
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	return { year, month, day };
}

const FILE_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const FILE_DATE_TIME = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parses the file format "DD.MM.YYYY". */
export function parseFileDate(text: string): CivilDate | null {
	const m = FILE_DATE.exec(text);
	if (!m) return null;
	const [day, month, year] = m.slice(1).map(Number) as [number, number, number];
	return isValidDate(year, month, day) ? makeDate(year, month, day) : null;
}

export function formatFileDate(date: CivilDate): string {
	const { year, month, day } = dateParts(date);
	return `${pad(day)}.${pad(month)}.${year}`;
}

/** Parses the file format "DD.MM.YYYY HH:MM:SS" (UTC). */
export function parseFileDateTime(text: string): UtcSeconds | null {
	const m = FILE_DATE_TIME.exec(text);
	if (!m) return null;
	const [day, month, year, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
	if (!isValidDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
	return (Date.UTC(year, month - 1, day, hour, minute, second) / 1000) as UtcSeconds;
}

export function formatFileDateTime(time: UtcSeconds): string {
	const d = new Date(time * 1000);
	return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function nowUtcSeconds(): UtcSeconds {
	return Math.floor(Date.now() / 1000) as UtcSeconds;
}

/** Today's date in the user's local timezone (what "today" means to the user). */
export function today(): CivilDate {
	const d = new Date();
	return civilDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The date `days` days later (or earlier, if negative). Throws outside the supported years. */
export function addDays(date: CivilDate, days: number): CivilDate {
	const { year, month, day } = dateParts(date);
	const d = new Date(Date.UTC(year, month - 1, day + days));
	return civilDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The same day `months` months later (or earlier), clamped to the month's end (31.01. + 1 → 28./29.02.). */
export function addMonths(date: CivilDate, months: number): CivilDate {
	const { year, month, day } = dateParts(date);
	const index = year * 12 + (month - 1) + months;
	const y = Math.floor(index / 12);
	const m = index - y * 12 + 1;
	const last = m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
	return civilDate(y, m, Math.min(day, last));
}

/** How dates are shown and typed (a user setting; the file always uses DD.MM.YYYY). */
export type DateStyle = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export const DATE_STYLES: readonly DateStyle[] = ['DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

export function formatDateAs(date: CivilDate, style: DateStyle): string {
	const { year, month, day } = dateParts(date);
	const [d, m, y] = [pad(day), pad(month), String(year)];
	switch (style) {
		case 'DD.MM.YYYY':
			return `${d}.${m}.${y}`;
		case 'DD/MM/YYYY':
			return `${d}/${m}/${y}`;
		case 'MM/DD/YYYY':
			return `${m}/${d}/${y}`;
		case 'YYYY-MM-DD':
			return `${y}-${m}-${d}`;
	}
}

/**
 * Parses a typed date in the given style. Any of . / - or space separate the parts, and parts may
 * be left out from the end of the date: "5" is the 5th of `reference`'s month, "5.3" the 5th of March
 * in `reference`'s year (for DD.MM.YYYY). Two-digit years are 20xx. A full "YYYY-MM-DD" is always
 * accepted. Returns null for anything else, including dates outside the supported years.
 */
export function parseDateInput(text: string, style: DateStyle, reference: CivilDate): CivilDate | null {
	const parts = text.trim().replace(/[./\-\s]+$/, '').split(/[./\-\s]+/);
	if (parts.length > 3 || !parts.every((p) => /^\d{1,4}$/.test(p))) return null;
	let day: string | undefined, month: string | undefined, year: string | undefined;
	if (parts.length === 3 && parts[0]!.length === 4) [year, month, day] = parts;
	else if (style === 'YYYY-MM-DD') [day, month, year] = [...parts].reverse(); // "5" is the day, "3-5" month and day
	else if (style === 'MM/DD/YYYY') [month, day, year] = parts.length === 1 ? [undefined, parts[0]] : parts;
	else [day, month, year] = parts;
	const ref = dateParts(reference);
	const y = year === undefined ? ref.year : year.length <= 2 ? 2000 + Number(year) : year.length === 4 ? Number(year) : NaN;
	const m = month === undefined ? ref.month : Number(month);
	const d = Number(day);
	return isValidDate(y, m, d) ? makeDate(y, m, d) : null;
}
