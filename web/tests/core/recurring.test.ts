import { describe, expect, it } from 'vitest';
import {
	addAccount,
	addDays,
	addMonths,
	daysBetween,
	daysInMonth,
	addRecurring,
	cents,
	confirmOccurrence,
	deleteRecurring,
	dueList,
	dueOccurrences,
	DUE_LIMIT,
	EditError,
	isValidSchedule,
	nextOccurrence,
	NO_CATEGORY,
	occurrences,
	skipOccurrence,
	skipOccurrencesThrough,
	updateRecurring,
	weekday,
	type CashGuardData,
	type CivilDate,
	type Id,
	type Recurring,
	type RecurringDraft,
	type Schedule,
	type UtcSeconds,
} from '../../src/core';
import { randomDocument } from './random-data';

const d = (text: string) => text as CivilDate;
const at = (seconds: number) => seconds as UtcSeconds;
const empty: CashGuardData = { categories: [], accounts: [], recurring: [], transactions: [] };
const template = (schedule: Schedule, fields: Partial<Recurring> = {}): Recurring => ({
	id: '1' as Id,
	description: 'Savings plan',
	categoryId: NO_CATEGORY,
	amount: null,
	accountId: null,
	schedule,
	start: d('2026-01-01'),
	end: null,
	handled: null,
	edited: at(0),
	...fields,
});
const monthly = (days: number[], every = 1) => ({ unit: 'month' as const, every, days });
const weekly = (days: number[], every = 1) => ({ unit: 'week' as const, every, days });

describe('occurrences', () => {
	it('monthly on several days, within the range given', () => {
		const savings = template(monthly([1, 8, 15, 22]));
		expect(occurrences(savings, d('2026-11-05'), d('2026-12-08'))).toEqual(['2026-11-08', '2026-11-15', '2026-11-22', '2026-12-01', '2026-12-08']);
		expect(occurrences(savings, d('2026-11-05'), d('2026-12-08'), 2)).toEqual(['2026-11-08', '2026-11-15']);
	});

	it("a day the month doesn't have falls on its last day, once", () => {
		const r = template(monthly([29, 30, 31]), { start: d('2027-01-01') });
		expect(occurrences(r, d('2027-01-01'), d('2027-04-30'))).toEqual(['2027-01-29', '2027-01-30', '2027-01-31', '2027-02-28', '2027-03-29', '2027-03-30', '2027-03-31', '2027-04-29', '2027-04-30']);
		// a leap year
		expect(occurrences(template(monthly([31]), { start: d('2028-02-01') }), d('2028-02-01'), d('2028-02-29'))).toEqual(['2028-02-29']);
	});

	it('every N months counts from the start month; yearly is every 12', () => {
		const quarterly = template(monthly([15], 3), { start: d('2026-02-10') });
		expect(occurrences(quarterly, d('2026-01-01'), d('2027-03-01'))).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15', '2027-02-15']);
		// far after the start, it doesn't walk all months from there
		expect(occurrences(template(monthly([1], 12), { start: d('1700-03-01') }), d('2026-01-01'), d('2027-12-31'))).toEqual(['2026-03-01', '2027-03-01']);
	});

	it('not before the start or after the end', () => {
		const r = template(monthly([1, 15]), { start: d('2026-01-10'), end: d('2026-03-01') });
		expect(occurrences(r, d('2025-01-01'), d('2030-01-01'))).toEqual(['2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01']);
	});

	it('weekly on weekdays, every N weeks counted from the start week', () => {
		expect(weekday(d('2026-11-23'))).toBe(1); // a Monday
		expect(weekday(d('2026-11-29'))).toBe(7);
		// starts on a Wednesday: that week's Monday is before the start, its Friday counts
		const r = template(weekly([1, 5], 2), { start: d('2026-11-25') });
		expect(occurrences(r, d('2026-11-01'), d('2026-12-31'))).toEqual(['2026-11-27', '2026-12-07', '2026-12-11', '2026-12-21', '2026-12-25']);
		expect(occurrences(r, d('2026-12-08'), d('2026-12-21'))).toEqual(['2026-12-11', '2026-12-21']);
	});

	it('stops at the end of the supported years', () => {
		expect(occurrences(template(monthly([31]), { start: d('9999-11-01') }), d('9999-01-01'), d('9999-12-31'))).toEqual(['9999-11-30', '9999-12-31']);
		expect(occurrences(template(weekly([7]), { start: d('9999-12-20') }), d('9999-12-01'), d('9999-12-31'))).toEqual(['9999-12-26']);
		expect(nextOccurrence(template(weekly([7]), { start: d('9999-12-20'), handled: d('9999-12-26') }))).toBeNull();
		// and at its beginning, in a week that began before it (1000-01-01 is a Wednesday)
		expect(occurrences(template(weekly([1, 3]), { start: d('1000-01-01') }), d('1000-01-01'), d('1000-01-10'))).toEqual(['1000-01-01', '1000-01-06', '1000-01-08']);
	});
});

