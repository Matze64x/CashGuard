/**
 * The desktop app's syncing screens and wiring, in a normal browser against a fake Tauri backend
 * (like `desktop.spec.ts`): the endpoint's commands and events are faked, and a phone's side of
 * the sync runs here in the test (`core/peer-sync.ts`), connected through the fake's `sync_send`
 * command and `sync-message` events.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addTransaction, cents, EMPTY_DATA, PeerSession, type CashGuardData, type CivilDate, type DeviceInfo, type StoredBase, type SyncMessage, type UtcSeconds } from '../../src/core';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');
const PC_ID = '00000000000000aa';
const PHONE_ID = '0123456789abcdef';
/** Another PC, with a lower id than this one: it merges, this PC is its client */
const LAPTOP_ID = '0000000000000011';

interface Fake {
	phones: { id: string; name: string; pairedAt: number }[];
	pcs: { id: string; name: string; pairedAt: number }[];
	found: { id: string; name: string }[];
	calls: string[];
	name: string;
	enabled: boolean;
	emit(event: string, payload: unknown): void;
}

async function installFakeTauri(page: Page) {
	await page.addInitScript(
		({ pcId, file, content }) => {
			const callbacks: Record<number, (payload: unknown) => void> = {};
			const listeners = new Map<number, string>();
			let nextId = 1;
			const fake = {
				phones: [] as { id: string; name: string; pairedAt: number }[],
				pcs: [] as { id: string; name: string; pairedAt: number }[],
				found: [] as { id: string; name: string }[],
				calls: [] as string[],
				name: 'Desk',
				enabled: false,
				emit: (event: string, payload: unknown) => listeners.forEach((name, id) => name === event && callbacks[id]?.({ event, id, payload })),
			};
			const info = () => ({ deviceId: pcId, name: fake.name, enabled: fake.enabled, address: fake.enabled ? '10.0.0.2:47652' : null });
			const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
				'plugin:dialog|open': () => file,
				read_file: () => content,
				data_location: () => ['/home/me/.local/share/matze64x.cashguard', false],
				sync_start: () => (fake.calls.push('start'), info()),
				// (the real bridge hands over a fresh copy each time)
				sync_phones: () => JSON.parse(JSON.stringify(fake.phones)),
				sync_pairing_start: () => ({ payload: `CG1|10.0.0.2|47652|u|p|${'ab'.repeat(32)}|secret|${pcId}`, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', seconds: 300 }),
				sync_pairing_stop: () => void fake.calls.push('pairing_stop'),
				sync_forget: ({ phoneId }) => {
					fake.calls.push(`forget ${phoneId}`);
					fake.phones = fake.phones.filter((p) => p.id !== phoneId);
				},
				sync_rename: ({ name }) => ((fake.name = name as string), info()),
				sync_set_enabled: ({ enabled }) => (fake.calls.push(`enabled ${enabled}`), (fake.enabled = enabled as boolean), info()),
				sync_pcs: () => JSON.parse(JSON.stringify({ paired: fake.pcs, found: fake.found })),
				sync_pc_pair: ({ peerId }) => void fake.calls.push(`pair ${peerId}`),
				sync_pc_pair_confirm: ({ code }) => void fake.calls.push(`confirm ${code}`),
				sync_pc_pairing_allowed: ({ allowed }) => void fake.calls.push(`allowed ${allowed}`),
				sync_pc_pair_cancel: () => void fake.calls.push('cancel'),
				sync_forget_pc: ({ peerId }) => {
					fake.calls.push(`forget pc ${peerId}`);
					fake.pcs = fake.pcs.filter((p) => p.id !== peerId);
				},
				// the phone's side runs in the test
				sync_send: ({ conn, text }) => (window as never as { __toPhone: (conn: number, text: string) => Promise<void> }).__toPhone(conn as number, text as string),
				sync_close: ({ conn }) => void fake.calls.push(`close ${conn}`),
				'plugin:event|listen': ({ event, handler }) => (listeners.set(handler as number, event as string), handler),
				'plugin:event|unlisten': ({ eventId }) => void listeners.delete(eventId as number),
			};
			Object.assign(window, {
				fake,
				__TAURI_INTERNALS__: {
					metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
					invoke: async (cmd: string, args: Record<string, unknown>) => {
						const command = commands[cmd];
						if (!command) throw `unknown command ${cmd}`;
						return command(args);
					},
					transformCallback: (callback: (payload: unknown) => void) => {
						const id = nextId++;
						callbacks[id] = callback;
						return id;
					},
				},
				__TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
			});
		},
		{ pcId: PC_ID, file: '/home/me/cashguard.json', content: FIXTURE },
	);
}

const emit = (page: Page, event: string, payload: unknown) => page.evaluate(([event, payload]) => (window as never as { fake: Fake }).fake.emit(event as string, payload), [event, payload] as const);
/** The header button that opens Devices (its text shows the sync state) */
const devicesButton = (page: Page) => page.getByTitle('Devices and syncing');

/** Turns networking on (it's off at every start) */
async function turnOn(page: Page) {
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await dialog.getByRole('switch', { name: 'Sync with my devices on the local network' }).check();
	await expect.poll(async () => (await fake(page)).calls).toContain('enabled true');
	await dialog.getByRole('button', { name: 'Done' }).click();
}

const fake = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as never as { fake: Fake }).fake)) as Fake);

