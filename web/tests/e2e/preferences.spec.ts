/** Balances, custom colors and the date format, operated with the keyboard. */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
let MOD = 'Control';

async function importFixture(page: Page) {
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.press(`${MOD}+o`);
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	await expect(page.getByText('No transactions yet')).toBeVisible();
});

test('a new transaction can update an account balance, remembered for the next one', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('n');
	await page.keyboard.type('Bakery');
	const dialog = page.getByRole('dialog', { name: 'New transaction' });
	await dialog.getByLabel('Amount', { exact: true }).fill('3,20');
	await dialog.getByLabel('Account').selectOption({ label: 'Wallet (cash)' });
	await expect(dialog).toContainText('105,71 € → 102,51 €');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(page.getByRole('status')).toContainText('Wallet (cash) is now at 102,51 €');

	// the account is preselected next time
	await page.keyboard.press('n');
	await expect(dialog.getByLabel('Account')).toHaveValue(/\d/);
	await expect(dialog).toContainText('102,51 € →');
	await page.keyboard.press('Escape');

	// one undo takes back both
	await page.keyboard.press(`${MOD}+z`);
	await expect(page.getByText('46 transactions')).toBeVisible();
	await page.keyboard.press('g');
	await page.keyboard.press('a');
	await expect(page.getByRole('option', { name: /Wallet/ })).toContainText('105,71 €');
});

test('a custom category color as hex', async ({ page }) => {
	await page.keyboard.press('g');
	await page.keyboard.press('c');
	await page.keyboard.press('n');
	await page.keyboard.type('Custom');
	const hex = page.getByLabel('Color', { exact: true });
	await hex.focus();
	await hex.fill('#3a7');
	await page.keyboard.press('Enter');
	const row = page.getByRole('option', { name: /Custom/ });
	await expect(row.locator('.dot')).toHaveCSS('background-color', 'rgb(51, 170, 119)');
	// editing it again shows the color
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Color', { exact: true })).toHaveValue('#33AA77FF');
	await expect(page.getByLabel('Choose a color')).toHaveValue('#33aa77');
});

test('the date format setting applies to the list and the editor', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press(`${MOD}+,`);
	await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Date format').selectOption('YYYY-MM-DD');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('option').first().locator('.date')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

	await page.keyboard.press('n');
	await page.keyboard.type('Dated');
	const date = page.getByRole('dialog').getByLabel('Date', { exact: true });
	await date.focus();
	await date.fill('2025-03-05');
	await page.keyboard.press('ArrowUp'); // a day later
	await expect(date).toHaveValue('2025-03-06');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(page.getByRole('option', { name: /Dated/ })).toContainText('2025-03-06');

	// the setting survives a reload
	await page.reload();
	await expect(page.getByRole('option', { name: /Dated/ })).toContainText('2025-03-06');
});

test('dates can be typed short', async ({ page }) => {
	await page.keyboard.press('n');
	await page.keyboard.type('Short date');
	const date = page.getByRole('dialog').getByLabel('Date', { exact: true });
	await date.focus();
	await date.fill('5.3.');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(page.getByRole('option', { name: /Short date/ })).toContainText(`05.03.${new Date().getFullYear()}`);
});