describe('due', () => {
	const savings = template(monthly([1, 8, 15, 22]), { handled: d('2026-11-08') });

	it('lists what is not handled yet, up to today', () => {
		expect(dueOccurrences(savings, d('2026-11-21')).dates).toEqual(['2026-11-15']);
		expect(dueOccurrences(savings, d('2026-11-22')).dates).toEqual(['2026-11-15', '2026-11-22']);
		expect(dueOccurrences({ ...savings, handled: null }, d('2026-01-08')).dates).toEqual(['2026-01-01', '2026-01-08']);
		expect(nextOccurrence(savings)).toBe('2026-11-15');
		expect(nextOccurrence({ ...savings, handled: d('2026-11-30') })).toBe('2026-12-01');
		expect(nextOccurrence({ ...savings, end: d('2026-11-14') })).toBeNull();
	});

	it('lists at most DUE_LIMIT after a long break', () => {
		const due = dueOccurrences(template(weekly([1, 2, 3, 4, 5, 6, 7])), d('2027-01-01'));
		expect(due.dates).toHaveLength(DUE_LIMIT);
		expect(due.more).toBe(true);
	});

	it('orders templates by their oldest due occurrence', () => {
		const rent = template(monthly([1]), { id: '2' as Id, description: 'Rent', handled: d('2026-10-01') });
		const data = { ...empty, recurring: [savings, rent, template(monthly([1]), { id: '3' as Id, start: d('2027-01-01') })] };
		expect(dueList(data, d('2026-11-21')).map((x) => [x.recurring.description, x.dates])).toEqual([
			['Rent', ['2026-11-01']],
			['Savings plan', ['2026-11-15']],
		]);
	});

	it('checks schedules like the file format', () => {
		expect(isValidSchedule(monthly([1, 31]))).toBe(true);
		expect(isValidSchedule(monthly([]))).toBe(false);
		expect(isValidSchedule(monthly([8, 1]))).toBe(false);
		expect(isValidSchedule(weekly([8]))).toBe(false);
		expect(isValidSchedule(monthly([1], 0))).toBe(false);
		expect(isValidSchedule(monthly([1], 1000))).toBe(false);
	});
});

describe('editing recurring transactions', () => {
	const draft: RecurringDraft = { description: 'Savings plan', categoryId: NO_CATEGORY, amount: null, accountId: null, schedule: monthly([1, 8]), start: d('2026-11-01'), end: null };

	it('adds, changes (stamping only the template) and deletes', () => {
		const { data, id } = addRecurring(empty, draft, at(1));
		expect(data.recurring).toEqual([{ id, ...draft, handled: null, edited: 1 }]);
		expect(updateRecurring(data, id, { ...draft }, at(2))).toBe(data);
		const changed = updateRecurring(data, id, { ...draft, amount: cents(-5000) }, at(2));
		expect(changed.recurring[0]).toMatchObject({ amount: -5000, edited: 2 });
		expect(deleteRecurring(changed, id).recurring).toEqual([]);
		expect(() => addRecurring(empty, { ...draft, categoryId: '9' as Id }, at(1))).toThrow(EditError);
		expect(() => addRecurring(empty, { ...draft, schedule: monthly([]) }, at(1))).toThrow(EditError);
		expect(() => addRecurring(empty, { ...draft, end: d('2026-10-01') }, at(1))).toThrow(EditError);
		expect(() => updateRecurring(empty, id, draft, at(2))).toThrow(EditError);
	});

	it('confirms and skips occurrences in order, without stamping the template', () => {
		const withAccount = addAccount(empty, 'Depot', cents(0), at(0));
		const account = withAccount.accounts[0]!.id;
		const { data, id } = addRecurring(withAccount, { ...draft, accountId: account }, at(1));
		const entry = { date: d('2026-11-02'), description: 'Savings plan', categoryId: NO_CATEGORY, amount: cents(-4980) };
		// not the next one: refused
		expect(() => confirmOccurrence(data, id, d('2026-11-08'), entry, account, at(5))).toThrow('Handle the earlier occurrences of “Savings plan” first.');
		const confirmed = confirmOccurrence(data, id, d('2026-11-01'), entry, account, at(5));
		expect(confirmed.data.recurring[0]).toMatchObject({ handled: '2026-11-01', edited: 1 });
		expect(confirmed.data.transactions).toEqual([expect.objectContaining({ id: confirmed.transactionId, date: '2026-11-02', amount: -4980 })]);
		expect(confirmed.data.accounts[0]).toMatchObject({ amount: -4980, edited: 5 });
		// without the account
		expect(confirmOccurrence(data, id, d('2026-11-01'), entry, null, at(5)).data.accounts).toEqual(data.accounts);
		const skipped = skipOccurrence(confirmed.data, id, d('2026-11-08'));
		expect(skipped.recurring[0]).toMatchObject({ handled: '2026-11-08', edited: 1 });
		expect(skipped.transactions).toHaveLength(1);
		expect(nextOccurrence(skipped.recurring[0]!)).toBe('2026-12-01');
	});
});

