<!--
	Date entry as text in the user's date style (Settings), since the browser's own date field
	follows the browser's language instead. Parts may be left out ("5" = the 5th of this month).
	↑/↓ change the day, PageUp/PageDown the month, Alt+↓ opens the browser's calendar.
-->
<script lang="ts">
	import { addDays, addMonths, formatDateAs, MAX_YEAR, MIN_YEAR, parseDateInput, today, type CivilDate } from '../../core';
	import { settings } from '../settings.svelte';

	let {
		value = $bindable(),
		id,
		label,
		autofocus = false,
	}: { value: CivilDate | null; id?: string; label?: string; autofocus?: boolean } = $props();

	const show = (v: CivilDate | null) => (v === null ? '' : formatDateAs(v, settings.dateStyle));
	let text = $state(show(value));
	// what this field last set, to tell outside changes (and setting changes) from typing
	let lastSet = $state<CivilDate | null>(value);
	let lastStyle = settings.dateStyle;
	$effect(() => {
		if (value !== lastSet || settings.dateStyle !== lastStyle) {
			text = show(value);
			lastSet = value;
			lastStyle = settings.dateStyle;
		}
	});

	// the month and year that left-out parts stand for: those of the current value, else today
	const reference = $derived(lastSet ?? today());
	const invalid = $derived(text.trim() !== '' && parseDateInput(text, settings.dateStyle, reference) === null);

	function set(next: CivilDate | null) {
		lastSet = next;
		value = next;
	}

	function oninput(event: Event) {
		text = (event.currentTarget as HTMLInputElement).value;
		set(text.trim() === '' ? null : parseDateInput(text, settings.dateStyle, reference));
	}

	function step(change: (d: CivilDate) => CivilDate) {
		try {
			const next = change(value ?? today());
			set(next);
			text = show(next);
		} catch {
			// would leave the supported years
		}
	}

	let picker: HTMLInputElement;
	function openPicker() {
		try {
			picker.showPicker();
		} catch {
			picker.focus(); // no showPicker (older browsers): the field itself is usable
		}
	}

	function onkeydown(event: KeyboardEvent) {
		const keys: Record<string, () => void> = {
			ArrowUp: () => step((d) => addDays(d, 1)),
			ArrowDown: () => (event.altKey ? openPicker() : step((d) => addDays(d, -1))),
			PageUp: () => step((d) => addMonths(d, 1)),
			PageDown: () => step((d) => addMonths(d, -1)),
		};
		const action = keys[event.key];
		if (action && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
			event.preventDefault();
			action();
		}
	}
</script>

<div class="date">
	<!-- svelte-ignore a11y_autofocus -->
	<input
		{id}
		type="text"
		inputmode="numeric"
		autocomplete="off"
		spellcheck="false"
		placeholder={settings.dateStyle}
		aria-label={label}
		aria-invalid={invalid}
		title="↑/↓: day, PageUp/PageDown: month, Alt+↓: calendar"
		value={text}
		{oninput}
		{onkeydown}
		onblur={() => (text = invalid ? text : show(value))}
		{autofocus}
	/>
	<!-- the browser's calendar; on phones a tap opens it directly -->
	<span class="calendar" title="Calendar (Alt+↓)">
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path
				d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v11H5z"
				fill="currentColor"
			/></svg
		>
		<input
			bind:this={picker}
			type="date"
			tabindex="-1"
			aria-label={`${label ?? 'Date'}: calendar`}
			min={`${MIN_YEAR}-01-01`}
			max={`${MAX_YEAR}-12-31`}
			value={value ?? ''}
			onclick={openPicker}
			onchange={(e) => {
				const picked = e.currentTarget.value as CivilDate;
				if (picked) step(() => picked);
			}}
		/>
	</span>
</div>
{#if invalid}<p class="error" role="alert">Enter a date like {formatDateAs('2026-03-05' as CivilDate, settings.dateStyle)}</p>{/if}

<style>
	.date {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	input[type='text'] {
		flex: 1;
		min-width: 0;
		font-variant-numeric: tabular-nums;
	}
	.calendar {
		position: relative;
		width: 2.5rem;
		height: 2.5rem;
		flex: none;
		display: grid;
		place-items: center;
		border: 1px solid var(--control-border);
		border-radius: 0.5rem;
		color: var(--muted);
	}
	.calendar:hover {
		border-color: var(--accent);
	}
	svg {
		width: 1.2rem;
		height: 1.2rem;
	}
	/* invisible, but covers the button so a tap/click reaches the browser's date field */
	.calendar input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		min-height: 0;
		opacity: 0;
		padding: 0;
		border: none;
		cursor: pointer;
	}
	.error {
		color: var(--negative);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
</style>
