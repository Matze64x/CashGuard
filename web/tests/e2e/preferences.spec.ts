/** Settings and other preferences, operated with the keyboard. */
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
