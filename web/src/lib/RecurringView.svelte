<!--
	Recurring transactions: their templates (what, how much, when), with the next occurrence and
	how many are due. n adds one, Enter edits, Delete deletes (undo with Mod+Z). Entering the due
	ones happens in the inbox (d).
-->
<script lang="ts">
	import {
		addRecurring,
		deleteRecurring,
		dueOccurrences,
		NO_CATEGORY,
		nextOccurrence,
		updateRecurring,
		type Id,
		type Recurring,
		type RecurringDraft,
	} from '../core';
	import { attempt } from './attempt';
	import { clock } from './clock.svelte';
	import { formatDate, formatEuro, plural } from './display';
	import RecurringEditor from './RecurringEditor.svelte';
	import { describeSchedule } from './schedule';
	import { shortcuts } from './shortcuts.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		notify,
		onreviewdue,
	}: { workspace: Workspace; active: boolean; notify: (text: string, undo?: boolean) => void; onreviewdue: () => void } = $props();

	const data = $derived(workspace.data);
	const templates = $derived([...data.recurring].sort((a, b) => a.description.localeCompare(b.description)));
	const categories = $derived(new Map(data.categories.map((c) => [c.id, c])));
	const accounts = $derived(new Map(data.accounts.map((a) => [a.id, a])));
	const due = $derived(new Map(data.recurring.map((r) => [r.id, dueOccurrences(r, clock.today)])));
	const dueCount = $derived([...due.values()].reduce((n, d) => n + d.dates.length, 0));

	let selectedId = $state<Id | null>(null);
	const selectedIndex = $derived(templates.findIndex((r) => r.id === selectedId));
	const selected = $derived(templates[selectedIndex]);
	let editing = $state.raw<{ id: Id | null; draft: RecurringDraft; handled: Recurring['handled'] } | null>(null);
	let saving = false;
	/** Why saving failed: shown in the editor (a notice would be hidden behind it) */
	let failure = $state<string | null>(null);
	let list: SelectableList<Recurring, Id>;
	let listElement = $state<HTMLElement>();

	/** Opens the editor for a new template, e.g. made from a transaction ("Make recurring") */
	export function openNew(draft?: RecurringDraft) {
		editing = {
			id: null,
			draft: draft ?? {
				description: '',
				categoryId: NO_CATEGORY,
				amount: null,
				accountId: null,
				schedule: { unit: 'month', every: 1, days: [Number(clock.today.slice(8))] },
				start: clock.today,
				end: null,
			},
			handled: null,
		};
	}

	function openEdit(r: Recurring | undefined) {
		if (r) editing = { id: r.id, draft: r, handled: r.handled };
	}

	function close() {
		editing = null;
		failure = null;
		list.focus();
	}

	async function save(draft: RecurringDraft) {
		const target = editing;
		if (!target || saving) return;
		saving = true;
		failure = null;
		const saved = await attempt((text) => (failure = text), async () => {
			if (target.id === null) {
				let created: Id | null = null;
				await workspace.edit(`Add recurring “${draft.description}”`, (d, now) => {
					const result = addRecurring(d, draft, now);
					created = result.id;
					return result.data;
				});
				selectedId = created;
			} else {
				const id = target.id;
				await workspace.edit(`Edit recurring “${draft.description}”`, (d, now) => updateRecurring(d, id, draft, now));
			}
		});
		saving = false;
		if (saved) close();
	}

	async function remove(r: Recurring | undefined) {
		if (!r) return;
		const next = templates[selectedIndex + 1] ?? templates[selectedIndex - 1];
		if (await attempt(notify, () => workspace.edit(`Delete recurring “${r.description}”`, (d) => deleteRecurring(d, r.id)))) {
			selectedId = next?.id ?? null;
			notify(`Deleted recurring “${r.description}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['n'], description: 'New recurring transaction', group: 'Recurring', when: () => active, run: () => openNew() },
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected recurring transaction', run: () => openEdit(selected) },
				{ keys: ['Delete', 'Backspace'], description: 'Delete the selected recurring transaction (undo with Mod+Z)', run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Recurring', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
		]),
	);
</script>

<div class="toolbar">
	<h2>Recurring</h2>
	<div class="actions">
		{#if dueCount > 0}<button onclick={onreviewdue} title="d">Enter {dueCount} due</button>{/if}
		<button class="primary" onclick={() => openNew()} title="n">New</button>
	</div>
</div>

<SelectableList
	bind:this={list}
	bind:selected={selectedId}
	bind:element={listElement}
	items={templates}
	key={(r) => r.id}
	label="Recurring transactions"
	{active}
	group="Recurring"
	itemName="recurring transaction"
	onopen={openEdit}
>
	{#snippet row(r)}
		{@const next = nextOccurrence(r)}
		{@const dueNow = due.get(r.id)}
		{@const category = categories.get(r.categoryId)}
		{@const account = r.accountId === null ? undefined : accounts.get(r.accountId)}
		<div class="row">
			<span class="description">
				{r.description || '—'}
				{#if dueNow && dueNow.dates.length > 0}<span class="badge">{dueNow.more ? `${dueNow.dates.length}+` : dueNow.dates.length} due</span>{/if}
			</span>
			<span class="amount" class:income={r.amount !== null && r.amount > 0}>{r.amount === null ? 'asked each time' : formatEuro(r.amount)}</span>
			<span class="meta">
				{describeSchedule(r.schedule)}
				{#if category}· <span class="dot" style:background={category.color}></span>{category.name}{/if}
				{#if account}· {account.name || '(unnamed)'}{/if}
			</span>
			<span class="next">{next === null ? 'ended' : `next ${formatDate(next)}`}</span>
		</div>
	{/snippet}
	{#snippet empty()}
		<p class="empty">
			No recurring transactions yet. Press <kbd>n</kbd> to add rent, a savings plan, …, or use “Make recurring” on a transaction.
		</p>
	{/snippet}
</SelectableList>

{#if dueCount > 0}
	<p class="due-note">{plural(dueCount, 'occurrence is', 'occurrences are')} due. Press <kbd>d</kbd> to enter them.</p>
{/if}

{#if editing}
	<RecurringEditor
		data={workspace.data}
		initial={editing.draft}
		handled={editing.handled}
		isNew={editing.id === null}
		{failure}
		title={editing.id === null ? 'New recurring transaction' : 'Edit recurring transaction'}
		onsave={(draft) => void save(draft)}
		onclose={close}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 0.75rem 0.5rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'description amount' 'meta next';
		gap: 0.15rem 1rem;
		padding: 0.6rem 0.75rem;
	}
	.description {
		grid-area: description;
		overflow-wrap: anywhere;
	}
	.amount {
		grid-area: amount;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.amount.income {
		color: var(--positive);
	}
	.meta {
		grid-area: meta;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.next {
		grid-area: next;
		color: var(--muted);
		font-size: 0.85rem;
		text-align: right;
		white-space: nowrap;
	}
	.dot {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		margin-right: 0.25rem;
	}
	.badge {
		margin-left: 0.5rem;
		padding: 0 0.45rem;
		border-radius: 1rem;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 0.8rem;
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 3rem 1rem;
	}
	.due-note {
		color: var(--muted);
		font-size: 0.9rem;
		padding: 0 0.75rem;
	}
</style>
