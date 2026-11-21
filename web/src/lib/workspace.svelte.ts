/**
 * The app's data: the working copy plus its sync state, persisted in the browser storage (also in
 * the desktop app, whose window is a browser engine).
 *
 * Every change goes through `#commit`, which saves first and only then updates what's shown, so
 * the screen never shows data that isn't stored. A failed save throws and changes nothing.
 *
 * Exchanging data with a CashGuard file, in the browser and the desktop app alike: importing one
 * merges it in (preview first, can be undone), exporting hands the data out as a file. The desktop
 * app can also keep a backup file (`settings.backupPath`): written a few seconds after each change
 * and when the window closes, never read back by itself (restoring it is an import). A backup is
 * NOT an export: `exported` is what reached another device, the merge base of the next import, and
 * a backup never leaves this machine. Files are only written if they read back, and always atomically.
 */
import {
	INITIAL_SYNC_STATE,
	nowUtcSeconds,
	parseCashGuard,
	planImport,
	serializeCashGuard,
	type CashGuardData,
	type ImportPlan,
	type Issue,
	type SyncState,
	type UtcSeconds,
} from '../core';
import * as desktop from './desktop';
import { errorMessage } from './errors';
import { saveFile } from './files';
import { settings } from './settings.svelte';
import { loadWorkspace, requestPersistentStorage, saveWorkspace, watchWorkspace, type StoredSnapshot } from './storage';

const DEFAULT_FILE_NAME = 'cashguard.json';
/** How long the backup waits after a change, so a burst of edits writes it once */
const BACKUP_DELAY_MS = 3000;

interface Snapshot {
	readonly sync: SyncState;
	/** The file last imported or exported, to suggest its name for the next export */
	readonly fileName: string | null;
}

export interface ImportSource {
	readonly fileName: string;
	/** The state the plan was made from; applying is refused if the data changed since */
	readonly from: SyncState;
}

export type ImportCandidate =
	| (ImportSource & { readonly ok: true; readonly plan: ImportPlan; readonly warnings: readonly Issue[] })
	| (ImportSource & { readonly ok: false; readonly errors: readonly Issue[] });

function parseStored(text: string): CashGuardData {
	const result = parseCashGuard(text);
	if (result.ok) return result.data;
	const [first] = result.errors;
	throw new Error(`The data stored in this browser is damaged (${first?.path || 'file'}: ${first?.message}).`);
}

/**
 * The file text of data, serialized once per data object (they're never changed): each save stores
 * the working copy, base and export as text, and only the working copy is new after an edit.
 */
const serialized = new WeakMap<CashGuardData, string>();
function serialize(data: CashGuardData): string {
	let text = serialized.get(data);
	if (text === undefined) serialized.set(data, (text = serializeCashGuard(data)));
	return text;
}

/** The file text, after making sure it reads back: a file is never written if it couldn't be opened again. */
function fileText(data: CashGuardData): string {
	const text = serialize(data);
	if (!parseCashGuard(text).ok) throw new Error("The file wasn't written: it wouldn't read back correctly. Please report this.");
	return text;
}

function toStored({ sync, fileName }: Snapshot): StoredSnapshot {
	const text = (data: CashGuardData | null) => data && serialize(data);
	return { working: serialize(sync.working), base: text(sync.base), exported: text(sync.exported), fileName };
}

function fromStored(stored: StoredSnapshot): Snapshot {
	// the working copy, base and export are often the same: parse each text once
	const parsed = new Map<string, CashGuardData>();
	const parse = (text: string) => {
		let data = parsed.get(text);
		// (not remembered as its serialization: an older stored format is upgraded when read)
		if (data === undefined) parsed.set(text, (data = parseStored(text)));
		return data;
	};
	const data = (text: string | null) => (text === null ? null : parse(text));
	return {
		sync: { working: parse(stored.working), base: data(stored.base), exported: data(stored.exported) },
		fileName: stored.fileName,
	};
}

interface UndoEntry {
	readonly before: CashGuardData;
	readonly after: CashGuardData;
	readonly label: string;
}

export class Workspace {
	readonly isDesktop = desktop.isDesktop;

	// $state.raw: snapshots are replaced as a whole, never mutated, so deep reactivity isn't needed
	#current = $state.raw<Snapshot>({ sync: INITIAL_SYNC_STATE, fileName: null });
	#beforeImport = $state.raw<Snapshot | null>(null);
	ready = $state(false);
	/** Increases whenever another tab changed the data and it was reloaded */
	revision = $state(0);
	/** Desktop app: why the last backup failed (null: it worked, or there is none) */
	backupError = $state<string | null>(null);

