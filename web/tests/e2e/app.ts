/** Helpers shared by the end-to-end tests. */
import { expect, type Page } from '@playwright/test';

/** Waits until the data is loaded: only then do shortcuts and the file actions work */
export async function waitForApp(page: Page) {
	// (the views are only rendered once the data is loaded)
	await expect(page.getByRole('listbox', { name: 'Transactions' })).toBeAttached();
}

/** Opens the settings */
export async function openSettings(page: Page) {
	await page.getByRole('button', { name: 'Settings' }).click();
	const dialog = page.getByRole('dialog', { name: 'Settings' });
	await expect(dialog).toBeVisible();
	return dialog;
}

/** Clicks one of the file actions, which are in the settings (the dialog closes) */
export async function fileAction(page: Page, name: 'Import' | 'Export' | 'Undo import') {
	const dialog = await openSettings(page);
	await dialog.getByRole('button', { name, exact: true }).click();
}
