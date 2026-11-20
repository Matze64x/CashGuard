/**
 * The app's data: the working copy plus its sync state, persisted in the browser storage (also in
 * the desktop app, whose window is a browser engine).
 *
 * Every change goes through `#commit`, which saves first and only then updates what's shown, so
 * the screen never shows data that isn't stored. A failed save throws and changes nothing.
 *
 * Syncing with the CashGuard file:
 * - browser: the user imports the file (merge preview first) and exports it to save it back
 * - desktop app: the app is linked to the file, reads it on start and whenever it changes on disk,
 *   merges automatically (asking only on conflicts or warnings), and writes changes back itself.
 *   Writes only replace the file if it still has the content the merge was based on.
 */
import {
	INITIAL_SYNC_STATE,
	needsWrite,
	nowUtcSeconds,
	parseCashGuard,
	planFileSync,
	planImport,
	serializeCashGuard,
	totalChanges,
	unexportedChanges,
	type CashGuardData,
	type ImportPlan,
	type Issue,
	type SyncState,
	type UtcSeconds,
} from '../core';
import * as desktop from './desktop';
import { errorMessage } from './errors';
import { saveFile } from './files';
import { loadWorkspace, requestPersistentStorage, saveWorkspace, watchWorkspace, type StoredSnapshot } from './storage';

const DEFAULT_FILE_NAME = 'cashguard.json';
/** How often the sync loop retries when the file keeps changing under it */
const MAX_SYNC_ATTEMPTS = 5;

interface Snapshot {
	readonly sync: SyncState;
	readonly fileName: string | null;
	/** Desktop app only: the synced file */
	readonly filePath: string | null;
}

/**
 * - 'import': the browser's import (can be undone)
 * - 'sync': the linked file changed on disk in a way that needs a decision (desktop)
 * - 'open': opening another file while there are changes not yet written to the current one (desktop)
 */
export type CandidateMode = 'import' | 'sync' | 'open';

interface CandidateSource {
	readonly mode: CandidateMode;
	readonly fileName: string;
	/** Desktop app: the file and its content as read, so "keep mine" can replace exactly that */
	readonly filePath: string | null;
	readonly fileText: string | null;
	/** The state the plan was made from; applying is refused if the data changed since */
	readonly from: SyncState;
}

export type ImportCandidate =
	| (CandidateSource & { readonly ok: true; readonly plan: ImportPlan; readonly warnings: readonly Issue[] })
	| (CandidateSource & { readonly ok: false; readonly errors: readonly Issue[] });

function parseStored(text: string): CashGuardData {
	const result = parseCashGuard(text);
	if (result.ok) return result.data;
	const [first] = result.errors;
	throw new Error(`The data stored in this browser is damaged (${first?.path || 'file'}: ${first?.message}).`);
}

function toStored({ sync, fileName, filePath }: Snapshot): StoredSnapshot {
	const text = (data: CashGuardData | null) => data && serializeCashGuard(data);
	return { working: serializeCashGuard(sync.working), base: text(sync.base), exported: text(sync.exported), fileName, filePath };
}