describe('occurrences (random templates)', () => {
	it('match the schedule, and splitting the range changes nothing', () => {
		let checked = 0;
		for (let seed = 1; seed <= 200; seed++) {
			for (const r of randomDocument(seed).recurring) {
				const from = r.start;
				const to = laterOrNull(from, 400);
				if (!to) continue;
				const all = occurrences(r, from, to);
				const middle = laterOrNull(from, 150)!;
				expect([...occurrences(r, from, middle), ...occurrences(r, laterOrNull(middle, 1)!, to)]).toEqual(all);
				expect(all).toEqual([...all].sort());
				for (const date of all) {
					expect(date >= r.start && (r.end === null || date <= r.end)).toBe(true);
					if (r.schedule.unit === 'week') expect(r.schedule.days).toContain(weekday(date));
					else {
						const day = Number(date.slice(8));
						const last = Number(addDays(addMonths(date.slice(0, 8).concat('01') as CivilDate, 1), -1).slice(8));
						expect(r.schedule.days.includes(day) || (day === last && r.schedule.days.some((x) => x > last))).toBe(true);
					}
					checked++;
				}
			}
		}
		expect(checked).toBeGreaterThan(500);
	});
});

function laterOrNull(date: CivilDate, days: number): CivilDate | null {
	try {
		return addDays(date, days);
	} catch {
		return null;
	}
}

describe('editing recurring transactions: careful with what comes in', () => {
	const draft: RecurringDraft = { description: 'Rent', categoryId: NO_CATEGORY, amount: cents(-90000), accountId: null, schedule: monthly([1]), start: d('2026-01-01'), end: null };
	const { data, id } = addRecurring(empty, draft, at(1));
	const handled = skipOccurrence(data, id, d('2026-01-01'));

	it('takes only the template from a whole recurring transaction passed as the draft', () => {
		const stale = data.recurring[0]!; // as an editor might hold it: not handled yet
		// unchanged: nothing to do, even though `handled` differs
		expect(updateRecurring(handled, id, stale, at(2))).toBe(handled);
		// changed: the template changes, how far it's handled stays
		expect(updateRecurring(handled, id, { ...stale, description: 'Flat' }, at(2)).recurring[0]).toMatchObject({ id, description: 'Flat', handled: '2026-01-01', edited: 2 });
		// a copy gets its own id and starts unhandled
		const copy = addRecurring(handled, handled.recurring[0]!, at(3));
		expect(copy.data.recurring.map((r) => [r.id, r.handled])).toEqual([
			[id, '2026-01-01'],
			[copy.id, null],
		]);
		expect(copy.id).not.toBe(id);
	});

	it('copies the days, so changing the draft later changes nothing', () => {
		const days = [1, 15];
		const updated = updateRecurring(data, id, { ...draft, schedule: { unit: 'month', every: 1, days } }, at(2));
		days.push(20);
		expect(updated.recurring[0]!.schedule.days).toEqual([1, 15]);
	});

	it('refuses invalid dates', () => {
		expect(() => addRecurring(empty, { ...draft, start: d('2026-02-30') }, at(1))).toThrow('Invalid date');
		expect(() => updateRecurring(data, id, { ...draft, end: d('10000-01-01') }, at(1))).toThrow('Invalid date');
	});

	it('skips a backlog at once', () => {
		const skipped = skipOccurrencesThrough(data, id, d('2026-04-01'));
		expect(skipped.recurring[0]).toMatchObject({ handled: '2026-04-01', edited: 1 });
		expect(nextOccurrence(skipped.recurring[0]!)).toBe('2026-05-01');
		// only through an occurrence, not before the next one
		expect(() => skipOccurrencesThrough(data, id, d('2026-04-02'))).toThrow('Handle the earlier occurrences of “Rent” first.');
		expect(() => skipOccurrencesThrough(skipped, id, d('2026-03-01'))).toThrow('already entered or skipped');
	});

	it('says why an occurrence can’t be handled', () => {
		// already handled (e.g. a second Enter, or another device did it)
		expect(() => skipOccurrence(handled, id, d('2026-01-01'))).toThrow('This occurrence of “Rent” is already entered or skipped.');
		// the schedule changed meanwhile (the 1st of February was shown, now it's from the 15th of February on)
		const moved = updateRecurring(handled, id, { ...draft, schedule: monthly([15]), start: d('2026-02-10') }, at(2));
		expect(() => skipOccurrence(moved, id, d('2026-02-01'))).toThrow('This is no longer an occurrence of “Rent”; its schedule changed.');
		// moving the day alone makes 15 January due (after paying on the 1st): one skip
		expect(nextOccurrence(updateRecurring(handled, id, { ...draft, schedule: monthly([15]) }, at(2)).recurring[0]!)).toBe('2026-01-15');
		expect(() => skipOccurrence(handled, id, d('2026-03-01'))).toThrow('Handle the earlier occurrences of “Rent” first.');
		const ended = updateRecurring(handled, id, { ...draft, end: d('2026-01-01') }, at(2));
		expect(() => skipOccurrence(ended, id, d('2026-02-01'))).toThrow('“Rent” has no more occurrences.');
		// paying ahead is fine
		expect(skipOccurrence(handled, id, d('2026-02-01')).recurring[0]!.handled).toBe('2026-02-01');
		// unknown ones
		for (const change of [() => skipOccurrence(data, '9' as Id, d('2026-01-01')), () => deleteRecurring(data, '9' as Id)]) expect(change).toThrow(EditError);
		const entry = { date: d('2026-01-01'), description: 'Rent', categoryId: NO_CATEGORY, amount: cents(-90000) };
		expect(() => confirmOccurrence(data, id, d('2026-01-01'), entry, '9' as Id, at(2))).toThrow('The account no longer exists');
	});
});

