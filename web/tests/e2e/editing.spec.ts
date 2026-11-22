/**
 * Entering and editing data, operated with the keyboard only (the app must be fully keyboard
 * controllable). Mouse use is covered implicitly by the other specs.
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));
/** The app's Mod key: ⌘ on Apple devices (also the emulated iPhone), Ctrl elsewhere */
let MOD = 'Control';

async function importFixture(page: Page) {
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.press(`${MOD}+o`);
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();
}

const row = (page: Page, text: string) => page.getByRole('option').filter({ hasText: text });

/** Presses Tab until the field with this label has the focus, like a keyboard user would. */
async function tabTo(page: Page, label: string) {
	const field = page.getByLabel(label, { exact: true });
	for (let i = 0; i < 20 && !(await field.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
	await expect(field).toBeFocused();
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	MOD = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
	await expect(page.getByText('No transactions yet')).toBeVisible();
});

test('add a transaction with the keyboard only', async ({ page }) => {
	await page.keyboard.press('n');
	const editor = page.getByRole('dialog', { name: 'New transaction' });
	await expect(editor.getByLabel('Description')).toBeFocused();
	await page.keyboard.type('Coffee');
	// date (today is preset), category, expense/income toggle, then the amount
	await tabTo(page, 'Amount');
	await page.keyboard.type('3,5');
	await page.keyboard.press('Enter');
	await expect(editor).toBeHidden();
	await expect(row(page, 'Coffee')).toContainText('-3,50 €');
	await expect(row(page, 'Coffee')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeFocused();
});

test('income via a typed +, and save and add another', async ({ page }) => {
	await page.keyboard.press('n');
	await page.keyboard.type('Salary');
	await tabTo(page, 'Amount');
	await page.keyboard.type('+2500');
	await page.keyboard.press(`${MOD}+Shift+Enter`);
	// a fresh editor for the next one
	const editor = page.getByRole('dialog', { name: 'New transaction' });
	await expect(editor.getByLabel('Description')).toHaveValue('');
	await page.keyboard.press('Escape');
	await expect(row(page, 'Salary')).toContainText('2.500,00 €');
});

test('a known description fills in category and amount', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('n');
	await page.keyboard.type('sushi');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	const editor = page.getByRole('dialog', { name: 'New transaction' });
	await expect(editor.getByLabel('Description')).toHaveValue('Sushi bar');
	await expect(editor.getByLabel('Category')).not.toHaveValue('No category');
	await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('22,36');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(page.getByText('47 transactions')).toBeVisible();
});

test('navigate, edit, delete and undo with the keyboard', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('j');
	await page.keyboard.press('j');
	const selected = page.getByRole('option', { selected: true });
	const description = (await selected.locator('.description').textContent())!.trim();

	// edit: Enter opens, Mod+Enter saves
	await page.keyboard.press('Enter');
	const editor = page.getByRole('dialog', { name: 'Edit transaction' });
	await editor.getByLabel('Description').fill('Edited with the keyboard');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(row(page, 'Edited with the keyboard')).toHaveAttribute('aria-selected', 'true');

	// delete needs no confirmation, undo brings it back
	await page.keyboard.press('Delete');
	await expect(page.getByText('45 transactions')).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Deleted “Edited with the keyboard”');
	await page.keyboard.press(`${MOD}+z`);
	await expect(page.getByText('46 transactions')).toBeVisible();
	await page.keyboard.press(`${MOD}+z`);
	await expect(row(page, description).first()).toBeVisible();
	await expect(row(page, 'Edited with the keyboard')).toHaveCount(0);
	// and redo
	await page.keyboard.press(`${MOD}+Shift+z`);
	await expect(row(page, 'Edited with the keyboard')).toBeVisible();
});

