<!--
	Edit the shared filter (f): period (with presets), income/expenses, categories and an amount
	range. Enter applies, Esc cancels. The search text is edited in the filter bar itself.
-->
<script lang="ts">
	import { compareIds, formatAmount, NO_CATEGORY, parseAmount, periodPresets, today, type Cents, type CivilDate, type Id, type Kind } from '../core';
	import { filter } from './filter.svelte';
	import DateInput from './ui/DateInput.svelte';
	import Modal from './ui/Modal.svelte';
	import type { Workspace } from './workspace.svelte';

	let { workspace, onclose }: { workspace: Workspace; onclose: () => void } = $props();

	const presets = periodPresets(today());
	const start = filter.current;
	let from = $state<CivilDate | null>(start.from);
	let to = $state<CivilDate | null>(start.to);
	let kind = $state<Kind>(start.kind);
	// categories deleted meanwhile aren't offered, so they're dropped
	// svelte-ignore state_referenced_locally
	let chosen = $state<Id[]>(start.categories.filter((id) => id === NO_CATEGORY || workspace.data.categories.some((c) => c.id === id)));
	let fromInvalid = $state(false);
	let toInvalid = $state(false);
	// choosing a preset replaces whatever is typed in the date fields, even invalid text
	let dateFields = $state(0);
	const amountText = (v: Cents | null) => (v === null ? '' : formatAmount(v).slice(1).replace('.', ','));
	let minText = $state(amountText(start.minAmount));
	let maxText = $state(amountText(start.maxAmount));
	let error = $state<string | null>(null);

	const categories = $derived([{ id: NO_CATEGORY, name: 'No category', color: 'transparent' }, ...[...workspace.data.categories].sort((a, b) => a.name.localeCompare(b.name))]);
	// the preset that matches the dates, if any ('' = any time, 'custom' = other dates)
	const preset = $derived(
		from === null && to === null ? '' : (presets.find((p) => p.period.from === from && p.period.to === to)?.label ?? 'custom'),
	);

	function choosePreset(label: string) {
		const period = presets.find((p) => p.label === label)?.period;
		from = period?.from ?? null;
		to = period?.to ?? null;
		dateFields++;
	}

	/** A typed amount without sign, or null if empty; undefined if invalid */
	function amountOf(text: string): Cents | null | undefined {
		if (text.trim() === '') return null;
		return parseAmount(`+${text.trim().replace(/^[+-]/, '')}`) ?? undefined;
	}

	function apply() {
		const minAmount = amountOf(minText);
		const maxAmount = amountOf(maxText);
		if (fromInvalid || toInvalid) return void (error = 'Enter valid dates, or leave them empty.');
		if (from && to && from > to) return void (error = 'The period ends before it starts.');
		if (minAmount === undefined || maxAmount === undefined) return void (error = 'Enter amounts like 12,50.');
		if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) return void (error = 'The smallest amount is larger than the largest.');
		filter.set({
			from,
			to,
			kind,
			// a snapshot, not the reactive proxy; sorted so the chips don't follow the click order
			categories: $state.snapshot(chosen).sort(compareIds),
			// "at least 0" filters nothing
			minAmount: minAmount === 0 ? null : minAmount,
			maxAmount,
		});
		onclose();
	}

	function clearAll() {
		filter.clearExceptText();
		onclose();
	}
</script>

<Modal title="Filter" {onclose}>
	<form
		novalidate
		oninput={() => (error = null)}
		onsubmit={(e) => {
			e.preventDefault();
			apply();
		}}
	>
		<div class="group" role="group" aria-labelledby="filter-legend-1">
			<span class="legend" id="filter-legend-1">Period</span>
			<!-- svelte-ignore a11y_autofocus -->
			<select aria-label="Period" value={preset} onchange={(e) => choosePreset(e.currentTarget.value)} autofocus>
				<option value="">Any time</option>
				{#each presets as p (p.label)}<option value={p.label}>{p.label}</option>{/each}
				<option value="custom" disabled>Other dates</option>
			</select>
			{#key dateFields}
				<div class="range">
					<DateInput label="From" bind:value={from} bind:invalid={fromInvalid} />
					<span aria-hidden="true">–</span>
					<DateInput label="To" bind:value={to} bind:invalid={toInvalid} />
				</div>
			{/key}
		</div>

		<div class="group" role="group" aria-labelledby="filter-legend-2">
			<span class="legend" id="filter-legend-2">Type</span>
			<select aria-label="Type" bind:value={kind}>
				<option value="all">Income and expenses</option>
				<option value="expense">Expenses only</option>
				<option value="income">Income only</option>
			</select>
		</div>

		<div class="group" role="group" aria-labelledby="filter-legend-3">
			<span class="legend" id="filter-legend-3">Categories <span class="hint">{chosen.length === 0 ? '(all)' : `(${chosen.length} chosen)`}</span></span>
			<div class="categories">
				{#each categories as c (c.id)}
					<label class="category">
						<input type="checkbox" value={c.id} bind:group={chosen} />
						<span class="dot" style:background={c.color}></span>
						{c.name || '(unnamed)'}
					</label>
				{/each}
			</div>
		</div>

		<div class="group" role="group" aria-labelledby="filter-legend-4">
			<span class="legend" id="filter-legend-4">Amount <span class="hint">(without sign)</span></span>
			<div class="range">
				<input type="text" inputmode="decimal" autocomplete="off" placeholder="from" aria-label="Amount from" bind:value={minText} />
				<span aria-hidden="true">–</span>
				<input type="text" inputmode="decimal" autocomplete="off" placeholder="to" aria-label="Amount to" bind:value={maxText} />
				<span class="hint">€</span>
			</div>
		</div>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="buttons">
			<button type="button" class="clear" onclick={clearAll}>Clear all</button>
			<button type="button" onclick={onclose}>Cancel</button>
			<button type="submit" class="primary">Apply</button>
		</div>
	</form>
</Modal>

<style>
	/* minmax(0, 1fr): columns may be narrower than the fields' natural width */
	form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	.group {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.4rem;
	}
	.legend {
		color: var(--muted);
	}
	.hint {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.range {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.range > :global(*) {
		flex: 1;
		min-width: 0;
	}
	.range > span {
		flex: none;
	}
	.categories {
		max-height: 12rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.25rem 0.5rem;
	}
	.category {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0;
	}
	.category input {
		min-height: 0;
	}
	.dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		flex: none;
	}
	.error {
		color: var(--negative);
		margin: 0;
	}
	.buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.clear {
		margin-right: auto;
	}
</style>
