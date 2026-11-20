/**
 * Access to the synced file in the desktop app (Tauri). Only call these when `isDesktop` is true;
 * the Tauri modules are loaded on demand, so the browser build doesn't need them.
 */
import { errorMessage } from './errors';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The file isn't in the state the write expected (someone else changed it); nothing was written. */
export class FileChangedError extends Error {}
/** A new file was to be created, but one exists already; nothing was written. */
export class FileExistsError extends Error {}

const FILTERS = [{ name: 'CashGuard file', extensions: ['json'] }];

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		return await invoke<T>(command, args);
	} catch (e) {
		// the Rust side reports these cases with a fixed prefix
		const message = errorMessage(e);
		if (message.startsWith('CHANGED:')) throw new FileChangedError(message.slice(8).trim());
		if (message.startsWith('EXISTS:')) throw new FileExistsError(message.slice(7).trim());
		throw new Error(message);
	}
}

/** Lets the user pick an existing CashGuard file. Returns its path, or null if cancelled. */
export async function chooseExistingFile(): Promise<string | null> {
	const { open } = await import('@tauri-apps/plugin-dialog');
	return open({ title: 'Open CashGuard file', filters: FILTERS, multiple: false, directory: false });
}

/** Lets the user choose where to create a new CashGuard file. Returns its path, or null. */
export async function chooseNewFile(): Promise<string | null> {
	const { save } = await import('@tauri-apps/plugin-dialog');
	const path = await save({ title: 'Create CashGuard file', filters: FILTERS, defaultPath: 'cashguard.json' });
	// appending the extension happens after the dialog's overwrite check; creating refuses to
	// replace an existing file anyway (see `writeFile`)
	return path && !path.endsWith('.json') ? `${path}.json` : path;
}

export function readFile(path: string): Promise<string> {
	return invoke<string>('read_synced_file', { path });
}

/**
 * Writes atomically, but only if the file still has the `expected` content (the text last read),
 * or, with `expected` null, doesn't exist yet. Throws FileChangedError / FileExistsError otherwise.
 */
export async function writeFile(path: string, contents: string, expected: string | null): Promise<void> {
	await invoke('write_synced_file', { path, contents, expected });
}

/**
 * Calls `onChange` (debounced) whenever the file may have changed on disk, including through our
 * own writes; callers compare contents. Watching another file replaces this watch.
 */
export async function watchFile(path: string, onChange: () => void): Promise<() => void> {
	const { listen } = await import('@tauri-apps/api/event');
	let timer: ReturnType<typeof setTimeout> | undefined;
	// sync tools and editors often write in several steps; wait until it settles
	const unlisten = await listen('synced-file-changed', () => {
		clearTimeout(timer);
		timer = setTimeout(onChange, 300);
	});
	try {
		await invoke('watch_synced_file', { path });
	} catch (e) {
		unlisten();
		throw e;
	}
	return () => {
		clearTimeout(timer);
		unlisten();
	};
}

export function fileNameOf(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}
