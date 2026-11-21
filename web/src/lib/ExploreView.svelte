<!--
	Explore the data: the shared filter, a timeline of income and expenses (or categories) per month
	(choosing months sets the filter's period), where the money went by category (or by description
	within one category), and the totals of what the filter selects.
-->
<script lang="ts">
	import {
		applyFilter,
		chartPeriod,
		isFiltered,
		monthsBetween,
		ofSide,
		projection,
		projectionBasis,
		sumCents,
		type Cents,
		type CivilDate,
		type Filter,
		type Side,
	} from '../core';
	import Breakdown from './Breakdown.svelte';
	import { clock } from './clock.svelte';
	import Timeline from './charts/Timeline.svelte';
	import CategoryTrends from './CategoryTrends.svelte';
	import Comparison from './Comparison.svelte';
	import { describePeriod, formatDate, formatEuro, plural } from './display';
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
		const end = earlier(to ?? result.transactions[0]?.date, later(all[0]?.date, clock.today));
		return start && end && start <= end ? monthsBetween(start, end).length : 0;
	});
	// a period that isn't over yet: where it's heading, by what usually comes in the rest of it
	// (where the data starts like the charts, which leave out probably mistyped dates)
	const oldest = $derived(chartPeriod(workspace.data.transactions, clock.today).oldest);
	const estimate = $derived.by(() => {
		const { from, to } = filter.current;
		if (!from || !to) return null;
		const basis = projectionBasis({ from, to }, clock.today, oldest);
		if (basis === null) return null;
		const project = projection(basis, withoutPeriod, (t) => (t.amount > 0 ? 'income' : 'expense'));
		const toIncome = project('income', income);
		const toExpenses = project('expense', expenses);
		// (nothing more expected: nothing to show)
		if (toIncome === null || toExpenses === null || (toIncome === income && toExpenses === expenses)) return null;
		return { to, income: toIncome, expenses: toExpenses, net: sumCents([toIncome, toExpenses]) };
	});
	// (dates compare as text; a missing one doesn't count)
	const later = (a?: CivilDate, b?: CivilDate) => (a && b ? (a > b ? a : b) : (a ?? b));
	const earlier = (a?: CivilDate, b?: CivilDate) => (a && b ? (a < b ? a : b) : (a ?? b));

	let showButton: HTMLButtonElement;
</script>

<div class="explore">
	<div class="filter"><FilterBar {workspace} {active} onleave={() => showButton.focus()} /></div>

	<!-- what the filter selects, over time and in total -->
	<div class="group overview">
		<section class="part timeline" aria-label="Timeline">
			<Timeline {workspace} matching={withoutPeriod} {side} />
		</section>

		<section class="part totals" aria-label="Totals of the filtered transactions">
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
			{#if estimate}
				<div class="estimate" role="group" aria-labelledby="explore-estimate">
					<h3 id="explore-estimate">Expected by {formatDate(estimate.to)}</h3>
					<dl>
						<dt>Income</dt>
						<dd>{formatEuro(estimate.income)}</dd>
						<dt>Expenses</dt>
						<dd>{formatEuro(estimate.expenses)}</dd>
						<dt>Net</dt>
						<dd>{formatEuro(estimate.net)}</dd>
					</dl>
				</div>
			{/if}
			<button bind:this={showButton} onclick={onshowtransactions} title="g t">
				Show {isFiltered(filter.current) ? plural(result.transactions.length, 'transaction') : 'all transactions'}
			</button>
		</section>
	</div>

	<!-- by category: the expenses or the income, chosen once for everything in here -->
	<section class="group by-category" aria-labelledby="explore-side">
		<div class="group-head">
			<h2 id="explore-side">{side === 'expense' ? 'Expenses' : 'Income'} by category</h2>
			<!-- a filter for income only or expenses only decides -->
			<Segmented
				bind:value={() => side, (value) => (chosenSide = value)}
				options={SIDES}
				label="Expenses or income"
				disabled={filter.current.kind !== 'all'}
			/>
			{#if filter.current.kind !== 'all'}<span class="muted note">as the filter says</span>{/if}
		</div>
		<section class="part breakdown" aria-label="Breakdown">
			<Breakdown {workspace} transactions={result.transactions} {side} />
		</section>
		<section class="part comparison" aria-label="Comparison">
			<Comparison {workspace} {side} />
		</section>
		<section class="part trends" aria-label="Trends">
			<CategoryTrends {workspace} matching={withoutPeriod} {side} />
		</section>
	</section>
</div>

<style>
	/* two boxes: the overview (timeline and totals) and, by category (expenses or income, chosen in
	   its head), the breakdown, the comparison and the trends; their parts side by side where
	   there's room. One column on phones. */
	.explore {
		display: grid;
		gap: 1rem;
		padding: 1rem 0.75rem;
	}
	.group {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		min-width: 0;
	}
	.part {
		padding: 1rem;
		min-width: 0;
	}
	/* parts below one another are divided by a line */
	.part + .part {
		border-top: 1px solid var(--border);
	}
	.group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--border);
		border-radius: 0.75rem 0.75rem 0 0;
		background: var(--accent-soft);
	}
	.group-head h2 {
		margin: 0;
		margin-right: auto;
		font-size: 1.2rem;
	}
	.note {
		font-size: 0.85rem;
	}
	@media (min-width: 80rem) {
		.overview {
			grid-template-columns: minmax(0, 1fr) 18rem;
		}
		.overview .totals {
			border-top: none;
			border-left: 1px solid var(--border);
		}
		.by-category {
			grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
			grid-template-areas: 'head head' 'breakdown comparison' 'trends trends';
		}
		.group-head {
			grid-area: head;
		}
		.breakdown {
			grid-area: breakdown;
		}
		.comparison {
			grid-area: comparison;
			border-top: none;
			border-left: 1px solid var(--border);
		}
		.trends {
			grid-area: trends;
		}
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
	h3 {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--muted);
	}
	/* the estimate: muted, set off by a dashed line like the estimates in the charts */
	.estimate {
		padding-top: 0.5rem;
		border-top: 1px dashed var(--border);
		color: var(--muted);
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
