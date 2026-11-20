/**
 * The desktop app's file syncing, run in a normal browser against a fake Tauri backend: an
 * in-memory "disk" (kept in sessionStorage, so it survives reloads like a real disk), file dialogs
 * that return a configured path, conditional writes like the Rust side, and change events the test
 * fires like the Rust file watcher does. Matches @tauri-apps/api 2.x's IPC (invoke,
 * transformCallback, plugin:event|listen, plugin:dialog|open/save).
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = readFileSync(fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url)), 'utf8');
const PATH = '/home/user/Sync/cashguard.json';
const OTHER = '/home/user/Sync/old.json';

interface Fake {
	disk: Record<string, string>;
	writes: string[];
	dialogPath: string | null;
	failWatch: boolean;
	/** Called inside the next write, before its check: simulates another program writing then */
	beforeNextWrite: string | null;
	fireChange(): void;
	save(): void;
}

async function installFakeTauri(page: Page) {
	await page.addInitScript(
		({ path, other, content }) => {
			const stored = sessionStorage.getItem('fake');
			const callbacks: Record<number, (payload: unknown) => void> = {};
			const listeners = new Set<number>();
			let nextId = 1;
			const fake = {
				disk: { [path]: content, [other]: content.replace(/"Description": "[^"]*"/, '"Description": "only in the old file"') },
				writes: [] as string[],
				dialogPath: path as string | null,
				failWatch: false,
				beforeNextWrite: null as string | null,
				...(stored ? JSON.parse(stored) : {}),
				fireChange: () => listeners.forEach((id) => callbacks[id]?.({ event: 'synced-file-changed', id, payload: null })),
				save: () => sessionStorage.setItem('fake', JSON.stringify(fake)),
			};
			const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
				'plugin:dialog|open': () => fake.dialogPath,
				'plugin:dialog|save': () => fake.dialogPath,
				read_synced_file: ({ path }) => {
					const text = fake.disk[path as string];
					if (text === undefined) throw `Can't read ${path}: No such file or directory`;
					return text;
				},
				write_synced_file: ({ path, contents, expected }) => {
					const p = path as string;
					if (fake.beforeNextWrite !== null) {
						fake.disk[p] = fake.beforeNextWrite;
						fake.beforeNextWrite = null;
					}
					const current = fake.disk[p];
					if (expected === null && current !== undefined) throw `EXISTS: ${p} already exists`;
					if (expected !== null && current !== expected) throw `CHANGED: ${p} changed on disk`;
					fake.disk[p] = contents as string;
					fake.writes.push(p);
					fake.save();
				},
				watch_synced_file: ({ path }) => {
					if (fake.failWatch) throw `Can't watch ${path}: No such file or directory`;
				},
				'plugin:event|listen': ({ handler }) => (listeners.add(handler as number), handler),
				'plugin:event|unlisten': ({ eventId }) => void listeners.delete(eventId as number),
			};
			Object.assign(window, {
				fake,
				__TAURI_INTERNALS__: {
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
		{ path: PATH, other: OTHER, content: FIXTURE },
	);
}

/** Runs `change` on the fake (in the page) and saves it; `fire` also sends a file change event. */
async function onFake(page: Page, change: string, arg: unknown = null, fire = false) {
	await page.evaluate(
		({ change, arg, fire }) => {
			const fake = (window as unknown as { fake: Fake }).fake;
			new Function('fake', 'arg', change)(fake, arg);
			fake.save();
			if (fire) fake.fireChange();
		},
		{ change, arg, fire },
	);
}
const fakeState = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { fake: Fake }).fake)) as Fake);
const transactionsOnDisk = async (page: Page, path = PATH) => JSON.parse((await fakeState(page)).disk[path] ?? '{"Transactions":[]}').Transactions.length;

const RENAME = `const doc = JSON.parse(fake.disk[arg]); doc.Transactions[0].Description = 'Renamed in the C++ client'; fake.disk[arg] = JSON.stringify(doc);`;
const EMPTY = `fake.disk[arg] = JSON.stringify({ Version: 'cgt_0.4.0', Categories: [], Accounts: [], Transactions: [] });`;

