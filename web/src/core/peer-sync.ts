/**
 * Syncing the data between two devices over a connection, platform-independent (the transport,
 * pairing and storage are someone else's job: see `SyncStore` and `PeerSession.send`).
 *
 * Each pair of devices keeps a **base**: the data they last agreed on. One side of the connection
 * is the **merger** (the PC for a phone; the lower device id between two PCs), the other the
 * **client**. Only the client starts a round, so rounds on one connection never overlap:
 *
 *   client                                   merger
 *   state { base: hash, data | null }  ──▶   merge(base, mine, theirs); save it as working copy
 *                                             and as the new base for this client, atomically
 *                                     ◀──   result { hash, data | null (= what you sent) }
 *   save the result as working copy and as
 *   the new base, atomically
 *
 * - The client sends its data only if it differs from the base (else the merger knows it).
 * - If the base the client names isn't the merger's (one side lost or never had it), the merge
 *   runs without a base: nothing counts as deleted, both sides are combined. That errs towards
 *   keeping data. If the client sent no data then, the merger asks for it (`resend`).
 * - If the client's data changed while the round was under way, its new edits are merged on top of
 *   the result (three-way: what it sent, what it has now, the result), and another round follows.
 * - When the merger's data changes (an edit, another device), it tells the client (`changed`),
 *   which then starts a round. So changes travel on: phone → PC → other PCs → their phones.
 * - Saving the working copy and the base together (one storage transaction) keeps them consistent
 *   even if the app is closed halfway.
 * Data travels in the file format, so it's checked like a file; both sides must use the same
 * format version and protocol (checked in `hello`).
 */
import { FORMAT_VERSION, parseCashGuard, serializeCashGuard } from './format';
import { merge, type MergeResult } from './merge';
import type { CashGuardData } from './model';
import { summarizeChanges, type ChangeSummary } from './sync';

export const SYNC_PROTOCOL = 1;

export type DeviceKind = 'pc' | 'phone';

export interface DeviceInfo {
	readonly id: string;
	readonly name: string;
	readonly kind: DeviceKind;
}

export type SyncMessage =
	| { readonly type: 'hello'; readonly protocol: number; readonly format: string; readonly device: DeviceInfo }
	| { readonly type: 'state'; readonly base: string | null; readonly data: string | null }
	| { readonly type: 'resend' }
	| { readonly type: 'result'; readonly hash: string; readonly data: string | null }
	| { readonly type: 'changed' }
	| { readonly type: 'error'; readonly message: string };

export interface StoredBase {
	readonly data: CashGuardData;
	/** `hashText` of its file text */
	readonly hash: string;
}

/** The working copy and the bases, as the app stores them. */
export interface SyncStore {
	current(): CashGuardData;
	/**
	 * Runs `change` on the current working copy and this peer's base, atomically with any other
	 * change to the data, and saves what it returns (working copy and base in one go; returning the
	 * same objects saves nothing). Returns `change`'s `value`.
	 */
	transact<T>(peer: string, change: (working: CashGuardData, base: StoredBase | null) => { working: CashGuardData; base: StoredBase | null; value: T }): Promise<T>;
}

/** What a finished round changed in this device's data, and the conflicts the merge decided. */
export interface SyncReport {
	readonly peer: DeviceInfo;
	readonly changes: ChangeSummary;
	readonly conflicts: number;
}

/**
 * A fast 64-bit hash of a text (two 32-bit FNV-1a variants over the UTF-16 code units), as 16 hex
 * digits. Only to tell whether two devices have the same base; not for security (the connection
 * is authenticated and encrypted by the transport).
 */
export function hashText(text: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ text.length;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193);
		b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
	}
	return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).toLowerCase();
}

export class SyncError extends Error {}

function parseData(text: string): CashGuardData {
	const result = parseCashGuard(text);
	if (!result.ok) {
		const [first] = result.errors;
		throw new SyncError(`The other device sent data that isn't valid (${first?.path || 'data'}: ${first?.message}).`);
	}
	return result.data;
}

