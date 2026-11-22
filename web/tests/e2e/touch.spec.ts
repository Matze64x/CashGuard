/**
 * Everything can be done by touch on a phone (the `iphone` project: mobile WebKit with a touch
 * screen): taps only, no keyboard shortcuts.
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));

test.skip(({ hasTouch }) => !hasTouch, 'a touch screen only');

async function importFixture(page: Page) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import' }).tap();
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).tap();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-12-02T12:00:00'));
	await page.goto('/');
	await importFixture(page);
});

test('a transaction: tap opens it; edit, copy, delete and undo by touch', async ({ page }) => {
	const rows = page.getByRole('option');
	await rows.first().tap();
	const editor = page.getByRole('dialog', { name: 'Edit transaction' });
	const first = await editor.getByLabel('Description').inputValue();
	expect(first).not.toBe('');

	// copy: a new one like it
	await editor.getByRole('button', { name: 'Copy' }).tap();
	const copy = page.getByRole('dialog', { name: 'New transaction (copy)' });
	await expect(copy.getByLabel('Description')).toHaveValue(first);
	await copy.getByRole('button', { name: 'Save', exact: true }).tap();
	await expect(page.getByText('47 transactions')).toBeVisible();

	// delete, then undo from the notice
	await rows.first().tap();
	await page.getByRole('dialog', { name: 'Edit transaction' }).getByRole('button', { name: 'Delete' }).tap();
	await expect(page.getByText('46 transactions')).toBeVisible();
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).tap();
	await expect(page.getByText('47 transactions')).toBeVisible();
});

test('accounts, categories and recurring transactions open by tap and can be deleted', async ({ page }) => {
	await page.getByRole('button', { name: /^Manage/ }).tap();
	const accounts = page.getByRole('listbox', { name: 'Accounts' });
	const before = await accounts.getByRole('option').count();
	await accounts.getByRole('option').first().tap();
	await page.getByRole('dialog', { name: 'Edit account' }).getByRole('button', { name: 'Delete' }).tap();
	await expect(accounts.getByRole('option')).toHaveCount(before - 1);

	const recurring = page.getByRole('listbox', { name: 'Recurring transactions' });
	const templates = await recurring.getByRole('option').count();
	await recurring.getByRole('option').first().tap();
	await page.getByRole('dialog', { name: 'Edit recurring transaction' }).getByRole('button', { name: 'Delete' }).tap();
	await expect(recurring.getByRole('option')).toHaveCount(templates - 1);

	// a category in use isn't deleted, and says why
	const categories = page.getByRole('listbox', { name: 'Categories' });
	await categories.getByRole('option', { name: /Groceries/ }).tap();
	await page.getByRole('dialog', { name: 'Edit category' }).getByRole('button', { name: 'Delete' }).tap();
	await expect(page.getByRole('status')).toContainText("can't be deleted");
});

test('filtering, the due inbox, settings and devices are reachable by touch', async ({ page }) => {
	await page.getByRole('button', { name: /^Filter/ }).tap();
	await expect(page.getByRole('dialog', { name: 'Filter' })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).tap();
	await page.getByRole('button', { name: 'Enter them' }).tap();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.getByRole('button', { name: 'Settings' }).tap();
	await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Done' }).tap();
	await page.getByTitle('Devices and syncing').tap();
	await expect(page.getByRole('dialog', { name: 'Devices' }).getByRole('switch')).toBeVisible();
	// keyboard help isn't offered on a touch screen
	await page.getByRole('dialog').getByRole('button', { name: 'Done' }).tap();
	await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});
