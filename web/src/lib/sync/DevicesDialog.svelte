<!--
	The devices this one syncs with: pairing (a PC shows a QR code, a phone scans it), the paired
	devices with whether they're connected, removing one, and this device's name.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { errorMessage } from '../errors';
	import Modal from '../ui/Modal.svelte';
	import { DesktopSync, type PairingQr } from './desktop-sync.svelte';
	import { parsePairingCode } from './pairing-code';
	import type { PhoneSync } from './phone-sync.svelte';
	import QrScanner from './QrScanner.svelte';

	let { sync, onclose }: { sync: DesktopSync | PhoneSync; onclose: () => void } = $props();

	const desktop = $derived(sync instanceof DesktopSync ? sync : null);
	const phone = $derived(sync instanceof DesktopSync ? null : sync);
	const connected = $derived(new Set(sync.manager.connections.map((c) => c.peerId)));

	// svelte-ignore state_referenced_locally
	let name = $state(desktop ? (desktop.info?.name ?? '') : (phone?.device?.name ?? ''));
	let message = $state<string | null>(null);
	let failure = $state<string | null>(null);
	/** The device whose removal waits for a second click */
	let confirming = $state<string | null>(null);

	async function act(action: () => Promise<string | null | void>) {
		failure = null;
		message = null;
		try {
			message = (await action()) ?? null;
		} catch (e) {
			failure = errorMessage(e);
		}
	}

	function rename(event: SubmitEvent) {
		event.preventDefault();
		void act(async () => {
			await sync.rename(name);
			return 'Name saved. Other devices see it the next time they connect.';
		});
	}

	function remove(id: string) {
		if (confirming !== id) return void (confirming = id);
		confirming = null;
		void act(async () => {
			await sync.forget(id);
			return null;
		});
	}

	// ---- PC: show a pairing code
	let qr = $state.raw<PairingQr | null>(null);
	let left = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	function showCode() {
		void act(async () => {
			qr = await desktop!.startPairing();
			left = qr.seconds;
			clearInterval(timer);
			timer = setInterval(() => {
				left -= 1;
				if (left <= 0) hideCode();
			}, 1000);
			desktop!.onPaired = (phoneName) => {
				hideCode();
				message = `Paired with ${phoneName}.`;
			};
			return null;
		});
	}

	function hideCode() {
		clearInterval(timer);
		if (qr) void desktop?.stopPairing();
		qr = null;
		if (desktop) desktop.onPaired = null;
	}

	onDestroy(hideCode);

	// ---- phone: scan a PC's code
	let scanning = $state(false);
	let typed = $state('');
	let pairing = $state(false);

	function pairWith(text: string) {
		const code = parsePairingCode(text);
		if (!code) return void (failure = 'That’s not a CashGuard pairing code.');
		scanning = false;
		pairing = true;
		void act(async () => {
			try {
				const pcName = await phone!.pair(code);
				typed = '';
				return `Paired with ${pcName}. Syncing now.`;
			} finally {
				pairing = false;
			}
		});
	}

	const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	const STATUS: Record<string, string> = {
		starting: 'Starting…',
		unpaired: 'Not paired with a PC yet.',
		connecting: 'Connecting…',
		connected: 'Connected.',
		unreachable: 'No paired PC can be reached right now. It syncs once CashGuard runs on one of them and both are on the same network.',
		'other-tab': 'Another tab of CashGuard syncs; this one waits.',
	};
</script>

