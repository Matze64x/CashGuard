<!--
	The due recurring transactions, entered one after the other: the oldest due occurrence comes
	pre-filled (`DueEntry`), the amount field focused. Enter enters it and brings the next; "Skip"
	marks it as not happened. A template's occurrences come in order; the list beside shows
	everything that's due, and choosing a template there takes its oldest one next. The one being
	entered stays put while other data changes (e.g. a sync), and after entering or skipping its next
	due one comes; when it has none left, the oldest due one. What was just done can be undone here.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		confirmOccurrence,
		dueList,
		skipOccurrence,
		type CivilDate,
		type Id,
		type TransactionDraft,
	} from '../core';
	import { attempt } from './attempt';
	import { clock } from './clock.svelte';
	import DueEntry from './DueEntry.svelte';
	import { formatDate, formatEuro, plural } from './display';
	import { describeSchedule } from './schedule';
	import Modal from './ui/Modal.svelte';
	import type { Workspace } from './workspace.svelte';

	let { workspace, notify, onclose }: { workspace: Workspace; notify: (text: string, undo?: boolean) => void; onclose: () => void } = $props();

	const data = $derived(workspace.data);
	const items = $derived(dueList(data, clock.today));
	const total = $derived(items.reduce((n, d) => n + d.dates.length, 0));

	/** The template being entered: pinned, so other changes don't swap it while typing */
	let chosen = $state<Id | null>(null);
	const current = $derived(items.find((d) => d.recurring.id === chosen) ?? items[0]);
	const occurrence = $derived(current?.dates[0]);
	$effect(() => {
		const id = current?.recurring.id ?? null;
		// (no longer due, e.g. handled on another device: then the oldest due one)
		if (untrack(() => chosen) !== id) chosen = id;
	});

	let error = $state<string | null>(null);
	/** What was just entered or skipped, to see it happened (and undo it) */
	let done = $state<string | null>(null);
	let saving = $state(false);

	const name = (description: string) => `“${description || 'recurring transaction'}”`;

	/** Runs a change; afterwards the template's next due one comes (if any). A failure shows in the dialog. */
	async function change(label: string, edit: Parameters<Workspace['edit']>[1], text: string) {
		if (saving) return;
		saving = true;
		error = null;
		const saved = await attempt((message) => (error = message), () => workspace.edit(label, edit));
		saving = false;
		if (!saved) return;
		done = text;
		await tick();
		if (items.length === 0) {
			notify(`${text} Nothing else is due.`, true);
			onclose();
		}
	}

	function enter(draft: TransactionDraft, accountId: Id | null) {
		const r = current?.recurring;
		const day = occurrence;
		if (!r || !day) return;
		const account = data.accounts.find((a) => a.id === accountId);
		void change(
			`Enter ${name(draft.description)} of ${formatDate(day)}`,
			(d, now) => confirmOccurrence(d, r.id, day, draft, accountId, now).data,
			`Entered ${name(draft.description)} of ${formatDate(day)}: ${formatEuro(draft.amount)}${account ? `, ${account.name || 'the account'} updated` : ''}.`,
		);
	}

	function skip() {
		const r = current?.recurring;
		const day = occurrence;
		if (!r || !day) return;
		void change(`Skip ${name(r.description)} of ${formatDate(day)}`, (d) => skipOccurrence(d, r.id, day), `Skipped ${name(r.description)} of ${formatDate(day)}.`);
	}

	async function undo() {
		if (saving) return;
		saving = true;
		let label: string | null = null;
		const undone = await attempt(
			(message) => (error = message),
			async () => void (label = await workspace.undo()),
		);
		saving = false;
		chosen = null;
		done = undone && label ? `Undone: ${label}` : null;
	}

	/** A short summary of what's coming after the one shown */
	const later = (dates: readonly CivilDate[], more: boolean) =>
		dates.length > 1 ? ` · then ${dates.slice(1, 4).map(formatDate).join(', ')}${dates.length > 4 || more ? ', …' : ''}` : '';
</script>

<Modal title="Due recurring transactions" {onclose} wide>
	<div class="inbox">
		<div class="entry">
			{#if current && occurrence}
				{@const r = current.recurring}
				<p class="what">
					<span class="name">{r.description || '—'}</span>
					<span class="when">due {formatDate(occurrence)}</span>
				</p>
				<p class="schedule">
					{describeSchedule(r.schedule)}{r.amount === null ? ', amount asked each time' : ''}{later(current.dates, current.more)}
				</p>
				<!-- a new form for each occurrence: nothing typed carries over -->
				{#key `${r.id}:${occurrence}`}
					<DueEntry
						{data}
						recurring={r}
						{occurrence}
						busy={saving}
						bind:error
						onenter={enter}
						onskip={skip}
					/>
				{/key}
			{:else}
				<p class="empty">Nothing is due.</p>
			{/if}
			<p class="done" aria-live="polite">
				{done ?? ''}
				{#if done && workspace.undoLabel}<button type="button" class="link" disabled={saving} onclick={() => void undo()}>Undo</button>{/if}
			</p>
		</div>

		<div class="queue" role="group" aria-label="Due">
			<p class="count">{plural(total, 'occurrence')} due{items.some((d) => d.more) ? ' (and more)' : ''}</p>
			<ul>
				{#each items as d (d.recurring.id)}
					<li>
						<button
							type="button"
							class:current={d === current}
							aria-current={d === current ? 'true' : undefined}
							onclick={() => {
								chosen = d.recurring.id;
								error = null;
							}}
						>
							<span class="q-name">{d.recurring.description || '—'}</span>
							<span class="q-dates">{formatDate(d.dates[0]!)}{d.dates.length > 1 ? ` + ${d.more ? `${d.dates.length - 1}+` : d.dates.length - 1} more` : ''}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
	<!-- (Escape closes it too; a touch screen needs a button) -->
	<div class="close"><button type="button" onclick={onclose}>Close</button></div>
</Modal>

<style>
	.close {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
	}
	.inbox {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15rem;
		gap: 1.25rem;
	}
	.what {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
	}
	.name {
		font-size: 1.15rem;
		font-weight: 600;
	}
	.when {
		color: var(--muted);
	}
	.schedule {
		margin: 0.25rem 0 1rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.done {
		margin: 0.75rem 0 0;
		min-height: 1.2em;
		color: var(--positive);
		font-size: 0.9rem;
	}
	.link {
		margin-left: 0.5rem;
		min-height: 0;
		padding: 0 0.4rem;
		font-size: 0.9rem;
	}
	.empty {
		color: var(--muted);
	}
	.queue {
		border-left: 1px solid var(--border);
		padding-left: 1.25rem;
	}
	.count {
		margin: 0 0 0.5rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}
	.queue button {
		width: 100%;
		display: grid;
		text-align: left;
		border: none;
		background: none;
		padding: 0.4rem 0.6rem;
		border-radius: 0.5rem;
		min-height: 0;
	}
	.queue button:hover {
		background: var(--accent-soft);
	}
	.queue button.current {
		background: var(--accent-soft);
		font-weight: 600;
	}
	.q-dates {
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: normal;
	}
	@media (max-width: 40rem) {
		.inbox {
			grid-template-columns: minmax(0, 1fr);
		}
		.queue {
			border-left: none;
			border-top: 1px solid var(--border);
			padding: 0.75rem 0 0;
		}
	}
</style>
