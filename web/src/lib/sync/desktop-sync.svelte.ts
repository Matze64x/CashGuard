/**
 * Syncing in the desktop app: phones connect to the Rust endpoint (`src-tauri/src/sync`), which
 * hands this window authenticated connections; the sync itself runs here (`SyncManager`). Also
 * pairing (QR codes), the paired phones and this PC's name.
 */
import type { SyncReport } from '../../core';
import { SyncManager } from './manager.svelte';
import type { Workspace } from '../workspace.svelte';

export interface DesktopInfo {
	readonly deviceId: string;
	readonly name: string;
	/** "ip:port" phones connect to; null: not on a local network */
	readonly address: string | null;
}

export interface PairedPhone {
	readonly id: string;
	readonly name: string;
	/** Unix seconds */
	readonly pairedAt: number;
}

export interface PairingQr {
	readonly payload: string;
	readonly svg: string;
	readonly seconds: number;
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		return await invoke<T>(command, args);
	} catch (e) {
		throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
	}
}

export class DesktopSync {
	readonly #workspace: Workspace;
	readonly manager: SyncManager;
	info = $state.raw<DesktopInfo | null>(null);
	phones = $state.raw<readonly PairedPhone[]>([]);
	/** Why syncing couldn't start */
	problem = $state<string | null>(null);
	readonly #connections = new Map<number, { receive: (text: string) => void; closed: () => void }>();
	/** Called when a phone was paired (e.g. to close the QR code) */
	onPaired: ((name: string) => void) | null = null;

	constructor(workspace: Workspace, report: (report: SyncReport) => void) {
		this.#workspace = workspace;
		this.manager = new SyncManager(workspace, () => ({ id: this.info!.deviceId, name: this.info!.name, kind: 'pc' }), report);
	}

	/** Listens for phones, then starts the endpoint. Returns the function that stops listening. */
	async start(): Promise<() => void> {
		const { listen } = await import('@tauri-apps/api/event');
		// a phone may connect before `sync_start` answered (this PC's id isn't known yet): its events
		// wait until then, in order
		let waiting: (() => void)[] | null = [];
		const inOrder = (handle: () => void) => (waiting ? waiting.push(handle) : handle());
		const stops = await Promise.all([
			listen<{ conn: number; phoneId: string; phoneName: string }>('sync-connected', ({ payload }) => inOrder(() => this.#connected(payload.conn, payload.phoneId))),
			listen<{ conn: number; text: string }>('sync-message', ({ payload }) => inOrder(() => this.#connections.get(payload.conn)?.receive(payload.text))),
			listen<number>('sync-closed', ({ payload }) =>
				inOrder(() => {
					this.#connections.get(payload)?.closed();
					this.#connections.delete(payload);
				}),
			),
			listen<{ phoneId: string; phoneName: string }>('sync-paired', ({ payload }) => {
				void this.refreshPhones();
				this.onPaired?.(payload.phoneName);
			}),
			listen<string | null>('sync-address', ({ payload }) => {
				if (this.info) this.info = { ...this.info, address: payload };
			}),
		]);
		try {
			this.info = await invoke<DesktopInfo>('sync_start');
			for (const handle of waiting.splice(0)) handle();
			waiting = null;
			await this.refreshPhones();
		} catch (e) {
			this.problem = e instanceof Error ? e.message : String(e);
		}
		return () => {
			for (const stop of stops) stop();
			this.manager.stop();
		};
	}

	#connected(conn: number, phoneId: string): void {
		// one message after the other: separate invokes could overtake each other
		let chain: Promise<unknown> = Promise.resolve();
		const handlers = this.manager.attach(
			{
				peerId: phoneId,
				send: (text) => void (chain = chain.then(() => invoke('sync_send', { conn, text })).catch(() => undefined)),
				close: () => void (chain = chain.then(() => invoke('sync_close', { conn })).catch(() => undefined)),
			},
			true,
		);
		this.#connections.set(conn, handlers);
	}

	async refreshPhones(): Promise<void> {
		this.phones = await invoke<PairedPhone[]>('sync_phones');
	}

	startPairing(): Promise<PairingQr> {
		return invoke<PairingQr>('sync_pairing_start');
	}

	stopPairing(): Promise<void> {
		return invoke('sync_pairing_stop');
	}

	/** Unpairs a phone: it can't connect any more until it's paired again. */
	async forget(phoneId: string): Promise<void> {
		await invoke('sync_forget', { phoneId });
		this.manager.forgetProblem(phoneId);
		await this.#workspace.forgetPeer(phoneId);
		await this.refreshPhones();
	}

	async rename(name: string): Promise<void> {
		this.info = await invoke<DesktopInfo>('sync_rename', { name });
	}
}
