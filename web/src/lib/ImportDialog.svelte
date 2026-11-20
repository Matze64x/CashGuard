<script lang="ts">
	import type { ChangeCounts, Conflict, ConflictReason, ImportWarning, Transaction } from '../core';
	import { formatDate, formatEuro, plural } from './display';
	import type { ImportCandidate } from './workspace.svelte';

	let { candidate, onapply, onkeep, onclose }: { candidate: ImportCandidate; onapply: () => void; onkeep: () => void; onclose: () => void } = $props();

	const TEXTS = {
		import: { title: 'Import', intro: 'Importing changes your data:', apply: 'Import', cancel: 'Cancel', broken: "The file can't be imported:" },
		sync: { title: 'Changes in', intro: 'The file changed. Applying the changes changes your data:', apply: 'Apply', cancel: 'Not now', broken: "The file can't be read:" },
		open: {
			title: 'Open',
			intro: 'You have changes that aren’t in your previous file yet. They are carried over into this file:',
			apply: 'Open',
			cancel: 'Cancel',
			broken: "The file can't be opened:",
		},
	} as const;
	const text = $derived(TEXTS[candidate.mode]);
	// desktop: when the file looks wrong, offer to keep the app's data and replace the file with it
	const canKeep = $derived(candidate.mode === 'sync' && (!candidate.ok || candidate.plan.warnings.length > 0));

	let dialog: HTMLDialogElement;
	$effect(() => {
		dialog.showModal();
		// closing on unmount returns the focus to where it was before
		return () => dialog.close();
	});

	const REASONS: Record<ConflictReason, string> = {
		'changed-on-both-sides': 'changed on both devices; the later change is kept',
		'deleted-and-changed': 'deleted on one device, changed on the other; the changed version is kept',
		'moved-into-group': 'moved into a group on one device; the group is kept',
		'deleted-category-in-use': 'deleted on one device but still used; the category is kept',
	};

	const WARNINGS: Record<ImportWarning, string> = {
		'empty-file': 'This file is empty. Applying it removes all your data.',
		'unrelated-file': 'This file has nothing in common with the version you had before. Is it the right file?',
		'many-deletions': 'This removes many transactions. Is this an old copy of the file?',
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

	function conflictLines(conflicts: { transactions: readonly Conflict<Transaction>[]; categories: readonly Conflict<{ name: string }>[]; accounts: readonly Conflict<{ name: string }>[] }) {
		return [
			// for 'moved-into-group', `kept` is the group, so name the moved transaction itself
			...conflicts.transactions.map((c) => `Transaction ${describeTransaction((c.reason === 'moved-into-group' ? (c.ours ?? c.theirs) : c.kept) ?? c.kept)} ${REASONS[c.reason]}`),
			...conflicts.categories.map((c) => `Category “${c.kept.name}” ${REASONS[c.reason]}`),
			...conflicts.accounts.map((c) => `Account “${c.kept.name}” ${REASONS[c.reason]}`),
		];
	}

	const changes = $derived.by(() => {
		if (!candidate.ok) return [];
		const c = candidate.plan.changes;
		return [describe(c.transactions, 'Transactions'), describe(c.categories, 'Categories'), describe(c.accounts, 'Accounts')].filter((x) => x !== null);
	});
	const conflicts = $derived(candidate.ok ? conflictLines(candidate.plan.merge.conflicts) : []);
	const warnings = $derived(candidate.ok ? candidate.plan.warnings.map((w) => WARNINGS[w]) : []);
</script>

<dialog bind:this={dialog} aria-labelledby="import-title" {onclose}>
	<h2 id="import-title">{text.title} “{candidate.fileName}”</h2>
	{#if !candidate.ok}
		<p class="error">{text.broken}</p>
		<ul class="issues">
			{#each candidate.errors.slice(0, 20) as issue, i (i)}
				<li><code>{issue.path || 'file'}</code> {issue.message}</li>
			{/each}
			{#if candidate.errors.length > 20}<li>… and {candidate.errors.length - 20} more</li>{/if}
		</ul>
		<div class="buttons">
			{#if canKeep}<button onclick={onkeep}>Replace it with my data</button>{/if}
			<button onclick={onclose}>{candidate.mode === 'sync' ? 'Not now' : 'Close'}</button>
		</div>
	{:else}
		{#each warnings as warning (warning)}
			<p class="warning" role="alert">{warning}</p>
		{/each}
		{#if changes.length === 0}
			<p>Nothing new: your data already contains everything in this file.</p>
		{:else}
			<p>{text.intro}</p>
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
		{#if candidate.mode === 'import'}<p class="hint">You can undo the import afterwards.</p>{/if}
		<div class="buttons">
			{#if canKeep}<button onclick={onkeep}>Replace it with my data</button>{/if}
			<!-- with warnings, cancelling is the suggested action -->
			<button class:primary={warnings.length > 0} onclick={onclose}>{text.cancel}</button>
			<button class:primary={warnings.length === 0} class:danger={warnings.length > 0} onclick={onapply}>{text.apply}</button>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		max-width: min(36rem, calc(100vw - 2rem));
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--surface);
		color: var(--text);
		padding: 1.25rem;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	h2 {
		margin-top: 0;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
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