async function openLinkedFile(page: Page) {
	await page.getByRole('button', { name: 'Open file…' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await installFakeTauri(page);
	await page.goto('/');
});

test('open a file, then follow its changes on disk, also after a restart', async ({ page }) => {
	await expect(page.getByText('Open your CashGuard file to get started')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeHidden();

	// with no data yet, the file is simply opened
	await openLinkedFile(page);
	await expect(page.getByText('cashguard.json')).toBeVisible();

	// another program changes the file: merged automatically, no question asked
	await onFake(page, RENAME, PATH, true);
	await expect(page.getByText('Renamed in the C++ client')).toBeVisible();
	await expect(page.getByRole('dialog')).toBeHidden();

	// a change while the app was closed arrives on the next start
	await onFake(page, `const doc = JSON.parse(fake.disk[arg]); doc.Transactions.pop(); fake.disk[arg] = JSON.stringify(doc);`, PATH);
	await page.reload();
	await expect(page.getByText('45 transactions')).toBeVisible();
	await expect(page.getByText('Renamed in the C++ client')).toBeVisible();
	// the app never had anything the file lacked, so it never wrote
	expect((await fakeState(page)).writes).toEqual([]);
});

test('an emptied file asks first, and "Replace it with my data" restores it', async ({ page }) => {
	await openLinkedFile(page);
	await onFake(page, EMPTY, PATH, true);
	const dialog = page.getByRole('dialog', { name: 'Changes in “cashguard.json”' });
	await expect(dialog.getByRole('alert').first()).toContainText('This file is empty');

	// "Not now" changes nothing; the next change on disk asks again
	await dialog.getByRole('button', { name: 'Not now' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
	await onFake(page, '', null, true);
	await expect(dialog).toBeVisible();

	await dialog.getByRole('button', { name: 'Replace it with my data' }).click();
	await expect(page.getByRole('status')).toContainText('The file now has your data again');
	await expect.poll(() => transactionsOnDisk(page)).toBe(46);
	expect((await fakeState(page)).writes).toEqual([PATH]);
});

test('replacing the file never overwrites a change that arrived meanwhile', async ({ page }) => {
	await openLinkedFile(page);
	await onFake(page, EMPTY, PATH, true);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('This file is empty');

	// while the prompt is open, the C++ client saves its full data again (no event yet)
	await onFake(page, `fake.beforeNextWrite = arg;`, FIXTURE.replace(/"Description": "[^"]*"/, '"Description": "Saved by the C++ client"'));
	await dialog.getByRole('button', { name: 'Replace it with my data' }).click();
	await expect(page.getByText('Saved by the C++ client')).toBeVisible();
	expect((await fakeState(page)).writes).toEqual([]);
	expect(await transactionsOnDisk(page)).toBe(46);
});

test('a damaged file is reported after a retry, and can be replaced', async ({ page }) => {
	await openLinkedFile(page);
	await onFake(page, `fake.disk[arg] = '{ "Version": "cgt_0.4.0", "Transa';`, PATH, true);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText("The file can't be read");
	await dialog.getByRole('button', { name: 'Replace it with my data' }).click();
	await expect.poll(() => transactionsOnDisk(page)).toBe(46);
});

test('opening another file switches to it without writing anything', async ({ page }) => {
	await openLinkedFile(page);
	await onFake(page, `fake.dialogPath = arg;`, OTHER);
	await page.getByRole('button', { name: 'Open file…' }).click();
	await expect(page.getByText('old.json')).toBeVisible();
	await expect(page.getByText('only in the old file')).toBeVisible();
	expect((await fakeState(page)).writes).toEqual([]);
});

test('"New file…" creates a file but never replaces an existing one', async ({ page }) => {
	await openLinkedFile(page);
	// the chosen name exists: refused
	await page.getByRole('button', { name: 'New file…' }).click();
	await expect(page.getByRole('alert')).toContainText('cashguard.json already exists');
	expect((await fakeState(page)).writes).toEqual([]);

	await onFake(page, `fake.dialogPath = arg;`, '/home/user/Sync/new');
	await page.getByRole('button', { name: 'New file…' }).click();
	await expect(page.getByText('new.json')).toBeVisible();
	expect((await fakeState(page)).writes).toEqual(['/home/user/Sync/new.json']);
	expect(await transactionsOnDisk(page, '/home/user/Sync/new.json')).toBe(46);
});

test('a file that disappeared is reported, and the app stays usable', async ({ page }) => {
	await openLinkedFile(page);
	await onFake(page, `delete fake.disk[arg];`, PATH, true);
	await expect(page.getByRole('alert')).toContainText("Syncing with the file failed: Can't read");
	await expect(page.getByText('46 transactions')).toBeVisible();

	// after a restart where even watching fails, opening another file still works
	await onFake(page, `fake.failWatch = true;`);
	await page.reload();
	await expect(page.getByRole('alert')).toContainText("Can't watch");
	await expect(page.getByRole('button', { name: 'Open file…' })).toBeEnabled();
});
