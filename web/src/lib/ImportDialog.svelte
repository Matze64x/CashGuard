<script lang="ts">
	import type { ChangeCounts, ConflictReason, ImportWarning, MergeResult, Transaction } from '../core';
	import { formatDate, formatEuro, plural } from './display';
	import Modal from './ui/Modal.svelte';
	import type { ImportCandidate } from './workspace.svelte';

	let { candidate, onapply, onclose }: { candidate: ImportCandidate; onapply: () => void; onclose: () => void } = $props();

	const REASONS: Record<ConflictReason, string> = {
		'changed-on-both-sides': 'changed on both devices; the later change is kept',
		'deleted-and-changed': 'deleted on one device, changed on the other; the changed version is kept',
		'moved-into-group': 'moved into a group on one device; the group is kept',
		'deleted-category-in-use': 'deleted on one device but still used; the category is kept',
	};

	const WARNINGS: Record<ImportWarning, string> = {
		'unrelated-file': 'This file has nothing in common with your data. Is it the right file?',
	};

	function describe(counts: ChangeCounts, what: string): string | null {
		const parts = [
			counts.added && `${counts.added} added`,
			counts.changed && `${counts.changed} changed`,
			counts.deleted && `${counts.deleted} removed`,
		].filter(Boolean);
		return parts.length ? `${what}: ${parts.join(', ')}` : null;
	}

	function describeTransaction(t: Transaction): string {
		return t.description ? `“${t.description}”` : `of ${formatDate(t.date)} (${formatEuro(t.amount)})`;
	}

	function conflictLines(conflicts: MergeResult['conflicts']) {
		return [
			// for 'moved-into-group', `kept` is the group, so name the moved transaction itself
			...conflicts.transactions.map((c) => `Transaction ${describeTransaction((c.reason === 'moved-into-group' ? (c.ours ?? c.theirs) : c.kept) ?? c.kept)} ${REASONS[c.reason]}`),
			...conflicts.categories.map((c) => `Category “${c.kept.name}” ${REASONS[c.reason]}`),
			...conflicts.accounts.map((c) => `Account “${c.kept.name}” ${REASONS[c.reason]}`),
			...conflicts.recurring.map((c) => `Recurring transaction “${c.kept.description}” ${REASONS[c.reason]}`),
		];
	}

	const changes = $derived.by(() => {
		if (!candidate.ok) return [];
		const c = candidate.plan.changes;
		return [describe(c.transactions, 'Transactions'), describe(c.categories, 'Categories'), describe(c.accounts, 'Accounts'), describe(c.recurring, 'Recurring transactions')].filter(
			(x) => x !== null,
		);
	});
	const conflicts = $derived(candidate.ok ? conflictLines(candidate.plan.merge.conflicts) : []);
	const warnings = $derived(candidate.ok ? candidate.plan.warnings.map((w) => WARNINGS[w]) : []);
</script>

<Modal title={`Import “${candidate.fileName}”`} {onclose}>
	{#if !candidate.ok}
		<p class="error">The file can't be imported:</p>
		<ul class="issues">
			{#each candidate.errors.slice(0, 20) as issue, i (i)}
				<li><code>{issue.path || 'file'}</code> {issue.message}</li>
			{/each}
			{#if candidate.errors.length > 20}<li>… and {candidate.errors.length - 20} more</li>{/if}
		</ul>
		<div class="buttons">
			<!-- svelte-ignore a11y_autofocus -->
			<button onclick={onclose} autofocus>Close</button>
		</div>
	{:else}
		{#each warnings as warning (warning)}
			<p class="warning" role="alert">{warning}</p>
		{/each}
		{#if changes.length === 0}
			<p>Nothing new: your data already contains everything in this file.</p>
		{:else}
			<p>Importing adds to your data (nothing is removed):</p>
			<ul>
				{#each changes as line (line)}<li>{line}</li>{/each}
			</ul>
		{/if}
		{#if conflicts.length > 0}
			<p>{plural(conflicts.length, 'conflict')}, resolved automatically:</p>
			<ul class="issues">
				{#each conflicts as line, i (i)}<li>{line}</li>{/each}
			</ul>
		{/if}
		{#if candidate.warnings.length > 0}
			<details>
				<summary>{plural(candidate.warnings.length, 'note')} about the file</summary>
				<ul class="issues">
					{#each candidate.warnings as issue, i (i)}<li><code>{issue.path}</code> {issue.message}</li>{/each}
				</ul>
			</details>
		{/if}
		<p class="hint">You can undo the import afterwards.</p>
		<div class="buttons">
			<!-- with warnings, cancelling is the suggested action (and has the focus) -->
			<!-- svelte-ignore a11y_autofocus -->
			<button class:primary={warnings.length > 0} onclick={onclose} autofocus>Cancel</button>
			<button class:primary={warnings.length === 0} class:danger={warnings.length > 0} onclick={onapply}>Import</button>
		</div>
	{/if}
</Modal>

<style>
	.issues {
		max-height: 40vh;
		overflow: auto;
		font-size: 0.9rem;
	}
	.error {
		color: var(--negative);
	}
	.warning {
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid var(--warning);
		color: var(--warning);
	}
	.hint {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.danger {
		color: var(--negative);
	}
</style>