describe('occurrences, more edges', () => {
	it('the next one after a handled day that is no occurrence, or before the start', () => {
		const r = template(monthly([10]), { start: d('2026-03-01') });
		expect(nextOccurrence({ ...r, handled: d('2026-01-20') })).toBe('2026-03-10');
		expect(nextOccurrence({ ...r, handled: d('2026-04-05') })).toBe('2026-04-10');
	});

	it('a collapsed day with a limit, and from that very day', () => {
		const r = template(monthly([28, 30, 31]), { start: d('2027-02-01') });
		expect(occurrences(r, d('2027-02-01'), d('2027-03-31'), 2)).toEqual(['2027-02-28', '2027-03-28']);
		expect(occurrences(r, d('2027-02-28'), d('2027-03-28'))).toEqual(['2027-02-28', '2027-03-28']);
	});

	it('agree with walking day by day (random schedules, ranges and limits)', () => {
		// the slow obvious way: is this day an occurrence?
		const isOccurrence = (r: Recurring, date: CivilDate) => {
			const { year, month, day } = { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8)) };
			const { unit, every, days } = r.schedule;
			if (date < r.start || (r.end !== null && date > r.end)) return false;
			if (unit === 'week') {
				const weeks = Math.floor((daysBetween(addDays(r.start, 1 - weekday(r.start)), date)) / 7);
				return weeks % every === 0 && days.includes(weekday(date));
			}
			const months = year * 12 + month - (Number(r.start.slice(0, 4)) * 12 + Number(r.start.slice(5, 7)));
			const last = daysInMonth(year, month);
			return months % every === 0 && (days.includes(day) || (day === last && days.some((x) => x > last)));
		};
		let seed = 7;
		const random = (n: number) => ((seed = (seed * 48271) % 2147483647), seed % n);
		for (let i = 0; i < 300; i++) {
			const unit = random(2) === 0 ? 'month' : 'week';
			const days = [...new Set(Array.from({ length: 1 + random(3) }, () => 1 + random(unit === 'month' ? 31 : 7)))].sort((a, b) => a - b);
			const start = addDays(d('2019-01-01'), random(1500));
			const r = template({ unit, every: [1, 2, 3, 5, 12][random(5)]!, days }, { start, end: random(3) === 0 ? addDays(start, random(900)) : null });
			const from = addDays(d('2018-06-01'), random(2500));
			const to = addDays(from, random(400));
			const limit = random(4) === 0 ? 1 + random(5) : Infinity;
			const expected: CivilDate[] = [];
			for (let day = from; day <= to && expected.length < limit; day = addDays(day, 1)) if (isOccurrence(r, day)) expected.push(day);
			expect(occurrences(r, from, to, limit), JSON.stringify({ r, from, to, limit })).toEqual(expected);
		}
	});
});
