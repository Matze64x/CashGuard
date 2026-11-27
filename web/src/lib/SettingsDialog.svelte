<!--
	Preferences of this device (stored in the browser, not in the data file), the devices it syncs
	with, the data (importing and exporting the file, the backup file), and the app's version and
	updates. Changes apply at once.
-->
<script lang="ts">
	import { DATE_STYLES, formatDateAs, today, type DateStyle } from '../core';
	import { attempt } from './attempt';
	import { chooseFileToSave, dataLocation, isDesktop } from './desktop';
	import { settings } from './settings.svelte';
	import { displayKeys } from './shortcuts.svelte';
	import Segmented from './ui/Segmented.svelte';
	import { APP_VERSION, updates } from './updates.svelte';
	import type { DesktopSync } from './sync/desktop-sync.svelte';
	import Devices from './sync/Devices.svelte';
	import type { PhoneSync } from './sync/phone-sync.svelte';
	import Modal from './ui/Modal.svelte';
	import type { Workspace } from './workspace.svelte';

	let {
		workspace,
		sync,
		busy,
		loadFailed,
		onimport,
		onexport,
		onundoimport,
		onclear,
		onclose,
	}: {
		workspace: Workspace;
		sync: DesktopSync | PhoneSync;
		/** The data isn't loaded (yet): no file actions */
		busy: boolean;
		/** The stored data couldn't be read: clearing it is the way out */
		loadFailed: boolean;
		/** The file actions; each closes the dialog first. They must start right in the click
		 * (browsers allow a file chooser or download only directly after one) */
		onimport: () => void;
		onexport: () => void;
		onundoimport: () => void;
		/** Deletes the data on this device (asked here first); closes the dialog */
		onclear: () => void;
		onclose: () => void;
	} = $props();
	const sample = today();
	const location = isDesktop ? dataLocation().catch(() => null) : null;
	let confirmingClear = $state(false);

	/** Why choosing the backup file failed (shown here: a notice would be behind the dialog) */
	let failure = $state<string | null>(null);

	async function chooseBackup() {
		failure = null;
		await attempt(
			(text) => (failure = text),
			async () => {
				const path = await chooseFileToSave('Back up to', settings.backupPath ?? 'cashguard-backup.json');
				if (path) await workspace.setBackupPath(path);
			},
		);
	}
</script>

<Modal title="Settings" closeButton {onclose}>
	<div class="settings">
		<label for="date-style">Date format</label>
		<select id="date-style" value={settings.dateStyle} onchange={(e) => (settings.dateStyle = e.currentTarget.value as DateStyle)}>
			{#each DATE_STYLES as style (style)}
				<option value={style}>{style} ({formatDateAs(sample, style)})</option>
			{/each}
		</select>
		<p class="muted">These settings apply to this device only.</p>
		<hr />
		<Devices {sync} />
		<hr />
		<h3>Data</h3>
		<div class="row">
			<button type="button" disabled={busy} title={displayKeys('Mod+o')} onclick={onimport}>Import</button>
			<button type="button" disabled={busy} title={displayKeys('Mod+s')} onclick={onexport}>Export</button>
			{#if workspace.canUndoImport}<button type="button" disabled={busy} onclick={onundoimport}>Undo import</button>{/if}
			<button type="button" class="danger" disabled={(busy && !loadFailed) || sync.enabled} onclick={() => (confirmingClear = true)}>Clear data…</button>
		</div>
		{#if sync.enabled}<p class="muted file">To clear the data, turn off sync first.</p>{/if}
		{#if workspace.fileName}<p class="muted file">Last file: <span class="name">{workspace.fileName}</span></p>{/if}
		{#if isDesktop}
			<h4>Backup file</h4>
			<div class="backup">
				{#if settings.backupPath}
					<code class="path">{settings.backupPath}</code>
					<div class="row">
						<button type="button" onclick={() => void chooseBackup()}>Change…</button>
						<button type="button" onclick={() => void workspace.setBackupPath(null)}>Turn off</button>
					</div>
				{:else}
					<div class="row"><button type="button" onclick={() => void chooseBackup()}>Choose…</button></div>
				{/if}
				{#if failure ?? workspace.backupError}<p class="error" role="alert">{failure ?? workspace.backupError}</p>{/if}
				<p class="muted">
					Updated a few seconds after each change. To restore it, import it.
				</p>
			</div>
		{/if}
		{#if location}
			{#await location then where}
				{#if where}
					<p class="muted where">
						{where.portable ? 'Data folder (portable):' : 'Data folder:'}
						<code>{where.path}</code>
					</p>
				{/if}
			{/await}
		{/if}
		<hr />
		<h3>App</h3>
		<p class="muted version">Version {APP_VERSION}</p>
		{#if updates.supported}
			<div class="row">
				{#if updates.available}
					<button type="button" class="primary" disabled={updates.busy} onclick={() => void updates.apply()}>Update</button>
					<span class="muted status">New version available.</span>
				{:else}
					<button type="button" disabled={updates.busy} onclick={() => void updates.check()}>Check for updates</button>
					{#if updates.checked !== null && !updates.busy}<span class="muted status">Up to date.</span>{/if}
				{/if}
			</div>
			{#if updates.failure}<p class="error" role="alert">{updates.failure}</p>{/if}
			<span class="label-text">Updates</span>
			<div class="choice">
				<Segmented
					label="Updates"
					options={[
						{ value: 'auto', label: 'Automatic' },
						{ value: 'ask', label: 'Manual' },
					]}
					bind:value={() => settings.updates, (v) => void updates.setAutomatic(v === 'auto')}
				/>
			</div>
		{/if}
		<div class="buttons"><button type="button" class="primary" onclick={onclose}>Done</button></div>
	</div>
</Modal>

{#if confirmingClear}
	<Modal title="Clear data?" onclose={() => (confirmingClear = false)}>
		<p class="ask">Deletes all transactions, categories, accounts and recurring transactions on this device. Other devices keep theirs{isDesktop && settings.backupPath ? ', and so does the backup file' : ''}. Export first to keep a copy.</p>
		<div class="buttons">
			<button type="button" onclick={() => (confirmingClear = false)}>Cancel</button>
			<button type="button" class="primary danger" onclick={onclear}>Clear data</button>
		</div>
	</Modal>
{/if}

<style>
	.settings {
		display: grid;
		gap: 0.5rem;
	}
	.muted,
	label {
		color: var(--muted);
	}
	.muted {
		font-size: 0.85rem;
		margin: 0.5rem 0 0;
	}
	.version {
		margin: 0;
	}
	.status {
		margin: 0;
		align-self: center;
	}
	.label-text {
		color: var(--muted);
	}
	/* (as wide as its options, not the dialog) */
	.choice {
		justify-self: start;
	}
	h3 {
		margin: 0;
		font-size: 1.1rem;
	}
	h4 {
		margin: 0.75rem 0 0;
		font-size: 1rem;
	}
	.file {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.backup {
		display: grid;
		gap: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.path,
	.where code {
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--negative);
		margin: 0;
	}
	.where code {
		overflow-wrap: anywhere;
	}
	hr {
		width: 100%;
		margin: 0.75rem 0 0.25rem;
		border: none;
		border-top: 1px solid var(--border);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.ask {
		margin: 0;
	}
	.primary.danger {
		background: var(--negative);
		border-color: var(--negative);
		color: var(--accent-text);
	}
</style>
