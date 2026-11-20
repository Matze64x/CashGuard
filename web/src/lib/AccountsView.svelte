<!--
	Accounts: the real balances (bank, cash, …), compared with the balance the transactions add up to.
	A difference means a transaction is missing or wrong.
-->
<script lang="ts">
	import { addAccount, deleteAccount, sumCents, totalAmount, updateAccount, type Account, type Cents } from '../core';
	import { attempt } from './attempt';
	import { formatDay, formatEuro } from './display';
	import { shortcuts } from './shortcuts.svelte';
	import AmountInput from './ui/AmountInput.svelte';
	import Modal from './ui/Modal.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let { workspace, active, notify }: { workspace: Workspace; active: boolean; notify: (text: string, undo?: boolean) => void } = $props();

	const accounts = $derived(workspace.data.accounts);
	const accountsTotal = $derived(sumCents(accounts.map((a) => a.amount)));
	const transactionsTotal = $derived(totalAmount(workspace.data.transactions));
	const difference = $derived(accountsTotal - transactionsTotal);

	// accounts have no ids yet, so the list (and the edits) address them by position
	type Row = { account: Account; index: number };
	const rows = $derived(accounts.map((account, index): Row => ({ account, index })));
	let selectedKey = $state<`${number}` | null>(null);
	const selected = $derived(rows.find((r) => String(r.index) === selectedKey));
	/** `original`: the account as the dialog opened, so saving can't hit another one moved into its place */
	let editing = $state<{ original: Row | null; name: string; amount: Cents | null } | null>(null);
	let saving = false;
	let list: SelectableList<Row, `${number}`>;
	let listElement = $state<HTMLElement>();

	const select = (index: number) => (selectedKey = index >= 0 ? `${index}` : null);

	function openEdit(row: Row | undefined) {
		if (row) editing = { original: row, name: row.account.name, amount: row.account.amount };
	}

	function close() {
		editing = null;
		list.focus();
	}

	async function save() {
		const target = editing;
		if (!target || saving) return;
		const name = target.name.trim();
		if (!name) return notify('Enter a name for the account.');
		if (target.amount === null) return notify('Enter the balance.');
		const amount = target.amount;
		saving = true;
		const saved = await attempt(notify, async () => {
			const { original } = target;
			if (original === null) {
				await workspace.edit(`Add account “${name}”`, (d, now) => addAccount(d, name, amount, now));
				select(accounts.length - 1);
			} else {
				await workspace.edit(`Edit account “${name}”`, (d, now) => updateAccount(d, original.index, { name, amount }, now, original.account));
			}
		});
		saving = false;
		if (saved) close();
	}

	async function remove(row: Row | undefined) {
		if (!row) return;
		const { account, index } = row;
		if (await attempt(notify, () => workspace.edit(`Delete account “${account.name}”`, (d) => deleteAccount(d, index, account)))) {
			select(Math.min(index, accounts.length - 1));
			notify(`Deleted account “${account.name}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['n'], description: 'New account', group: 'Accounts', when: () => active, run: () => (editing = { original: null, name: '', amount: null }) },
			// these act on the selection, so only while the list (not a button elsewhere) has the focus
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected account', run: () => openEdit(selected) },
				{ keys: ['Delete', 'Backspace'], description: 'Delete the selected account (undo with Mod+Z)', run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Accounts', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
		]),
	);
</script>

<div class="toolbar">
	<h2>Accounts</h2>
	<button class="primary" onclick={() => (editing = { original: null, name: '', amount: null })} title="n">New</button>
</div>

<SelectableList
	bind:this={list}
	bind:selected={selectedKey}
	bind:element={listElement}
	items={rows}
	key={(r) => `${r.index}`}
	label="Accounts"
	{active}
	group="Accounts"
	itemName="account"
	onopen={openEdit}
>
	{#snippet row({ account })}
		<div class="row">
			<span class="name">{account.name || '(unnamed)'}</span>
			<span class="edited">updated {formatDay(account.edited)}</span>
			<span class="amount" class:income={account.amount > 0}>{formatEuro(account.amount)}</span>
		</div>
	{/snippet}
	{#snippet empty()}
		<p class="empty">No accounts yet. Press <kbd>n</kbd> to add your bank account, cash, …</p>
	{/snippet}
</SelectableList>

<dl class="check" aria-live="polite">
	<dt>Accounts</dt>
	<dd>{formatEuro(accountsTotal)}</dd>
	<dt>Transactions</dt>
	<dd>{formatEuro(transactionsTotal)}</dd>
	<dt>Difference</dt>
	<dd class:ok={difference === 0} class:off={difference !== 0}>
		{difference === 0 ? 'none, everything matches' : formatEuro(difference as Cents)}
	</dd>
</dl>

{#if editing}
	<Modal title={editing.original === null ? 'New account' : 'Edit account'} onclose={close}>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label for="account-name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="account-name" type="text" autocomplete="off" bind:value={editing.name} autofocus={editing.original === null} required />
			<label for="account-amount">Current balance</label>
			<!-- an existing account usually only needs its new balance -->
			<AmountInput id="account-amount" label="Current balance" bind:value={editing.amount} autofocus={editing.original !== null} />
			<div class="buttons">
				<button type="button" onclick={close}>Cancel</button>
				<button type="submit" class="primary">Save</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 0.75rem 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto 9rem;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.6rem 0.75rem;
	}
	.name {
		overflow-wrap: anywhere;
	}
	.edited {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.amount.income {
		color: var(--positive);
	}
	.check {
		display: grid;
		grid-template-columns: auto auto;
		justify-content: end;
		gap: 0.3rem 1.5rem;
		padding: 1rem 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.check dt {
		color: var(--muted);
	}
	.check dd {
		margin: 0;
		text-align: right;
	}
	.ok {
		color: var(--positive);
	}
	.off {
		color: var(--negative);
		font-weight: 600;
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 3rem 1rem;
	}
	form {
		display: grid;
		gap: 0.5rem;
	}
	label {
		color: var(--muted);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	@media (max-width: 40rem) {
		.row {
			grid-template-columns: 1fr auto;
		}
		.edited {
			grid-row: 2;
		}
	}
</style>
