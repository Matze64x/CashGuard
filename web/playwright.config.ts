import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the dev server. Run with: npm run test:e2e
export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: 'tests/e2e-results',
	fullyParallel: true,
	reporter: 'list',
	use: { baseURL: 'http://localhost:5199' },
	webServer: { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: false },
	projects: [
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		// WebKit is Safari's engine: the closest to the iPhone we can test here
		{ name: 'iphone', use: { ...devices['iPhone 15'] } },
	],
});
