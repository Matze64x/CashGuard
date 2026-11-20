/** The build exactly as published on GitHub Pages (below /CashGuard/), see playwright.config.ts. */
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PUBLISHED = 'http://localhost:5299/CashGuard/';
const FIXTURE = fileURLToPath(new URL('../fixtures/edge-cases.json', import.meta.url));

test('the installed app works offline, with its data', async ({ page, context }) => {
	await page.goto(PUBLISHED);
	// the service worker takes over once it has cached the app
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await (await chooser).setFiles(FIXTURE);
	await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('46 transactions')).toBeVisible();

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByText('46 transactions')).toBeVisible();
});

test('everything is served below the base path and the app can be installed', async ({ page, request }) => {
	await page.goto(PUBLISHED);
	const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
	expect(touchIcon).toBe('/CashGuard/placeholder-apple-touch-icon.png');
	expect((await request.get(new URL(touchIcon!, PUBLISHED).href)).ok()).toBe(true);

	const manifestUrl = new URL((await page.locator('link[rel="manifest"]').getAttribute('href'))!, PUBLISHED).href;
	const manifest = await (await request.get(manifestUrl)).json();
	expect(manifest).toMatchObject({ name: 'CashGuard', display: 'standalone' });
	// start_url and scope resolve to the app's folder on Pages
	expect(new URL(manifest.start_url, manifestUrl).href).toBe(PUBLISHED);
	expect(new URL(manifest.scope, manifestUrl).href).toBe(PUBLISHED);
	for (const icon of manifest.icons) expect((await request.get(new URL(icon.src, manifestUrl).href)).ok()).toBe(true);

	const registration = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
	expect(registration).toBe(PUBLISHED);
});
