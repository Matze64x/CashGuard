/** The shared filter: chips, the filter dialog, and the list following it. */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
let MOD = 'Control';

async function importFixture(page: Page) {
	// (shortcuts work once the data is loaded)
	await expect(page.getByRole('button', { name: 'Import' })).toBeEnabled();
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.press(`${MOD}+o`);
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	await importFixture(page);
});

test('filter by period and category with the keyboard, then remove a chip', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await expect(dialog.getByRole('combobox', { name: 'Period' })).toBeFocused();
	await dialog.getByLabel('From', { exact: true }).fill('1.11.2026');
	await dialog.getByLabel('To', { exact: true }).fill('30.11.2026');
	await dialog.getByRole('checkbox', { name: 'Groceries' }).check();
	await dialog.getByLabel('To', { exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(dialog).toBeHidden();

	const chips = page.getByRole('list', { name: 'Active filters' });
	await expect(chips).toContainText('November 2026');
	await expect(chips).toContainText('Groceries');
	await expect(page.getByText(/\d+ match(es)? of 46/)).toBeVisible();
	for (const date of await page.getByRole('option').locator('.date').allTextContents()) expect(date).toMatch(/\.11\.2026$/);
	for (const category of await page.getByRole('option').locator('.category').allTextContents()) expect(category).toContain('Groceries');

	// a chip is a button: Enter removes that filter
	await page.getByRole('button', { name: 'Remove filter: Groceries' }).focus();
	await page.keyboard.press('Enter');
	await expect(chips).not.toContainText('Groceries');
	await expect(chips).toContainText('November 2026');
});

test('presets, income only, an amount range, and clearing', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByRole('combobox', { name: 'Type' }).selectOption('income');
	await dialog.getByLabel('Amount from').fill('100');
	await page.keyboard.press('Enter');
	const chips = page.getByRole('list', { name: 'Active filters' });
	await expect(chips).toContainText('Income only');
	await expect(chips).toContainText('at least 100,00 €');
	for (const amount of await page.getByRole('option').locator('.amount').allTextContents()) expect(amount).not.toContain('-');

	await page.keyboard.press('f');
	await dialog.getByRole('combobox', { name: 'Period' }).selectOption('Last year');
	await expect(dialog.getByLabel('From', { exact: true })).toHaveValue(`01.01.${new Date().getFullYear() - 1}`);
	await dialog.getByRole('button', { name: 'Clear all' }).click();
	await expect(chips).toBeHidden();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('the search sits next to the filters and combines with them', async ({ page }) => {
	await page.keyboard.press('/');
	await page.keyboard.type('supermarket');
	await expect(page.getByText('6 matches of 46')).toBeVisible();
	await page.keyboard.press('Enter');
	await page.keyboard.press('f');
	await page.getByRole('dialog').getByLabel('Amount from').fill('80');
	await page.keyboard.press('Enter');
	await expect(page.getByText(/^[1-5] match(es)? of 46$/)).toBeVisible();
});

test('invalid input is reported instead of applied, and Esc keeps the old filter', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByLabel('From', { exact: true }).fill('31.02.2026');
	await dialog.getByLabel('Amount from').focus();
	await page.keyboard.press('Enter');
	await expect(dialog.getByRole('alert').filter({ hasText: 'valid dates' })).toBeVisible();

	await dialog.getByLabel('From', { exact: true }).fill('');
	await dialog.getByLabel('Amount from').fill('100');
	await dialog.getByLabel('Amount to').fill('50');
	await page.keyboard.press('Enter');
	await expect(dialog.getByRole('alert')).toContainText('larger than the largest');

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('list', { name: 'Active filters' })).toBeHidden();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('Enter in a dropdown applies the filter', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByRole('combobox', { name: 'Type' }).selectOption('expense');
	await dialog.getByRole('combobox', { name: 'Type' }).focus();
	await page.keyboard.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Expenses only');
});

test('removing a chip moves the focus to the next chip, then to the search', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByRole('combobox', { name: 'Type' }).selectOption('expense');
	await dialog.getByLabel('Amount from').fill('10');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Remove filter: Expenses only' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: /Remove filter: at least/ })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('searchbox')).toBeFocused();
});

test('a split transaction is filtered as one, by its own date', async ({ page }) => {
	// "Online order #4711" is on 20.09.2026, one of its parts later in September
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByLabel('From', { exact: true }).fill('21.09.2026');
	await dialog.getByLabel('To', { exact: true }).fill('30.09.2026');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('option').filter({ hasText: 'Online order #4711' })).toHaveCount(0);
	await page.getByRole('button', { name: /Remove filter/ }).click();
	await page.keyboard.press('Escape'); // the focus went to the search: on to the list
	await page.keyboard.press('f');
	await dialog.getByLabel('From', { exact: true }).fill('20.09.2026');
	await dialog.getByLabel('To', { exact: true }).fill('20.09.2026');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('option').filter({ hasText: 'Online order #4711' })).toHaveCount(1);
});
