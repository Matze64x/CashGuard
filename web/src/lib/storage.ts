/** Persists the workspace in the browser (IndexedDB), as file-format text. */
import { get, set } from 'idb-keyval';

export interface StoredSnapshot {
	readonly working: string;
	readonly base: string | null;
	readonly exported: string | null;
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

export async function loadWorkspace(): Promise<StoredWorkspace | undefined> {
	return get<StoredWorkspace>(KEY);
}

/** Saves and tells other open tabs of the app, so they reload instead of overwriting it later. */
export async function saveWorkspace(workspace: StoredWorkspace): Promise<void> {
	await set(KEY, workspace);
	channel?.postMessage('saved');
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
