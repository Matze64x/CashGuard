<!--
	The transaction list: search, keyboard navigation (j/k or arrows), and new/edit/copy/delete.
	Deleting needs no confirmation because it can be undone (Mod+Z). Above it, a banner when
	recurring transactions are due.
-->
<script lang="ts">
	import {
		addTransaction,
		adjustAccount,
		applyFilter,
		cents,
		deleteTransaction,
		draftTotal,
		isFiltered,
		NO_CATEGORY,
		sumCents,
		today,
		toDraft,
		totalAmount,
		updateTransaction,
		type Account,
		type Category,
		type Cents,
		type Id,
		type Transaction,
		type RecurringDraft,
		type TransactionDraft,
	} from '../core';
	import { attempt } from './attempt';
	import { showError } from './notices.svelte';
	import { formatDate, formatEuro, plural } from './display';
	import { filter } from './filter.svelte';
	import FilterBar from './FilterBar.svelte';
	import { displayKeys, shortcuts } from './shortcuts.svelte';
	import TransactionEditor from './TransactionEditor.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		notify,
		emptyHint,
		onshowaccounts,
		dueCount,
		dueLabel,
		onreviewdue,
		onmakerecurring,
	}: {
		workspace: Workspace;
		/** Whether this view is the one shown (its shortcuts only apply then) */
		active: boolean;
		notify: (text: string, undo?: boolean) => void;
		emptyHint: string;
		/** Switches to the accounts */
		onshowaccounts: () => void;
		/** Due occurrences of recurring transactions */
		dueCount: number;
		/** The count as shown (e.g. "50+") */
		dueLabel: string;
		/** Opens the inbox of due recurring transactions */
		onreviewdue: () => void;
		/** Makes a recurring transaction like the edited one */
		onmakerecurring: (draft: RecurringDraft) => void;
	} = $props();

	const data = $derived(workspace.data);

	/** Whether the amounts are hidden (from onlookers): at every start, until the eye button shows them */
	let hidden = $state(true);
	const money = (amount: Cents) => (hidden ? '••••' : formatEuro(amount));
	const categories = $derived(new Map<Id, Category>(data.categories.map((c) => [c.id, c])));

	// do the accounts still match the transactions? (only worth showing once there are accounts)
	const accountsDifference = $derived(data.accounts.length === 0 ? null : sumCents(data.accounts.map((a) => a.amount)) - totalAmount(data.transactions));

	// what the shared filter selects (a split transaction counts as one, by its own fields)
	const result = $derived(applyFilter(data.transactions, data.categories, filter.current));
	const visible = $derived(result.transactions);
	const filtered = $derived(isFiltered(filter.current));

	let selectedId = $state<Id | null>(null);
	const selectedIndex = $derived(visible.findIndex((t) => t.id === selectedId));
	const selected = $derived(selectedIndex >= 0 ? visible[selectedIndex] : undefined);

	/** `original`: the transaction as it was when editing started (saving refuses to overwrite a change made meanwhile) */
	let editing = $state<{ title: string; id: Id | null; draft: TransactionDraft; key: number; original?: Transaction } | null>(null);
	let editorKey = 0;
	let saving = false;
	let list: SelectableList<Transaction, Id>;
	let listElement = $state<HTMLElement>();

	const blankDraft = (date = today()): TransactionDraft => ({ date, description: '', categoryId: NO_CATEGORY, amount: cents(0) });

	function openNew(date = today()) {
		editing = { title: 'New transaction', id: null, draft: blankDraft(date), key: editorKey++ };
	}

	function openEdit(t: Transaction | undefined) {
		if (t) editing = { title: 'Edit transaction', id: t.id, draft: toDraft(t), key: editorKey++, original: t };
	}

	/** A new transaction like the selected one, dated today: quick for recurring entries */
	function openCopy(t: Transaction | undefined) {
		if (!t) return;
		const draft = toDraft(t);
		editing = {
			title: 'New transaction (copy)',
			id: null,
			draft: { ...draft, date: today(), subTransactions: draft.subTransactions?.map(({ id: _, ...s }) => ({ ...s, date: today() })) },
			key: editorKey++,
		};
	}

	/** Why saving failed: shown in the editor (a notice would be hidden behind it) */
	let failure = $state<string | null>(null);
	const fail = (text: string) => void (failure = text);

	function close() {
		editing = null;
		failure = null;
		list.focus();
	}

	/** An action on the transaction being edited, from its editor: the editor closes first */
	const fromEditor = (action: (t: Transaction) => unknown, t: Transaction) => () => {
		close();
		selectedId = t.id;
		void action(t);
	};

	async function save(draft: TransactionDraft, another: boolean, account: Account | null) {
		const target = editing;
		// a second Enter while saving must not add the transaction twice
		if (!target || saving) return;
		saving = true;
		failure = null;
		const saved = await attempt(fail, async () => {
			if (target.id === null) {
				let created: Id | null = null;
				let balance: Cents | null = null;
				// one change, so one undo takes back both the transaction and the balance
				await workspace.edit(`Add “${draft.description || 'transaction'}”`, (d, now) => {
					const result = addTransaction(d, draft, now);
					created = result.id;
					if (!account) return result.data;
					const adjusted = adjustAccount(result.data, account.id, draftTotal(draft), now);
					balance = adjusted.accounts.find((a) => a.id === account.id)!.amount;
					return adjusted;
				});
				selectedId = created;
				if (account && balance !== null) notify(`${account.name} is now at ${money(balance)}.`, true);
			} else {
				const id = target.id;
				await workspace.edit(`Edit “${draft.description || 'transaction'}”`, (d, now) => updateTransaction(d, id, draft, now, target.original));
				selectedId = id;
			}
		});
		saving = false;
		if (!saved) return;
		failure = null;
		if (another) openNew(draft.date);
		else close();
	}

	/** "Make recurring…": saves the transaction's changes first (then nothing typed is lost) */
	async function makeRecurring(template: RecurringDraft, edited: TransactionDraft) {
		const target = editing;
		if (!target || target.id === null || saving) return;
		const id = target.id;
		saving = true;
		failure = null;
		const saved = await attempt(fail, () => workspace.edit(`Edit “${edited.description || 'transaction'}”`, (d, now) => updateTransaction(d, id, edited, now, target.original)));
		saving = false;
		if (!saved) return;
		editing = null;
		onmakerecurring(template);
	}

	async function remove(t: Transaction | undefined) {
		if (!t) return;
		const next = visible[selectedIndex + 1] ?? visible[selectedIndex - 1];
		const label = t.description || 'transaction';
		if (await attempt(showError, () => workspace.edit(`Delete “${label}”`, (d) => deleteTransaction(d, t.id)))) {
			selectedId = next?.id ?? null;
			notify(`Deleted “${label}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['n'], description: 'New transaction', group: 'Transactions', when: () => active, run: () => openNew() },
			{ keys: ['h'], description: 'Hide or show the amounts', group: 'Transactions', when: () => active, run: () => (hidden = !hidden) },
			// these act on the selection, so only while the list (not a button elsewhere) has the focus
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected transaction', run: () => openEdit(selected) },
				{ keys: ['c'], description: 'New transaction like the selected one (copy)', run: () => openCopy(selected) },
				{ keys: ['Delete', 'Backspace'], description: `Delete the selected transaction (undo with ${displayKeys('Mod+z')})`, run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Transactions', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
		]),
	);
</script>

<div class="toolbar">
	<div class="filter"><FilterBar {workspace} {active} onleave={() => listElement?.focus()} /></div>
	<button class="primary" onclick={() => openNew()} title="n">New</button>
</div>

{#if dueCount > 0}
	<div class="due">
		<span>{dueLabel} recurring {dueCount === 1 ? 'transaction is' : 'transactions are'} due.</span>
		<button class="primary" onclick={onreviewdue} title="d">Enter them</button>
	</div>
{/if}

<section class="summary" aria-live="polite">
	<span class="balance" class:hidden>{money(result.total)}</span>
	<button class="eye" aria-label={hidden ? 'Show amounts' : 'Hide amounts'} title="h" onclick={() => (hidden = !hidden)}>
		<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12" />
			<circle cx="12" cy="12" r="3" />
			{#if hidden}<path d="M3 3l18 18" />{/if}
		</svg>
	</button>
	<span class="muted">
		{filtered ? `${plural(visible.length, 'match', 'matches')} of ${data.transactions.length}` : plural(data.transactions.length, 'transaction')}
	</span>
	{#if accountsDifference !== null}
		<button class="accounts" class:off={accountsDifference !== 0} title="Compare with the accounts (g m)" onclick={onshowaccounts}>
			{accountsDifference === 0 ? '✓ Accounts match' : hidden ? 'Accounts differ' : `Accounts differ by ${formatEuro(accountsDifference as Cents)}`}
		</button>
	{/if}
</section>

<SelectableList
	bind:this={list}
	bind:selected={selectedId}
	bind:element={listElement}
	items={visible}
	key={(t) => t.id}
	label="Transactions"
	{active}
	group="Transactions"
	itemName="transaction"
	onopen={openEdit}
>
	{#snippet row(t)}
		<div class="row" style:--category={categories.get(t.categoryId)?.color ?? 'transparent'}>
			<span class="date">{formatDate(t.date)}</span>
			<span class="description">
				{t.description || '—'}
				{#if t.subTransactions}<span class="badge">{plural(t.subTransactions.length, 'part')}</span>{/if}
			</span>
			<span class="meta">
				<span class="category">
					<span class="dot"></span>{categories.get(t.categoryId)?.name ?? ''}
				</span>
			</span>
			<span class="amount" class:income={!hidden && t.amount > 0} class:expense={!hidden && t.amount < 0} class:hidden>{money(t.amount)}</span>
		</div>
	{/snippet}
	{#snippet empty()}
		<p class="empty">{filtered ? 'Nothing matches the filter.' : `No transactions yet. ${emptyHint}`}</p>
	{/snippet}
</SelectableList>

{#if editing}
	{#key editing.key}
		<TransactionEditor
			{data}
			initial={editing.draft}
			title={editing.title}
			isNew={editing.id === null}
			onsave={save}
			onclose={close}
			{failure}
			onmakerecurring={editing.id === null ? undefined : (template, edited) => void makeRecurring(template, edited)}
			ondelete={editing.original && fromEditor(remove, editing.original)}
			oncopy={editing.original && fromEditor(openCopy, editing.original)}
		/>
	{/key}
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: start;
		gap: 0.5rem;
		padding: 1rem 0.75rem 0;
	}
	.filter {
		flex: 1;
		min-width: 0;
	}
	.due {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin: 0.75rem 0.75rem 0;
		padding: 0.5rem 0.5rem 0.5rem 0.9rem;
		border-radius: 0.5rem;
		background: var(--accent-soft);
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 1rem;
		padding: 1rem 0.75rem 0.5rem;
	}
	.balance {
		font-size: 2rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.muted,
	.hidden {
		color: var(--muted);
	}
	.eye {
		align-self: center;
		display: grid;
		place-items: center;
		min-width: 2.25rem;
		min-height: 2.25rem;
		padding: 0;
		color: var(--muted);
	}
	.eye svg {
		width: 1.25rem;
		height: 1.25rem;
	}
	.accounts {
		margin-left: auto;
		border: none;
		background: none;
		min-height: 0;
		padding: 0.2rem 0.4rem;
		color: var(--positive);
		font-size: 0.9rem;
	}
	.accounts.off {
		color: var(--negative);
		font-weight: 600;
	}
	.row {
		display: grid;
		grid-template-columns: 6.5rem 1fr 11rem 8rem;
		grid-template-areas: 'date description meta amount';
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0.75rem 0.5rem 1.15rem;
		position: relative;
	}
	/* the category's color, to scan the list by (inside the edge, where the selection has its bar) */
	.row::before {
		content: '';
		position: absolute;
		left: 0.3rem;
		top: 0.4rem;
		bottom: 0.4rem;
		width: 4px;
		border-radius: 2px;
		background: var(--category);
	}
	.date {
		grid-area: date;
	}
	.description {
		grid-area: description;
		overflow-wrap: anywhere;
	}
	.meta {
		grid-area: meta;
		min-width: 0;
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
	.amount.expense {
		color: var(--negative);
	}
	.date,
	.category {
		font-size: 0.9rem;
	}
	.date {
		color: var(--muted);
	}
	.category {
		/* its own color, toned towards the text so it stays readable in light and dark */
		color: color-mix(in oklab, var(--category) 65%, var(--text));
		font-weight: 500;
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		background: var(--category);
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
		color: var(--muted);
		text-align: center;
		padding: 3rem 1rem;
	}
	@media (max-width: 40rem) {
		.row {
			grid-template-columns: 1fr auto;
			grid-template-areas: 'description amount' 'date meta';
			row-gap: 0.15rem;
		}
		.meta {
			justify-self: end;
		}
		.date,
		.category {
			font-size: 0.8rem;
		}
	}
</style>