	readonly data = $derived(this.#current.sync.working);
	readonly fileName = $derived(this.#current.fileName);
	readonly canUndoImport = $derived(this.#beforeImport !== null);

	/**
	 * Edits that can be undone (Mod+Z) and redone. Only valid while the data hasn't changed otherwise
	 * (import, another tab): then the labels are null and undo/redo clear the stacks.
	 */
	#undo = $state.raw<readonly UndoEntry[]>([]);
	#redo = $state.raw<readonly UndoEntry[]>([]);
	readonly undoLabel = $derived(this.#undo.at(-1)?.after === this.#current.sync.working ? this.#undo.at(-1)!.label : null);
	readonly redoLabel = $derived(this.#redo.at(-1)?.before === this.#current.sync.working ? this.#redo.at(-1)!.label : null);

	/** Changes run one at a time, so they can't interleave */
	#queue: Promise<unknown> = Promise.resolve();
	#backupTimer: ReturnType<typeof setTimeout> | undefined;
	/** The working copy last written to the backup file (in memory: each start writes it once) */
	#backedUp: CashGuardData | null = null;

	/** Loads the stored data. Throws if storage is unavailable or the data is damaged. */
	async load(): Promise<void> {
		const stored = await loadWorkspace();
		if (stored) {
			this.#current = fromStored(stored.current);
			try {
				this.#beforeImport = stored.beforeImport && fromStored(stored.beforeImport);
			} catch {
				// a damaged undo snapshot must not prevent loading the data itself
				this.#beforeImport = null;
			}
		}
		this.ready = true;
	}

	/** Loads the data and keeps it up to date with other tabs; the desktop app backs it up before closing. Throws only if the data can't be loaded. */
	async start(): Promise<() => void> {
		void requestPersistentStorage();
		await this.load();
		const stopWatchingTabs = watchWorkspace(() =>
			this.load().then(() => {
				this.revision++;
			}),
		);
		let stopWatchingClose = () => {};
		if (this.isDesktop) {
			stopWatchingClose = await desktop.onWindowClose(() => this.flushBackup());
			// catches up on changes the last run couldn't back up (e.g. it was killed)
			this.#scheduleBackup();
		}
		return () => {
			stopWatchingTabs();
			stopWatchingClose();
			clearTimeout(this.#backupTimer);
		};
	}

	// ------------------------------------------------------------------ import and export

	/** Plans merging a file into the working copy; nothing changes until `applyImport`. */
	planImport(fileName: string, text: string): ImportCandidate {
		const source = { fileName, from: this.#current.sync };
		const result = parseCashGuard(text);
		if (!result.ok) return { ...source, ok: false, errors: result.errors };
		return { ...source, ok: true, plan: planImport(source.from, result.data), warnings: result.warnings };
	}

	/** Desktop app: lets the user pick a file and plans importing it. Null if cancelled. */
	async chooseImport(): Promise<ImportCandidate | null> {
		const path = await desktop.chooseExistingFile('Import a CashGuard file');
		return path ? this.planImport(desktop.fileNameOf(path), await desktop.readFile(path)) : null;
	}

	/** Applies a planned import; it can be undone until the next change. */
	applyImport(candidate: ImportCandidate & { ok: true }): Promise<void> {
		return this.#serial(async () => {
			if (this.#current.sync !== candidate.from) throw new Error('Your data changed in the meantime. Please try again.');
			await this.#commit({ sync: candidate.plan.next, fileName: candidate.fileName }, this.#current);
		});
	}

	undoImport(): Promise<void> {
		return this.#serial(async () => {
			if (this.#beforeImport) await this.#commit(this.#beforeImport, null);
		});
	}

	/**
	 * Hands the working copy to the user as a file: in the browser as a download or via the share
	 * sheet (it must start right from the click: browsers block it after an await), in the desktop
	 * app saved where the user chooses. Returns false if cancelled.
	 */
	async exportFile(): Promise<boolean> {
		const handedOut = this.#current.sync.working;
		const name = this.#current.fileName ?? DEFAULT_FILE_NAME;
		if (this.isDesktop) {
			const path = await desktop.chooseFileToSave('Export a CashGuard file', name);
			if (!path) return false;
			// (in the queue: no other write, e.g. the backup, can run at the same time)
			await this.#serial(async () => {
				await desktop.writeFile(path, fileText(handedOut));
				await this.#markExported(handedOut, desktop.fileNameOf(path));
			});
			return true;
		}
		if (!(await saveFile(fileText(handedOut), name))) return false;
		await this.#serial(() => this.#markExported(handedOut, name));
		return true;
	}

	/** Changes made meanwhile (e.g. in another tab, or a save still in progress) are kept: only what was handed out counts as exported. Must run inside `#serial`. */
	async #markExported(data: CashGuardData, fileName: string): Promise<void> {
		await this.#commit({ sync: { ...this.#current.sync, exported: data }, fileName }, this.#beforeImport);
	}

	// ------------------------------------------------------------------ desktop: backup file

	/** Sets (or, with null, turns off) the backup file; a new one is written right away. */
	async setBackupPath(path: string | null): Promise<void> {
		settings.backupPath = path;
		this.#backedUp = null;
		this.backupError = null;
		clearTimeout(this.#backupTimer);
		if (path) await this.backupNow();
	}

	/** Writes the backup file now (if there is one). A failure shows in `backupError`, and is retried on the next change. */
	backupNow(): Promise<void> {
		clearTimeout(this.#backupTimer);
		this.#backupTimer = undefined;
		return this.#serial(async () => {
			const path = settings.backupPath;
			if (!this.isDesktop || !path) return;
			const data = this.#current.sync.working;
			if (data === this.#backedUp) return;
			try {
				await desktop.writeFile(path, fileText(data));
				this.#backedUp = data;
				this.backupError = null;
			} catch (e) {
				this.backupError = errorMessage(e);
			}
		});
	}

	/** Writes a pending backup right away (e.g. the window is closing). */
	async flushBackup(): Promise<void> {
		// a change still being saved schedules its backup only when it's done: wait for it
		await this.#queue;
		if (this.#backupTimer !== undefined) await this.backupNow();
	}

	#scheduleBackup(): void {
		if (!this.isDesktop || !settings.backupPath) return;
		clearTimeout(this.#backupTimer);
		this.#backupTimer = setTimeout(() => void this.backupNow(), BACKUP_DELAY_MS);
	}

	// ------------------------------------------------------------------ editing

	/**
	 * Applies an edit (a pure function from `core/edit.ts`) to the working copy and saves it.
	 * `label` describes it for undo, e.g. 'Delete “Rent”'. Throws (and changes nothing) if the edit
	 * is invalid.
	 */
	edit(label: string, change: (data: CashGuardData, now: UtcSeconds) => CashGuardData): Promise<void> {
		return this.#serial(async () => {
			const before = this.#current.sync.working;
			const after = change(before, nowUtcSeconds());
			if (after === before) return;
			await this.#replaceWorking(after);
			this.#undo = [...this.#undo.slice(-49), { before, after, label }];
			this.#redo = [];
		});
	}

	/** Undoes the last edit. Returns its label, or null if there's nothing (valid) to undo. */
	undo(): Promise<string | null> {
		return this.#serial(async () => {
			const last = this.#undo.at(-1);
			if (!last) return null;
			// an import changed the data since: undoing would also revert that, so don't
			if (this.#current.sync.working !== last.after) {
				this.#undo = [];
				this.#redo = [];
				return null;
			}
			await this.#replaceWorking(last.before);
			this.#undo = this.#undo.slice(0, -1);
			this.#redo = [...this.#redo, last];
			return last.label;
		});
	}

