<script lang="ts">
	import AccountsView from './lib/AccountsView.svelte';
	import CategoriesView from './lib/CategoriesView.svelte';
	import { plural } from './lib/display';
	import { errorMessage } from './lib/errors';
	import ImportDialog from './lib/ImportDialog.svelte';
	import SettingsDialog from './lib/SettingsDialog.svelte';
	import { displayKeys, shortcuts } from './lib/shortcuts.svelte';
	import TransactionsView from './lib/TransactionsView.svelte';
	import ShortcutHelp from './lib/ui/ShortcutHelp.svelte';
	import { Workspace, type ImportCandidate } from './lib/workspace.svelte';

	const SECTIONS = [
		{ id: 'transactions', label: 'Transactions', keys: 'g t' },
		{ id: 'categories', label: 'Categories', keys: 'g c' },
		{ id: 'accounts', label: 'Accounts', keys: 'g a' },
	] as const;
	let section = $state<(typeof SECTIONS)[number]['id']>('transactions');

	const workspace = new Workspace();
	let loadError = $state<string | null>(null);
	$effect(() => {
		const stop = workspace.start().catch((e: unknown) => {
			loadError = errorMessage(e);
			return () => {};
		});
		return () => void stop.then((f) => f());
	});

	// raw: a proxy would break the identity check of `candidate.from` in the workspace
	let candidate = $state.raw<ImportCandidate | null>(null);
	// desktop app: a sync with the file that needs a decision comes from the workspace
	const shownCandidate = $derived(candidate ?? workspace.prompt);
	function closeDialog() {
		candidate = null;
		workspace.prompt = null;
	}
	// another tab changed the data: a planned import is based on old data, so drop it
	$effect(() => {
		void workspace.revision;
		candidate = null;
	});

	/** `undo`: offer to undo the last edit (e.g. after deleting) */
	let notice = $state<{ text: string; error: boolean; undo?: boolean } | null>(null);
	function notify(text: string, undo = false) {
		notice = { text, error: false, undo };
	}

	let settingsOpen = $state(false);

	function undo() {
		void run(async () => {
			const label = await workspace.undo();
			return label ? `Undone: ${label}` : 'Nothing to undo.';
		});
	}

	function redo() {
		void run(async () => {
			const label = await workspace.redo();
			return label ? `Redone: ${label}` : 'Nothing to redo.';
		});
	}

	$effect(() => {
		window.addEventListener('keydown', shortcuts.handle);
		return () => window.removeEventListener('keydown', shortcuts.handle);
	});

	$effect(() =>
		shortcuts.add([
			// also in dialogs (outside text fields), so the help can show e.g. the editor's keys
			{ keys: ['?'], description: 'Show the keyboard shortcuts', group: 'General', inDialog: true, when: () => !shortcuts.helpOpen, run: () => (shortcuts.helpOpen = true) },
			{ keys: ['Mod+z'], description: 'Undo the last change', group: 'General', when: () => !busy, run: undo },
			{ keys: ['Mod+Shift+z', 'Mod+y'], description: 'Redo', group: 'General', when: () => !busy, run: redo },
			{ keys: ['Mod+,'], description: 'Settings', group: 'General', inFields: true, run: () => (settingsOpen = true) },
			...SECTIONS.map((s) => ({ keys: [s.keys], description: `Go to ${s.label.toLowerCase()}`, group: 'General', run: () => (section = s.id) })),
			...(workspace.isDesktop
				? [{ keys: ['Mod+o'], description: 'Open another file', group: 'File', inFields: true, when: () => !busy, run: openFile }]
				: [
						{ keys: ['Mod+o'], description: 'Import the synced file', group: 'File', inFields: true, when: () => !busy, run: () => fileInput.click() },
						{ keys: ['Mod+s'], description: 'Export the file', group: 'File', inFields: true, when: () => !busy, run: exportFile },
					]),
		]),
	);
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
			notice = { text: `Something went wrong: ${errorMessage(e)}`, error: true };
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
		const chosen = shownCandidate;
		closeDialog();
		if (chosen?.ok) {
			void run(async () => {
				await workspace.applyImport(chosen);
				return workspace.isDesktop ? null : 'Imported.';
			});
		}
	}

	function keepMine() {
		const chosen = shownCandidate;
		closeDialog();
		if (chosen) {
			void run(async () => {
				await workspace.keepMine(chosen);
				return 'The file now has your data again.';
			});
		}
	}

	function openFile() {
		void run(async () => {
			candidate = await workspace.chooseFileToOpen();
			return null;
		});
	}

	function createFile() {
		void run(async () => ((await workspace.createFile()) ? 'Created. Changes are saved to the file from now on.' : null));
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
		{#if workspace.fileName}<span class="file" title={workspace.filePath ?? workspace.fileName}>{workspace.fileName}</span>{/if}
	</div>
	<div class="actions">
		{#if workspace.isDesktop}
			<button disabled={busy} onclick={openFile}>Open file…</button>
			<button disabled={busy} onclick={createFile}>New file…</button>
		{:else}
			{#if workspace.canUndoImport}
				<button disabled={busy} onclick={undoImport}>Undo import</button>
			{/if}
			<button disabled={busy} onclick={() => fileInput.click()}>Import</button>
			<button class="primary" disabled={busy} aria-label={exportLabel} title={exportLabel} onclick={exportFile}>
				Export{#if workspace.unexportedCount > 0}<span class="count" aria-hidden="true">{workspace.unexportedCount}</span>{/if}
			</button>
		{/if}
	</div>
	<nav aria-label="Sections">
		{#each SECTIONS as s (s.id)}
			<button class="tab" aria-current={section === s.id ? 'page' : undefined} title={displayKeys(s.keys)} onclick={() => (section = s.id)}>{s.label}</button>
		{/each}
		<button class="tab icon first-icon" aria-label="Keyboard shortcuts" title="?" onclick={() => (shortcuts.helpOpen = true)}>?</button>
		<button class="tab icon" aria-label="Settings" title={displayKeys('Mod+,')} onclick={() => (settingsOpen = true)}>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path
					fill="currentColor"
					d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.84c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7"
				/></svg
			>
		</button>
	</nav>
</header>

<main>
	{#if workspace.syncError}
		<p class="notice error" role="alert">Syncing with the file failed: {workspace.syncError}</p>
	{/if}
	{#if notice}
		<p class="notice" class:error={notice.error} role={notice.error ? 'alert' : 'status'}>
			{notice.text}
			{#if notice.undo && workspace.undoLabel}<button class="link" onclick={undo}>Undo <kbd>{displayKeys('Mod+z')}</kbd></button>{/if}
		</p>
	{/if}
	{#if loadError}
		<p class="notice error" role="alert">Your data can't be loaded, so nothing can be changed right now. {loadError}</p>
	{:else if workspace.ready}
		<!-- each view stays mounted (keeps its selection and search); only the shown one is active -->
		<div hidden={section !== 'transactions'}>
			<TransactionsView
				{workspace}
				active={section === 'transactions'}
				{notify}
				emptyHint={workspace.isDesktop ? 'Open your CashGuard file to get started.' : 'Import your CashGuard file to get started, or press n to add one.'}
			/>
		</div>
		<div hidden={section !== 'categories'}><CategoriesView {workspace} active={section === 'categories'} {notify} /></div>
		<div hidden={section !== 'accounts'}><AccountsView {workspace} active={section === 'accounts'} {notify} /></div>
	{/if}
</main>

{#if shortcuts.helpOpen}
	<ShortcutHelp onclose={() => (shortcuts.helpOpen = false)} />
{/if}

{#if settingsOpen}
	<SettingsDialog onclose={() => (settingsOpen = false)} />
{/if}

{#if shownCandidate}
	<ImportDialog candidate={shownCandidate} onapply={applyImport} onkeep={keepMine} onclose={closeDialog} />
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
	nav {
		display: flex;
		gap: 0.25rem;
		width: 100%;
		overflow-x: auto;
	}
	.tab {
		border: none;
		border-radius: 0.5rem;
		background: none;
		color: var(--muted);
		min-height: 2.25rem;
	}
	.tab[aria-current='page'] {
		color: var(--text);
		background: var(--accent-soft);
		font-weight: 600;
	}
	.tab.first-icon {
		margin-left: auto;
	}
	.tab.icon {
		min-width: 2.25rem;
		display: grid;
		place-items: center;
	}
	.tab svg {
		width: 1.15rem;
		height: 1.15rem;
	}
	.link {
		border: none;
		background: none;
		color: var(--accent);
		font-weight: 600;
		min-height: 0;
		padding: 0 0.4rem;
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
