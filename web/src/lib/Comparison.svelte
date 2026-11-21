<!--
	The filter's period next to the same stretch of time right before it (without a period: the
	last 12 complete months and the 12 before; a period that isn't over yet only up to today, like
	for like), per category, or per description with exactly one category chosen: both totals, the
	change and the monthly average. A row filters by its category or searches for its description.
-->
<script lang="ts">
	import {
		applyFilter,
		compareTotals,
		comparePeriod,
		lastTwelveMonths,
		ofSide,
		sumCents,
		totalsByCategory,
		totalsByDescription,
		type Cents,
		type Period,
		type Side,
		type Transaction,
	} from '../core';
	import { clock } from './clock.svelte';
	import { describePeriod, formatEuro, formatEuroChange } from './display';
	import { filter } from './filter.svelte';
	import { rowTarget } from './rows.svelte';
	import type { Workspace } from './workspace.svelte';

	let { workspace, side }: { workspace: Workspace; side: Side } = $props();

	const comparison = $derived.by(() => {
		const { from, to } = filter.current;
		if (from && to) return comparePeriod({ from, to }, clock.today);
		return from || to ? null : comparePeriod(lastTwelveMonths(clock.today), clock.today);
	});

	/** What the filter selects in a period, of the side */
	const within = (period: Period): Transaction[] =>
		ofSide(applyFilter(workspace.data.transactions, workspace.data.categories, { ...filter.current, ...period }).transactions, side);

	const categories = $derived(new Map(workspace.data.categories.map((c) => [c.id, c])));
	const byDescription = $derived(filter.current.categories.length === 1);
	const totalsBy = $derived(byDescription ? totalsByDescription : totalsByCategory);
	const rows = $derived.by(() => {
		if (!comparison) return [];
		return compareTotals<string>(totalsBy(within(comparison.current)), totalsBy(within(comparison.previous))).map((r) => ({
			...r,
			...rowTarget(r.key, byDescription, categories),
		}));
	});
	const totals = $derived({ current: sumCents(rows.map((r) => r.current)), previous: sumCents(rows.map((r) => r.previous)) });
	// the period before ends before the oldest transaction: there's nothing to compare with
	const noData = $derived.by(() => {
		const oldest = workspace.data.transactions.at(-1)?.date;
		return !!comparison && !!oldest && comparison.previous.to < oldest;
	});

	const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
	/** Amounts without sign: for expenses, "more" means spending more */
	const size = (value: Cents) => Math.abs(value) as Cents;
</script>

{#snippet change(current: Cents, previous: Cents)}
	{@const delta = (size(current) - size(previous)) as Cents}
	{@const ratio = previous === 0 ? null : delta / size(previous)}
	<!-- colored when it's worth noticing: less spending (or more income) is good -->
	{@const notable = !noData && (ratio === null ? delta !== 0 : Math.abs(ratio) >= 0.005)}
	{@const good = side === 'expense' ? delta < 0 : delta > 0}
	<td class="number" class:good={notable && good} class:bad={notable && !good}>
		<span class="wide">{formatEuroChange(delta)}</span>
		<span class="percent">{noData ? '–' : ratio === null ? (delta === 0 ? '' : 'new') : percent.format(ratio)}</span>
	</td>
{/snippet}

<h2>{side === 'expense' ? 'Expenses' : 'Income'} compared with the period before</h2>
{#if !comparison}
	<p class="note">Choose a period with a start and an end to compare it.</p>
{:else}
	<p class="note">
		<b>{describePeriod(comparison.current.from, comparison.current.to)}</b>{filter.current.from ? '' : ' (the last 12 complete months)'} compared with
		<b>{describePeriod(comparison.previous.from, comparison.previous.to)}</b>
		{#if comparison.cut}<br />The period isn't over yet, so the same days of the period before are compared.{/if}
		{#if noData}<br />There's no data that far back, so there are no changes to show.{/if}
	</p>
	{#if rows.length === 0}
		<p class="note">Nothing here for the current filter.</p>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">{byDescription ? 'Description' : 'Category'}</th>
						<th scope="col" class="number">This period</th>
						<th scope="col" class="number wide">Before</th>
						<th scope="col" class="number">Change</th>
						<th scope="col" class="number wide">Per month</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.key)}
						<tr>
							<th scope="row">
								<button class="name" onclick={row.choose} disabled={!row.choose} title={row.title}>
									{#if row.color}<span class="dot" style:background={row.color}></span>{/if}
									<span class="label">{row.label}</span>
								</button>
							</th>
							<td class="number">{formatEuro(size(row.current))}</td>
							<td class="number muted wide">{formatEuro(size(row.previous))}</td>
							{@render change(row.current, row.previous)}
							<td class="number muted wide">{formatEuro(Math.round(size(row.current) / comparison.months) as Cents)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<th scope="row">Total</th>
						<td class="number">{formatEuro(size(totals.current))}</td>
						<td class="number muted wide">{formatEuro(size(totals.previous))}</td>
						{@render change(totals.current, totals.previous)}
						<td class="number muted wide">{formatEuro(Math.round(size(totals.current) / comparison.months) as Cents)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
{/if}

<style>
	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
	}
	.note {
		margin: 0 0 0.75rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.note b {
		color: var(--text);
		font-weight: 600;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
		white-space: nowrap;
	}
	thead th {
		color: var(--muted);
		font-weight: normal;
		font-size: 0.85rem;
	}
	tfoot th,
	tfoot td {
		border-bottom: none;
		font-weight: 600;
	}
	tbody th {
		font-weight: normal;
		max-width: 14rem;
	}
	.number {
		text-align: right;
	}
	.muted {
		color: var(--muted);
	}
	.good {
		color: var(--positive);
	}
	.bad {
		color: var(--negative);
	}
	.percent {
		display: inline-block;
		min-width: 3.2rem;
		font-size: 0.85rem;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		max-width: 100%;
		min-height: 0;
		padding: 0.15rem 0.35rem;
		margin-left: -0.35rem;
		border: none;
		background: none;
		text-align: left;
	}
	.name:hover:not(:disabled) {
		background: var(--accent-soft);
	}
	.name:disabled {
		opacity: 1;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		flex: none;
	}
	/* phones: the period and the change in %; the rest would need scrolling */
	@media (max-width: 40rem) {
		.wide {
			display: none;
		}
		tbody th {
			max-width: 9rem;
		}
	}
</style>
