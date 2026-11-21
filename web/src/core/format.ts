/**
 * Reading and writing the CashGuard file format (shared with the C++ client).
 *
 * The writer reproduces the C++ client's output (rapidjson PrettyWriter) byte for byte, so a file
 * can be loaded and saved by either client without spurious diffs. All values are JSON strings.
 */
import { formatFileDate, formatFileDateTime, MAX_YEAR, MIN_YEAR, parseFileDate, parseFileDateTime } from './dates';
import { legacyAccountIds, NO_CATEGORY, parseId, type Id } from './ids';
import { formatAmount, parseAmount } from './money';
import { normalizeGroup, sortNewestFirst, type Account, type CashGuardData, type Category, type Recurring, type Transaction } from './model';

export const FORMAT_VERSION = 'cgt_0.6.0';
/** The version before account ids: still read (accounts get ids from their names, see `legacyAccountIds`) */
export const LEGACY_FORMAT_VERSION = 'cgt_0.4.0';
/** The versions still read: before account ids, before recurring transactions, and the current one */
const READABLE_VERSIONS = [LEGACY_FORMAT_VERSION, 'cgt_0.5.0', FORMAT_VERSION];

export interface Issue {
	/** Location in the file, e.g. `Transactions[3].Transactions[1].Amount` */
	readonly path: string;
	readonly message: string;
}

export type ParseResult =
	| { readonly ok: true; readonly data: CashGuardData; readonly warnings: readonly Issue[] }
	| { readonly ok: false; readonly errors: readonly Issue[]; readonly warnings: readonly Issue[] };

const TRANSACTION_KEYS = ['ID', 'Date', 'Category', 'Amount', 'Description', 'Added', 'Edited', 'Transactions'];
const RECURRING_KEYS = ['ID', 'Description', 'Category', 'Amount', 'Account', 'Every', 'Unit', 'Days', 'Start', 'End', 'Handled', 'Edited'];
const EVERY_PATTERN = /^[1-9]\d{0,2}$/;
/** Days ascending, without repeats or spaces: "1,8,15,22" */
const DAYS_PATTERN = /^[1-9]\d?(,[1-9]\d?)*$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{8}$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const DATE_FORMAT = `date (expected DD.MM.YYYY, years ${MIN_YEAR}–${MAX_YEAR})`;
const TIMESTAMP_FORMAT = `timestamp (expected DD.MM.YYYY HH:MM:SS, years ${MIN_YEAR}–${MAX_YEAR})`;

