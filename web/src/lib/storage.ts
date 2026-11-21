/** Persists the workspace in the browser (IndexedDB), as file-format text. */
import { createStore, del, get, promisifyRequest } from 'idb-keyval';

// idb-keyval's default database and store, opened explicitly to write several keys in one transaction
const store = createStore('keyval-store', 'keyval');

export interface StoredSnapshot {
	readonly working: string;
	readonly fileName: string | null;
}

export interface StoredWorkspace {
	readonly current: StoredSnapshot;
	/** The state before the last import, to undo it */
	readonly beforeImport: StoredSnapshot | null;
}

const KEY = 'cashguard-workspace-v2';

// One channel for sending and receiving: a channel doesn't receive its own messages, so a tab is
// only told about saves of other tabs (a second channel object in the same tab would hear them).
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cashguard-workspace');

/** The data last agreed on with another device (see `core/peer-sync.ts`), as file-format text */
export interface StoredBaseText {
	readonly text: string;
	readonly hash: string;
}

const baseKey = (peer: string) => `cashguard-base-v1:${peer}`;

export async function loadWorkspace(): Promise<StoredWorkspace | undefined> {
	return get<StoredWorkspace>(KEY, store);
}

export async function loadBase(peer: string): Promise<StoredBaseText | undefined> {
	return get<StoredBaseText>(baseKey(peer), store);
}

/**
 * Saves the workspace and, if given, another device's base (null: delete it) in one transaction:
 * either both are saved or neither. Tells other open tabs, so they reload instead of overwriting
 * it later.
 */
export async function saveWorkspace(workspace: StoredWorkspace, base?: { peer: string; value: StoredBaseText | null }): Promise<void> {
	await store('readwrite', (s) => {
		s.put(workspace, KEY);
		if (base) {
			if (base.value) s.put(base.value, baseKey(base.peer));
			else s.delete(baseKey(base.peer));
		}
		return promisifyRequest(s.transaction);
	});
	channel?.postMessage('saved');
}

/** Forgets another device's base (when it's unpaired). */
export async function deleteBase(peer: string): Promise<void> {
	await del(baseKey(peer), store);
}

/** Calls `onChange` when another tab saved the workspace. Returns a function to stop listening. */
export function watchWorkspace(onChange: () => void): () => void {
	channel?.addEventListener('message', onChange);
	return () => channel?.removeEventListener('message', onChange);
}

/** Asks the browser not to evict the data under storage pressure (iOS evicts unused site data). */
export async function requestPersistentStorage(): Promise<void> {
	await navigator.storage?.persist?.().catch(() => undefined);
}
