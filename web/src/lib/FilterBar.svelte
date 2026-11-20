<!--
	The search field plus the active filters as chips (press one to remove it), and the filter
	dialog (f). Shared by the views, which all show what the filter selects.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { NO_CATEGORY, type Id } from '../core';
	import { categoryLabel, describeAmountRange, describePeriod } from './display';
	import { filter } from './filter.svelte';
	import FilterDialog from './FilterDialog.svelte';
	import { shortcuts } from './shortcuts.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		onleave,
	}: {
		workspace: Workspace;
		/** Whether this bar's view is the one shown (its keys only apply then) */
		active: boolean;
		/** Enter or ↓ in the search: go on to the results */
		onleave: () => void;
	} = $props();

	let search: HTMLInputElement;
	let chipList = $state<HTMLElement>();
	let dialogOpen = $state(false);

	// a category deleted meanwhile (or one from a file opened since) can't match anything: drop it
	$effect(() => {
		const known = new Set(workspace.data.categories.map((c) => c.id));
		const kept = filter.current.categories.filter((id) => id === NO_CATEGORY || known.has(id));
		if (kept.length !== filter.current.categories.length) filter.set({ categories: kept });
	});

	/** Removes a chip's filter and moves the focus to the chip now in its place (or the search) */
	async function remove(chip: { remove: () => void }, index: number) {
		chip.remove();
		await tick();
		const buttons = chipList?.querySelectorAll('button');
		const next = buttons?.[Math.min(index, buttons.length - 1)];
		(next ?? search).focus();
	}

	const categories = $derived(new Map(workspace.data.categories.map((c) => [c.id, c])));
	const chips = $derived.by(() => {
		const f = filter.current;
		const list: { key: string; label: string; color?: string; remove: () => void }[] = [];
		if (f.from || f.to) list.push({ key: 'period', label: describePeriod(f.from, f.to), remove: () => filter.set({ from: null, to: null }) });
		if (f.kind !== 'all') list.push({ key: 'kind', label: f.kind === 'income' ? 'Income only' : 'Expenses only', remove: () => filter.set({ kind: 'all' }) });
		for (const id of f.categories) {
			const c = categories.get(id);
			list.push({
				key: `category-${id}`,
				label: categoryLabel(id, c),
				color: c?.color,
				remove: () => filter.set({ categories: filter.current.categories.filter((x: Id) => x !== id) }),
			});
		}
		if (f.minAmount !== null || f.maxAmount !== null)
			list.push({ key: 'amount', label: describeAmountRange(f.minAmount, f.maxAmount), remove: () => filter.set({ minAmount: null, maxAmount: null }) });
		return list;
	});

	$effect(() =>
		shortcuts.add([
			{ keys: ['/'], description: 'Search', group: 'Filter', when: () => active, run: () => search.focus() },
			{ keys: ['Mod+f'], description: 'Search', group: 'Filter', inFields: true, when: () => active, run: () => search.focus() },
			{ keys: ['f'], description: 'Filter by period, category, amount, …', group: 'Filter', when: () => active, run: () => (dialogOpen = true) },
		]),
	);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && filter.current.text) {
			event.preventDefault();
			filter.set({ text: '' });
		} else if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown') {
			event.preventDefault();
			onleave();
		}
	}
</script>

<div class="bar">
	<div class="row">
		<input
			bind:this={search}
			value={filter.current.text}
			oninput={(e) => filter.set({ text: e.currentTarget.value })}
			class="search"
			type="search"
			placeholder="Search"
			aria-label="Search (press /)"
			{onkeydown}
		/>
		<button onclick={() => (dialogOpen = true)} title="f">Filter{chips.length ? ` (${chips.length})` : ''}</button>
	</div>
	{#if chips.length > 0}
		<ul class="chips" aria-label="Active filters" bind:this={chipList}>
			{#each chips as chip, i (chip.key)}
				<li>
					<button class="chip" aria-label={`Remove filter: ${chip.label}`} title="Remove this filter" onclick={() => remove(chip, i)}>
						{#if chip.color}<span class="dot" style:background={chip.color}></span>{/if}
						{chip.label}
						<span class="x" aria-hidden="true">×</span>
					</button>
				</li>
			{/each}
			{#if chips.length > 1}
				<li><button class="chip clear" onclick={() => remove({ remove: () => filter.clearExceptText() }, 0)}>Clear all</button></li>
			{/if}
		</ul>
	{/if}
</div>

{#if dialogOpen}
	<FilterDialog {workspace} onclose={() => (dialogOpen = false)} />
{/if}

<style>
	.bar {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.search {
		flex: 1;
		min-width: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2rem;
		padding: 0.15rem 0.6rem;
		border-radius: 1rem;
		background: var(--accent-soft);
		border-color: transparent;
		font-size: 0.9rem;
	}
	.chip.clear {
		background: none;
		border-color: var(--border);
		color: var(--muted);
	}
	.x {
		color: var(--muted);
		font-size: 1.1rem;
		line-height: 1;
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}
</style>
