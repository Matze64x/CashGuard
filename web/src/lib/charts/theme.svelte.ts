/**
 * The app's colors (CSS custom properties in app.css) for charts, which can't use CSS directly.
 * Reactive: follows a switch between light and dark mode.
 */
const NAMES = ['text', 'muted', 'border', 'surface', 'accent', 'accent-soft', 'positive', 'negative'] as const;
export type ChartColors = Record<(typeof NAMES)[number], string>;

function read(): ChartColors {
	const style = getComputedStyle(document.documentElement);
	return Object.fromEntries(NAMES.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])) as ChartColors;
}

class Theme {
	colors = $state.raw<ChartColors>(read());

	constructor() {
		matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => (this.colors = read()));
	}
}

export const theme = new Theme();
