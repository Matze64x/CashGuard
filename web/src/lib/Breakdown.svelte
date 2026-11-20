<!--
	Where the money went (or came from) in what the filter selects: categories with a bar, amount and
	share, largest first. With exactly one category chosen, that category by description instead.
	Each row is a button: a category filters by it, a description goes into the search.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ofSide, sumCents, totalsByCategory, totalsByDescription, type Cents, type Id, type Side, type Transaction } from '../core';
	import { categoryColor, categoryLabel, formatEuro, plural } from './display';
	import { filter } from './filter.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		transactions,
		side,
		actions,
	}: {
		workspace: Workspace;
		/** What the filter selects */
		transactions: readonly Transaction[];
		side: Side;
		/** Controls shown next to the heading */
		actions?: Snippet;
	} = $props();

	const LIMIT = 10;
	let showAll = $state(false);

	const categories = $derived(new Map(workspace.data.categories.map((c) => [c.id, c])));
	const sided = $derived(ofSide(transactions, side));
	const single = $derived(filter.current.categories.length === 1 ? filter.current.categories[0]! : null);

	// a different list starts short again
	$effect(() => {
		void single;
		void side;
		showAll = false;
	});

	interface Row {
		key: string;
		label: string;
		color?: string;
		total: Cents;
		count: number;
		/** null: nothing to choose (an empty description can't be searched for) */
		choose: (() => void) | null;
	}
	const rows = $derived.by((): Row[] => {
		if (single !== null)
			return totalsByDescription(sided).map((s) => ({
				key: s.key,
				label: s.key || '(no description)',
				total: s.total,
				count: s.count,
				choose: s.key ? () => filter.set({ text: s.key }) : null,
			}));
		return totalsByCategory(sided).map((s) => ({
			key: s.key,
			label: categoryLabel(s.key, categories.get(s.key)),
			color: categoryColor(categories.get(s.key)),
			total: s.total,
			count: s.count,
			choose: () => filter.set({ categories: [s.key as Id] }),
		}));
	});
	// all rows have the side's sign, so the total is never 0 while there are rows
	const total = $derived(sumCents(rows.map((r) => r.total)));
	const largest = $derived(Math.max(1, ...rows.map((r) => Math.abs(r.total))));
	const visible = $derived(showAll ? rows : rows.slice(0, LIMIT));
	const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 });

	const heading = $derived(
		`${side === 'expense' ? 'Expenses' : 'Income'} ${single !== null ? `in ${categoryLabel(single, categories.get(single))}, by description` : 'by category'}`,
	);
</script>

<div class="header">
	<h2>{heading}</h2>
	{@render actions?.()}
</div>
{#if rows.length === 0}
	<p class="empty">Nothing here for the current filter.</p>
{:else}
	<ul class="rows">
		{#each visible as row (row.key)}
			{@const share = percent.format(row.total / total)}
			<li>
				<button
					class="row"
					onclick={row.choose}
					disabled={!row.choose}
					title={!row.choose ? undefined : single !== null ? `Search for “${row.label}”` : 'Show only this category'}
					aria-label={`${row.label}: ${formatEuro(row.total)}, ${share}, ${plural(row.count, 'transaction')}`}
				>
					<span class="label">
						{#if row.color}<span class="dot" style:background={row.color}></span>{/if}
						<span class="name">{row.label}</span>
					</span>
					<span class="amount">{formatEuro(row.total)}</span>
					<span class="share">{share}</span>
					<span class="bar" aria-hidden="true">
						<span style:width={`${(Math.abs(row.total) / largest) * 100}%`} style:background={row.color ?? (side === 'expense' ? 'var(--negative)' : 'var(--positive)')}></span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if rows.length > LIMIT}
		<button class="more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${rows.length}`}</button>
	{/if}
{/if}

<style>
	.header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.empty {
		color: var(--muted);
		margin: 0;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
	}
	.row {
		width: 100%;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 3rem;
		grid-template-areas: 'label amount share' 'bar bar bar';
		gap: 0.15rem 0.75rem;
		align-items: baseline;
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: none;
		text-align: left;
		min-height: 0;
	}
	.row:hover:not(:disabled) {
		background: var(--accent-soft);
	}
	/* not choosable, but just as readable */
	.row:disabled {
		opacity: 1;
	}
	.label {
		grid-area: label;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		flex: none;
	}
	.amount {
		grid-area: amount;
		font-variant-numeric: tabular-nums;
	}
	.share {
		grid-area: share;
		text-align: right;
		color: var(--muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		grid-area: bar;
		height: 0.35rem;
		border-radius: 0.2rem;
		background: var(--border);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: 0.2rem;
	}
	.more {
		margin-top: 0.5rem;
	}
</style>
