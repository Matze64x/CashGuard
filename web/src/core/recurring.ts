/**
 * When recurring transactions come, and which of them are due. A template's occurrences are
 * handled (entered or skipped) strictly in order: `handled` is the last one done, so the next one is
 * always the first occurrence after it.
 */
import { addDays, civilDate, dateParts, daysInMonth, MAX_YEAR, type CivilDate } from './dates';
import { compareIds } from './ids';
import type { CashGuardData, Recurring, Schedule } from './model';

const LAST_DAY = `${MAX_YEAR}-12-31` as CivilDate;

/** 1 = Monday … 7 = Sunday */
export function weekday(date: CivilDate): number {
	const { year, month, day } = dateParts(date);
	return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

const monthIndex = (date: CivilDate) => {
	const { year, month } = dateParts(date);
	return year * 12 + month - 1;
};

/** The date `days` later, or null beyond the supported years */
function laterBy(date: CivilDate, days: number): CivilDate | null {
	try {
		return addDays(date, days);
	} catch {
		return null;
	}
}

/**
 * A template's occurrences from `from` through `to` (both included, and within its start and end),
 * in order, at most `limit`. Monthly: every `every` months counted from the start's month, a day
 * the month doesn't have on its last day (the 30th and 31st of February are one occurrence).
 * Weekly: every `every` weeks counted from the start's week (Monday to Sunday).
 */
export function occurrences(r: Pick<Recurring, 'schedule' | 'start' | 'end'>, from: CivilDate, to: CivilDate, limit = Infinity): CivilDate[] {
	const lo = from > r.start ? from : r.start;
	const hi = r.end !== null && r.end < to ? r.end : to;
	const found: CivilDate[] = [];
	if (lo > hi || limit <= 0) return found;
	const { unit, every, days } = r.schedule;
	// each step is one period (month or week) with occurrences; start at the first one that can reach `lo`
	if (unit === 'month') {
		const first = monthIndex(r.start);
		for (let k = Math.max(0, Math.floor((monthIndex(lo) - first) / every)); ; k++) {
			const index = first + k * every;
			const year = Math.floor(index / 12);
			const month = (index % 12) + 1;
			if (year > MAX_YEAR || index > monthIndex(hi)) return found;
			const last = daysInMonth(year, month);
			for (const day of days) {
				const date = civilDate(year, month, Math.min(day, last));
				if (date < lo || date === found.at(-1)) continue;
				if (date > hi) return found;
				found.push(date);
				if (found.length >= limit) return found;
			}
		}
	}
	// as day numbers: the start week's Monday may be before the supported years
	const [first, last] = [dayNumber(lo), dayNumber(hi)];
	const monday = dayNumber(r.start) - (weekday(r.start) - 1);
	for (let k = Math.max(0, Math.floor((first - monday) / (7 * every))); ; k++) {
		const week = monday + k * 7 * every;
		if (week > last) return found;
		for (const day of days) {
			const n = week + day - 1;
			if (n > last) return found;
			if (n < first) continue;
			found.push(addDays(lo, n - first));
			if (found.length >= limit) return found;
		}
	}
}

/** Days since 1970-01-01 */
function dayNumber(date: CivilDate): number {
	const { year, month, day } = dateParts(date);
	return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** The template's next occurrence to handle (the first after `handled`), whenever it is; null if there's none */
export function nextOccurrence(r: Recurring): CivilDate | null {
	const from = r.handled === null ? r.start : laterBy(r.handled, 1);
	return from === null ? null : (occurrences(r, from, LAST_DAY, 1)[0] ?? null);
}

export interface Due {
	readonly recurring: Recurring;
	/** The occurrences not handled yet up to today, oldest first (only the first can be handled now) */
	readonly dates: readonly CivilDate[];
	/** Whether more are due than listed */
	readonly more: boolean;
}

/** Due occurrences are listed up to this many per template (e.g. after a long break) */
export const DUE_LIMIT = 50;

/** A template's occurrences that are due (not handled yet, up to today) */
export function dueOccurrences(r: Recurring, today: CivilDate): Due {
	const from = r.handled === null ? r.start : laterBy(r.handled, 1);
	const dates = from === null ? [] : occurrences(r, from, today, DUE_LIMIT + 1);
	return { recurring: r, dates: dates.slice(0, DUE_LIMIT), more: dates.length > DUE_LIMIT };
}

/** The templates with due occurrences, the one due longest first (then by id, the same on every device) */
export function dueList(data: CashGuardData, today: CivilDate): Due[] {
	return data.recurring
		.map((r) => dueOccurrences(r, today))
		.filter((d) => d.dates.length > 0)
		.sort((a, b) => (a.dates[0]! < b.dates[0]! ? -1 : a.dates[0]! > b.dates[0]! ? 1 : compareIds(a.recurring.id, b.recurring.id)));
}

/** Whether a schedule is valid (as the file format requires) */
export function isValidSchedule({ unit, every, days }: Schedule): boolean {
	const last = unit === 'week' ? 7 : 31;
	return (
		(unit === 'month' || unit === 'week') &&
		Number.isInteger(every) &&
		every >= 1 &&
		every <= 999 &&
		days.length > 0 &&
		days.every((d, i) => Number.isInteger(d) && d >= 1 && d <= last && (i === 0 || d > days[i - 1]!))
	);
}
