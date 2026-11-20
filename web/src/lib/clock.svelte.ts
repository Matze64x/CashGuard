/**
 * Today's date, kept current: views stay mounted for as long as the app is open, so anything that
 * depends on "today" (this month, the last 12 months, …) reads it from here to follow a new day.
 */
import { today } from '../core';

class Clock {
	today = $state(today());

	constructor() {
		setInterval(() => {
			const now = today();
			if (now !== this.today) this.today = now;
		}, 60_000);
	}
}

export const clock = new Clock();