	redo(): Promise<string | null> {
		return this.#serial(async () => {
			const next = this.#redo.at(-1);
			if (!next || this.#current.sync.working !== next.before) {
				this.#redo = [];
				return null;
			}
			await this.#replaceWorking(next.after);
			this.#redo = this.#redo.slice(0, -1);
			this.#undo = [...this.#undo, next];
			return next.label;
		});
	}

	/** Must run inside `#serial`. An edit invalidates "undo import" (it would discard the edit). */
	async #replaceWorking(working: CashGuardData): Promise<void> {
		await this.#commit({ ...this.#current, sync: { ...this.#current.sync, working } }, null);
	}

	#serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(task, task);
		this.#queue = run.catch(() => undefined);
		return run;
	}

	/**
	 * Saves and then shows a new state. `beforeImport` is what "Undo import" restores; any change
	 * other than an import or export (e.g. editing) must pass null, so undo can't discard it.
	 */
	async #commit(next: Snapshot, beforeImport: Snapshot | null): Promise<void> {
		await saveWorkspace({ current: toStored(next), beforeImport: beforeImport && toStored(beforeImport) });
		const changed = next.sync.working !== this.#current.sync.working;
		this.#current = next;
		this.#beforeImport = beforeImport;
		if (changed) this.#scheduleBackup();
	}
}
