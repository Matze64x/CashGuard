<script lang="ts">
	import type { CashGuardData, Category, Id } from '../core';
	import { formatDate, formatEuro } from './display';

	let { data }: { data: CashGuardData } = $props();

	const categories = $derived(new Map<Id, Category>(data.categories.map((c) => [c.id, c])));
	// "#RRGGBBAA": CSS accepts 8-digit hex colors directly; "no category" (id 0) has no entry
	const colorOf = (id: Id) => categories.get(id)?.color ?? 'transparent';
</script>

<!-- role="list": Safari's VoiceOver drops list semantics when list-style is none -->
<ul class="list" role="list">
	{#each data.transactions as t (t.id)}
		<li>
			<span class="description">
				{t.description || '—'}
				{#if t.subTransactions}<span class="badge">{t.subTransactions.length} parts</span>{/if}
			</span>
			<span class="amount" class:negative={t.amount < 0}>{formatEuro(t.amount)}</span>
			<span class="meta">
				<span class="date">{formatDate(t.date)}</span>
				<span class="category"><span class="dot" style:background={colorOf(t.categoryId)}></span>{categories.get(t.categoryId)?.name ?? ''}</span>
			</span>
		</li>
	{:else}
		<li class="empty">No transactions yet. Import your CashGuard file to get started.</li>
	{/each}
</ul>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: grid;
		grid-template-columns: 6.5rem 1fr 10rem 8rem;
		grid-template-areas: 'date description category amount';
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	/* on wide screens, date and category are columns of their own */
	.meta {
		display: contents;
	}
	.date {
		grid-area: date;
	}
	.description {
		grid-area: description;
		overflow-wrap: anywhere;
	}
	.category {
		grid-area: category;
	}
	.amount {
		grid-area: amount;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--positive);
	}
	.amount.negative {
		color: var(--text);
	}
	.date,
	.category {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.dot {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		margin-right: 0.4rem;
	}
	.badge {
		margin-left: 0.4rem;
		font-size: 0.75rem;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 1rem;
		padding: 0 0.4rem;
	}
	.empty {
		display: block;
		color: var(--muted);
		text-align: center;
		padding: 3rem 1rem;
	}
	/* phone: description and amount on the first line, date and category below */
	@media (max-width: 40rem) {
		li {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'description amount' 'meta meta';
			row-gap: 0.15rem;
		}
		.meta {
			grid-area: meta;
			display: flex;
			justify-content: space-between;
			gap: 0.75rem;
			min-width: 0;
		}
		.date,
		.category {
			font-size: 0.8rem;
		}
		.category {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