test('search with / and go to the results', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('/');
	await page.keyboard.type('supermarket');
	await expect(page.getByText('6 matches of 46')).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeFocused();
	await expect(page.getByRole('option', { selected: true })).toContainText(/supermarket/i);
	await page.keyboard.press('/');
	await page.keyboard.press('Escape'); // clears the search
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('split a transaction into parts', async ({ page }) => {
	await page.keyboard.press('n');
	await page.keyboard.type('Weekly shop');
	const editor = page.getByRole('dialog', { name: 'New transaction' });
	await editor.getByRole('button', { name: 'Split into parts…' }).focus();
	await page.keyboard.press('Enter');
	await editor.getByLabel('Part 1 description').fill('Food');
	await editor.getByLabel('Part 1 amount').fill('40');
	await editor.getByRole('button', { name: 'Add part' }).focus();
	await page.keyboard.press('Enter');
	await editor.getByLabel('Part 2 description').fill('Bottle deposit');
	await editor.getByLabel('Part 2 amount').fill('+2,25');
	await expect(editor).toContainText('Total -37,75 €');
	await page.keyboard.press(`${MOD}+Enter`);
	await expect(row(page, 'Weekly shop')).toContainText('2 parts');
	await expect(row(page, 'Weekly shop')).toContainText('-37,75 €');
});

test('categories and accounts, and the shortcut help', async ({ page }) => {
	await page.keyboard.press('g');
	await page.keyboard.press('m');
	await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
	// the Manage tab: accounts first, they get the focus
	await expect(page.getByRole('listbox', { name: 'Accounts' })).toBeFocused();
	await page.getByRole('region', { name: 'Categories' }).getByRole('button', { name: 'New' }).focus();
	await page.keyboard.press('Enter');
	await page.keyboard.type('Coffee shops'); // gets an unused default color
	await page.keyboard.press('Enter');
	await expect(page.getByRole('option', { name: /Coffee shops/ })).toContainText('unused');

	await page.getByRole('region', { name: 'Accounts' }).getByRole('button', { name: 'New' }).focus();
	await page.keyboard.press('Enter');
	// a problem shows in the dialog, not behind it
	await page.keyboard.type('   ');
	await page.getByLabel('Current balance').fill('+20');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'New account' }).getByRole('alert')).toHaveText('Enter a name for the account.');
	await page.getByRole('dialog').getByLabel('Name').fill('');
	await page.getByRole('dialog').getByLabel('Name').focus();
	await page.keyboard.type('Wallet');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('option', { name: /Wallet/ })).toContainText('20,00 €');
	await expect(page.getByText('Difference')).toBeVisible();

	// the new category is offered when entering a transaction
	await page.keyboard.press('g');
	await page.keyboard.press('t');
	await page.keyboard.press('n');
	await page.getByRole('dialog').getByLabel('Category').click();
	await expect(page.getByRole('dialog').getByRole('listbox', { name: 'Categories' }).getByRole('option', { name: 'Coffee shops' })).toHaveCount(1);
	// (the first Escape closes the list, the second the dialog)
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();

	await page.keyboard.press('?');
	const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	await expect(help).toContainText('New transaction');
	await expect(help).toContainText('Undo the last change');
	await expect(help).not.toContainText('Mod+');
	await page.keyboard.press('Escape');
	await expect(help).toBeHidden();
});

test('the Manage tab: each list takes the keys only while it has the focus', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('g');
	await page.keyboard.press('m');
	const accounts = page.getByRole('listbox', { name: 'Accounts' });
	const categories = page.getByRole('listbox', { name: 'Categories' });
	await expect(accounts).toBeFocused();
	await page.keyboard.press('j');
	await expect(accounts.getByRole('option', { selected: true })).toHaveCount(1);
	await expect(categories.getByRole('option', { selected: true })).toHaveCount(0);
	const selectedAccount = await accounts.getByRole('option', { selected: true }).textContent();
	await categories.focus();
	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await expect(categories.getByRole('option', { selected: true })).toHaveCount(1);
	await expect(accounts.getByRole('option', { selected: true })).toHaveText(selectedAccount!);
	// Enter opens the focused list's selection
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Edit category' })).toBeVisible();
});

