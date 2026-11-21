/**
 * Runs the sync (`core/peer-sync.ts`) over the open connections to other devices: one `PeerSession`
 * per connection, changes of the data passed on to all the other connections, and what each sync
 * brought in reported as a notice. The transports (WebRTC to phones, TLS between PCs) only hand it
 * authenticated connections.
 */
import { PeerSession, totalChanges, type DeviceInfo, type SyncReport } from '../../core';
import { errorMessage } from '../errors';
import type { Workspace } from '../workspace.svelte';

/** An open, authenticated connection to another device, carrying text messages in order */
export interface SyncConnection {
	/** The other device's id, as its key proved it */
	readonly peerId: string;
	send(text: string): void;
	/** Ends the connection (e.g. the sync failed) */
	close(): void;
}

export interface ConnectionState {
	readonly peer: DeviceInfo | null;
	readonly peerId: string;
	/** The last error that ended the sync on this connection */
	readonly error: string | null;
	/** When the last round finished (ms since 1970) */
	readonly lastSync: number | null;
}

/** Which side of a connection merges: the PC for a phone; between two PCs the lower id (both sides agree). */
export function isMerger(self: DeviceInfo, peerId: string, peerIsPhone: boolean): boolean {
	if (self.kind === 'phone') return false;
	return peerIsPhone || self.id < peerId;
}

interface Attached {
	readonly connection: SyncConnection;
	readonly session: PeerSession;
	state: ConnectionState;
}

export class SyncManager {
	readonly #workspace: Workspace;
	readonly #self: () => DeviceInfo;
	readonly #report: (report: SyncReport) => void;
	readonly #attached = new Set<Attached>();
	/** Connections and their state, for the screens */
	connections = $state.raw<readonly ConnectionState[]>([]);
	#stopListening: () => void;

	/**
	 * `self`: this device (read at each new connection, so a renamed device introduces itself by its
	 * new name). `report`: called after each round that changed something here.
	 */
	constructor(workspace: Workspace, self: () => DeviceInfo, report: (report: SyncReport) => void) {
		this.#workspace = workspace;
		this.#self = self;
		this.#report = report;
		this.#stopListening = workspace.onChange((cause) => {
			for (const a of this.#attached) if (a.connection.peerId !== cause) a.session.localChanged();
		});
	}

	/**
	 * Starts syncing over a new connection. `peerIsPhone`: what the transport knows about the other
	 * side (phones connect over WebRTC). Returns the function to call with each received message,
	 * and the one to call when the connection closed.
	 */
	attach(connection: SyncConnection, peerIsPhone: boolean): { receive: (text: string) => void; closed: () => void } {
		const self = this.#self();
		const attached: Attached = {
			connection,
			state: { peer: null, peerId: connection.peerId, error: null, lastSync: null },
			session: new PeerSession({
				self,
				merger: isMerger(self, connection.peerId, peerIsPhone),
				store: this.#workspace,
				peerId: connection.peerId,
				send: (message) => connection.send(JSON.stringify(message)),
				onSynced: (report) => {
					this.#update(attached, { peer: report.peer, lastSync: Date.now(), error: null });
					if (totalChanges(report.changes) > 0) this.#report(report);
				},
				onFailed: (error) => {
					this.#update(attached, { error: error.message });
					connection.close();
				},
			}),
		};
		this.#attached.add(attached);
		this.#publish();
		attached.session.start();
		return {
			receive: (text) => {
				let message;
				try {
					message = JSON.parse(text);
				} catch (e) {
					this.#update(attached, { error: `Unreadable message: ${errorMessage(e)}` });
					connection.close();
					return;
				}
				attached.session.receive(message);
			},
			closed: () => {
				this.#attached.delete(attached);
				this.#publish();
			},
		};
	}

	#update(attached: Attached, changes: Partial<ConnectionState>): void {
		attached.state = { ...attached.state, ...changes, peer: changes.peer ?? attached.state.peer ?? attached.session.peer };
		this.#publish();
	}

	#publish(): void {
		this.connections = [...this.#attached].map((a) => a.state);
	}

	stop(): void {
		this.#stopListening();
		for (const a of this.#attached) a.connection.close();
		this.#attached.clear();
		this.#publish();
	}
}