<Modal title="Devices" {onclose}>
	<div class="devices">
		{#if desktop}
			{#if desktop.problem}
				<p class="error" role="alert">Syncing can’t start: {desktop.problem}</p>
			{:else}
				<p class="muted">
					{desktop.info?.address ? 'Phones on the same network connect to this PC while CashGuard runs here.' : 'This PC isn’t on a local network right now, so phones can’t connect.'}
				</p>
			{/if}

			<h3>Phones</h3>
			{#if desktop.phones.length === 0}
				<p class="muted">No phone is paired yet.</p>
			{:else}
				<ul>
					{#each desktop.phones as p (p.id)}
						<li>
							<span class="name">{p.name}</span>
							<span class="state" class:on={connected.has(p.id)}>{connected.has(p.id) ? 'connected' : 'not connected'}</span>
							<button type="button" class:danger={confirming === p.id} onclick={() => remove(p.id)}>{confirming === p.id ? 'Remove for good' : 'Remove'}</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if qr}
				<div class="qr">
					<!-- (an SVG made by this app's own desktop side) -->
					<div class="code" aria-label="Pairing code">{@html qr.svg}</div>
					<p>In CashGuard on the phone: Devices → “Pair with a PC”, then point the camera at this code. It works once, for {minutes(left)} more.</p>
					<details>
						<summary>Can’t scan it?</summary>
						<p class="muted">Enter this code on the other device instead:</p>
						<code class="payload">{qr.payload}</code>
					</details>
					<button type="button" onclick={hideCode}>Stop pairing</button>
				</div>
			{:else}
				<button type="button" class="primary" disabled={!desktop.info?.address} onclick={showCode}>Pair a phone</button>
			{/if}
		{:else if phone}
			<p class="muted" aria-live="polite">{STATUS[phone.status]}</p>
			{#if phone.status === 'unreachable' && phone.problem}<p class="muted small">{phone.problem}</p>{/if}

			<h3>PCs</h3>
			{#if phone.pairings.length === 0}
				<p class="muted">No PC is paired yet.</p>
			{:else}
				<ul>
					{#each phone.pairings as p (p.pcId)}
						<li>
							<span class="name">{p.name}</span>
							<span class="state" class:on={connected.has(p.pcId)}>{connected.has(p.pcId) ? 'connected' : 'not connected'}</span>
							<button type="button" class:danger={confirming === p.pcId} onclick={() => remove(p.pcId)}>{confirming === p.pcId ? 'Remove for good' : 'Remove'}</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if scanning}
				<QrScanner accept={(text) => parsePairingCode(text) !== null} onfound={pairWith} />
				<button type="button" onclick={() => (scanning = false)}>Cancel</button>
			{:else}
				<p class="muted small">On the PC: CashGuard → Devices → “Pair a phone” shows the code.</p>
				<button type="button" class="primary" disabled={pairing} onclick={() => ((scanning = true), (failure = null), (message = null))}>
					{pairing ? 'Pairing…' : 'Pair with a PC'}
				</button>
				<details>
					<summary>Enter the code instead</summary>
					<form
						class="typed"
						onsubmit={(e) => {
							e.preventDefault();
							pairWith(typed);
						}}
					>
						<input type="text" autocomplete="off" spellcheck="false" aria-label="Pairing code" placeholder="CG1|…" bind:value={typed} />
						<button type="submit" disabled={pairing || !typed.trim()}>Pair</button>
					</form>
				</details>
			{/if}
		{/if}

		{#if failure}<p class="error" role="alert">{failure}</p>{/if}
		{#if message}<p class="ok" role="status">{message}</p>{/if}

		<h3>This device</h3>
		<form class="rename" onsubmit={rename}>
			<label for="device-name">Name</label>
			<input id="device-name" type="text" autocomplete="off" maxlength="64" bind:value={name} />
			<button type="submit">Save</button>
		</form>

		<div class="buttons"><button type="button" class="primary" onclick={onclose}>Done</button></div>
	</div>
</Modal>

<style>
	.devices {
		display: grid;
		gap: 0.6rem;
	}
	h3 {
		margin: 0.75rem 0 0;
		font-size: 1rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.state {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.state.on {
		color: var(--positive);
	}
	.muted {
		color: var(--muted);
		margin: 0;
	}
	.small {
		font-size: 0.85rem;
	}
	.error {
		color: var(--negative);
		margin: 0;
	}
	.ok {
		color: var(--positive);
		margin: 0;
	}
	.qr {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}
	.code {
		background: #fff;
		padding: 0.5rem;
		border-radius: 0.5rem;
		line-height: 0;
	}
	.code :global(svg) {
		width: min(16rem, 70vw);
		height: auto;
	}
	.qr p {
		margin: 0;
	}
	.payload {
		display: block;
		overflow-wrap: anywhere;
		user-select: all;
	}
	.typed,
	.rename {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.4rem;
	}
	.typed input,
	.rename input {
		flex: 1;
		min-width: 0;
	}
	.rename label {
		color: var(--muted);
	}
	button.danger {
		border-color: var(--negative);
		color: var(--negative);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}
</style>
