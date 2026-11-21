/**
 * The desktop app's syncing screens and wiring, in a normal browser against a fake Tauri backend
 * (like `desktop.spec.ts`): the endpoint's commands and events are faked, and a phone's side of
 * the sync runs here in the test (`core/peer-sync.ts`), connected through the fake's `sync_send`
 * command and `sync-message` events.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addTransaction, cents, EMPTY_DATA, PeerSession, type CashGuardData, type CivilDate, type StoredBase, type SyncMessage, type UtcSeconds } from '../../src/core';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');
const PC_ID = '00000000000000aa';
const PHONE_ID = '0123456789abcdef';

interface Fake {
	phones: { id: string; name: string; pairedAt: number }[];
	calls: string[];
	name: string;
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
				calls: [] as string[],
				name: 'Desk',
				emit: (event: string, payload: unknown) => listeners.forEach((name, id) => name === event && callbacks[id]?.({ event, id, payload })),
			};
			const info = () => ({ deviceId: pcId, name: fake.name, address: '10.0.0.2:47652' });
			const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
				'plugin:dialog|open': () => file,
				read_file: () => content,
				data_location: () => ['/home/me/.local/share/matze64x.cashguard', false],
				sync_start: () => info(),
				// (the real bridge hands over a fresh copy each time)
				sync_phones: () => JSON.parse(JSON.stringify(fake.phones)),
				sync_pairing_start: () => ({ payload: `CG1|10.0.0.2|47652|u|p|${'ab'.repeat(32)}|secret|${pcId}`, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', seconds: 300 }),
				sync_pairing_stop: () => void fake.calls.push('pairing_stop'),
				sync_forget: ({ phoneId }) => {
					fake.calls.push(`forget ${phoneId}`);
					fake.phones = fake.phones.filter((p) => p.id !== phoneId);
				},
				sync_rename: ({ name }) => ((fake.name = name as string), info()),
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
const fake = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as never as { fake: Fake }).fake)) as Fake);

/** A phone: the sync's client side with an in-memory store */
class Phone {
	working: CashGuardData = EMPTY_DATA;
	bases = new Map<string, StoredBase>();
	session: PeerSession;
	errors: string[] = [];
	/** Messages to the PC go one after the other (separate page calls could overtake each other) */
	#chain: Promise<unknown> = Promise.resolve();

	constructor(page: Page, conn: number) {
		this.session = new PeerSession({
			self: { id: PHONE_ID, name: 'My iPhone', kind: 'phone' },
			merger: false,
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
			send: (message) => void (this.#chain = this.#chain.then(() => emit(page, 'sync-message', { conn, text: JSON.stringify(message) }))),
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
	await page.getByRole('button', { name: 'Devices' }).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await expect(dialog).toContainText('No phone is paired yet.');
	await dialog.getByRole('button', { name: 'Pair a phone' }).click();
	await expect(dialog.getByLabel('Pairing code')).toBeVisible();
	await expect(dialog).toContainText('It works once');

	await page.evaluate(() => (window as never as { fake: Fake }).fake.phones.push({ id: '0123456789abcdef', name: 'My iPhone', pairedAt: 0 }));
	await emit(page, 'sync-paired', { phoneId: PHONE_ID, phoneName: 'My iPhone' });
	await expect(dialog.getByRole('status')).toContainText('Paired with My iPhone.');
	await expect(dialog.getByLabel('Pairing code')).toBeHidden();
	await expect(dialog.getByText('My iPhone', { exact: true })).toBeVisible();
	await expect(dialog.getByText('not connected')).toBeVisible();

	// removing needs a second click
	await dialog.getByRole('button', { name: 'Remove' }).click();
	await dialog.getByRole('button', { name: 'Remove for good' }).click();
	await expect(dialog).toContainText('No phone is paired yet.');
	expect((await fake(page)).calls).toContain(`forget ${PHONE_ID}`);
});

test('renaming this PC', async ({ page }) => {
	await page.getByRole('button', { name: 'Devices' }).click();
	const dialog = page.getByRole('dialog', { name: 'Devices' });
	await expect(dialog.getByLabel('Name')).toHaveValue('Desk');
	await dialog.getByLabel('Name').fill('Office PC');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog.getByRole('status')).toContainText('Name saved');
	expect((await fake(page)).name).toBe('Office PC');
});

test('a connected phone syncs with the PC both ways, in order, and the header says so', async ({ page }) => {
	await importFixture(page);
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
	await emit(page, 'sync-connected', { conn: 7, phoneId: PHONE_ID, phoneName: 'My iPhone' });
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
