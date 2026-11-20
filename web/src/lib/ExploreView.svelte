<!--
	Explore the data: the shared filter, a timeline of income and expenses (or categories) per month
	(choosing months sets the filter's period), where the money went by category (or by description
	within one category), and the totals of what the filter selects.
-->
<script lang="ts">
	import {
		applyFilter,
		isFiltered,
		monthsBetween,
		ofSide,
		sumCents,
		today,
		type Cents,
		type CivilDate,
		type Filter,
		type Side,
	} from '../core';
	import Breakdown from './Breakdown.svelte';
	import Timeline from './charts/Timeline.svelte';
	import YearOverYear from './charts/YearOverYear.svelte';
	import Comparison from './Comparison.svelte';
	import { describePeriod, formatEuro, plural } from './display';
	import { filter } from './filter.svelte';
	import FilterBar from './FilterBar.svelte';
	import Segmented from './ui/Segmented.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		onshowtransactions,
	}: { workspace: Workspace; active: boolean; onshowtransactions: () => void } = $props();

	// expenses or income for the category views; follows the filter if that is set to one of them
	let chosenSide = $state<Side>('expense');
	const side = $derived(filter.current.kind === 'all' ? chosenSide : filter.current.kind);
	const SIDES = [
		{ value: 'expense', label: 'Expenses' },
		{ value: 'income', label: 'Income' },
	] as const;

	const result = $derived(applyFilter(workspace.data.transactions, workspace.data.categories, filter.current));
	// what the filter selects apart from its period, for the charts over time (they show all months
	// for context): as text, so it only changes (and is only filtered again) when more than the
	// period changes, which is what clicking a chart does
	const restOfFilter = $derived(JSON.stringify({ ...filter.current, from: null, to: null } satisfies Filter));
	const withoutPeriod = $derived(applyFilter(workspace.data.transactions, workspace.data.categories, JSON.parse(restOfFilter) as Filter).transactions);
	const income = $derived(sumCents(ofSide(result.transactions, 'income').map((t) => t.amount)));
	const expenses = $derived(sumCents(ofSide(result.transactions, 'expense').map((t) => t.amount)));
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
		<Timeline {workspace} matching={withoutPeriod} {side} />
	</section>

	<div class="columns">
		<section class="panel breakdown" aria-label="Breakdown">
			<Breakdown {workspace} transactions={result.transactions} {side}>
				{#snippet actions()}
					<!-- a filter for income only or expenses only decides -->
					<Segmented
						bind:value={() => side, (value) => (chosenSide = value)}
						options={SIDES}
						label="Expenses or income"
						disabled={filter.current.kind !== 'all'}
					/>
				{/snippet}
			</Breakdown>
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

	<section class="panel" aria-label="Year over year">
		<YearOverYear {workspace} matching={withoutPeriod} {side} />
	</section>

	<section class="panel" aria-label="Comparison">
		<Comparison {workspace} {side} />
	</section>
</div>

<style>
	.explore {
		display: grid;
		gap: 1rem;
		padding: 1rem 0.75rem;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		align-items: start;
		gap: 1rem;
	}
	@media (max-width: 50rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
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
