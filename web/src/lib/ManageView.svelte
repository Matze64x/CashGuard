<!--
	The smaller lists in one place: accounts (on top: their balances change most often), recurring
	transactions and categories. Each list takes keys only while it has the focus (the accounts get
	it when the tab is shown); "New" buttons add, Enter edits, Delete deletes.
-->
<script lang="ts">
	import type { RecurringDraft } from '../core';
	import AccountsView from './AccountsView.svelte';
	import CategoriesView from './CategoriesView.svelte';
	import RecurringView from './RecurringView.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		active,
		notify,
		onreviewdue,
	}: { workspace: Workspace; active: boolean; notify: (text: string, undo?: boolean) => void; onreviewdue: () => void } = $props();

	let recurringView = $state<RecurringView>();

	/** Opens the editor for a new recurring transaction ("Make recurring…") */
	export function newRecurring(draft: RecurringDraft) {
		recurringView?.openNew(draft);
	}
</script>

<section aria-label="Accounts"><AccountsView {workspace} {active} shared="first" {notify} /></section>
<section aria-label="Recurring transactions"><RecurringView bind:this={recurringView} {workspace} {active} shared="other" {notify} {onreviewdue} /></section>
<section aria-label="Categories"><CategoriesView {workspace} {active} shared="other" {notify} /></section>

<style>
	section + section {
		margin-top: 1.5rem;
		border-top: 1px solid var(--border);
	}
</style>
