/**
 * The desktop app's files (import, export, the backup file), run in a normal browser against a
 * fake Tauri backend: an in-memory "disk" (kept in sessionStorage, so it survives reloads like a
 * real disk), file dialogs that return a configured path, and a window whose closing the test
 * requests like the user would. Matches @tauri-apps/api 2.x's IPC (invoke, transformCallback,
 * plugin:event|listen, plugin:dialog|open/save/message, plugin:window|destroy).
 */
import { expect, test, type Page } from '@playwright/test';
import { fileAction, openSettings } from './app';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = readFileSync(fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url)), 'utf8');
const FILE = '/home/user/Sync/cashguard.json';
const BACKUP = '/home/user/Backups/cashguard-backup.json';

interface Fake {
	disk: Record<string, string>;
	writes: string[];
	dialogPath: string | null;
	failWrites: boolean;
	destroyed: boolean;
	/** The answer to the next "replace?" question */
	replace: boolean;
	asked: string[];
	fire(event: string): void;
	save(): void;
}

async function installFakeTauri(page: Page) {
	await page.addInitScript(
		({ file, content }) => {
			const stored = sessionStorage.getItem('fake');
			const callbacks: Record<number, (payload: unknown) => void> = {};
			const listeners = new Map<number, string>();
			let nextId = 1;
			const fake = {
				disk: { [file]: content } as Record<string, string>,
				writes: [] as string[],
				dialogPath: file as string | null,
				failWrites: false,
				destroyed: false,
				replace: true,
				asked: [] as string[],
				...(stored ? JSON.parse(stored) : {}),
				fire: (event: string) => listeners.forEach((name, id) => name === event && callbacks[id]?.({ event, id, payload: null })),
				save: () => sessionStorage.setItem('fake', JSON.stringify(fake)),
			};
			const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
				'plugin:dialog|open': () => fake.dialogPath,
				'plugin:dialog|save': () => fake.dialogPath,
				// `ask` (Yes/No buttons)
				'plugin:dialog|message': ({ message }) => {
					fake.asked.push(message as string);
					fake.save();
					return fake.replace ? 'Yes' : 'No';
				},
				file_exists: ({ path }) => fake.disk[path as string] !== undefined,
				read_file: ({ path }) => {
					const text = fake.disk[path as string];
					if (text === undefined) throw `Can't read ${path}: No such file or directory`;
					return text;
				},
				write_file: ({ path, contents }) => {
					if (fake.failWrites) throw `Can't write ${path}: No space left on device`;
					fake.disk[path as string] = contents as string;
					fake.writes.push(path as string);
					fake.save();
				},
				data_location: () => ['/home/me/CashGuard-data', true],
				'plugin:event|listen': ({ event, handler }) => (listeners.set(handler as number, event as string), handler),
				'plugin:event|unlisten': ({ eventId }) => void listeners.delete(eventId as number),
				'plugin:window|destroy': () => {
					fake.destroyed = true;
					fake.save();
				},
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
		{ file: FILE, content: FIXTURE },
	);
}

/** Runs `change` on the fake (in the page) and saves it */
async function onFake(page: Page, change: string, arg: unknown = null) {
	await page.evaluate(
		({ change, arg }) => {
			const fake = (window as unknown as { fake: Fake }).fake;
			new Function('fake', 'arg', change)(fake, arg);
			fake.save();
		},
		{ change, arg },
	);
}
const fakeState = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { fake: Fake }).fake)) as Fake);
const transactionsIn = async (page: Page, path: string) => {
	const text = (await fakeState(page)).disk[path];
	return text === undefined ? null : (JSON.parse(text) as { Transactions: unknown[] }).Transactions.length;
};

async function importFile(page: Page) {
	await fileAction(page, 'Import');
	const dialog = page.getByRole('dialog', { name: 'Import “cashguard.json”' });
	await dialog.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

async function chooseBackup(page: Page) {
	await onFake(page, 'fake.dialogPath = arg', BACKUP);
	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Choose…' }).click();
	await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText(BACKUP);
	await page.keyboard.press('Escape');
}

async function addTransaction(page: Page, description: string) {
	await page.keyboard.press('n');
	await page.keyboard.type(description);
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
	await installFakeTauri(page);
	await page.goto('/');
});

