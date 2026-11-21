/**
 * Syncing two devices with the app's real storage: two browser contexts (each its own IndexedDB,
 * like two devices) whose sync managers are connected through the test runner instead of the
 * network. Uses the dev-only `__cashguardTest` hook (see `App.svelte`).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));

interface Device {
	page: Page;
	id: string;
	kind: 'pc' | 'phone';
}

async function openDevice(context: BrowserContext, id: string, kind: 'pc' | 'phone'): Promise<Device> {
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	return { page, id, kind };
}

/** Bridges already set up (they survive reloads) */
const bridged = new WeakSet<Page>();

/** Connects two devices' sync managers; messages go through the test runner (in order). */
async function connect(a: Device, b: Device) {
	const links: [Device, Device][] = [
		[a, b],
		[b, a],
	];
	for (const [from, to] of links) {
		if (bridged.has(from.page)) continue;
		bridged.add(from.page);
		await from.page.exposeBinding(`__sendTo_${to.id}`, async (_source, text: string) => {
			await to.page.evaluate(([peer, text]) => (window as never as { __receive: Record<string, (t: string) => void> }).__receive[peer]!(text), [from.id, text] as const);
		});
	}
	// a mailbox per connection first: messages arriving before the session is attached wait there
	for (const [self, peer] of links) {
		await self.page.evaluate((peer) => {
			const w = window as never as { __receive?: Record<string, (t: string) => void>; __inbox?: Record<string, string[]> };
			const inbox: string[] = ((w.__inbox ??= {})[peer] = []);
			(w.__receive ??= {})[peer] = (text) => void inbox.push(text);
		}, peer.id);
	}
	for (const [self, peer] of links) {
		await self.page.evaluate(
			({ self, peer }) => {
				const w = window as never as {
					__cashguardTest: { workspace: unknown; SyncManager: new (...args: unknown[]) => { attach(c: unknown, phone: boolean): { receive(t: string): void; closed(): void } }; notices: { info(t: string): void } };
					__receive?: Record<string, (t: string) => void>;
					__inbox?: Record<string, string[]>;
					__managers?: unknown[];
				} & Record<string, (t: string) => Promise<void>>;
				const { workspace, SyncManager, notices } = w.__cashguardTest;
				const manager = new SyncManager(workspace, () => ({ id: self.id, name: self.id, kind: self.kind }), (r: { peer: { name: string } }) =>
					notices.info(`Synced with ${r.peer.name}.`),
				);
				// messages are passed on one after the other, in order
				let chain = Promise.resolve();
				const connection = {
					peerId: peer.id,
					send: (text: string) => void (chain = chain.then(() => w[`__sendTo_${peer.id}`]!(text))),
					close: () => undefined,
				};
				(w.__managers ??= []).push(manager);
				const handlers = manager.attach(connection, peer.kind === 'phone');
				(w.__receive ??= {})[peer.id] = handlers.receive;
				for (const text of w.__inbox![peer.id]!.splice(0)) handlers.receive(text);
			},
			{ self: { id: self.id, kind: self.kind }, peer: { id: peer.id, kind: peer.kind } },
		);
	}
}

async function importFixture(page: Page) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import' }).click();
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

async function addTransaction(page: Page, description: string) {
	await page.keyboard.press('n');
	await page.keyboard.type(description);
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog')).toBeHidden();
}

const row = (page: Page, text: string) => page.getByRole('option').filter({ hasText: text });

test('two devices sync additions, edits and deletions both ways, and keep their base across restarts', async ({ browser }) => {
	const pcContext = await browser.newContext();
	const phoneContext = await browser.newContext();
	const pc = await openDevice(pcContext, 'pc-1', 'pc');
	const phone = await openDevice(phoneContext, 'phone-1', 'phone');

	await importFixture(pc.page);
	await addTransaction(phone.page, 'Bought on the phone');
	await connect(pc, phone);

	// first sync: both sides combined
	await expect(pc.page.getByText('47 transactions')).toBeVisible();
	await expect(phone.page.getByText('47 transactions')).toBeVisible();
	await expect(phone.page.getByRole('status')).toContainText('Synced with pc-1');

	// an edit on the phone reaches the PC
	await phone.page.getByRole('searchbox').fill('Bought on the phone');
	await phone.page.getByRole('listbox', { name: 'Transactions' }).focus();
	await phone.page.keyboard.press('j');
	await phone.page.keyboard.press('Enter');
	await phone.page.getByRole('dialog').getByLabel('Description').fill('Renamed on the phone');
	await phone.page.keyboard.press('Control+Enter');
	await pc.page.getByRole('searchbox').fill('Renamed on the phone');
	await expect(row(pc.page, 'Renamed on the phone')).toBeVisible();

	// a deletion on the PC reaches the phone
	await pc.page.getByRole('searchbox').fill('');
	await pc.page.getByRole('listbox', { name: 'Transactions' }).focus();
	await pc.page.keyboard.press('j');
	await pc.page.keyboard.press('Delete');
	await expect(pc.page.getByText('46 transactions')).toBeVisible();
	await phone.page.getByRole('searchbox').fill('');
	await expect(phone.page.getByText('46 transactions')).toBeVisible();

	// after a restart (offline meanwhile), a deletion on the phone still carries over: the base was stored
	await phone.page.reload();
	await pc.page.reload();
	await expect(phone.page.getByText('46 transactions')).toBeVisible();
	await phone.page.getByRole('listbox', { name: 'Transactions' }).focus();
	await phone.page.keyboard.press('j');
	await phone.page.keyboard.press('Delete');
	await expect(phone.page.getByText('45 transactions')).toBeVisible();
	await addTransaction(pc.page, 'Added on the PC while apart');
	await connect(pc, phone);
	await expect(pc.page.getByText('46 transactions')).toBeVisible();
	await expect(phone.page.getByText('46 transactions')).toBeVisible();
	await phone.page.getByRole('searchbox').fill('Added on the PC while apart');
	await expect(phone.page.getByText('1 match of 46')).toBeVisible();

	await pcContext.close();
	await phoneContext.close();
});
