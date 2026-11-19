/**
 * The app's data: the working copy plus its sync state, persisted in the browser.
 *
 * Every change goes through `#commit`, which saves first and only then updates what's shown, so
 * the screen never shows data that isn't stored. A failed save throws and changes nothing.
 */
import {
	INITIAL_SYNC_STATE,
	parseCashGuard,
	planImport,
	serializeCashGuard,
	totalChanges,
	unexportedChanges,
	type CashGuardData,
	type ImportPlan,
	type Issue,
	type SyncState,
} from '../core';
import { saveFile } from './files';
import { loadWorkspace, requestPersistentStorage, saveWorkspace, watchWorkspace, type StoredSnapshot } from './storage';

const DEFAULT_FILE_NAME = 'cashguard.json';

interface Snapshot {
	readonly sync: SyncState;
	readonly fileName: string | null;
}

export type ImportCandidate =
	| { readonly ok: true; readonly fileName: string; readonly plan: ImportPlan; readonly warnings: readonly Issue[] }
	| { readonly ok: false; readonly fileName: string; readonly errors: readonly Issue[] };

function parseStored(text: string): CashGuardData {
	const result = parseCashGuard(text);
	if (result.ok) return result.data;
	const [first] = result.errors;
	throw new Error(`The data stored in this browser is damaged (${first?.path || 'file'}: ${first?.message}).`);
}

function toStored({ sync, fileName }: Snapshot): StoredSnapshot {
	const text = (data: CashGuardData | null) => data && serializeCashGuard(data);
	return { working: serializeCashGuard(sync.working), base: text(sync.base), exported: text(sync.exported), fileName };
}

function fromStored(stored: StoredSnapshot): Snapshot {
	const data = (text: string | null) => (text === null ? null : parseStored(text));
	return { sync: { working: parseStored(stored.working), base: data(stored.base), exported: data(stored.exported) }, fileName: stored.fileName };
}

export class Workspace {
	// $state.raw: snapshots are replaced as a whole, never mutated, so deep reactivity isn't needed
	#current = $state.raw<Snapshot>({ sync: INITIAL_SYNC_STATE, fileName: null });
	#beforeImport = $state.raw<Snapshot | null>(null);
	ready = $state(false);
	/** Increases whenever the data was reloaded because another tab changed it */
	revision = $state(0);

	readonly data = $derived(this.#current.sync.working);
	readonly fileName = $derived(this.#current.fileName);
	readonly unexportedCount = $derived(totalChanges(unexportedChanges(this.#current.sync)));
	readonly canUndoImport = $derived(this.#beforeImport !== null);

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

	/** Loads the data initially and again whenever another tab changes it. */
	async start(): Promise<() => void> {
		void requestPersistentStorage();
		await this.load();
		return watchWorkspace(() =>
			this.load().then(() => {
				this.revision++;
			}),
		);
	}

	/** Plans merging a file into the working copy; nothing changes until `applyImport`. */
	async planImport(file: File): Promise<ImportCandidate> {
		const result = parseCashGuard(await file.text());
		if (!result.ok) return { ok: false, fileName: file.name, errors: result.errors };
		return { ok: true, fileName: file.name, plan: planImport(this.#current.sync, result.data), warnings: result.warnings };
	}

	async applyImport(candidate: ImportCandidate & { ok: true }): Promise<void> {
		await this.#commit({ sync: candidate.plan.next, fileName: candidate.fileName }, this.#current);
	}

	async undoImport(): Promise<void> {
		if (this.#beforeImport) await this.#commit(this.#beforeImport, null);
	}

	/** Hands the working copy to the user to save over the synced file. Returns false if cancelled. */
	async exportFile(): Promise<boolean> {
		const { sync, fileName } = this.#current;
		if (!(await saveFile(serializeCashGuard(sync.working), fileName ?? DEFAULT_FILE_NAME))) return false;
		await this.#commit({ sync: { ...sync, exported: sync.working }, fileName }, this.#beforeImport);
		return true;
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