test('import with a preview, and export where the user chooses', async ({ page }) => {
	await importFile(page);
	const settings = await openSettings(page);
	await expect(settings.getByRole('button', { name: 'Undo import' })).toBeVisible();
	await settings.getByRole('button', { name: 'Done' }).click();

	await addTransaction(page, 'Bought on the desktop');
	await onFake(page, 'fake.dialogPath = arg', '/home/user/export');
	await fileAction(page, 'Export');
	await expect(page.getByRole('status')).toContainText('Exported.');
	// the extension is added
	expect(await transactionsIn(page, '/home/user/export.json')).toBe(47);
	await expect((await openSettings(page)).getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('a cancelled dialog changes nothing', async ({ page }) => {
	await onFake(page, 'fake.dialogPath = null');
	await fileAction(page, 'Import');
	await fileAction(page, 'Export');
	await expect(page.getByRole('dialog')).toBeHidden();
	expect((await fakeState(page)).writes).toEqual([]);
});

test('the backup file: written when chosen, after changes, and when the window closes', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	// written right away
	expect(await transactionsIn(page, BACKUP)).toBe(46);

	// a few seconds after a change
	await addTransaction(page, 'First');
	expect(await transactionsIn(page, BACKUP)).toBe(46);
	await expect.poll(() => transactionsIn(page, BACKUP), { timeout: 8000 }).toBe(47);

	// closing writes a pending backup at once, then closes the window
	await addTransaction(page, 'Second');
	await page.evaluate(() => (window as unknown as { fake: Fake }).fake.fire('tauri://close-requested'));
	await expect.poll(async () => (await fakeState(page)).destroyed).toBe(true);
	expect(await transactionsIn(page, BACKUP)).toBe(48);
	// the original file was only read
	expect((await fakeState(page)).writes.filter((p) => p === FILE)).toEqual([]);
});

test('a failing backup shows, and the next change tries again', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	await onFake(page, 'fake.failWrites = true');
	await addTransaction(page, 'Not backed up yet');
	await expect(page.getByRole('alert')).toContainText("The backup file couldn't be written: Can't write", { timeout: 8000 });

	// it stays until dismissed or fixed
	await page.waitForTimeout(6500);
	await expect(page.getByRole('alert')).toBeVisible();
	await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByRole('alert')).toBeHidden();
	await addTransaction(page, 'Still not backed up');
	await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });

	await onFake(page, 'fake.failWrites = false');
	await addTransaction(page, 'Backed up again');
	await expect(page.getByRole('alert')).toBeHidden({ timeout: 8000 });
	expect(await transactionsIn(page, BACKUP)).toBe(49);
});

test('changes made before restarting are backed up after the restart', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	await onFake(page, 'fake.failWrites = true');
	await addTransaction(page, 'Typed, then the app was gone');
	await onFake(page, 'fake.failWrites = false');
	await page.reload();
	await expect.poll(() => transactionsIn(page, BACKUP), { timeout: 8000 }).toBe(47);
});

test('the backup can be turned off', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	await page.getByRole('button', { name: 'Settings' }).click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await settings.getByRole('button', { name: 'Turn off' }).click();
	await expect(settings.getByRole('button', { name: 'Choose…' })).toBeVisible();
	await page.keyboard.press('Escape');
	const writes = (await fakeState(page)).writes.length;
	await addTransaction(page, 'Not backed up');
	await page.waitForTimeout(3500);
	expect((await fakeState(page)).writes.length).toBe(writes);
});

test('the settings say where the app keeps its data', async ({ page }) => {
	await page.getByRole('button', { name: 'Settings' }).click();
	await expect(page.getByRole('dialog')).toContainText('Data folder (portable)');
	await expect(page.getByRole('dialog')).toContainText('/home/me/CashGuard-data');
});

test('a backup is no export: importing the exported file later keeps the changes made since', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	await addTransaction(page, 'Exported to the phone');
	await onFake(page, 'fake.dialogPath = arg', '/home/user/Sync/phone.json');
	await fileAction(page, 'Export');
	await expect(page.getByRole('status')).toContainText('Exported.');

	await addTransaction(page, 'Only on the desktop');
	await expect.poll(() => transactionsIn(page, BACKUP), { timeout: 8000 }).toBe(48);
	// the phone's file comes back unchanged
	await fileAction(page, 'Import');
	const dialog = page.getByRole('dialog', { name: 'Import “phone.json”' });
	await expect(dialog).toContainText('Nothing new');
	await dialog.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('48 transactions')).toBeVisible();
});

test('closing while a change is still being saved backs it up', async ({ page }) => {
	await importFile(page);
	await chooseBackup(page);
	await page.keyboard.press('n');
	await page.keyboard.type('Saved while closing');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.evaluate(() => {
		(document.querySelector('dialog[open] button[type=submit]') as HTMLButtonElement).click();
		(window as unknown as { fake: Fake }).fake.fire('tauri://close-requested');
	});
	await expect.poll(async () => (await fakeState(page)).destroyed).toBe(true);
	expect(await transactionsIn(page, BACKUP)).toBe(47);
});

test('a name typed without .json still asks before replacing that file', async ({ page }) => {
	await importFile(page);
	await onFake(page, 'fake.disk["/home/user/Sync/phone.json"] = "keep me"; fake.dialogPath = "/home/user/Sync/phone"; fake.replace = false');
	await fileAction(page, 'Export');
	await expect.poll(async () => (await fakeState(page)).asked).toEqual(['phone.json already exists. Replace it?']);
	expect((await fakeState(page)).disk['/home/user/Sync/phone.json']).toBe('keep me');

	await onFake(page, 'fake.replace = true');
	await fileAction(page, 'Export');
	await expect.poll(() => transactionsIn(page, '/home/user/Sync/phone.json')).toBe(46);
});
