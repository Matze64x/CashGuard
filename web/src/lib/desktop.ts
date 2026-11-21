/**
 * Files in the desktop app (Tauri): choosing, reading and writing them, and the window closing.
 * Only call these when `isDesktop` is true; the Tauri modules are loaded on demand, so the browser
 * build doesn't need them.
 */
import { errorMessage } from './errors';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const FILTERS = [{ name: 'CashGuard file', extensions: ['json'] }];

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		return await invoke<T>(command, args);
	} catch (e) {
		throw new Error(errorMessage(e));
	}
}

/** Lets the user pick an existing CashGuard file. Returns its path, or null if cancelled. */
export async function chooseExistingFile(title: string): Promise<string | null> {
	const { open } = await import('@tauri-apps/plugin-dialog');
	return open({ title, filters: FILTERS, multiple: false, directory: false });
}

/** Lets the user choose where to save a CashGuard file (the dialog asks before replacing one). Returns its path, or null. */
export async function chooseFileToSave(title: string, defaultPath: string): Promise<string | null> {
	const { save } = await import('@tauri-apps/plugin-dialog');
	const path = await save({ title, filters: FILTERS, defaultPath });
	return path && !/\.json$/i.test(path) ? `${path}.json` : path;
}

export function readFile(path: string): Promise<string> {
	return invoke<string>('read_file', { path });
}

/** Writes atomically: the file has either its old content or all of the new one, never a part. */
export async function writeFile(path: string, contents: string): Promise<void> {
	await invoke('write_file', { path, contents });
}

/** Where the desktop app keeps its own data (working copy, settings), and whether that's the portable folder. */
export async function dataLocation(): Promise<{ path: string; portable: boolean } | null> {
	const location = await invoke<[string, boolean] | null>('data_location', {});
	return location && { path: location[0], portable: location[1] };
}

/** Runs `beforeClose` (e.g. writing the backup) when the window is about to close, then closes it. */
export async function onWindowClose(beforeClose: () => Promise<void>): Promise<() => void> {
	const { getCurrentWindow } = await import('@tauri-apps/api/window');
	// the window closes once the handler is done (it's awaited)
	return getCurrentWindow().onCloseRequested(async () => {
		// closing must not hang on a slow disk, and a failure was shown already
		await Promise.race([beforeClose().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5000))]);
	});
}

export function fileNameOf(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}
