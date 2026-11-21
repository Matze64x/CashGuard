/** Recurring transactions in words, and the schedule's days as the editor shows and reads them. */
import type { Schedule } from '../core';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Monthly on the 1st, 8th and 15th", "Every 2 weeks on Mon and Fri", "Every 12 months on the 15th" */
export function describeSchedule({ unit, every, days }: Schedule): string {
	const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
	if (unit === 'week') return `${every === 1 ? 'Weekly' : `Every ${every} weeks`} on ${list(days.map((d) => WEEKDAYS[d - 1]!))}`;
	return `${every === 1 ? 'Monthly' : `Every ${every} months`} on the ${list(days.map(ordinal))}`;
}

/** Days of the month as typed: "1, 15" or "1 15" (any order, repeats ignored); null if invalid */
export function parseMonthDays(text: string): number[] | null {
	const parts = text.split(/[\s,;]+/).filter(Boolean);
	if (parts.length === 0 || !parts.every((p) => /^\d{1,2}$/.test(p))) return null;
	const days = [...new Set(parts.map(Number))].sort((a, b) => a - b);
	return days.every((d) => d >= 1 && d <= 31) ? days : null;
}
