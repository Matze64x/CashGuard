/** Recurring transactions: entering the due ones in the inbox, and managing the templates. */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
let MOD = 'Control';

// the fixture's templates, on 02.12.2026: rent on the 31st (a month's last day) since 29.02.2024,
// never handled: 34 due; the savings plan (1st, 8th, 15th, 22nd) handled through 15.11.2026: 2 due
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-12-02T12:00:00'));
	await page.goto('/');
	MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.press(`${MOD}+o`);
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

const inbox = (page: Page) => page.getByRole('dialog', { name: 'Due recurring transactions' });

test('the due ones are entered one after the other, in order, with the keyboard', async ({ page }) => {
	await expect(page.getByText('36 recurring transactions are due.')).toBeVisible();
	await page.keyboard.press('d');
	const dialog = inbox(page);
	// the oldest first: a fixed amount comes prefilled, Enter enters it and brings the next
	await expect(dialog).toContainText('due 29.02.2024');
	await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('950,00');
	await expect(dialog.getByLabel('Amount', { exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dialog).toContainText('due 31.03.2024');
	await expect(dialog).toContainText('Entered “Rent');

	// another template: its amount is asked, its account updated
	await dialog.getByRole('button', { name: /Savings plan \(ETF\)/ }).click();
	await expect(dialog).toContainText('due 22.11.2026');
	await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('');
	await expect(dialog.getByLabel('Amount', { exact: true })).toBeFocused();
	await page.keyboard.type('49,80');
	await expect(dialog).toContainText('16.221,91 € → 16.172,11 €');
	await page.keyboard.press('Enter');
	await expect(dialog).toContainText('Entered “Savings plan (ETF)” of 22.11.2026: -49,80 €, Checking account updated.');
	await expect(dialog).toContainText('due 01.12.2026');

	// skipped: it didn't happen; then (none of this one left) the oldest due one again
	await dialog.getByRole('button', { name: "Skip, it didn't happen" }).click();
	await expect(dialog).toContainText('Skipped “Savings plan (ETF)” of 01.12.2026.');
	await expect(dialog).toContainText('due 31.03.2024');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	await expect(page.getByRole('listbox', { name: 'Transactions' })).toContainText('Savings plan (ETF)');
	await expect(page.getByText('33 recurring transactions are due.')).toBeVisible();
	// each one is a change of its own: undo brings the skipped one back
	await page.keyboard.press(`${MOD}+z`);
	await expect(page.getByText('34 recurring transactions are due.')).toBeVisible();
});

test('a template is made with the keyboard and shows when it comes', async ({ page }) => {
	await page.keyboard.press('g');
	await page.keyboard.press('r');
	await expect(page.getByRole('listbox', { name: 'Recurring transactions' })).toContainText('Savings plan (ETF)');
	await page.keyboard.press('n');
	const editor = page.getByRole('dialog', { name: 'New recurring transaction' });
	await page.keyboard.type('Gym');
	await editor.getByLabel('Category').selectOption({ label: 'Health' });
	await editor.getByLabel('Ask each time').uncheck();
	await editor.getByLabel('Amount', { exact: true }).fill('29,90');
	await editor.getByLabel('On days').fill('1, 15');
	// starts today (02.12.2026) by default
	await expect(editor).toContainText('Monthly on the 1st and 15th, -29,90 €. Next: 15.12.2026');
	await editor.getByLabel('Starts').fill('05.12.2026');
	await expect(editor).toContainText('Next: 15.12.2026, 01.01.2027, 15.01.2027, 01.02.2027, …');
	await editor.getByLabel('On days').press('Enter');
	await expect(editor).toBeHidden();
	const row = page.getByRole('option', { name: /Gym/ });
	await expect(row).toContainText('Monthly on the 1st and 15th');
	await expect(row).toContainText('next 15.12.2026');
	await expect(row).toContainText('-29,90 €');
});

test('a transaction can be made recurring, from the month after it on', async ({ page }) => {
	await page.getByRole('searchbox').fill('Liability insurance');
	await page.getByRole('option', { name: /Liability insurance/ }).first().dblclick();
	await page.getByRole('dialog', { name: 'Edit transaction' }).getByRole('button', { name: 'Make recurring…' }).click();
	const editor = page.getByRole('dialog', { name: 'New recurring transaction' });
	await expect(editor.getByLabel('Description')).toHaveValue('Liability insurance');
	await expect(editor).toContainText('Monthly on the 15th, -18,45 €. Next: 15.12.2026');
	await editor.getByLabel('Every').fill('12');
	await editor.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('option', { name: /Liability insurance/ })).toContainText('Every 12 months on the 15th');
});

test('nothing carries over from one occurrence to the next, and a held Enter enters one', async ({ page }) => {
	await page.keyboard.press('d');
	const dialog = inbox(page);
	const amount = dialog.getByLabel('Amount', { exact: true });
	// the rent made income by mistake, then another template: its amount starts as an expense again
	await dialog.getByRole('button', { name: /Expense/ }).click();
	await amount.fill('12,345');
	await dialog.getByRole('button', { name: /Savings plan \(ETF\)/ }).click();
	await expect(amount).toHaveValue('');
	await expect(dialog.getByRole('button', { name: /Expense \(press for income\)/ })).toBeVisible();
	await expect(amount).toBeFocused();
	await page.keyboard.type('10');
	await expect(dialog).toContainText('16.221,91 € → 16.211,91 €');

	// holding Enter: one entry, not one per key repeat
	await page.keyboard.down('Enter');
	await page.keyboard.down('Enter');
	await page.keyboard.down('Enter');
	await page.keyboard.up('Enter');
	await expect(dialog).toContainText('Entered “Savings plan (ETF)” of 22.11.2026');
	await expect(dialog.getByText('35 occurrences due')).toBeVisible();

	// and right here it can be undone
	await dialog.getByRole('button', { name: 'Undo' }).click();
	await expect(dialog).toContainText('Undone: Enter “Savings plan (ETF)” of 22.11.2026');
	await expect(dialog.getByText('36 occurrences due')).toBeVisible();
});

test('a backlog is skipped at once, and the inbox closes when nothing is left', async ({ page }) => {
	await page.keyboard.press('d');
	const dialog = inbox(page);
	await expect(dialog).toContainText('due 29.02.2024');
	await dialog.getByRole('button', { name: 'Skip all but the latest' }).click();
	await expect(dialog).toContainText('Skipped 33 occurrences of “Rent');
	await expect(dialog.getByText('3 occurrences due')).toBeVisible();
	// the latest rent, then the oldest due one: the savings plan
	for (const due of ['30.11.2026', '22.11.2026', '01.12.2026']) {
		await expect(dialog).toContainText(`due ${due}`);
		await dialog.getByRole('button', { name: "Skip, it didn't happen" }).click();
	}
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('status')).toContainText('Skipped “Savings plan (ETF)” of 01.12.2026. Nothing else is due.');
	await expect(page.getByText('recurring transactions are due')).toBeHidden();
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeFocused();
});

test('editing a template keeps its category, even with a description used elsewhere', async ({ page }) => {
	await page.keyboard.press('g');
	await page.keyboard.press('r');
	await page.getByRole('option', { name: /Rent/ }).dblclick();
	const editor = page.getByRole('dialog', { name: 'Edit recurring transaction' });
	await editor.getByLabel('Description').fill('Supermarket');
	await page.keyboard.press('Tab');
	await expect(editor.getByLabel('Category')).toHaveValue('0');
});
