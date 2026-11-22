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

/**
 * The labelled months on the chart's x axis ("Oct 26"; narrow charts label only some months), with
 * the month's full name and the horizontal center of its column
 */
async function monthLabels(page: Page): Promise<{ name: string; x: number }[]> {
	const box = (await chart(page).boundingBox())!;
	const labels = chart(page).locator('text').filter({ hasText: /^[A-Z][a-z]{2} \d{2}$/ });
	const found: { name: string; x: number }[] = [];
	for (const label of await labels.all()) {
		const at = await label.boundingBox();
		// the axis, not the zoom slider below it
		if (!at || at.y > box.y + box.height - 45) continue;
		const [month, year] = (await label.textContent())!.split(' ');
		const name = new Date(`${month} 1, 20${year}`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
		found.push({ name, x: at.x + at.width / 2 });
	}
	return found;
}

/** Clicks into a month's column, above its label */
async function clickMonth(page: Page, x: number, shift = false) {
	const box = (await chart(page).boundingBox())!;
	if (shift) await page.keyboard.down('Shift');
	await page.mouse.click(x, box.y + box.height / 3);
	if (shift) await page.keyboard.up('Shift');
}

test('click a month to choose it, Shift+click to extend; the list follows', async ({ page }) => {
	await expect(chart(page)).toBeVisible();
	const labels = await monthLabels(page);
	expect(labels.length).toBeGreaterThan(1);
	const last = labels.at(-1)!;
	const chips = page.getByRole('list', { name: 'Active filters' });
	await clickMonth(page, last.x);
	await expect(chips).toContainText(last.name);
	await expect(page.getByRole('region', { name: /^Totals/ }).getByRole('heading', { name: last.name })).toBeVisible();
	// the breakdown says which period its amounts are for
	await expect(page.getByRole('region', { name: 'Breakdown' }).getByRole('heading')).toHaveText(last.name);
	await clickMonth(page, labels[0]!.x, true);
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
	await expect(page.getByRole('region', { name: /^Totals/ }).getByRole('heading', { name: '2010' })).toBeVisible();
	await expect(page.locator('.totals dd').first()).toHaveText('0,00 €');

	// a transaction with a year typed wrong
	await page.keyboard.press('g');
	await page.keyboard.press('t');
	await page.keyboard.press('n');
	await page.keyboard.type('Typo');
	await page.getByRole('dialog').getByLabel('Date', { exact: true }).fill('1.1.1990');
	await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
	await page.keyboard.press(`${MOD}+Enter`);
	// (saving takes a moment; keys go to the editor until it's closed)
	await expect(page.getByRole('dialog')).toBeHidden();
	await page.keyboard.press('g');
	await page.keyboard.press('e');
	await expect(page.getByRole('note')).toContainText('01.01.1990 “Typo”');
	await expect(chart(page)).toBeVisible();
});

test('the breakdown: a category filters, then its descriptions show; income on request', async ({ page }) => {
	const breakdown = page.getByRole('region', { name: 'Breakdown' });
	// the box around it says what it shows, and has the switch for everything in it
	const box = page.getByRole('region', { name: /by category$/ });
	await expect(box.getByRole('heading', { level: 2 }).first()).toHaveText('Expenses by category');
	// its own heading: the period the amounts are for
	await expect(breakdown.getByRole('heading')).toHaveText('All time');
	const groceries = breakdown.getByRole('button', { name: /^Groceries:/ });
	// a list of buttons: works with the keyboard too
	await groceries.focus();
	await page.keyboard.press('Enter');
	const chips = page.getByRole('list', { name: 'Active filters' });
	await expect(chips).toContainText('Groceries');
	await expect(breakdown.getByRole('heading')).toHaveText('All time: Groceries, by description');
	await breakdown.getByRole('button', { name: /^Supermarket:/ }).click();
	await expect(page.getByRole('searchbox')).toHaveValue('Supermarket');

	await page.getByRole('button', { name: 'Remove filter: Groceries' }).click();
	await box.getByRole('radio', { name: 'Income' }).check();
	await expect(page.getByRole('region', { name: 'Income by category' })).toBeVisible();
	await expect(breakdown.getByRole('heading')).toHaveText('All time');

	// a filter for expenses only decides the side
	await page.getByRole('searchbox').fill('');
	await page.keyboard.press('Escape');
	await page.keyboard.press('f');
	await page.getByRole('dialog').getByRole('combobox', { name: 'Type' }).selectOption('expense');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('region', { name: 'Expenses by category' })).toBeVisible();
	await expect(box.getByRole('radio', { name: 'Income' })).toBeDisabled();
	await expect(box).toContainText('as the filter says');
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
	await expect(page.getByRole('region', { name: 'Breakdown' }).getByRole('heading')).toHaveText(/^.+: .+, by description$/);
});

