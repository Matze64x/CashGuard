<!--
	Description with suggestions from earlier transactions (a combobox): ↓/↑ choose a suggestion,
	Enter takes it, Esc closes the list. `onpick` fires when a description is taken or the field is left.
-->
<script lang="ts">
	import { suggestDescriptions, type CashGuardData } from '../../core';

	let {
		value = $bindable(),
		data,
		id,
		label = 'Description',
		autofocus = false,
		onpick,
	}: { value: string; data: CashGuardData; id: string; label?: string; autofocus?: boolean; onpick?: (description: string) => void } = $props();

	let open = $state(false);
	let active = $state(-1);
	const suggestions = $derived(open && value.trim() !== '' ? suggestDescriptions(data, value) : []);
	const listId = $derived(`${id}-suggestions`);

	function take(description: string) {
		value = description;
		open = false;
		active = -1;
		onpick?.(description);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && suggestions.length > 0) {
			event.preventDefault();
			open = true;
			active = (active + 1) % suggestions.length;
		} else if (event.key === 'ArrowUp' && suggestions.length > 0) {
			event.preventDefault();
			active = active <= 0 ? suggestions.length - 1 : active - 1;
		} else if (event.key === 'Enter' && open && suggestions[active] !== undefined) {
			event.preventDefault();
			take(suggestions[active]!);
		} else if (event.key === 'Escape' && open && suggestions.length > 0) {
			// close the list, not the dialog
			event.preventDefault();
			event.stopPropagation();
			open = false;
			active = -1;
		}
	}
</script>

<div class="combobox">
	<!-- svelte-ignore a11y_autofocus -->
	<input
		{id}
		type="text"
		autocomplete="off"
		aria-label={label}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={suggestions.length > 0}
		aria-controls={listId}
		aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
		{autofocus}
		bind:value
		oninput={() => {
			open = true;
			active = -1;
		}}
		{onkeydown}
		onblur={() => {
			open = false;
			onpick?.(value);
		}}
	/>
	{#if suggestions.length > 0}
		<ul id={listId} role="listbox" aria-label="Earlier descriptions">
			{#each suggestions as suggestion, i (suggestion)}
				<li
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onpointerdown={(e) => {
						// keep the focus in the field
						e.preventDefault();
						take(suggestion);
					}}
				>
					{suggestion}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.combobox {
		position: relative;
	}
	input {
		width: 100%;
	}
	ul {
		position: absolute;
		z-index: 2;
		left: 0;
		right: 0;
		margin: 0.2rem 0 0;
		padding: 0.25rem 0;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--control-border);
		border-radius: 0.5rem;
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.15);
		max-height: 16rem;
		overflow: auto;
	}
	li {
		padding: 0.4rem 0.75rem;
		cursor: pointer;
	}
	li.active {
		background: var(--accent-soft);
	}
	@media (hover: hover) {
		li:hover {
			background: var(--accent-soft);
		}
	}
</style>
