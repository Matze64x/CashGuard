/**
 * The filter shared by every view (the transaction list and the charts), so they always show the
 * same entries. Kept for the session only.
 */
import { NO_FILTER, type Filter } from '../core';

class FilterState {
	/** raw: replaced as a whole, never mutated */
	current = $state.raw<Filter>(NO_FILTER);

	set(changes: Partial<Filter>): void {
		this.current = { ...this.current, ...changes };
	}

	/** Removes every filter except the search text (which has its own field) */
	clearExceptText(): void {
		this.current = { ...NO_FILTER, text: this.current.text };
	}
}

export const filter = new FilterState();
