/** A large file (years of data): the list only renders rows near the screen and still behaves like a whole list. */
import { expect, test } from '@playwright/test';
import { waitForApp } from './app';
import { writeFileSync } from 'node:fs';
import { FORMAT_VERSION } from '../../src/core/format';

const COUNT = 5000;

test('a long list: only rows near the screen exist, and keys reach both ends', async ({ page }, testInfo) => {
	// one transaction a day back from 21.11.2026, numbered from the newest
	const day = (i: number) => new Date(Date.UTC(2026, 10, 21 - i));
	const pad = (n: number) => String(n).padStart(2, '0');
	const transactions = Array.from({ length: COUNT }, (_, i) => {
		const d = day(i);
		return {
			ID: String(1000 + i),
			Date: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
			Category: '0',
			Amount: '-1.00',
			// every 7th description is long, so some rows wrap on a phone
			Description: i % 7 === 0 ? `Purchase ${i} with a rather long description that wraps on narrow screens` : `Purchase ${i}`,
			Added: '21.11.2026 10:00:00',
			Edited: '21.11.2026 10:00:00',
		};
	});
	const file = testInfo.outputPath('large.json');
	writeFileSync(file, JSON.stringify({ Version: FORMAT_VERSION, Categories: [], Accounts: [], Recurring: [], Transactions: transactions }, null, 4));

	await page.goto('/');
	const MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	// (shortcuts work once the data is loaded)
	await waitForApp(page);
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.press(`${MOD}+o`);
	await (await chooser).setFiles(file);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText(`${COUNT} transactions`)).toBeVisible();

	const options = page.getByRole('option');
	expect(await options.count()).toBeLessThan(300);
	const selected = page.locator('[role=option][aria-selected=true]');

	await page.getByRole('listbox', { name: 'Transactions' }).focus();
	await page.keyboard.press('End');
	await expect(selected).toContainText(`Purchase ${COUNT - 1}`);
	await expect(selected).toBeInViewport();
	await expect(selected).toHaveAttribute('aria-posinset', String(COUNT));
	await page.keyboard.press('ArrowUp');
	await expect(selected).toContainText(`Purchase ${COUNT - 2}`);
	await expect(selected).toBeInViewport();

	await page.keyboard.press('Home');
	await expect(selected).toContainText('Purchase 0');
	await expect(selected).toBeInViewport();
	for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');
	await expect(selected).toContainText('Purchase 50');
	await expect(selected).toBeInViewport();

	// scrolling the page brings the rows there
	await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
	await expect
		.poll(() => page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[role=option]')?.textContent ?? ''))
		.toMatch(/Purchase 2\d{3}\b/);
	expect(await options.count()).toBeLessThan(300);

	// a search finds rows that weren't rendered
	await page.getByRole('searchbox').fill('Purchase 4321');
	await expect(page.getByText('1 match of 5000')).toBeVisible();
	await expect(options).toHaveCount(1);
});