/** The file text of data, made once per data object (they're never changed) */
const texts = new WeakMap<CashGuardData, string>();
function textOf(data: CashGuardData): string {
	let text = texts.get(data);
	if (text === undefined) texts.set(data, (text = serializeCashGuard(data)));
	return text;
}
const hashes = new WeakMap<CashGuardData, string>();
function hashOf(data: CashGuardData): string {
	let hash = hashes.get(data);
	if (hash === undefined) hashes.set(data, (hash = hashText(textOf(data))));
	return hash;
}

function baseOf(data: CashGuardData): StoredBase {
	return { data, hash: hashOf(data) };
}

function conflictCount(result: MergeResult): number {
	const c = result.conflicts;
	return c.transactions.length + c.categories.length + c.accounts.length + c.recurring.length;
}

/** Same data (as the file would store it), regardless of object identity (by hash: a 64-bit collision is negligible) */
function sameData(a: CashGuardData, b: CashGuardData): boolean {
	return a === b || hashOf(a) === hashOf(b);
}

export interface PeerSessionOptions {
	readonly self: DeviceInfo;
	/** Whether this side merges (else it's the client and starts the rounds) */
	readonly merger: boolean;
	readonly store: SyncStore;
	/**
	 * The other device's id as the transport authenticated it (its key). A `hello` naming another id
	 * is refused, so a paired device can't pass itself off as another one (and use its base).
	 */
	readonly peerId: string;
	/** Sends a message to the other device (the transport serializes it) */
	readonly send: (message: SyncMessage) => void;
	/** A round changed this device's data (or found nothing to change) */
	readonly onSynced?: (report: SyncReport) => void;
	/** The session can't go on (wrong version, invalid data, …); the transport should close the connection */
	readonly onFailed?: (error: Error) => void;
}

/**
 * One connection's sync, for either side. Feed it the other side's messages (`receive`) and tell
 * it when this device's data changed (`localChanged`). Messages are handled one at a time.
 */
export class PeerSession {
	readonly #options: PeerSessionOptions;
	#peer: DeviceInfo | null = null;
	#failed = false;
	#queue: Promise<void> = Promise.resolve();
	/** Client: a round is under way (state sent, result not yet received) */
	#inRound = false;
	/** Client: start another round when this one is done */
	#again = false;
	/** Client: the working copy sent in the current round */
	#sent: CashGuardData | null = null;

	constructor(options: PeerSessionOptions) {
		this.#options = options;
	}

	get peer(): DeviceInfo | null {
		return this.#peer;
	}

	/** Starts the session: both sides introduce themselves first. */
	start(): void {
		const { self } = this.#options;
		this.#options.send({ type: 'hello', protocol: SYNC_PROTOCOL, format: FORMAT_VERSION, device: self });
	}

	receive(message: SyncMessage): void {
		this.#queue = this.#queue.then(() => this.#handle(message)).catch((e: unknown) => this.#fail(e instanceof Error ? e : new Error(String(e))));
	}

