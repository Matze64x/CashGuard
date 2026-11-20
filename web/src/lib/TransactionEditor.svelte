<!--
	Create or edit a transaction, optionally split into parts (a group). Fully keyboard operable:
	Tab through the fields, Enter or Mod+Enter saves, Mod+Shift+Enter saves and starts the next one,
	Esc cancels.
-->
<script lang="ts">
	import {
		cents,
		civilDate,
		lastUseOf,
		MAX_YEAR,
		MIN_YEAR,
		NO_CATEGORY,
		sumCents,
		type CashGuardData,
		type Cents,
		type CivilDate,
		type Id,
		type TransactionDraft,
	} from '../core';
	import { formatEuro } from './display';
	import { shortcuts } from './shortcuts.svelte';
	import AmountInput from './ui/AmountInput.svelte';
	import DescriptionInput from './ui/DescriptionInput.svelte';
	import Modal from './ui/Modal.svelte';

	let {
		data,
		initial,
		title,
		isNew,
		onsave,
		onclose,
	}: {
		data: CashGuardData;
		initial: TransactionDraft;
		title: string;
		/** A new transaction (an existing one is never prefilled from others) */
		isNew: boolean;
		/** `another`: the user wants to enter the next transaction right away */
		onsave: (draft: TransactionDraft, another: boolean) => void;
		onclose: () => void;
	} = $props();

	interface Part {
		key: number;
		id?: Id;
		date: string;
		description: string;
		categoryId: Id;
		amount: Cents | null;
	}

	// the form keeps its own copy; `initial` only seeds it
	// svelte-ignore state_referenced_locally
	const start = initial;
	let date = $state<string>(start.date);
	let description = $state(start.description);
	let categoryId = $state<Id>(start.categoryId);
	// an empty new transaction starts without an amount, so it has to be entered
	// svelte-ignore state_referenced_locally
	const blank = isNew && start.description === '' && start.amount === 0;
	let amount = $state<Cents | null>(start.subTransactions || blank ? null : start.amount);
	let nextKey = 0;
	let parts = $state<Part[] | null>(start.subTransactions?.map((s) => ({ ...s, key: nextKey++ })) ?? null);
	let error = $state<string | null>(null);

	const categories = $derived([...data.categories].sort((a, b) => a.name.localeCompare(b.name)));
	const partsTotal = $derived(parts && parts.every((p) => p.amount !== null) ? sumCents(parts.map((p) => p.amount!)) : null);

	function validDate(text: string): CivilDate | null {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
		if (!match) return null;
		try {
			return civilDate(Number(match[1]), Number(match[2]), Number(match[3]));
		} catch {
			return null;
		}
	}

	/** Fill in category and amount of a new transaction from the last time this description was used. */
	function prefill(picked: string) {
		if (!isNew) return;
		const last = lastUseOf(data, picked);
		if (!last) return;
		if (categoryId === NO_CATEGORY) categoryId = last.categoryId;
		if (amount === null && !parts) amount = last.amount;
	}

	function split() {
		parts = [{ key: nextKey++, date, description: '', categoryId, amount }];
		amount = null;
	}

	function unsplit() {
		const [first] = parts ?? [];
		amount = parts?.length === 1 && first ? first.amount : partsTotal;
		parts = null;
	}

	function save(another: boolean) {
		error = null;
		const day = validDate(date);
		if (!day) return void (error = `Enter a valid date between ${MIN_YEAR} and ${MAX_YEAR}.`);
		if (!parts) {
			if (amount === null) return void (error = 'Enter an amount.');
			return onsave({ date: day, description: description.trim(), categoryId, amount }, another);
		}
		if (parts.length === 0) return void (error = "Add a part, or choose “Don't split”.");
		const subTransactions = [];
		for (const [i, part] of parts.entries()) {
			const partDay = validDate(part.date);
			if (!partDay) return void (error = `Part ${i + 1}: enter a valid date.`);
			if (part.amount === null) return void (error = `Part ${i + 1}: enter an amount.`);
			subTransactions.push({ ...(part.id && { id: part.id }), date: partDay, description: part.description.trim(), categoryId: part.categoryId, amount: part.amount });
		}
		onsave({ date: day, description: description.trim(), categoryId, amount: cents(0), subTransactions }, another);
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['Mod+Enter'], description: 'Save', group: 'Transaction editor', inFields: true, inDialog: true, run: () => save(false) },
			{ keys: ['Mod+Shift+Enter'], description: 'Save and add another', group: 'Transaction editor', inFields: true, inDialog: true, run: () => save(true) },
		]),
	);
