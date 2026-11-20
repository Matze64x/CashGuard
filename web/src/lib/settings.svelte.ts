/**
 * Per-device preferences (not part of the data file). Kept in localStorage, which can be
 * unavailable (private windows, blocked storage): then the defaults apply and changes last until
 * the page is closed. Other tabs pick up changes through the `storage` event.
 */
import { DATE_STYLES, type DateStyle } from '../core';

const KEY = 'cashguard-settings-v1';

interface Values {
	dateStyle: DateStyle;
}

const DEFAULTS: Values = { dateStyle: 'DD.MM.YYYY' };

function load(): Values {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Values>;
		return {
			dateStyle: DATE_STYLES.includes(raw.dateStyle as DateStyle) ? raw.dateStyle! : DEFAULTS.dateStyle,
		};
	} catch {
		return { ...DEFAULTS };
	}
}

class Settings {
	#values = $state.raw<Values>(load());

	constructor() {
		if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === KEY && (this.#values = load()));
	}

	get dateStyle(): DateStyle {
		return this.#values.dateStyle;
	}
	set dateStyle(dateStyle: DateStyle) {
		this.#set({ dateStyle });
	}

	#set(changes: Partial<Values>) {
		this.#values = { ...this.#values, ...changes };
		try {
			localStorage.setItem(KEY, JSON.stringify(this.#values));
		} catch {
			// not stored; still applies until the page is closed
		}
	}
}

export const settings = new Settings();
