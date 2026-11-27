import { expect, test, type Page } from '@playwright/test';
import { fileAction, openSettings } from './app';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
const fixtureText = () => readFileSync(FIXTURE, 'utf8');

async function importFile(page: Page, path: string) {
	const chooser = page.waitForEvent('filechooser');
	await fileAction(page, 'Import');
	await (await chooser).setFiles(path);
}

/** Writes a variant of the fixture (any valid JSON is fine for importing) and returns its path. */
function variant(path: string, edit: (doc: { Transactions: { ID: string; Description: string; Edited: string }[] }) => void): string {
	const doc = JSON.parse(fixtureText());
	edit(doc);
	writeFileSync(path, JSON.stringify(doc));
	return path;
}

test('import, persist, export and undo', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('No transactions yet')).toBeVisible();

	await importFile(page, FIXTURE);
	const dialog = page.getByRole('dialog', { name: 'Import “edge-cases.json”' });
	await expect(dialog).toContainText('Transactions: 46 added');
	await dialog.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	// the working copy survives a reload
	await page.reload();
	await expect(page.getByText('46 transactions')).toBeVisible();
	let settings = await openSettings(page);
	await expect(settings).toContainText('Last file: edge-cases.json');
	await settings.getByRole('button', { name: 'Done' }).click();

	// importing the same file again changes nothing
	await importFile(page, FIXTURE);
	await expect(dialog).toContainText('Nothing new');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();

	// export gives back exactly the imported file
	if (!test.info().project.use.hasTouch) {
		const download = page.waitForEvent('download');
		await fileAction(page, 'Export');
		const file = await download;
		expect(file.suggestedFilename()).toBe('edge-cases.json');
		expect(readFileSync(await file.path(), 'utf8')).toBe(fixtureText());
	}

	// undo restores the empty state including the file name, also after a reload
	await fileAction(page, 'Undo import');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	await page.reload();
	await expect(page.getByText('No transactions yet')).toBeVisible();
	settings = await openSettings(page);
	await expect(settings).not.toContainText('edge-cases.json');
	await expect(settings.getByRole('button', { name: 'Undo import' })).toBeHidden();
});

test('a second import adds and updates, but never removes', async ({ page }, testInfo) => {
	await page.goto('/');
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	const changed = variant(testInfo.outputPath('changed.json'), (doc) => {
		doc.Transactions[0]!.Description = 'Renamed on the desktop';
		doc.Transactions[0]!.Edited = '01.01.2030 00:00:00';
		// gone from the file: stays in the app
		doc.Transactions.pop();
		doc.Transactions.push({ ...doc.Transactions[1]!, ID: '987654321', Description: 'Only in the file' });
	});
	await importFile(page, changed);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Transactions: 1 added, 1 changed');
	await expect(dialog).toContainText('nothing is removed');
	await dialog.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('47 transactions')).toBeVisible();
	await page.getByRole('searchbox').fill('Renamed on the desktop');
	await expect(page.getByText('1 match of 47')).toBeVisible();
});

test('an empty file changes nothing', async ({ page }, testInfo) => {
	await page.goto('/');
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	const empty = testInfo.outputPath('empty.json');
	writeFileSync(empty, '');
	await importFile(page, empty);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Nothing new');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('a file with nothing in common is flagged and cancelling is suggested', async ({ page }, testInfo) => {
	await page.goto('/');
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	const other = variant(testInfo.outputPath('other.json'), (doc) => {
		doc.Transactions = [{ ...doc.Transactions[1]!, ID: '987654321' }];
	});
	await importFile(page, other);
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('alert').first()).toContainText('nothing in common with your data');
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveClass(/primary/);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('a broken file is reported with the location of the problem', async ({ page }, testInfo) => {
	const broken = testInfo.outputPath('broken.json');
	writeFileSync(broken, fixtureText().replace('"Amount": "-9999.99"', '"Amount": "lots"'));
	await page.goto('/');
	await importFile(page, broken);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText("can't be imported");
	await expect(dialog).toContainText('Invalid amount: "lots"');
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByText('No transactions yet')).toBeVisible();
});

test('on touch devices, export uses the share sheet', async ({ page }) => {
	// simulate a phone in any browser: a coarse pointer and a share sheet that records the file
	await page.addInitScript(() => {
		const original = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => (query === '(pointer: coarse)' ? ({ matches: true } as MediaQueryList) : original(query));
		Object.assign(navigator, {
			canShare: () => true,
			share: async ({ files }: { files: File[] }) => {
				const file = files[0]!;
				(window as unknown as { shared: unknown }).shared = { name: file.name, text: await file.text() };
			},
		});
	});
	await page.goto('/');
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await fileAction(page, 'Export');
	await expect(page.getByRole('status')).toContainText('Exported');
	const shared = await page.evaluate(() => (window as unknown as { shared: { name: string; text: string } }).shared);
	expect(shared.name).toBe('edge-cases.json');
	expect(shared.text).toBe(fixtureText());
});

test('if saving fails, nothing changes and the error is shown', async ({ page }) => {
	await page.addInitScript(() => {
		IDBObjectStore.prototype.put = () => {
			throw new DOMException('The disk is full', 'QuotaExceededError');
		};
	});
	await page.goto('/');
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	// (syncing reports that it can't start too: storage is broken)
	await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toContainText('The disk is full');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	await expect((await openSettings(page)).getByRole('button', { name: 'Undo import' })).toBeHidden();
});

test('clear data: asks first, deletes everything here, with no undo; not while syncing', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	await importFile(page, FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	// cancelled: nothing happens
	let settings = await openSettings(page);
	await settings.getByRole('button', { name: 'Clear data…' }).click();
	const confirm = page.getByRole('dialog', { name: 'Clear data?' });
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(confirm).toBeHidden();
	await expect(settings).toBeVisible();

	// not while sync is on
	await page.getByRole('switch', { name: 'Sync' }).evaluate((s: HTMLInputElement) => s.click());
	await expect(settings.getByRole('button', { name: 'Clear data…' })).toBeDisabled();
	await expect(settings).toContainText('To clear the data, turn off sync first.');
	await page.getByRole('switch', { name: 'Sync' }).evaluate((s: HTMLInputElement) => s.click());

	await settings.getByRole('button', { name: 'Clear data…' }).click();
	await confirm.getByRole('button', { name: 'Clear data' }).click();
	await expect(settings).toBeHidden();
	await expect(page.getByRole('status')).toContainText('Cleared the data on this device.');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	// no undo, and it stays cleared after a restart
	await page.keyboard.press('Control+z');
	await expect(page.getByText('No transactions yet')).toBeVisible();
	await page.reload();
	await expect(page.getByText('No transactions yet')).toBeVisible();
	settings = await openSettings(page);
	await expect(settings).not.toContainText('Last file:');
});