type JsonObject = { readonly [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function join(path: string, key: string): string {
	return path ? `${path}.${key}` : key;
}

class Parser {
	readonly errors: Issue[] = [];
	readonly warnings: Issue[] = [];
	readonly categoryIds = new Set<Id>([NO_CATEGORY]);
	readonly transactionIds = new Set<Id>();
	readonly accountIds = new Set<Id>();
	readonly recurringIds = new Set<Id>();
	/** Reading a file from before account ids (`LEGACY_FORMAT_VERSION`) */
	legacy = false;

	error(path: string, message: string): null {
		this.errors.push({ path, message });
		return null;
	}

	object(value: unknown, path: string, knownKeys: readonly string[]): JsonObject | null {
		if (!isObject(value)) return this.error(path, 'Must be an object');
		for (const key of Object.keys(value)) {
			if (!knownKeys.includes(key)) this.warnings.push({ path: join(path, key), message: 'Unknown key, it will be dropped on save' });
		}
		return value;
	}

	string(object: JsonObject, key: string, path: string): string | null {
		const value = object[key];
		if (typeof value === 'string') {
			// the C++ client reads strings as C strings and would cut them off here
			if (value.includes('\0')) return this.error(join(path, key), 'Must not contain a NUL character');
			// half of a UTF-16 pair (only possible as an escape): not text, and the C++ client refuses the file
			if (LONE_SURROGATE.test(value)) return this.error(join(path, key), 'Must not contain an invalid character (a lone surrogate escape)');
			return value;
		}
		return this.error(join(path, key), value === undefined ? 'Missing' : 'Must be a string');
	}

	array(object: JsonObject, key: string, path: string): readonly unknown[] {
		const value = object[key];
		if (Array.isArray(value)) return value;
		this.error(join(path, key), value === undefined ? 'Missing' : 'Must be an array');
		return [];
	}

	field<T>(object: JsonObject, key: string, path: string, parse: (text: string) => T | null, what: string): T | null {
		const text = this.string(object, key, path);
		if (text === null) return null;
		return parse(text) ?? this.error(join(path, key), `Invalid ${what}: "${text}"`);
	}

	category(value: unknown, path: string): Category | null {
		const object = this.object(value, path, ['ID', 'Name', 'Color']);
		if (!object) return null;
		const id = this.field(object, 'ID', path, parseId, 'id');
		const name = this.string(object, 'Name', path);
		const color = this.field(object, 'Color', path, (t) => (COLOR_PATTERN.test(t) ? t.toUpperCase() : null), 'color (expected #RRGGBBAA)');
		if (id === NO_CATEGORY) return this.error(join(path, 'ID'), 'Category id 0 is reserved for "no category"');
		if (id !== null && this.categoryIds.has(id)) return this.error(join(path, 'ID'), `Duplicate category id ${id}`);
		if (id === null || name === null || color === null) return null;
		this.categoryIds.add(id);
		return { id, name, color };
	}

	/** In a legacy file, accounts have no id yet: `id` is null, to be derived from all names */
	account(value: unknown, path: string): (Omit<Account, 'id'> & { id: Id | null }) | null {
		const object = this.object(value, path, ['ID', 'Name', 'Amount', 'Edited']);
		if (!object) return null;
		if (this.legacy && 'ID' in object) this.warnings.push({ path: join(path, 'ID'), message: `Ignored: in files of version ${LEGACY_FORMAT_VERSION}, account ids come from the names` });
		const id = this.legacy ? null : this.field(object, 'ID', path, parseId, 'id');
		const name = this.string(object, 'Name', path);
		const amount = this.field(object, 'Amount', path, parseAmount, 'amount');
		const edited = this.field(object, 'Edited', path, parseFileDateTime, TIMESTAMP_FORMAT);
		if (id !== null && this.accountIds.has(id)) return this.error(join(path, 'ID'), `Duplicate account id ${id}`);
		if ((id === null && !this.legacy) || name === null || amount === null || edited === null) return null;
		if (id !== null) this.accountIds.add(id);
		return { id, name, amount, edited };
	}

	/** Categories must be parsed before, so category references can be checked. */
	recurring(value: unknown, path: string): Recurring | null {
		const object = this.object(value, path, RECURRING_KEYS);
		if (!object) return null;
		const optional = <T>(key: string, parse: (text: string) => T | null, what: string): T | null | undefined => {
			const text = this.string(object, key, path);
			if (text === null) return undefined;
			if (text === '') return null;
			return parse(text) ?? (this.error(join(path, key), `Invalid ${what}: "${text}"`) ?? undefined);
		};
		const id = this.field(object, 'ID', path, parseId, 'id');
		const description = this.string(object, 'Description', path);
		let categoryId = this.field(object, 'Category', path, parseId, 'category id');
		const amount = optional('Amount', parseAmount, 'amount (or empty: asked each time)');
		const accountId = optional('Account', parseId, 'account id (or empty: none)');
		const every = this.field(object, 'Every', path, (t) => (EVERY_PATTERN.test(t) ? Number(t) : null), 'interval (expected 1–999)');
		const unit = this.field(object, 'Unit', path, (t) => (t === 'month' || t === 'week' ? t : null), 'unit (expected month or week)');
		const start = this.field(object, 'Start', path, parseFileDate, DATE_FORMAT);
		const end = optional('End', parseFileDate, DATE_FORMAT);
		const handled = optional('Handled', parseFileDate, DATE_FORMAT);
		const edited = this.field(object, 'Edited', path, parseFileDateTime, TIMESTAMP_FORMAT);
		const lastDay = unit === 'week' ? 7 : 31;
		const days = this.field(
			object,
			'Days',
			path,
			(t) => {
				if (!DAYS_PATTERN.test(t)) return null;
				const list = t.split(',').map(Number);
				return list.every((d, i) => d <= lastDay && (i === 0 || d > list[i - 1]!)) ? list : null;
			},
			unit === 'week' ? 'weekdays (expected e.g. "1,5", 1 = Monday … 7 = Sunday, ascending)' : 'days (expected e.g. "1,15", 1–31, ascending)',
		);
		if (id !== null && this.recurringIds.has(id)) return this.error(join(path, 'ID'), `Duplicate recurring transaction id ${id}`);
		if (start !== null && end && end < start) return this.error(join(path, 'End'), 'Must not be before the start');
		if (categoryId !== null && !this.categoryIds.has(categoryId)) {
			// a client that doesn't know templates may have deleted the category: no reason to refuse the
			// file. (The file keeps the old id until the template is saved again; harmless.)
			this.warnings.push({ path: join(path, 'Category'), message: `Unknown category id ${categoryId}; it will use no category` });
			categoryId = NO_CATEGORY;
		}
		if (
			id === null || description === null || categoryId === null || amount === undefined || accountId === undefined || every === null ||
			unit === null || days === null || start === null || end === undefined || handled === undefined || edited === null
		)
			return null;
		this.recurringIds.add(id);
		return { id, description, categoryId, amount, accountId, schedule: { unit, every, days }, start, end, handled, edited };
	}

	/** Categories must be parsed before transactions, so category references can be checked. */
	transaction(value: unknown, path: string, isSub = false): Transaction | null {
		const object = this.object(value, path, TRANSACTION_KEYS);
		if (!object) return null;
		const id = this.field(object, 'ID', path, parseId, 'id');
		const date = this.field(object, 'Date', path, parseFileDate, DATE_FORMAT);
		const categoryId = this.field(object, 'Category', path, parseId, 'category id');
		const amount = this.field(object, 'Amount', path, parseAmount, 'amount');
		const description = this.string(object, 'Description', path);
		const added = this.field(object, 'Added', path, parseFileDateTime, TIMESTAMP_FORMAT);
		const edited = this.field(object, 'Edited', path, parseFileDateTime, TIMESTAMP_FORMAT);
		if (id !== null) {
			if (this.transactionIds.has(id)) this.error(join(path, 'ID'), `Duplicate transaction id ${id}`);
			this.transactionIds.add(id);
		}
		if (categoryId !== null && !this.categoryIds.has(categoryId)) this.error(join(path, 'Category'), `Unknown category id ${categoryId}`);

		let subTransactions: Transaction[] | undefined;
		if ('Transactions' in object) {
			if (isSub) return this.error(join(path, 'Transactions'), 'Sub-transactions cannot have sub-transactions');
			// parse all subs even if the group itself is invalid, so every problem is reported at once
			const subs = this.array(object, 'Transactions', path).map((sub, i) => this.transaction(sub, `${path}.Transactions[${i}]`, true));
			subTransactions = subs.filter((t) => t !== null);
			if (subTransactions.length !== subs.length) return null;
		}
		if (id === null || date === null || categoryId === null || amount === null || description === null || added === null || edited === null) return null;
		try {
			return normalizeGroup({ id, date, categoryId, amount, description, added, edited, ...(subTransactions && { subTransactions }) });
		} catch {
			return this.error(join(path, 'Transactions'), 'The sub-transaction amounts add up to an amount that is too large');
		}
	}
}

/**
 * Parses file content. Never throws for bad input: all problems are reported with their location.
 * An empty file (0 bytes) is a valid empty database, as in the C++ client.
 */
export function parseCashGuard(content: string): ParseResult {
	if (content.length === 0) return { ok: true, data: { categories: [], accounts: [], recurring: [], transactions: [] }, warnings: [] };
	let root: unknown;
	try {
		root = JSON.parse(content);
	} catch (e) {
		return { ok: false, errors: [{ path: '', message: `Not valid JSON: ${(e as Error).message}` }], warnings: [] };
	}
	const p = new Parser();
	const failed = (): ParseResult => ({ ok: false, errors: p.errors, warnings: p.warnings });
	if (!isObject(root)) {
		p.error('', 'The file must contain a JSON object');
		return failed();
	}
	const version = p.string(root, 'Version', '');
	if (version === null) return failed();
	if (!READABLE_VERSIONS.includes(version)) {
		p.error(
			'Version',
			isNewerVersion(version)
				? `The file was written by a newer version of CashGuard (format "${version}"). Update the app (restart it) to open it.`
				: `Unsupported version "${version}", expected "${FORMAT_VERSION}"`,
		);
		return failed();
	}
	p.legacy = version === LEGACY_FORMAT_VERSION;
	// recurring transactions came with the current version
	const hasRecurring = version === FORMAT_VERSION;
	p.object(root, '', hasRecurring ? ['Version', 'Categories', 'Accounts', 'Recurring', 'Transactions'] : ['Version', 'Categories', 'Accounts', 'Transactions']);

	const categories = p.array(root, 'Categories', '').map((value, i) => p.category(value, `Categories[${i}]`));
	const accounts = p.array(root, 'Accounts', '').map((value, i) => p.account(value, `Accounts[${i}]`));
	const recurring = hasRecurring ? p.array(root, 'Recurring', '').map((value, i) => p.recurring(value, `Recurring[${i}]`)) : [];
	const transactions = p.array(root, 'Transactions', '').map((value, i) => p.transaction(value, `Transactions[${i}]`));

	if (p.errors.length > 0) return failed();
	const valid = <T>(items: (T | null)[]): T[] => items.filter((item) => item !== null);
	const parsedAccounts = valid(accounts);
	const ids = p.legacy ? legacyAccountIds(parsedAccounts.map((a) => a.name)) : parsedAccounts.map((a) => a.id!);
	// (derived ids can't repeat for valid names, short of a 64-bit hash collision)
	if (new Set(ids).size !== ids.length) {
		p.error('Accounts', 'Two accounts got the same id from their names; rename one of them in the other CashGuard client, then open the file again');
		return failed();
	}
	return {
		ok: true,
		data: {
			categories: valid(categories),
			accounts: parsedAccounts.map((a, i) => ({ ...a, id: ids[i]! })),
			recurring: valid(recurring),
			transactions: sortNewestFirst(valid(transactions)),
		},
		warnings: p.warnings,
	};
}

/** Whether a version string like "cgt_1.2.3" is later than `FORMAT_VERSION` */
function isNewerVersion(version: string): boolean {
	const parts = (v: string) => /^cgt_(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
	const [theirs, ours] = [parts(version), parts(FORMAT_VERSION)!];
	if (!theirs) return false;
	for (let i = 0; i < 3; i++) if (theirs[i] !== ours[i]) return theirs[i]! > ours[i]!;
	return false;
}

// ------------------------------------------------------------------------------------- writing

type JsonValue = string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const SHORT_ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };

/** String escaping as done by rapidjson's Writer (other control characters as \u00XX, uppercase hex). */
function quote(text: string): string {
	const escaped = text.replace(/["\\\u0000-\u001f]/g, (ch) => SHORT_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
	return `"${escaped}"`;
}

/** Pretty printing as done by rapidjson's PrettyWriter: 4 spaces, "key": value, empty arrays as []. */
function write(value: JsonValue, indent: string): string {
	if (typeof value === 'string') return quote(value);
	const inner = indent + '    ';
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		return `[\n${value.map((v: JsonValue) => inner + write(v, inner)).join(',\n')}\n${indent}]`;
	}
	const entries = Object.entries(value as { readonly [key: string]: JsonValue });
	return `{\n${entries.map(([k, v]) => `${inner}${quote(k)}: ${write(v, inner)}`).join(',\n')}\n${indent}}`;
}

function recurringToJson(r: Recurring): JsonValue {
	return {
		ID: r.id,
		Description: r.description,
		Category: r.categoryId,
		Amount: r.amount === null ? '' : formatAmount(r.amount),
		Account: r.accountId ?? '',
		Every: String(r.schedule.every),
		Unit: r.schedule.unit,
		Days: r.schedule.days.join(','),
		Start: formatFileDate(r.start),
		End: r.end === null ? '' : formatFileDate(r.end),
		Handled: r.handled === null ? '' : formatFileDate(r.handled),
		Edited: formatFileDateTime(r.edited),
	};
}

function transactionToJson(t: Transaction): JsonValue {
	return {
		ID: t.id,
		Date: formatFileDate(t.date),
		Category: t.categoryId,
		Amount: formatAmount(t.amount),
		Description: t.description,
		Added: formatFileDateTime(t.added),
		Edited: formatFileDateTime(t.edited),
		...(t.subTransactions && { Transactions: t.subTransactions.map(transactionToJson) }),
	};
}

/**
 * Serializes to the exact text the C++ client would write (no trailing newline). The canonical
 * form (sort order, group sums, uppercase colors, no category 0) is enforced here too, so data
 * built by UI code can't produce a file the C++ client would rewrite differently.
 */
export function serializeCashGuard(data: CashGuardData): string {
	return write(
		{
			Version: FORMAT_VERSION,
			Categories: data.categories
				.filter((c) => c.id !== NO_CATEGORY)
				.map((c) => ({ ID: c.id, Name: c.name, Color: c.color.toUpperCase() })),
			Accounts: data.accounts.map((a) => ({ ID: a.id, Name: a.name, Amount: formatAmount(a.amount), Edited: formatFileDateTime(a.edited) })),
			Recurring: data.recurring.map(recurringToJson),
			Transactions: sortNewestFirst(data.transactions.map(normalizeGroup)).map(transactionToJson),
		},
		'',
	);
}