	/** This device's data changed (an edit, or another device): pass it on. */
	localChanged(): void {
		if (this.#failed || !this.#peer) return;
		if (this.#options.merger) this.#options.send({ type: 'changed' });
		else this.#queue = this.#queue.then(() => this.#startRound()).catch((e: unknown) => this.#fail(e instanceof Error ? e : new Error(String(e))));
	}

	#fail(error: Error): void {
		if (this.#failed) return;
		this.#failed = true;
		if (!(error instanceof RemoteError)) this.#options.send({ type: 'error', message: error.message });
		this.#options.onFailed?.(error);
	}

	async #handle(message: SyncMessage): Promise<void> {
		if (this.#failed) return;
		if (message.type === 'error') throw new RemoteError(`The other device stopped syncing: ${message.message}`);
		if (message.type === 'hello') return this.#hello(message);
		if (!this.#peer) throw new SyncError('The other device did not introduce itself.');
		const { merger } = this.#options;
		switch (message.type) {
			case 'state':
				if (!merger) throw new SyncError('Unexpected state message.');
				return this.#merge(message.base, message.data);
			case 'resend':
				if (merger || !this.#inRound) throw new SyncError('Unexpected resend message.');
				return this.#sendState(true);
			case 'result':
				if (merger || !this.#inRound) throw new SyncError('Unexpected result message.');
				return this.#applyResult(message.hash, message.data);
			case 'changed':
				if (merger) throw new SyncError('Unexpected changed message.');
				return this.#startRound();
		}
	}

	async #hello(message: SyncMessage & { type: 'hello' }): Promise<void> {
		if (this.#peer) throw new SyncError('The other device introduced itself twice.');
		if (message.device.id !== this.#options.peerId) throw new SyncError("The other device's identity doesn't match its key.");
		if (message.protocol !== SYNC_PROTOCOL) throw new SyncError(`The other device (${message.device.name}) uses another version of CashGuard. Update both to the latest version.`);
		if (message.format !== FORMAT_VERSION) throw new SyncError(`The other device (${message.device.name}) uses another data format (${message.format}). Update both to the latest version.`);
		this.#peer = message.device;
		// the client starts with a round, so both sides catch up right after connecting
		if (!this.#options.merger) await this.#startRound();
	}

	// ---------------------------------------------------------------- client

	async #startRound(): Promise<void> {
		if (this.#inRound) {
			this.#again = true;
			return;
		}
		this.#inRound = true;
		this.#again = false;
		await this.#sendState(false);
	}

	/** `full`: send the data even if it equals the base (the merger doesn't have our base) */
	async #sendState(full: boolean): Promise<void> {
		const peer = this.#peer!;
		const { working, base } = await this.#options.store.transact(peer.id, (working, base) => ({ working, base, value: { working, base } }));
		this.#sent = working;
		const unchanged = !full && base !== null && (base.data === working || base.hash === hashOf(working));
		this.#options.send({ type: 'state', base: base?.hash ?? null, data: unchanged ? null : textOf(working) });
	}

	async #applyResult(hash: string, data: string | null): Promise<void> {
		const peer = this.#peer!;
		const sent = this.#sent!;
		const result = data === null ? sent : parseData(data);
		const base = baseOf(result);
		if (base.hash !== hash) throw new SyncError("The other device's result didn't arrive intact.");
		const report = await this.#options.store.transact(peer.id, (working) => {
			// edits made here since the state was sent are merged on top of the result
			const merged = working === sent ? null : merge(sent, working, result);
			const next = merged ? merged.data : result;
			const unchanged = sameData(next, working);
			return {
				working: unchanged ? working : next,
				base,
				value: { changes: summarizeChanges(working, unchanged ? working : next), conflicts: merged ? conflictCount(merged) : 0, again: merged !== null && !sameData(next, result) },
			};
		});
		this.#inRound = false;
		this.#sent = null;
		this.#options.onSynced?.({ peer, changes: report.changes, conflicts: report.conflicts });
		if (report.again || this.#again) await this.#startRound();
	}

	// ---------------------------------------------------------------- merger

	async #merge(baseHash: string | null, data: string | null): Promise<void> {
		const peer = this.#peer!;
		const theirsSent = data === null ? null : parseData(data);
		const outcome = await this.#options.store.transact(peer.id, (working, stored) => {
			const base = stored !== null && baseHash !== null && stored.hash === baseHash ? stored : null;
			// "unchanged" only means something if we have the same base
			if (theirsSent === null && base === null) return { working, base: stored, value: null };
			const theirs = theirsSent ?? base!.data;
			// nothing changed on either side since the base: nothing to merge
			if (base !== null && sameData(theirs, base.data) && sameData(working, base.data)) {
				return { working, base: stored, value: { next: working, newBase: base, theirs, changes: summarizeChanges(working, working), conflicts: 0 } };
			}
			const merged = merge(base?.data ?? null, working, theirs);
			const next = sameData(merged.data, working) ? working : merged.data;
			const newBase = baseOf(next);
			return {
				working: next,
				base: newBase,
				value: { next, newBase, theirs, changes: summarizeChanges(working, next), conflicts: conflictCount(merged) },
			};
		});
		if (outcome === null) {
			this.#options.send({ type: 'resend' });
			return;
		}
		const { next, newBase, theirs, changes, conflicts } = outcome;
		this.#options.send({ type: 'result', hash: newBase.hash, data: sameData(next, theirs) ? null : textOf(next) });
		this.#options.onSynced?.({ peer, changes, conflicts });
	}
}

/** The other side reported an error (not sent back to it). */
class RemoteError extends SyncError {}