function fromStored(stored: StoredSnapshot): Snapshot {
	const data = (text: string | null) => (text === null ? null : parseStored(text));
	return {
		sync: { working: parseStored(stored.working), base: data(stored.base), exported: data(stored.exported) },
		fileName: stored.fileName,
		filePath: stored.filePath ?? null,
	};
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface UndoEntry {
	readonly before: CashGuardData;
	readonly after: CashGuardData;
	readonly label: string;
}

export class Workspace {
	readonly isDesktop = desktop.isDesktop;

	// $state.raw: snapshots are replaced as a whole, never mutated, so deep reactivity isn't needed
	#current = $state.raw<Snapshot>({ sync: INITIAL_SYNC_STATE, fileName: null, filePath: null });
	#beforeImport = $state.raw<Snapshot | null>(null);
	ready = $state(false);
	/** Increases whenever another tab changed the data and it was reloaded */
	revision = $state(0);
	/** Desktop app: a sync with the file that needs the user's decision */
	prompt = $state.raw<ImportCandidate | null>(null);
	/** Desktop app: why the last sync with the file failed */
	syncError = $state<string | null>(null);

	readonly data = $derived(this.#current.sync.working);
	readonly fileName = $derived(this.#current.fileName);
	readonly filePath = $derived(this.#current.filePath);
	readonly unexportedCount = $derived(totalChanges(unexportedChanges(this.#current.sync)));
	readonly canUndoImport = $derived(this.#beforeImport !== null);

	/**
	 * Edits that can be undone (Mod+Z) and redone. Only valid while the data hasn't changed otherwise
	 * (sync, import, another tab): then the labels are null and undo/redo clear the stacks.
	 */
	#undo = $state.raw<readonly UndoEntry[]>([]);
	#redo = $state.raw<readonly UndoEntry[]>([]);
	readonly undoLabel = $derived(this.#undo.at(-1)?.after === this.#current.sync.working ? this.#undo.at(-1)!.label : null);
	readonly redoLabel = $derived(this.#redo.at(-1)?.before === this.#current.sync.working ? this.#redo.at(-1)!.label : null);

	#unwatchFile: (() => void) | null = null;
	/** Operations on the file run one at a time, so they can't interleave */
	#queue: Promise<unknown> = Promise.resolve();

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

	/**
	 * Loads the data, keeps it up to date with other tabs, and (desktop) starts syncing the file.
	 * Throws only if the data can't be loaded; problems with the file show up in `syncError`.
	 */
	async start(): Promise<() => void> {
		void requestPersistentStorage();
		await this.load();
		const stopWatchingTabs = watchWorkspace(() =>
			this.load().then(() => {
				this.revision++;
			}),
		);
		if (this.isDesktop && this.#current.filePath) {
			try {
				await this.#watch(this.#current.filePath);
			} catch (e) {
				this.syncError = errorMessage(e);
			}
		}
		// insurance for file systems that don't report changes (e.g. network drives)
		const onFocus = () => {
			if (this.#current.filePath) void this.syncWithFile();
		};
		if (this.isDesktop) window.addEventListener('focus', onFocus);
		return () => {
			stopWatchingTabs();
			window.removeEventListener('focus', onFocus);
			this.#unwatchFile?.();
		};
	}

	// ------------------------------------------------------------------ browser: import and export

	/** Plans merging a file into the working copy; nothing changes until `applyImport`. */
	async planImport(file: File): Promise<ImportCandidate> {
		const source = { mode: 'import', fileName: file.name, filePath: null, fileText: null, from: this.#current.sync } as const;
		const result = parseCashGuard(await file.text());
		if (!result.ok) return { ...source, ok: false, errors: result.errors };
		return { ...source, ok: true, plan: planImport(source.from, result.data), warnings: result.warnings };
	}

	/** Applies a planned import (browser) or a sync/open decision (desktop). */
	async applyImport(candidate: ImportCandidate & { ok: true }): Promise<void> {
		const linking = candidate.filePath !== null && candidate.filePath !== this.#current.filePath;
		await this.#serial(async () => {
			if (candidate.mode === 'sync' && this.#current.sync !== candidate.from) {
				// a newer change arrived while the prompt was open: decide based on that instead
				this.prompt = await this.#syncLoop();
				return;
			}
			this.#checkUnchanged(candidate);
			// desktop: the file is the shared truth, so there's nothing to undo to
			const beforeImport = this.isDesktop ? null : this.#current;
			await this.#commit({ sync: candidate.plan.next, fileName: candidate.fileName, filePath: candidate.filePath ?? this.#current.filePath }, beforeImport);
			if (this.isDesktop && !linking) this.prompt = await this.#syncLoop();
		});
		if (linking) await this.#watch(candidate.filePath!);
	}

	async undoImport(): Promise<void> {
		if (this.#beforeImport) await this.#commit(this.#beforeImport, null);
	}

	/** Hands the working copy to the user to save over the synced file. Returns false if cancelled. */
	async exportFile(): Promise<boolean> {
		const { sync, fileName } = this.#current;
		if (!(await saveFile(serializeCashGuard(sync.working), fileName ?? DEFAULT_FILE_NAME))) return false;
		await this.#commit({ ...this.#current, sync: { ...sync, exported: sync.working } }, this.#beforeImport);
		return true;
	}

	// ------------------------------------------------------------------ editing

	/**
	 * Applies an edit (a pure function from `core/edit.ts`) to the working copy and saves it; the
	 * desktop app also writes it to the file. `label` describes it for undo, e.g. 'Delete “Rent”'.
	 * Throws (and changes nothing) if the edit is invalid.
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
			// a sync or import changed the data since: undoing would also revert that, so don't
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
		if (!this.isDesktop) return;
		try {
			this.prompt = await this.#syncLoop();
			this.syncError = null;
		} catch (e) {
			// the edit is saved in the app; writing the file is retried on the next change
			this.syncError = errorMessage(e);
		}
	}

	// ------------------------------------------------------------------ desktop: linked file

	/**
	 * Lets the user pick a file to sync with. If everything is written to the current file (or
	 * there's no data yet), it's simply opened. Otherwise the unwritten changes are carried over
	 * into the new file, which is returned as a merge to confirm.
	 */
	async chooseFileToOpen(): Promise<ImportCandidate | null> {
		const path = await desktop.chooseExistingFile();
		if (!path) return null;
		const fileText = await desktop.readFile(path);
		const result = parseCashGuard(fileText);
		const from = this.#current.sync;
		const source = { mode: 'open', fileName: desktop.fileNameOf(path), filePath: path, fileText, from } as const;
		if (!result.ok) return { ...source, ok: false, errors: result.errors };
		const same = path === this.#current.filePath;
		const { working } = from;
		const nothingToCarry = !needsWrite(from) || working.transactions.length + working.categories.length + working.accounts.length === 0;
		if (!same && nothingToCarry) {
			await this.#serial(() => this.#commit({ sync: { working: result.data, base: result.data, exported: null }, fileName: source.fileName, filePath: path }, null));
			await this.#watch(path);
			return null;
		}
		// relative to the old base, the plan keeps exactly the changes not yet written; warnings
		// that compare with the old file make no sense for a different file
		const plan = planImport(from, result.data);
		const warnings = same ? plan.warnings : plan.warnings.filter((w) => w === 'empty-file');
		return { ...source, mode: same ? 'sync' : 'open', ok: true, plan: { ...plan, warnings }, warnings: result.warnings };
	}

	/** Lets the user create a new file with the current data and syncs with it from then on. */
	async createFile(): Promise<boolean> {
		const path = await desktop.chooseNewFile();
		if (!path) return false;
		await this.#serial(async () => {
			const { working } = this.#current.sync;
			try {
				await desktop.writeFile(path, serializeCashGuard(working), null);
			} catch (e) {
				if (e instanceof desktop.FileExistsError) throw new Error(`${desktop.fileNameOf(path)} already exists. Use “Open file…” to sync with it.`);
				throw e;
			}
			await this.#commit({ sync: { working, base: working, exported: null }, fileName: desktop.fileNameOf(path), filePath: path }, null);
		});
		await this.#watch(path);
		return true;
	}

	/**
	 * Desktop prompt: keep the app's data and replace the file with it (e.g. the file was emptied or
	 * damaged). Only replaces the file if it still has the content shown in the prompt.
	 */
	async keepMine(candidate: ImportCandidate): Promise<void> {
		const { filePath, fileText } = candidate;
		if (filePath === null || fileText === null) return;
		await this.#serial(async () => {
			this.#checkUnchanged(candidate);
			const { working } = this.#current.sync;
			try {
				await desktop.writeFile(filePath, serializeCashGuard(working), fileText);
			} catch (e) {
				if (!(e instanceof desktop.FileChangedError)) throw e;
				// the file changed again meanwhile: look at it anew
				this.prompt = await this.#syncLoop();
				return;
			}
			await this.#commit({ ...this.#current, sync: { working, base: working, exported: null } }, null);
		});
	}

	/** Brings the working copy and the linked file in line; asks via `prompt` when needed. */
	syncWithFile(): Promise<void> {
		return this.#serial(async () => {
			try {
				this.prompt = await this.#syncLoop();
				this.syncError = null;
			} catch (e) {
				this.syncError = errorMessage(e);
			}
		});
	}

	async #watch(path: string): Promise<void> {
		await this.#serial(async () => {
			this.#unwatchFile?.();
			this.#unwatchFile = null;
			this.#unwatchFile = await desktop.watchFile(path, () => void this.syncWithFile());
		});
		await this.syncWithFile();
	}

	/**
	 * Reads the file, merges it in and writes back what it lacks, until both agree. Returns a
	 * prompt if the user has to decide. Must run inside `#serial`.
	 */
	async #syncLoop(): Promise<ImportCandidate | null> {
		for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
			const { filePath, fileName, sync } = this.#current;
			if (!filePath) return null;
			const fileText = await desktop.readFile(filePath);
			const source = { mode: 'sync', fileName: fileName ?? desktop.fileNameOf(filePath), filePath, fileText, from: sync } as const;
			const result = parseCashGuard(fileText);
			if (!result.ok) {
				// maybe another program is still writing it; give it a moment before asking
				if (attempt === 0) {
					await sleep(500);
					continue;
				}
				return { ...source, ok: false, errors: result.errors };
			}
			const plan = planFileSync(sync, result.data);
			if (plan.kind === 'unchanged') return null;
			if (plan.kind === 'import') {
				if (!plan.automatic) return { ...source, ok: true, plan: plan.plan, warnings: result.warnings };
				await this.#commit({ ...this.#current, sync: plan.plan.next }, null);
			}
			const current = this.#current.sync;
			if (!needsWrite(current)) return null;
			try {
				// the file's content is the merge base, so it's what the file must still contain
				await desktop.writeFile(filePath, serializeCashGuard(current.working), fileText);
			} catch (e) {
				if (e instanceof desktop.FileChangedError) continue;
				throw e;
			}
			await this.#commit({ ...this.#current, sync: { ...current, base: current.working, exported: null } }, null);
			return null;
		}
		throw new Error('The file keeps changing. Syncing will be retried on its next change.');
	}

	#checkUnchanged(candidate: ImportCandidate): void {
		if (this.#current.sync !== candidate.from) throw new Error('Your data changed in the meantime. Please try again.');
	}

	#serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(task, task);
		this.#queue = run.catch(() => undefined);
		return run;
	}

	/**
	 * Saves and then shows a new state. `beforeImport` is what "Undo import" restores; any change
	 * other than an import or export (e.g. editing, Phase 4) must pass null, so undo can't discard it.
	 */
	async #commit(next: Snapshot, beforeImport: Snapshot | null): Promise<void> {
		await saveWorkspace({ current: toStored(next), beforeImport: beforeImport && toStored(beforeImport) });
		this.#current = next;
		this.#beforeImport = beforeImport;
	}
}
