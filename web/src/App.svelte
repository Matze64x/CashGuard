<script lang="ts">
	import { totalAmount } from './core';
	import { formatEuro, plural } from './lib/display';
	import ImportDialog from './lib/ImportDialog.svelte';
	import TransactionList from './lib/TransactionList.svelte';
	import { Workspace, type ImportCandidate } from './lib/workspace.svelte';

	const workspace = new Workspace();
	let loadError = $state<string | null>(null);
	$effect(() => {
		const stop = workspace.start().catch((e: Error) => {
			loadError = e.message;
			return () => {};
		});
		return () => void stop.then((f) => f());
	});

	let candidate = $state<ImportCandidate | null>(null);
	// another tab changed the data: a planned import is based on old data, so drop it
	$effect(() => {
		void workspace.revision;
		candidate = null;
	});

	let notice = $state<{ text: string; error: boolean } | null>(null);
	$effect(() => {
		if (!notice || notice.error) return;
		const timer = setTimeout(() => (notice = null), 5000);
		return () => clearTimeout(timer);
	});

	/** Runs an action and shows a failure instead of losing it in the console. */
	async function run(action: () => Promise<string | null>) {
		try {
			const text = await action();
			notice = text ? { text, error: false } : null;
		} catch (e) {
			notice = { text: `Something went wrong: ${(e as Error).message}`, error: true };
		}
	}

	let fileInput: HTMLInputElement;

	function onFileChosen() {
		const file = fileInput.files?.[0];
		fileInput.value = ''; // so choosing the same file again triggers a change too
		if (file) {
			void run(async () => {
				candidate = await workspace.planImport(file);
				return null;
			});
		}
	}

	function applyImport() {
		const chosen = candidate;
		candidate = null;
		if (chosen?.ok) {
			void run(async () => {
				await workspace.applyImport(chosen);
				return 'Imported.';
			});
		}
	}

	function undoImport() {
		void run(async () => {
			await workspace.undoImport();
			return 'Import undone.';
		});
	}

	function exportFile() {
		// no await before exportFile: browsers only allow sharing/downloading directly after a click
		void run(async () => ((await workspace.exportFile()) ? 'Exported. Save it over your synced file, then it reaches your other devices.' : null));
	}

	const busy = $derived(!workspace.ready || loadError !== null);
	const exportLabel = $derived(
		workspace.unexportedCount > 0 ? `Export, ${plural(workspace.unexportedCount, 'change')} not exported yet` : 'Export',
	);
</script>

<!-- iOS greys out files for a strict filter on some versions, so text files are allowed too -->
<input type="file" accept=".json,application/json,text/plain" hidden bind:this={fileInput} onchange={onFileChosen} />

<header>
	<div class="title">
		<h1>CashGuard</h1>
		{#if workspace.fileName}<span class="file">{workspace.fileName}</span>{/if}
	</div>
	<div class="actions">
		{#if workspace.canUndoImport}
			<button disabled={busy} onclick={undoImport}>Undo import</button>
		{/if}
		<button disabled={busy} onclick={() => fileInput.click()}>Import</button>
		<button class="primary" disabled={busy} aria-label={exportLabel} title={exportLabel} onclick={exportFile}>
			Export{#if workspace.unexportedCount > 0}<span class="count" aria-hidden="true">{workspace.unexportedCount}</span>{/if}
		</button>
	</div>
</header>

<main>
	{#if notice}
		<p class="notice" class:error={notice.error} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
	{/if}
	{#if loadError}
		<p class="notice error" role="alert">Your data can't be loaded, so nothing can be changed right now. {loadError}</p>
	{:else if workspace.ready}
		<section class="summary">
			<span class="balance">{formatEuro(totalAmount(workspace.data.transactions))}</span>
			<span class="muted">{plural(workspace.data.transactions.length, 'transaction')}</span>
		</section>
		<TransactionList data={workspace.data} />
	{/if}
</main>

{#if candidate}
	<ImportDialog {candidate} onapply={applyImport} onclose={() => (candidate = null)} />
{/if}

<style>
	header {
		position: sticky;
		top: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: space-between;
		align-items: center;
		padding: max(0.75rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) 0.75rem max(1rem, env(safe-area-inset-left));
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		z-index: 1;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.file {
		color: var(--muted);
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.count {
		margin-left: 0.4rem;
		background: var(--surface);
		color: var(--accent);
		border-radius: 1rem;
		padding: 0 0.45rem;
		font-size: 0.8rem;
	}
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 0 env(safe-area-inset-right) max(1rem, env(safe-area-inset-bottom)) env(safe-area-inset-left);
	}
	.summary {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		padding: 1.25rem 0.75rem 0.75rem;
	}
	.balance {
		font-size: 2rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--muted);
	}
	.notice {
		margin: 0.75rem 0.75rem 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--accent-soft);
	}
	.notice.error {
		background: none;
		border: 1px solid var(--negative);
		color: var(--negative);
	}
</style>
