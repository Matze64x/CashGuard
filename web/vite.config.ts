import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the app below the repository name; everything else (dev server, desktop
// app) serves it at the root. The deploy workflow sets CASHGUARD_BASE.
const base = process.env['CASHGUARD_BASE'] ?? '/';

// https://vite.dev/config/
export default defineConfig({
	base,
	plugins: [
		svelte(),
		// installable web app that works offline; the service worker is registered in main.ts
		// (only in browsers, not in the desktop app)
		VitePWA({
			// the desktop app ships its files itself, so it gets no service worker
			disable: Boolean(process.env['TAURI_ENV_PLATFORM']),
			// a new version is installed in the background and used from the next full start of the
			// app; it never reloads a running app, so open dialogs or unsaved input can't be lost
			registerType: 'prompt',
			injectRegister: false,
			// PLACEHOLDER icons (made from Tauri's default icon) until the app icon is decided
			manifest: {
				id: '.',
				name: 'CashGuard',
				short_name: 'CashGuard',
				description: 'Personal finances, synced as one file',
				start_url: '.',
				scope: '.',
				display: 'standalone',
				background_color: '#f6f7f8',
				theme_color: '#ffffff',
				icons: [
					{ src: 'placeholder-icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'placeholder-icon-512.png', sizes: '512x512', type: 'image/png' },
				],
			},
			// the app's data lives in IndexedDB, not in this cache
			workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
		}),
	],
	test: {
		include: ['tests/**/*.test.ts'],
	},
});
