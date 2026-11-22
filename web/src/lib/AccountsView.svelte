<!--
	Accounts: the real balances (bank, cash, …), compared with the balance the transactions add up to.
	A difference means a transaction is missing or wrong.
-->
<script lang="ts">
	import { addAccount, deleteAccount, sumCents, totalAmount, updateAccount, type Account, type Cents, type Id } from '../core';
	import { attempt } from './attempt';
	import { showError } from './notices.svelte';
	import { formatDay, formatEuro } from './display';
	import { displayKeys, shortcuts } from './shortcuts.svelte';
	import AmountInput from './ui/AmountInput.svelte';
	import Modal from './ui/Modal.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		shared,
		notify,
	}: {
		workspace: Workspace;
		active: boolean;
		/** One of several lists in the Manage tab (see `SelectableList`) */
		shared: 'first' | 'other';
		notify: (text: string, undo?: boolean) => void;
	} = $props();

	const accounts = $derived(workspace.data.accounts);
	const accountsTotal = $derived(sumCents(accounts.map((a) => a.amount)));
	const transactionsTotal = $derived(totalAmount(workspace.data.transactions));
	const difference = $derived(accountsTotal - transactionsTotal);

	type Row = { account: Account };
	const rows = $derived(accounts.map((account): Row => ({ account })));
	let selectedKey = $state<Id | null>(null);
	const selected = $derived(rows.find((r) => r.account.id === selectedKey));
	/** `original`: the account as the dialog opened, so saving can't overwrite a change synced meanwhile */
	let editing = $state<{ original: Account | null; name: string; amount: Cents | null } | null>(null);
	let saving = false;
	let list: SelectableList<Row, Id>;
	let listElement = $state<HTMLElement>();

	function openEdit(row: Row | undefined) {
		if (row) editing = { original: row.account, name: row.account.name, amount: row.account.amount };
	}

	/** Why saving failed: shown in the dialog (a notice would be hidden behind it) */
	let failure = $state<string | null>(null);
	const fail = (text: string) => void (failure = text);

	function close() {
		editing = null;
		failure = null;
		list.focus();
	}

	async function save() {
		const target = editing;
		if (!target || saving) return;
		const name = target.name.trim();
		failure = null;
		if (!name) return fail('Enter a name for the account.');
		if (target.amount === null) return fail('Enter the balance.');
		const amount = target.amount;
		saving = true;
		const saved = await attempt(fail, async () => {
			const { original } = target;
			if (original === null) {
				await workspace.edit(`Add account “${name}”`, (d, now) => addAccount(d, name, amount, now));
				selectedKey = accounts.at(-1)?.id ?? null;
			} else {
				await workspace.edit(`Edit account “${name}”`, (d, now) => updateAccount(d, original.id, { name, amount }, now, original));
			}
		});
		saving = false;
		if (saved) close();
	}

	/** Deleting from the editor: it closes first */
	function deleteEdited() {
		const id = editing?.original?.id;
		close();
		if (id === undefined) return;
		selectedKey = id;
		void remove(rows.find((r) => r.account.id === id));
	}

	async function remove(row: Row | undefined) {
		if (!row) return;
		const { account } = row;
		const index = accounts.indexOf(account);
		if (await attempt(showError, () => workspace.edit(`Delete account “${account.name}”`, (d) => deleteAccount(d, account.id)))) {
			// the one that took its place
			selectedKey = accounts[Math.min(index, accounts.length - 1)]?.id ?? null;
			notify(`Deleted account “${account.name}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			// these act on the selection, so only while the list (not a button elsewhere) has the focus
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected account', run: () => openEdit(selected) },
				{ keys: ['Delete', 'Backspace'], description: `Delete the selected account (undo with ${displayKeys('Mod+z')})`, run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Accounts', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
		]),
	);
</script>

<div class="toolbar">
	<h2>Accounts</h2>
	<button class="primary" onclick={() => (editing = { original: null, name: '', amount: null })}>New</button>
</div>

<SelectableList
	bind:this={list}
	bind:selected={selectedKey}
	bind:element={listElement}
	items={rows}
	key={(r) => r.account.id}
	label="Accounts"
	{active}
	{shared}
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
		<p class="empty">No accounts yet. Add one with “New”.</p>
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
			{#if failure}<p class="error" role="alert">{failure}</p>{/if}
			<div class="buttons">
				{#if editing.original}
					<div class="item-actions"><button type="button" class="danger" onclick={deleteEdited}>Delete</button></div>
				{/if}
				<button type="button" onclick={close}>Cancel</button>
				<button type="submit" class="primary">Save</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.error {
		color: var(--negative);
		margin: 0;
	}
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