/** Another device (a phone, or a PC that merges): its side of the sync with an in-memory store */
class Phone {
	working: CashGuardData = EMPTY_DATA;
	bases = new Map<string, StoredBase>();
	session: PeerSession;
	errors: string[] = [];
	/** Messages to the PC go one after the other (separate page calls could overtake each other) */
	#chain: Promise<unknown> = Promise.resolve();

	constructor(page: Page, conn: number, self: DeviceInfo = { id: PHONE_ID, name: 'My iPhone', kind: 'phone' }) {
		this.session = new PeerSession({
			self,
			merger: self.kind === 'pc',
			peerId: PC_ID,
			store: {
				current: () => this.working,
				transact: async (peer, change) => {
					const r = change(this.working, this.bases.get(peer) ?? null);
					this.working = r.working;
					if (r.base) this.bases.set(peer, r.base);
					return r.value;
				},
			},
			// (a message still on its way when the test ends goes nowhere)
			send: (message) => void (this.#chain = this.#chain.then(() => emit(page, 'sync-message', { conn, text: JSON.stringify(message) })).catch(() => undefined)),
			onFailed: (e) => this.errors.push(e.message),
		});
	}
}

test.beforeEach(async ({ page }) => {
	await installFakeTauri(page);
	await page.goto('/');
});

async function importFixture(page: Page) {
	await page.getByRole('button', { name: 'Import' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

test('pairing a phone: the code shows until the phone paired, then it is listed', async ({ page }) => {
	await turnOn(page);
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await expect(dialog).toContainText('No phones paired.');
	await dialog.getByRole('button', { name: 'Pair a phone' }).click();
	await expect(dialog.getByLabel('Pairing code')).toBeVisible();
	await expect(dialog).toContainText('Valid for');

	await page.evaluate(() => (window as never as { fake: Fake }).fake.phones.push({ id: '0123456789abcdef', name: 'My iPhone', pairedAt: 0 }));
	await emit(page, 'sync-paired', { phoneId: PHONE_ID, phoneName: 'My iPhone' });
	await expect(dialog.getByRole('status')).toContainText('Paired with My iPhone.');
	await expect(dialog.getByLabel('Pairing code')).toBeHidden();
	await expect(dialog.getByText('My iPhone', { exact: true })).toBeVisible();
	await expect(dialog.getByText('not connected')).toBeVisible();

	// removing needs a second click
	await dialog.getByRole('button', { name: 'Remove' }).click();
	await dialog.getByRole('button', { name: 'Remove for good' }).click();
	await expect(dialog).toContainText('No phones paired.');
	expect((await fake(page)).calls).toContain(`forget ${PHONE_ID}`);
});

test('renaming this PC', async ({ page }) => {
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await expect(dialog.getByLabel('Name')).toHaveValue('Desk');
	await dialog.getByLabel('Name').fill('Office PC');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog.getByRole('status')).toContainText('Name saved');
	expect((await fake(page)).name).toBe('Office PC');
});

test('a connected phone syncs with the PC both ways, in order, and the header says so', async ({ page }) => {
	await importFixture(page);
	await turnOn(page);
	const phone = new Phone(page, 7);
	phone.working = addTransaction(EMPTY_DATA, { date: '2026-11-01' as CivilDate, description: 'Bought on the phone', categoryId: '0' as never, amount: cents(-250) }, 1_900_000_000 as UtcSeconds).data;
	// messages from the PC go to the phone in the order they were sent
	const received: SyncMessage[] = [];
	await page.exposeBinding('__toPhone', async (_source, conn: number, text: string) => {
		expect(conn).toBe(7);
		const message = JSON.parse(text) as SyncMessage;
		received.push(message);
		phone.session.receive(message);
	});
	await emit(page, 'sync-connected', { conn: 7, peerId: PHONE_ID, peerName: 'My iPhone', kind: 'phone' });
	phone.session.start();

	await expect(page.getByText('47 transactions')).toBeVisible();
	await expect.poll(() => phone.working.transactions.length).toBe(47);
	await expect(page.getByRole('button', { name: '1 connected' })).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Synced with My iPhone. Transactions: 1 added.');
	expect(received[0]!.type).toBe('hello');

	// an edit on the PC reaches the phone
	await page.keyboard.press('n');
	await page.keyboard.type('Bought at the desk');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press('Enter');
	await expect.poll(() => phone.working.transactions.some((t) => t.description === 'Bought at the desk')).toBe(true);

	// the phone goes away
	await emit(page, 'sync-closed', 7);
	await expect(page.getByRole('button', { name: 'Devices' })).toBeVisible();
	expect(phone.errors).toEqual([]);
});

test('pairing with another PC: both compare the code, then it is listed', async ({ page }) => {
	await page.evaluate((id) => ((window as never as { fake: Fake }).fake.found = [{ id, name: 'Laptop' }]), LAPTOP_ID);
	await turnOn(page);
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	const onNetwork = dialog.getByRole('list', { name: 'PCs on this network' });
	await expect(onNetwork).toContainText('Laptop');
	await onNetwork.getByRole('button', { name: 'Pair' }).click();
	await expect.poll(async () => (await fake(page)).calls).toContain(`pair ${LAPTOP_ID}`);

	await emit(page, 'sync-pc-pairing', { state: 'code', code: '123 456', peerId: LAPTOP_ID, peerName: 'Laptop', incoming: false });
	const pairing = dialog.getByRole('group', { name: 'Pairing with Laptop' });
	await expect(pairing.getByLabel('Code')).toHaveText('123 456');
	await pairing.getByRole('button', { name: 'Same code' }).click();
	await expect(pairing.getByRole('button', { name: 'Waiting for Laptop…' })).toBeDisabled();
	// (with the code seen: it never confirms another pairing's code)
	expect((await fake(page)).calls).toContain('confirm 123 456');

	await page.evaluate((id) => (window as never as { fake: Fake }).fake.pcs.push({ id, name: 'Laptop', pairedAt: 0 }), LAPTOP_ID);
	await emit(page, 'sync-pc-pairing', { state: 'done', peerId: LAPTOP_ID, peerName: 'Laptop' });
	await expect(dialog.getByRole('status')).toContainText('Paired with Laptop.');
	await expect(pairing).toBeHidden();
	// listed as paired, no longer as one to pair with
	await expect(dialog.getByText('not connected')).toBeVisible();
	await expect(onNetwork).toBeHidden();

	// a PC that removed this one says so
	await emit(page, 'sync-pc-refused', { peerId: LAPTOP_ID, reason: 'Laptop removed this PC. Remove it here and pair again.' });
	await expect(dialog).toContainText('Laptop removed this PC.');
	await dialog.getByRole('button', { name: 'Remove' }).click();
	await dialog.getByRole('button', { name: 'Remove for good' }).click();
	await expect.poll(async () => (await fake(page)).calls).toContain(`forget pc ${LAPTOP_ID}`);
	// on the network still, so it can be paired again
	await expect(onNetwork).toContainText('Laptop');
});

test('other PCs can pair only while Devices is open; their code shows there, and cancelling tells them', async ({ page }) => {
	await turnOn(page);
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await expect.poll(async () => (await fake(page)).calls.filter((c) => c.startsWith('allowed')).at(-1)).toBe('allowed true');
	await emit(page, 'sync-pc-pairing', { state: 'code', code: '654 321', peerId: LAPTOP_ID, peerName: 'Laptop', incoming: true });
	const pairing = dialog.getByRole('group', { name: 'Pairing with Laptop' });
	await expect(pairing.getByLabel('Code')).toHaveText('654 321');
	await pairing.getByRole('button', { name: 'Cancel' }).click();
	await expect(pairing).toBeHidden();
	await expect.poll(async () => (await fake(page)).calls).toContain('cancel');

	// the other side cancelling shows why
	await emit(page, 'sync-pc-pairing', { state: 'code', code: '111 222', peerId: LAPTOP_ID, peerName: 'Laptop', incoming: true });
	await expect(pairing).toBeVisible();
	await emit(page, 'sync-pc-pairing', { state: 'failed', reason: 'Cancelled on Laptop.' });
	await expect(dialog.getByRole('alert')).toHaveText('Cancelled on Laptop.');
});

test('another PC syncs with this one both ways (here as the client: the lower id merges)', async ({ page }) => {
	await importFixture(page);
	await turnOn(page);
	const laptop = new Phone(page, 9, { id: LAPTOP_ID, name: 'Laptop', kind: 'pc' });
	laptop.working = addTransaction(EMPTY_DATA, { date: '2026-11-02' as CivilDate, description: 'Bought on the laptop', categoryId: '0' as never, amount: cents(-300) }, 1_900_000_100 as UtcSeconds).data;
	await page.exposeBinding('__toPhone', async (_source, conn: number, text: string) => {
		expect(conn).toBe(9);
		laptop.session.receive(JSON.parse(text) as SyncMessage);
	});
	await emit(page, 'sync-connected', { conn: 9, peerId: LAPTOP_ID, peerName: 'Laptop', kind: 'pc' });
	laptop.session.start();

	await expect(page.getByText('47 transactions')).toBeVisible();
	await expect.poll(() => laptop.working.transactions.length).toBe(47);
	await expect(page.getByRole('status')).toContainText('Synced with Laptop. Transactions: 1 added.');

	// an edit here reaches the laptop
	await page.keyboard.press('n');
	await page.keyboard.type('Bought at the desk');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press('Enter');
	await expect.poll(() => laptop.working.transactions.some((t) => t.description === 'Bought at the desk')).toBe(true);
	expect(laptop.errors).toEqual([]);
});

test('closing Devices stops other PCs from pairing and cancels a pairing under way', async ({ page }) => {
	await page.evaluate((id) => ((window as never as { fake: Fake }).fake.found = [{ id, name: 'Laptop' }]), LAPTOP_ID);
	await turnOn(page);
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await dialog.getByRole('list', { name: 'PCs on this network' }).getByRole('button', { name: 'Pair' }).click();
	await expect(dialog.getByRole('button', { name: 'Pairing…' })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect.poll(async () => (await fake(page)).calls).toEqual(expect.arrayContaining(['allowed false', 'cancel']));
	// an attempt nobody saw here isn't reported
	await emit(page, 'sync-pc-pairing', { state: 'failed', reason: 'The connection to Stranger ended.' });
	await devicesButton(page).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.getByRole('list', { name: 'PCs on this network' }).getByRole('button', { name: 'Pair' })).toBeEnabled();
});

test('networking is off at every start; the switch turns it on and off', async ({ page }) => {
	await expect(devicesButton(page)).toHaveText('Sync off');
	await devicesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	const toggle = dialog.getByRole('switch', { name: 'Sync with my devices on the local network' });
	await expect(toggle).not.toBeChecked();
	await expect(dialog.getByRole('button', { name: 'Pair a phone' })).toBeDisabled();
	await toggle.check();
	await expect(dialog.getByRole('button', { name: 'Pair a phone' })).toBeEnabled();
	await toggle.uncheck();
	await expect.poll(async () => (await fake(page)).calls).toEqual(expect.arrayContaining(['enabled true', 'enabled false']));
	await expect(dialog.getByRole('button', { name: 'Pair a phone' })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(devicesButton(page)).toHaveText('Sync off');
});

test('a device that synced before shows when', async ({ page }) => {
	await page.evaluate((id) => localStorage.setItem('cashguard-last-synced-v1', JSON.stringify({ [id]: Date.now() - 5 * 60_000 })), PHONE_ID);
	await page.reload();
	// (paired after the app loaded its list: it reloads it on this event)
	await expect.poll(async () => (await fake(page)).calls).toContain('start');
	await page.evaluate((id) => (window as never as { fake: Fake }).fake.phones.push({ id, name: 'My iPhone', pairedAt: 0 }), PHONE_ID);
	await emit(page, 'sync-paired', { phoneId: PHONE_ID, phoneName: 'My iPhone' });
	await turnOn(page);
	await devicesButton(page).click();
	await expect(page.getByRole('dialog', { name: 'Devices' })).toContainText('synced 5 min ago');
});
