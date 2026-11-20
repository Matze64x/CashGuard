<!--
	Explore the data: the shared filter, a timeline of income and expenses per month (choosing
	months sets the filter's period), and the totals of what the filter selects.
-->
<script lang="ts">
	import { applyFilter, isFiltered, monthsBetween, sumCents, today, type Cents, type CivilDate } from '../core';
	import Timeline from './charts/Timeline.svelte';
	import { describePeriod, formatEuro, plural } from './display';
	import { filter } from './filter.svelte';
	import FilterBar from './FilterBar.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		onshowtransactions,
	}: { workspace: Workspace; active: boolean; onshowtransactions: () => void } = $props();

	const result = $derived(applyFilter(workspace.data.transactions, workspace.data.categories, filter.current));
	const income = $derived(sumCents(result.transactions.filter((t) => t.amount > 0).map((t) => t.amount)));
	const expenses = $derived(sumCents(result.transactions.filter((t) => t.amount < 0).map((t) => t.amount)));
	// the months the totals cover, for the monthly average: the period as far as there is data (so
	// "This year" in March counts 3 months), else the span of the matching transactions
	const monthCount = $derived.by(() => {
		const all = workspace.data.transactions; // newest first
		const { from, to } = filter.current;
		const start = later(from ?? result.transactions.at(-1)?.date, all.at(-1)?.date);
		const end = earlier(to ?? result.transactions[0]?.date, later(all[0]?.date, today()));
		return start && end && start <= end ? monthsBetween(start, end).length : 0;
	});
	// (dates compare as text; a missing one doesn't count)
	const later = (a?: CivilDate, b?: CivilDate) => (a && b ? (a > b ? a : b) : (a ?? b));
	const earlier = (a?: CivilDate, b?: CivilDate) => (a && b ? (a < b ? a : b) : (a ?? b));

	let showButton: HTMLButtonElement;
</script>

<div class="explore">
	<FilterBar {workspace} {active} onleave={() => showButton.focus()} />

	<section class="panel" aria-label="Timeline">
		<Timeline {workspace} />
	</section>

	<section class="panel totals" aria-label="Totals of the filtered transactions">
		<h2>{filter.current.from || filter.current.to ? describePeriod(filter.current.from, filter.current.to) : 'All time'}</h2>
		<dl>
			<dt>Income</dt>
			<dd class="income">{formatEuro(income)}</dd>
			<dt>Expenses</dt>
			<dd class="expenses">{formatEuro(expenses)}</dd>
			<dt>Net</dt>
			<dd>{formatEuro(result.total)}</dd>
			{#if monthCount > 1}
				<dt>Per month</dt>
				<dd>{formatEuro(Math.round(result.total / monthCount) as Cents)} <span class="muted">over {monthCount} months</span></dd>
			{/if}
		</dl>
		<button bind:this={showButton} onclick={onshowtransactions} title="g t">
			Show {isFiltered(filter.current) ? plural(result.transactions.length, 'transaction') : 'all transactions'}
		</button>
	</section>
</div>

<style>
	.explore {
		display: grid;
		gap: 1rem;
		padding: 1rem 0.75rem;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		padding: 1rem;
		min-width: 0;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
	}
	dl {
		display: grid;
		grid-template-columns: auto auto;
		justify-content: start;
		gap: 0.3rem 2rem;
		margin: 0 0 1rem;
		font-variant-numeric: tabular-nums;
	}
	dt,
	.muted {
		color: var(--muted);
	}
	dd {
		margin: 0;
		text-align: right;
	}
	.income {
		color: var(--positive);
	}
	.expenses {
		color: var(--negative);
	}
</style>
