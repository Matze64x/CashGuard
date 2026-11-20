/** The Explore section: the timeline sets the shared period filter, by keyboard and mouse. */
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

const monthName = (offset: number) => {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() + offset, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

// errors in the page (e.g. thrown by ECharts in a timer) fail the test
let pageErrors: Error[] = [];
test.afterEach(() => expect(pageErrors.map((e) => e.message)).toEqual([]));

test.beforeEach(async ({ page }) => {
	pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error));
	await page.goto('/');
	MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	await importFixture(page);
	await page.keyboard.press('g');
	await page.keyboard.press('e');
	await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
});

const chart = (page: Page) => page.getByRole('region', { name: 'Timeline' }).locator('svg').first();

/** Clicks the month column at this fraction of the plot's width (1 = the last month) */
async function clickMonth(page: Page, at: number, shift = false) {
	const box = (await chart(page).boundingBox())!;
	// the plot leaves room for the axis labels on both sides
	const left = box.x + 60;
	const right = box.x + box.width - 75;
	if (shift) await page.keyboard.down('Shift');
	await page.mouse.click(left + (right - left) * at, box.y + box.height / 3);
	if (shift) await page.keyboard.up('Shift');
}

test('click a month to choose it, Shift+click to extend; the list follows', async ({ page }) => {
	await expect(chart(page)).toBeVisible();
	const chips = page.getByRole('list', { name: 'Active filters' });
	await clickMonth(page, 1);
	await expect(chips).toContainText(monthName(0));
	await expect(page.getByRole('heading', { name: monthName(0) })).toBeVisible();
	await clickMonth(page, 0.5, true);
	await expect(chips).toContainText(/ – /);

	const show = page.getByRole('button', { name: /^Show \d+ transactions?$/ });
	const count = Number((await show.textContent())!.match(/\d+/)![0]);
	await show.click();
	await expect(page.getByText(`${count === 1 ? '1 match' : `${count} matches`} of 46`)).toBeVisible();
});

test('the other filters apply to the chart and the totals; Enter in the search leads on', async ({ page }) => {
	await page.keyboard.press('f');
	await page.getByRole('dialog').getByRole('combobox', { name: 'Type' }).selectOption('income');
	await page.keyboard.press('Enter');
	await expect(page.locator('.totals dd.expenses')).toHaveText('0,00 €');
	await page.keyboard.press('/');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: /^Show \d+ transactions?$/ })).toBeFocused();
});

test('a period outside the data shows nothing, and mistyped dates are named', async ({ page }) => {
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByLabel('From', { exact: true }).fill('1.1.2010');
	await dialog.getByLabel('To', { exact: true }).fill('31.12.2010');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: '2010' })).toBeVisible();
	await expect(page.locator('.totals dd').first()).toHaveText('0,00 €');

	// a transaction with a year typed wrong
	await page.keyboard.press('g');
	await page.keyboard.press('t');
	await page.keyboard.press('n');
	await page.keyboard.type('Typo');
	await page.getByRole('dialog').getByLabel('Date', { exact: true }).fill('1.1.1990');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press(`${MOD}+Enter`);
	await page.keyboard.press('g');
	await page.keyboard.press('e');
	await expect(page.getByRole('note')).toContainText('01.01.1990 “Typo”');
	await expect(chart(page)).toBeVisible();
});

test('the breakdown: a category filters, then its descriptions show; income on request', async ({ page }) => {
	const breakdown = page.getByRole('region', { name: 'Breakdown' });
	await expect(breakdown.getByRole('heading')).toHaveText('Expenses by category');
	const groceries = breakdown.getByRole('button', { name: /^Groceries:/ });
	// a list of buttons: works with the keyboard too
	await groceries.focus();
	await page.keyboard.press('Enter');
	const chips = page.getByRole('list', { name: 'Active filters' });
	await expect(chips).toContainText('Groceries');
	await expect(breakdown.getByRole('heading')).toHaveText('Expenses in Groceries, by description');
	await breakdown.getByRole('button', { name: /^Supermarket:/ }).click();
	await expect(page.getByRole('searchbox')).toHaveValue('Supermarket');

	await page.getByRole('button', { name: 'Remove filter: Groceries' }).click();
	await breakdown.getByRole('radio', { name: 'Income' }).check();
	await expect(breakdown.getByRole('heading')).toHaveText('Income by category');

	// a filter for expenses only decides the side
	await page.getByRole('searchbox').fill('');
	await page.keyboard.press('Escape');
	await page.keyboard.press('f');
	await page.getByRole('dialog').getByRole('combobox', { name: 'Type' }).selectOption('expense');
	await page.keyboard.press('Enter');
	await expect(breakdown.getByRole('heading')).toHaveText('Expenses by category');
	await expect(breakdown.getByRole('radio', { name: 'Income' })).toBeDisabled();
});

test('by category: clicking a category in the chart filters by it', async ({ page }) => {
	await page.getByRole('radio', { name: 'By category' }).check();
	const box = (await chart(page).boundingBox())!;
	// the bottom of the last month's stack (the x axis is 56 px above the chart's bottom edge); hover
	// first, so the tooltip is showing while the chart changes
	await page.mouse.move(box.x + box.width - 25, box.y + box.height - 62);
	await page.waitForTimeout(300);
	await page.mouse.click(box.x + box.width - 25, box.y + box.height - 62);
	await page.waitForTimeout(500);
	await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(/\w/);
	await expect(page.getByRole('region', { name: 'Breakdown' }).getByRole('heading')).toHaveText(/^Expenses in .+, by description$/);
});

test('an empty description can not be searched for', async ({ page }) => {
	// the fixture has an expense without category and description
	const breakdown = page.getByRole('region', { name: 'Breakdown' });
	await breakdown.getByRole('button', { name: /^No category:/ }).click();
	const empty = breakdown.getByRole('button', { name: /^\(no description\):/ });
	await expect(empty).toBeDisabled();
});
