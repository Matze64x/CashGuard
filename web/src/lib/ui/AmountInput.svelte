<!--
	Amount entry: the number without sign, plus an expense/income toggle (expense by default).
	Typing "+" or "-" anywhere in the field switches the sign. Accepts "12,50" and "12.50".
	Focusing the field selects its content, so typing replaces a prefilled amount.
-->
<script lang="ts">
	import { cents, formatAmount, parseAmount, type Cents } from '../../core';

	let {
		value = $bindable(),
		id,
		label = 'Amount',
		required = true,
		autofocus = false,
	}: { value: Cents | null; id: string; label?: string; required?: boolean; autofocus?: boolean } = $props();

	const toText = (v: Cents | null) => (v === null ? '' : formatAmount(v).slice(1).replace('.', ','));
	let negative = $state(value === null ? true : value <= 0);
	let text = $state(toText(value));
	// keep the field in sync when the value is set from outside (e.g. prefilled from a description)
	let lastSet: Cents | null = value;
	$effect(() => {
		if (value !== lastSet) {
			text = toText(value);
			if (value !== null && value !== 0) negative = value < 0;
			lastSet = value;
		}
	});

	const magnitude = $derived(text.trim() === '' ? null : parseAmount(`+${text.trim()}`));
	const invalid = $derived(text.trim() !== '' && magnitude === null);

	function update() {
		const next = magnitude === null ? null : cents(negative ? -magnitude : magnitude);
		lastSet = next;
		value = next;
	}

	function oninput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (/[+-]/.test(input.value)) {
			negative = input.value.lastIndexOf('-') > input.value.lastIndexOf('+');
			text = input.value.replace(/[+-]/g, '');
			// `text` may be unchanged ("12" -> "12+" -> "12"), then Svelte wouldn't update the field
			input.value = text;
		} else text = input.value;
		update();
	}

	function toggle() {
		negative = !negative;
		update();
	}
</script>

<div class="amount">
	<button
		type="button"
		class="sign"
		class:income={!negative}
		aria-pressed={!negative}
		aria-label={negative ? 'Expense (press for income)' : 'Income (press for expense)'}
		title="Expense or income (type + or - in the field)"
		onclick={toggle}>{negative ? '−' : '+'}</button
	>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		{id}
		{autofocus}
		onfocus={(e) => e.currentTarget.select()}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		placeholder="0,00"
		aria-label={label}
		aria-invalid={invalid}
		{required}
		value={text}
		{oninput}
	/>
	<span class="currency" aria-hidden="true">€</span>
</div>
{#if invalid}<p class="error" role="alert">Enter an amount like 12,50</p>{/if}

<style>
	.amount {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	input {
		flex: 1;
		min-width: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.sign {
		width: 2.5rem;
		font-weight: 700;
		color: var(--negative);
	}
	.sign.income {
		color: var(--positive);
	}
	.currency {
		color: var(--muted);
	}
	.error {
		color: var(--negative);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
</style>
