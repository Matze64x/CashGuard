<!--
	The transaction list: search, keyboard navigation (j/k or arrows), and new/edit/copy/delete.
	Deleting needs no confirmation because it can be undone (Mod+Z).
-->
<script lang="ts">
	import {
		addTransaction,
		adjustAccount,
		cents,
		deleteTransaction,
		draftTotal,
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
		type TransactionDraft,
	} from '../core';
	import { attempt } from './attempt';
	import { formatDate, formatEuro, plural } from './display';
	import { shortcuts } from './shortcuts.svelte';
	import TransactionEditor from './TransactionEditor.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		notify,
		emptyHint,
		onshowaccounts,
	}: {
		workspace: Workspace;
		/** Whether this view is the one shown (its shortcuts only apply then) */
		active: boolean;
		notify: (text: string, undo?: boolean) => void;
		emptyHint: string;
		/** Switches to the accounts */
		onshowaccounts: () => void;
	} = $props();

	const data = $derived(workspace.data);
	const categories = $derived(new Map<Id, Category>(data.categories.map((c) => [c.id, c])));

	// do the accounts still match the transactions? (only worth showing once there are accounts)
	const accountsDifference = $derived(data.accounts.length === 0 ? null : sumCents(data.accounts.map((a) => a.amount)) - totalAmount(data.transactions));

	let query = $state('');
	const visible = $derived.by(() => {
		const q = query.trim().toLocaleLowerCase();
		if (!q) return data.transactions;
		return data.transactions.filter((t) =>
			[t.description, categories.get(t.categoryId)?.name ?? '', formatDate(t.date), formatEuro(t.amount), ...(t.subTransactions ?? []).map((s) => s.description)]
				.some((text) => text.toLocaleLowerCase().includes(q)),
		);
	});

	let selectedId = $state<Id | null>(null);
	const selectedIndex = $derived(visible.findIndex((t) => t.id === selectedId));
	const selected = $derived(selectedIndex >= 0 ? visible[selectedIndex] : undefined);

	let editing = $state<{ title: string; id: Id | null; draft: TransactionDraft; key: number } | null>(null);
	let editorKey = 0;
	let saving = false;
	let list: SelectableList<Transaction, Id>;
	let listElement = $state<HTMLElement>();
	let search: HTMLInputElement;

	const blankDraft = (date = today()): TransactionDraft => ({ date, description: '', categoryId: NO_CATEGORY, amount: cents(0) });

	function openNew(date = today()) {
		editing = { title: 'New transaction', id: null, draft: blankDraft(date), key: editorKey++ };
	}

	function openEdit(t: Transaction | undefined) {
		if (t) editing = { title: 'Edit transaction', id: t.id, draft: toDraft(t), key: editorKey++ };
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

	function close() {
		editing = null;
		list.focus();
	}

	async function save(draft: TransactionDraft, another: boolean, account: { index: number; account: Account } | null) {
		const target = editing;
		// a second Enter while saving must not add the transaction twice
		if (!target || saving) return;
		saving = true;
		const saved = await attempt(notify, async () => {
			if (target.id === null) {
				let created: Id | null = null;
				let balance: Cents | null = null;
				// one change, so one undo takes back both the transaction and the balance
				await workspace.edit(`Add “${draft.description || 'transaction'}”`, (d, now) => {
					const result = addTransaction(d, draft, now);
					created = result.id;
					if (!account) return result.data;
					const adjusted = adjustAccount(result.data, account.index, account.account, draftTotal(draft), now);
					balance = adjusted.accounts[account.index]!.amount;
					return adjusted;
				});
				selectedId = created;
				if (account && balance !== null) notify(`${account.account.name} is now at ${formatEuro(balance)}.`, true);
			} else {
				const id = target.id;
				await workspace.edit(`Edit “${draft.description || 'transaction'}”`, (d, now) => updateTransaction(d, id, draft, now));
				selectedId = id;
			}
		});
		saving = false;
		if (!saved) return;
		if (another) openNew(draft.date);
		else close();
	}

	async function remove(t: Transaction | undefined) {
		if (!t) return;
		const next = visible[selectedIndex + 1] ?? visible[selectedIndex - 1];
		const label = t.description || 'transaction';
		if (await attempt(notify, () => workspace.edit(`Delete “${label}”`, (d) => deleteTransaction(d, t.id)))) {
			selectedId = next?.id ?? null;
			notify(`Deleted “${label}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['n'], description: 'New transaction', group: 'Transactions', when: () => active, run: () => openNew() },
			// these act on the selection, so only while the list (not a button elsewhere) has the focus
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected transaction', run: () => openEdit(selected) },
				{ keys: ['c'], description: 'New transaction like the selected one (copy)', run: () => openCopy(selected) },
				{ keys: ['Delete', 'Backspace'], description: 'Delete the selected transaction (undo with Mod+Z)', run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Transactions', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
			{ keys: ['/'], description: 'Search', group: 'Transactions', when: () => active, run: () => search.focus() },
			{ keys: ['Mod+f'], description: 'Search', group: 'Transactions', inFields: true, when: () => active, run: () => search.focus() },
		]),
	);

	function onSearchKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && query) {
			event.preventDefault();
			query = '';
		} else if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'ArrowDown') {
			// go to the results (focusing the list selects the first row on screen)
			event.preventDefault();
			listElement?.focus();
		}
	}
</script>

<div class="toolbar">
	<input
		bind:this={search}
		bind:value={query}
		class="search"
		type="search"
		placeholder="Search"
		aria-label="Search transactions (press /)"
		onkeydown={onSearchKey}
	/>
	<button class="primary" onclick={() => openNew()} title="n">New</button>
</div>

<section class="summary" aria-live="polite">
	<span class="balance">{formatEuro(totalAmount(visible))}</span>
	<span class="muted">
		{query.trim() ? `${plural(visible.length, 'match', 'matches')} of ${data.transactions.length}` : plural(data.transactions.length, 'transaction')}
	</span>
	{#if accountsDifference !== null}
		<button class="accounts" class:off={accountsDifference !== 0} title="Compare with the accounts (g a)" onclick={onshowaccounts}>
			{accountsDifference === 0 ? '✓ Accounts match' : `Accounts differ by ${formatEuro(accountsDifference as Cents)}`}
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
		<div class="row">
			<span class="date">{formatDate(t.date)}</span>
			<span class="description">
				{t.description || '—'}
				{#if t.subTransactions}<span class="badge">{plural(t.subTransactions.length, 'part')}</span>{/if}
			</span>
			<span class="meta">
				<span class="category">
					<span class="dot" style:background={categories.get(t.categoryId)?.color ?? 'transparent'}></span>{categories.get(t.categoryId)?.name ?? ''}
				</span>
			</span>
			<span class="amount" class:income={t.amount > 0}>{formatEuro(t.amount)}</span>
		</div>
	{/snippet}
	{#snippet empty()}
		<p class="empty">{query.trim() ? 'Nothing matches the search.' : `No transactions yet. ${emptyHint}`}</p>
	{/snippet}
</SelectableList>

{#if editing}
	{#key editing.key}
		<TransactionEditor {data} initial={editing.draft} title={editing.title} isNew={editing.id === null} onsave={save} onclose={close} />
	{/key}
{/if}

<style>
	.toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 1rem 0.75rem 0;
	}
	.search {
		flex: 1;
		min-width: 0;
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
	.muted {
		color: var(--muted);
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
		padding: 0.5rem 0.75rem;
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
	.date,
	.category {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.category {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
