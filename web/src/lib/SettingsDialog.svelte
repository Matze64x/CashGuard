<!-- Preferences of this device (stored in the browser, not in the data file). Changes apply at once. -->
<script lang="ts">
	import { DATE_STYLES, formatDateAs, today, type DateStyle } from '../core';
	import { dataLocation, isDesktop } from './desktop';
	import { settings } from './settings.svelte';
	import Modal from './ui/Modal.svelte';

	let { onclose }: { onclose: () => void } = $props();
	const sample = today();
	const location = isDesktop ? dataLocation().catch(() => null) : null;
</script>

<Modal title="Settings" {onclose}>
	<div class="settings">
		<label for="date-style">Date format</label>
		<!-- svelte-ignore a11y_autofocus -->
		<select id="date-style" value={settings.dateStyle} onchange={(e) => (settings.dateStyle = e.currentTarget.value as DateStyle)} autofocus>
			{#each DATE_STYLES as style (style)}
				<option value={style}>{style} ({formatDateAs(sample, style)})</option>
			{/each}
		</select>
		<p class="muted">Settings apply to this device only; your CashGuard file is not changed.</p>
		{#if location}
			{#await location then where}
				{#if where}
					<p class="muted where">
						{where.portable ? 'Portable: the app keeps its data (working copy, settings, backups of your file) next to itself, in' : 'The app keeps its data (working copy, settings, backups of your file) in'}
						<code>{where.path}</code>
					</p>
				{/if}
			{/await}
		{/if}
		<div class="buttons"><button type="button" class="primary" onclick={onclose}>Done</button></div>
	</div>
</Modal>

<style>
	.settings {
		display: grid;
		gap: 0.5rem;
	}
	.muted,
	label {
		color: var(--muted);
	}
	.muted {
		font-size: 0.85rem;
		margin: 0.5rem 0 0;
	}
	.where code {
		overflow-wrap: anywhere;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
	}
</style>