test('cancelling keeps the scroll position, and switching sections moves the focus there', async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 600 });
	await importFixture(page);
	// (scrolled directly: mobile WebKit has no mouse wheel)
	await page.evaluate(() => scrollTo(0, 300));
	await expect.poll(() => page.evaluate(() => scrollY)).toBe(300);
	await page.keyboard.press('n');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeFocused();
	// (a row partly under the sticky header is revealed, which may move the page a few pixels)
	expect(Math.abs((await page.evaluate(() => scrollY)) - 300)).toBeLessThan(40);
	// the selection starts on screen, not at the (scrolled away) top
	await expect(page.getByRole('option', { selected: true })).toBeInViewport();

	// a clicked tab doesn't keep the focus (it would show a focus ring on the next key)
	await page.getByRole('button', { name: 'Manage' }).click();
	await expect(page.getByRole('listbox', { name: 'Accounts' })).toBeFocused();
	await page.keyboard.press('g');
	await page.keyboard.press('t');
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeFocused();
});

test.describe('keys reach the right place', () => {
	test('Enter and Backspace on a focused button operate the button, not the list', async ({ page }) => {
		await importFixture(page);
		await page.keyboard.press('j');
		await page.getByRole('button', { name: 'Import', exact: true }).focus();
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Delete');
		await expect(page.getByText('46 transactions')).toBeVisible();
		await page.getByRole('button', { name: 'Manage' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('/ can be typed in the search', async ({ page }) => {
		await page.keyboard.press('/');
		await page.keyboard.type('a/b');
		await expect(page.getByRole('searchbox')).toHaveValue('a/b');
	});

	test('holding Delete deletes only one transaction', async ({ page }) => {
		await importFixture(page);
		await page.keyboard.press('j');
		await page.keyboard.down('Delete');
		await page.keyboard.down('Delete'); // a repeat while held
		await page.keyboard.up('Delete');
		await expect(page.getByText('45 transactions')).toBeVisible();
		await page.waitForTimeout(200);
		await expect(page.getByText('45 transactions')).toBeVisible();
	});

	test('the help shows the editor keys when opened from the editor', async ({ page }) => {
		await page.keyboard.press('n');
		await page.getByRole('dialog').getByRole('button', { name: 'Split into parts…' }).focus();
		await page.keyboard.press('?');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Save and add another');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'New transaction' })).toBeVisible();
	});
});

test.describe('editor safeguards', () => {
	test('submitting twice quickly adds the transaction once', async ({ page }) => {
		await page.keyboard.press('n');
		await page.keyboard.type('Once');
		await page.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
		await page.evaluate(() => {
			const form = document.querySelector('dialog form') as HTMLFormElement;
			form.requestSubmit();
			form.requestSubmit();
		});
		await expect(page.getByText('1 transaction', { exact: true })).toBeVisible();
		await page.waitForTimeout(300);
		await expect(row(page, 'Once')).toHaveCount(1);
	});

	test('a typed sign leaves only the number in the amount field', async ({ page }) => {
		await page.keyboard.press('n');
		const amount = page.getByRole('dialog').getByLabel('Amount', { exact: true });
		await amount.focus();
		await page.keyboard.type('12+');
		await expect(amount).toHaveValue('12');
		await page.keyboard.type('+');
		await expect(amount).toHaveValue('12');
	});

	test('editing never takes over the category of another transaction with the same description', async ({ page }) => {
		await importFixture(page);
		await page.keyboard.press('n');
		await page.keyboard.type('Sushi bar');
		await page.keyboard.press('Tab'); // prefills category and amount (new transaction)
		const editor = page.getByRole('dialog');
		await editor.getByLabel('Category').click();
		await editor.getByRole('option', { name: 'No category' }).click();
		await page.keyboard.press(`${MOD}+Enter`);
		await expect(page.getByText('47 transactions')).toBeVisible();

		await page.keyboard.press('Enter'); // edit the new one
		await expect(editor.getByLabel('Description')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(editor.getByLabel('Category')).toHaveValue('No category');
	});

	test('a split transaction without parts is not saved', async ({ page }) => {
		await page.keyboard.press('n');
		await page.keyboard.type('Nothing left');
		const editor = page.getByRole('dialog');
		await editor.getByRole('button', { name: 'Split into parts…' }).click();
		await editor.getByRole('button', { name: 'Remove part 1' }).click();
		await page.keyboard.press(`${MOD}+Enter`);
		await expect(editor.getByRole('alert')).toContainText('Add a part');
		await expect(page.getByText('No transactions yet')).toBeVisible();
	});
});

test('saving never overwrites a change made in another tab meanwhile', async ({ page, context }) => {
	await importFixture(page);
	await page.keyboard.press('j');
	await page.keyboard.press('Enter');
	const editor = page.getByRole('dialog', { name: 'Edit transaction' });
	await editor.getByLabel('Description').fill('Changed here');

	// the same transaction is changed in another tab
	const other = await context.newPage();
	await other.goto('/');
	await expect(other.getByText('46 transactions')).toBeVisible();
	await other.keyboard.press('j');
	await other.keyboard.press('Enter');
	await other.getByRole('dialog').getByLabel('Description').fill('Changed in the other tab');
	await other.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(other.getByRole('dialog')).toBeHidden();
	await expect(row(page, 'Changed in the other tab')).toBeVisible();

	await editor.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('was changed elsewhere meanwhile');
	await page.keyboard.press('Escape');
	await expect(row(page, 'Changed in the other tab')).toBeVisible();
	await expect(row(page, 'Changed here')).toHaveCount(0);
});

test('two tabs saving at the same time both keep their change', async ({ page, context }) => {
	await importFixture(page);
	// the second tab misses the first one's "saved" message (as when both save at once)
	const other = await context.newPage();
	await other.addInitScript(() => {
		BroadcastChannel.prototype.addEventListener = () => undefined;
	});
	await other.goto('/');
	await expect(other.getByText('46 transactions')).toBeVisible();

	const add = async (p: Page, description: string) => {
		await p.keyboard.press('n');
		await p.keyboard.type(description);
		await p.getByRole('dialog').getByLabel('Amount', { exact: true }).fill('1');
		await p.keyboard.press('Enter');
		await expect(p.getByRole('dialog')).toBeHidden();
	};
	await add(page, 'Added in the first tab');
	// the second tab still shows the old data, but its save notices the first tab's and builds on it
	await add(other, 'Added in the second tab');
	await expect(other.getByText('48 transactions')).toBeVisible();
	await expect(page.getByText('48 transactions')).toBeVisible();
	await page.reload();
	await expect(page.getByText('48 transactions')).toBeVisible();
});

test('the editor can also delete or copy the transaction (for the mouse and touch screens)', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('j');
	await page.keyboard.press('Enter');
	let editor = page.getByRole('dialog', { name: 'Edit transaction' });
	const description = await editor.getByLabel('Description').inputValue();
	await editor.getByRole('button', { name: 'Copy' }).click();
	editor = page.getByRole('dialog', { name: 'New transaction (copy)' });
	await expect(editor.getByLabel('Description')).toHaveValue(description);
	await editor.getByRole('button', { name: 'Cancel' }).click();

	await page.keyboard.press('Enter');
	await page.getByRole('dialog', { name: 'Edit transaction' }).getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('45 transactions')).toBeVisible();
	await page.keyboard.press(`${MOD}+z`);
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('the category picker shows colors and finds a category by typing', async ({ page }) => {
	await importFixture(page);
	await page.keyboard.press('n');
	await page.keyboard.type('Lunch');
	await tabTo(page, 'Category');
	await page.keyboard.type('rest');
	const list = page.getByRole('dialog').getByRole('listbox', { name: 'Categories' });
	await expect(list.getByRole('option').first()).toHaveText('Restaurants & Cafés');
	// each with its color
	await expect(list.getByRole('option').first().locator('.dot')).toHaveCSS('background-color', /rgb/);
	// Tab takes the highlighted one and moves on
	await page.keyboard.press('Tab');
	await expect(page.getByRole('dialog').getByLabel('Category')).toHaveValue('Restaurants & Cafés');
	await expect(list).toBeHidden();
	// Escape closes the list without closing the dialog, and keeps the choice
	await page.getByRole('dialog').getByLabel('Category').focus();
	await page.keyboard.press('ArrowDown');
	await expect(list).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('dialog').getByLabel('Category')).toHaveValue('Restaurants & Cafés');
});
