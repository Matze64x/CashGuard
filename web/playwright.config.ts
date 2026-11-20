import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the dev server, and against the build exactly as it's published on
// GitHub Pages (below /CashGuard/, in dist-pages; the publish workflow uploads that directory).
// Run with: npm run test:e2e
export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'tests/e2e-results',
	fullyParallel: true,
	reporter: 'list',
	forbidOnly: Boolean(process.env['CI']),
	// CI machines are slower; one retry keeps timing hiccups from blocking a deployment
	retries: process.env['CI'] ? 1 : 0,
	use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
	webServer: [
		{ command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: false },
		// the published build, for what only exists there (service worker, manifest, base path)
		{
			command: 'export CASHGUARD_BASE=/CashGuard/ && npx vite build --outDir dist-pages && npx vite preview --outDir dist-pages --port 5299 --strictPort',
			url: 'http://localhost:5299/CashGuard/',
			reuseExistingServer: false,
		},
	],
	projects: [
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		// WebKit is Safari's engine: the closest to the iPhone we can test here
		{ name: 'iphone', use: { ...devices['iPhone 15'] } },
	],
});
