<!--
	Amount entry: the number without sign, plus an expense/income toggle (expense by default).
	Typing "+" or "-" anywhere in the field switches the sign. Accepts "12,50" and "12.50".
	Focusing the field selects its content, so typing replaces a prefilled amount. ↑/↓ change the
	number by a cent (not below 0). An invalid amount
	only turns the border red (no text that would shift the layout); screen readers hear why.
-->
<script lang="ts">
	import { cents, formatAmount, parseAmount, type Cents } from '../../core';

	let {
		value = $bindable(),
		id,
		label = 'Amount',
		required = true,
		autofocus = false,
		income = false,
	}: {
		value: Cents | null;
		id: string;
		label?: string;
		required?: boolean;
		autofocus?: boolean;
		/** The sign to start with while there's no amount yet (else it's an expense) */
		income?: boolean;
	} = $props();

	const toText = (v: Cents | null) => (v === null ? '' : formatAmount(v).slice(1).replace('.', ','));
	// svelte-ignore state_referenced_locally
	let negative = $state(value === null ? !income : value <= 0);
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

	function step(event: KeyboardEvent) {
		if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (invalid) return;
		event.preventDefault();
		const next = Math.max(0, (magnitude ?? 0) + (event.key === 'ArrowUp' ? 1 : -1));
		text = toText(cents(next));
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
		aria-describedby={invalid ? `${id}-invalid` : undefined}
		{required}
		value={text}
		{oninput}
		onkeydown={step}
	/>
	<span class="currency" aria-hidden="true">€</span>
	<span id={`${id}-invalid`} class="hidden">{invalid ? 'Not an amount: enter one like 12,50' : ''}</span>
</div>

<style>
	.amount {
		position: relative;
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
	/* read by screen readers only */
	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
