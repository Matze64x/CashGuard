<!-- A radio group of colors: Tab into it, arrow keys choose (standard radio behaviour). -->
<script lang="ts">
	import { CATEGORY_COLORS } from '../palette';

	let { value = $bindable(), label = 'Color' }: { value: string; label?: string } = $props();
	const name = `color-${Math.random().toString(36).slice(2)}`;
	// a color from elsewhere (e.g. the C++ client) that isn't in the palette stays selectable
	const options = $derived(CATEGORY_COLORS.some((c) => c.color === value.toUpperCase()) ? CATEGORY_COLORS : [{ name: 'Current color', color: value.toUpperCase() }, ...CATEGORY_COLORS]);
</script>

<fieldset>
	<legend>{label}</legend>
	<div class="swatches">
		{#each options as option (option.color)}
			<label class="swatch" style:--swatch={option.color} title={option.name}>
				<input type="radio" {name} value={option.color} bind:group={value} aria-label={option.name} />
			</label>
		{/each}
	</div>
</fieldset>

<style>
	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}
	legend {
		color: var(--muted);
		margin-bottom: 0.4rem;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.swatch {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--swatch);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	input {
		appearance: none;
		margin: 0;
		min-height: 0;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		border: 2px solid transparent;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	input:checked {
		border-color: var(--text);
		box-shadow: inset 0 0 0 2px var(--surface);
	}
	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