test('an empty description can not be searched for', async ({ page }) => {
	// the fixture has an expense without category and description
	const breakdown = page.getByRole('region', { name: 'Breakdown' });
	await breakdown.getByRole('button', { name: /^No category:/ }).click();
	const empty = breakdown.getByRole('button', { name: /^\(no description\):/ });
	await expect(empty).toBeDisabled();
});

test('the comparison: last 12 months by default, the chosen period otherwise; rows filter', async ({ page }) => {
	const comparison = page.getByRole('region', { name: 'Comparison' });
	await expect(comparison).toContainText('(the last 12 complete months) compared with');

	// a month of the fixture's data (over, so compared as a whole)
	await page.keyboard.press('f');
	const dialog = page.getByRole('dialog', { name: 'Filter' });
	await dialog.getByLabel('From', { exact: true }).fill('1.10.2026');
	await dialog.getByLabel('To', { exact: true }).fill('31.10.2026');
	await page.keyboard.press('Enter');
	await expect(comparison).toContainText('October 2026 compared with September 2026');
	await expect(comparison.getByRole('row', { name: /^Total/ })).toBeVisible();

	const first = comparison.getByRole('rowheader').first().getByRole('button');
	const name = (await first.textContent())!.trim();
	await first.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(name);
	await expect(comparison.getByRole('columnheader', { name: 'Description' })).toBeVisible();

	// an open period can't be compared
	await page.getByRole('button', { name: /Remove filter: October 2026/ }).click();
	await page.keyboard.press('Escape');
	await page.keyboard.press('f');
	await dialog.getByLabel('From', { exact: true }).fill('1.11.2026');
	await page.keyboard.press('Enter');
	await expect(comparison).toContainText('Choose a period with a start and an end');
});

test('an unfinished period is compared like for like', async ({ page }) => {
	const now = new Date();
	test.skip(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() === now.getDate(), 'today is the month’s last day');
	await page.keyboard.press('f');
	await page.getByRole('dialog').getByRole('combobox', { name: 'Period' }).selectOption('This month');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('region', { name: 'Comparison' })).toContainText('the same days of the period before');
});

test('trends: a row per category, by month or year; a row filters by its category', async ({ page }) => {
	const trends = page.getByRole('region', { name: 'Trends' });
	await expect(trends.getByRole('heading')).toHaveText('Over time');
	await expect(trends).toContainText('Ø per month');
	// years: the fixture's data (2026) stays in the last 10 years for long
	await trends.getByRole('radio', { name: 'Years' }).check();
	await expect(trends).toContainText('Ø per year');
	const rows = trends.getByRole('listitem');
	const groceries = trends.getByRole('button', { name: /^Groceries: (on average .* per year|new this year|no whole year with it yet)/ });
	await expect(groceries).toBeVisible();

	await groceries.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Groceries');
	await expect(rows).toHaveCount(1);
});

test('an unfinished month shows where it is heading', async ({ page }) => {
	// on the 20th of the fixture's last month, with what usually comes after the 20th before
	await page.clock.setFixedTime(new Date('2026-11-20T12:00:00'));
	await page.reload();
	await page.keyboard.press('g');
	await page.keyboard.press('e');
	await expect(page.getByRole('region', { name: 'Timeline' })).toContainText('Dashed: where this month is heading.');
	await expect(page.getByRole('region', { name: 'Trends' })).toContainText('dashed: where this month is heading');

	await page.keyboard.press('f');
	await page.getByRole('dialog').getByRole('combobox', { name: 'Period' }).selectOption('This month');
	await page.keyboard.press('Enter');
	const expected = page.getByRole('group', { name: 'Expected by 30.11.2026' });
	await expect(expected).toBeVisible();
	// expenses as usual after the 20th; income: nothing usually comes then
	await expect(expected).toContainText('Income 10.000,00 € Expenses -10.583,54 € Net -583,54 €');
});
