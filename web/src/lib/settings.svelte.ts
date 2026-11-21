/**
 * Per-device preferences (not part of the data file). Kept in localStorage, which can be
 * unavailable (private windows, blocked storage): then the defaults apply and changes last until
 * the page is closed. Other tabs pick up changes through the `storage` event.
 */
import { DATE_STYLES, type DateStyle } from '../core';

const KEY = 'cashguard-settings-v1';

interface Values {
	dateStyle: DateStyle;
	/**
	 * The account whose balance a new transaction updates, by id (or by name, as stored before
	 * accounts had ids; see `findAccount`), or null. Per device: on the phone it's usually the card
	 * just paid with, on the computer none.
	 */
	balanceAccount: string | null;
	/** Desktop app: the file the data is backed up to, or null for none */
	backupPath: string | null;
}

const DEFAULTS: Values = { dateStyle: 'DD.MM.YYYY', balanceAccount: null, backupPath: null };

function load(): Values {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Values>;
		return {
			dateStyle: DATE_STYLES.includes(raw.dateStyle as DateStyle) ? raw.dateStyle! : DEFAULTS.dateStyle,
			balanceAccount: typeof raw.balanceAccount === 'string' ? raw.balanceAccount : null,
			backupPath: typeof raw.backupPath === 'string' && raw.backupPath !== '' ? raw.backupPath : null,
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

	get balanceAccount(): string | null {
		return this.#values.balanceAccount;
	}
	set balanceAccount(balanceAccount: string | null) {
		this.#set({ balanceAccount });
	}

	get backupPath(): string | null {
		return this.#values.backupPath;
	}
	set backupPath(backupPath: string | null) {
		this.#set({ backupPath });
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

/** The remembered account: by id, or by name as remembered before accounts had ids */
export function findAccount<A extends { id: string; name: string }>(accounts: readonly A[], remembered: string | null): A | undefined {
	if (remembered === null) return undefined;
	return accounts.find((a) => a.id === remembered) ?? accounts.find((a) => a.name === remembered);
}
