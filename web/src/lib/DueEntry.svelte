<!--
	The form for one due occurrence of a recurring transaction, created anew for each one (so
	nothing typed for one, not even the amount's sign, carries over to the next): the amount is
	focused, empty if it's asked each time (with the sign it had last time); the rest prefilled.
-->
<script lang="ts">
	import { addCents, lastUseOf, MAX_YEAR, MIN_YEAR, NO_CATEGORY, type CashGuardData, type Cents, type CivilDate, type Id, type Recurring, type TransactionDraft } from '../core';
	import { onMount, tick } from 'svelte';
	import { formatEuro } from './display';
	import AmountInput from './ui/AmountInput.svelte';
	import DateInput from './ui/DateInput.svelte';
	import DescriptionInput from './ui/DescriptionInput.svelte';

	let {
		data,
		recurring,
		occurrence,
		busy,
		error = $bindable(),
		onenter,
		onskip,
	}: {
		data: CashGuardData;
		recurring: Recurring;
		occurrence: CivilDate;
		busy: boolean;
		/** Shown under the form (also failures to save) */
		error: string | null;
		/** `accountId`: an existing account, or null */
		onenter: (draft: TransactionDraft, accountId: Id | null) => void;
		onskip: () => void;
	} = $props();

	// seeded once: the parent creates this anew for each occurrence
	// svelte-ignore state_referenced_locally
	const r = recurring;
	// svelte-ignore state_referenced_locally
	let date = $state<CivilDate | null>(occurrence);
	let amount = $state<Cents | null>(r.amount);
	let description = $state(r.description);
	// svelte-ignore state_referenced_locally
	let categoryId = $state<Id>(data.categories.some((c) => c.id === r.categoryId) ? r.categoryId : NO_CATEGORY);
	// a template's account that was deleted meanwhile means none
	// svelte-ignore state_referenced_locally
	let accountId = $state<Id | ''>(r.accountId !== null && data.accounts.some((a) => a.id === r.accountId) ? r.accountId : '');
	// an amount asked each time starts with the sign it had last time (a salary is income)
	// svelte-ignore state_referenced_locally
	const income = r.amount === null && (lastUseOf(data, r.description)?.amount ?? 0) > 0;

	const categories = $derived([...data.categories].sort((a, b) => a.name.localeCompare(b.name)));
	// (as they are now: one deleted meanwhile, e.g. on another device, counts as none)
	const account = $derived(data.accounts.find((a) => a.id === accountId));
	const category = $derived(categoryId === NO_CATEGORY || data.categories.some((c) => c.id === categoryId) ? categoryId : NO_CATEGORY);

	// (a field that appears in an open dialog isn't focused by `autofocus`)
	onMount(() => void tick().then(() => document.getElementById('due-amount')?.focus()));

	function submit() {
		if (busy) return;
		error = null;
		if (!date) return void (error = `Enter a valid date between ${MIN_YEAR} and ${MAX_YEAR}.`);
		if (amount === null) return void (error = 'Enter the amount.');
		onenter({ date, description: description.trim(), categoryId: category, amount }, account?.id ?? null);
	}
</script>

<form
	novalidate
	onsubmit={(e) => {
		e.preventDefault();
		submit();
	}}
>
	<div class="fields">
		<label for="due-amount">Amount</label>
		<AmountInput id="due-amount" bind:value={amount} {income} />

		<label for="due-date">Date</label>
		<DateInput id="due-date" bind:value={date} />

		<label for="due-description">Description</label>
		<DescriptionInput id="due-description" bind:value={description} {data} />

		<label for="due-category">Category</label>
		<select id="due-category" bind:value={categoryId}>
			<option value={NO_CATEGORY}>No category</option>
			{#each categories as c (c.id)}<option value={c.id}>{c.name || '(unnamed)'}</option>{/each}
		</select>

		{#if data.accounts.length > 0}
			<label for="due-account">Account</label>
			<div class="account">
				<select id="due-account" bind:value={accountId}>
					<option value="">Don't update a balance</option>
					{#each data.accounts as a (a.id)}<option value={a.id}>{a.name || '(unnamed)'}</option>{/each}
				</select>
				{#if account}
					<span class="balance">{formatEuro(account.amount)} → {amount === null ? '…' : formatEuro(addCents(account.amount, amount))}</span>
				{/if}
			</div>
		{/if}
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="buttons">
		<button type="button" disabled={busy} onclick={onskip}>Skip, it didn't happen</button>
		<button type="submit" class="primary" disabled={busy} title="Enter">Enter</button>
	</div>
</form>

<style>
	.fields {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.75rem 1rem;
		align-items: center;
	}
	label {
		color: var(--muted);
	}
	.account {
		display: grid;
		gap: 0.25rem;
	}
	.balance {
		color: var(--muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.error {
		color: var(--negative);
		margin: 0.75rem 0 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
	@media (max-width: 40rem) {
		.fields {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.25rem;
		}
		label {
			margin-top: 0.5rem;
		}
	}
</style>