</script>

<Modal {title} {onclose} wide={parts !== null}>
	<form
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			save(false);
		}}
	>
		<div class="fields">
			<label for="tx-description">Description</label>
			<DescriptionInput id="tx-description" bind:value={description} {data} autofocus onpick={prefill} />

			<label for="tx-date">Date</label>
			<input id="tx-date" type="date" min={`${MIN_YEAR}-01-01`} max={`${MAX_YEAR}-12-31`} bind:value={date} required />

			<label for="tx-category">Category</label>
			<select id="tx-category" bind:value={categoryId}>
				<option value={NO_CATEGORY}>No category</option>
				{#each categories as c (c.id)}<option value={c.id}>{c.name || '(unnamed)'}</option>{/each}
			</select>

			{#if !parts}
				<label for="tx-amount">Amount</label>
				<AmountInput id="tx-amount" bind:value={amount} />
			{/if}
		</div>

		{#if parts}
			<fieldset class="parts">
				<legend>Parts <span class="total">Total {partsTotal === null ? '–' : formatEuro(partsTotal)}</span></legend>
				{#each parts as part, i (part.key)}
					<div class="part">
						<input class="p-date" type="date" aria-label={`Part ${i + 1} date`} min={`${MIN_YEAR}-01-01`} max={`${MAX_YEAR}-12-31`} bind:value={part.date} />
						<div class="p-description">
							<DescriptionInput id={`part-${part.key}-description`} label={`Part ${i + 1} description`} bind:value={part.description} {data} />
						</div>
						<select class="p-category" aria-label={`Part ${i + 1} category`} bind:value={part.categoryId}>
							<option value={NO_CATEGORY}>No category</option>
							{#each categories as c (c.id)}<option value={c.id}>{c.name || '(unnamed)'}</option>{/each}
						</select>
						<div class="p-amount"><AmountInput id={`part-${part.key}-amount`} label={`Part ${i + 1} amount`} bind:value={part.amount} /></div>
						<button class="p-remove" type="button" aria-label={`Remove part ${i + 1}`} onclick={() => (parts = parts!.filter((p) => p !== part))}>✕</button>
					</div>
				{/each}
				<div class="part-actions">
					<button type="button" onclick={() => (parts = [...parts!, { key: nextKey++, date, description: '', categoryId, amount: null }])}>Add part</button>
					<button type="button" onclick={unsplit}>Don't split</button>
				</div>
			</fieldset>
		{:else}
			<p class="split"><button type="button" onclick={split}>Split into parts…</button></p>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="buttons">
			<button type="button" onclick={onclose}>Cancel</button>
			<button type="button" onclick={() => save(true)} title="Mod+Shift+Enter">Save and add another</button>
			<button type="submit" class="primary" title="Enter or Mod+Enter">Save</button>
		</div>
	</form>
</Modal>

<style>
	.fields {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem 1rem;
		align-items: center;
	}
	label {
		color: var(--muted);
	}
	.parts {
		margin: 1rem 0 0;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	legend {
		padding: 0 0.4rem;
	}
	.total {
		margin-left: 0.75rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.part {
		display: grid;
		grid-template-columns: 9.5rem 1fr 10rem 11rem auto;
		grid-template-areas: 'date description category amount remove';
		gap: 0.5rem;
		align-items: start;
		margin-bottom: 0.5rem;
	}
	.p-date {
		grid-area: date;
	}
	.p-description {
		grid-area: description;
		min-width: 0;
	}
	.p-category {
		grid-area: category;
		min-width: 0;
	}
	.p-amount {
		grid-area: amount;
	}
	.p-remove {
		grid-area: remove;
	}
	.part-actions,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.buttons {
		justify-content: flex-end;
		margin-top: 1.25rem;
		/* long forms (many parts) scroll, the buttons stay in reach */
		position: sticky;
		bottom: -1.25rem;
		padding: 0.75rem 0 1.25rem;
		margin-bottom: -1.25rem;
		background: var(--surface);
	}
	.split {
		margin: 1rem 0 0;
	}
	.error {
		color: var(--negative);
	}
	@media (max-width: 40rem) {
		.fields {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
		label {
			margin-top: 0.5rem;
		}
		.part {
			grid-template-columns: 1fr 1fr auto;
			grid-template-areas: 'description description description' 'date date date' 'category category category' 'amount amount remove';
			border-bottom: 1px solid var(--border);
			padding-bottom: 0.75rem;
		}
		.p-date {
			min-width: 0;
		}
	}
</style>
