<!--
	Create or edit a recurring transaction's template: what it is (description, category, a fixed
	amount or "ask each time", the account it updates) and when it comes (every N months on days of
	the month, or every N weeks on weekdays, from a start to an optional end). Shows the next
	occurrences, so the schedule can be checked at a glance. Enter saves, Esc cancels.
-->
<script lang="ts">
	import {
		addDays,
		isValidSchedule,
		lastUseOf,
		MAX_YEAR,
		MIN_YEAR,
		NO_CATEGORY,
		occurrences,
		type CashGuardData,
		type Cents,
		type CivilDate,
		type Id,
		type RecurringDraft,
		type Schedule,
		weekday,
	} from '../core';
	import { formatDate, formatEuro } from './display';
	import { describeSchedule, parseMonthDays, WEEKDAYS } from './schedule';
	import AmountInput from './ui/AmountInput.svelte';
	import DateInput from './ui/DateInput.svelte';
	import DescriptionInput from './ui/DescriptionInput.svelte';
	import Modal from './ui/Modal.svelte';

	let {
		data,
		initial,
		handled = null,
		isNew,
		title,
		failure = null,
		onsave,
		onclose,
	}: {
		data: CashGuardData;
		initial: RecurringDraft;
		/** How far an existing template is handled: the preview starts after it */
		handled?: CivilDate | null;
		/** A new template: picking a known description fills in its category and amount */
		isNew: boolean;
		title: string;
		/** Why saving failed, shown in the form */
		failure?: string | null;
		onsave: (draft: RecurringDraft) => void;
		onclose: () => void;
	} = $props();

	// the form keeps its own copy; `initial` only seeds it
	// svelte-ignore state_referenced_locally
	const seed = initial;
	let description = $state(seed.description);
	let categoryId = $state<Id>(seed.categoryId);
	// a blank new template starts with a fixed amount (to be entered, or filled in from the description)
	let ask = $state(seed.amount === null && seed.description !== '');
	let amount = $state<Cents | null>(seed.amount);
	// a template's account that was deleted meanwhile shows as none
	// svelte-ignore state_referenced_locally
	let accountId = $state<Id | ''>(seed.accountId !== null && data.accounts.some((a) => a.id === seed.accountId) ? seed.accountId : '');
	let every = $state(String(seed.schedule.every));
	let unit = $state<Schedule['unit']>(seed.schedule.unit);
	let monthDays = $state(seed.schedule.unit === 'month' ? seed.schedule.days.join(', ') : '1');
	let weekdays = $state<boolean[]>(WEEKDAYS.map((_, i) => seed.schedule.unit === 'week' && seed.schedule.days.includes(i + 1)));
	let start = $state<CivilDate | null>(seed.start);
	let end = $state<CivilDate | null>(seed.end);
	let endInvalid = $state(false);
	let error = $state<string | null>(null);

	const categories = $derived([...data.categories].sort((a, b) => a.name.localeCompare(b.name)));

	/** The schedule as entered, or null while it's incomplete */
	const schedule = $derived.by((): Schedule | null => {
		const n = /^\d{1,3}$/.test(every.trim()) ? Number(every.trim()) : NaN;
		const days = unit === 'month' ? parseMonthDays(monthDays) : weekdays.flatMap((on, i) => (on ? [i + 1] : []));
		const s = days && { unit, every: n, days };
		return s && isValidSchedule(s) ? s : null;
	});

	/** The next few occurrences (after how far it's handled), for the preview */
	const preview = $derived.by(() => {
		if (!schedule || !start || endInvalid) return null;
		let from: CivilDate = start;
		try {
			if (handled !== null && handled >= start) from = addDays(handled, 1);
		} catch {
			return [];
		}
		// (one more than shown, to know whether "…" follows)
		return occurrences({ schedule, start, end }, from, `${MAX_YEAR}-12-31` as CivilDate, 5);
	});

	/** Fill in category and amount from the last time this description was used */
	function prefill(picked: string) {
		if (!isNew) return;
		const last = lastUseOf(data, picked);
		if (!last) return;
		if (categoryId === NO_CATEGORY) categoryId = last.categoryId;
		if (!ask && amount === null) amount = last.amount;
	}

	function save() {
		error = null;
		const fail = (message: string) => void (error = message);
		if (!description.trim()) return fail('Enter a description.');
		if (!ask && amount === null) return fail('Enter the amount, or choose “Ask each time”.');
		if (!/^\d{1,3}$/.test(every.trim()) || Number(every) < 1) return fail('Enter how often: every 1 to 999 months or weeks.');
		if (!schedule) return fail(unit === 'month' ? 'Enter the days of the month, e.g. “1, 15”.' : 'Choose at least one weekday.');
		if (!start) return fail(`Enter a valid start date between ${MIN_YEAR} and ${MAX_YEAR}.`);
		if (endInvalid) return fail('Enter a valid end date, or leave it empty.');
		if (end !== null && end < start) return fail('The end must not be before the start.');
		onsave({
			description: description.trim(),
			categoryId,
			amount: ask ? null : amount,
			// (an account deleted meanwhile means none anyway: kept as it is, so saving changes nothing)
			accountId: accountId !== '' ? accountId : seed.accountId !== null && !data.accounts.some((a) => a.id === seed.accountId) ? seed.accountId : null,
			schedule,
			start,
			end,
		});
	}
</script>

<Modal {title} {onclose}>
	<form
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<div class="fields">
			<label for="rec-description">Description</label>
			<DescriptionInput id="rec-description" bind:value={description} {data} autofocus onpick={prefill} />

			<label for="rec-category">Category</label>
			<select id="rec-category" bind:value={categoryId}>
				<option value={NO_CATEGORY}>No category</option>
				{#each categories as c (c.id)}<option value={c.id}>{c.name || '(unnamed)'}</option>{/each}
			</select>

			<span class="label">Amount</span>
			<div class="amount">
				<label class="check"><input type="checkbox" bind:checked={ask} /> Ask each time</label>
				{#if !ask}<AmountInput id="rec-amount" bind:value={amount} />{/if}
			</div>

			{#if data.accounts.length > 0}
				<label for="rec-account">Account</label>
				<select id="rec-account" bind:value={accountId}>
					<option value="">Don't update a balance</option>
					{#each data.accounts as a (a.id)}<option value={a.id}>{a.name || '(unnamed)'}</option>{/each}
				</select>
			{/if}

			<label for="rec-every">Every</label>
			<div class="every">
				<input id="rec-every" type="text" inputmode="numeric" autocomplete="off" bind:value={every} aria-describedby="rec-schedule" />
				<select
					aria-label="Months or weeks"
					bind:value={unit}
					onchange={() => {
						// weekly: start with the start date's weekday
						if (unit === 'week' && start && !weekdays.some(Boolean)) weekdays[weekday(start) - 1] = true;
					}}
				>
					<option value="month">{every.trim() === '1' ? 'month' : 'months'}</option>
					<option value="week">{every.trim() === '1' ? 'week' : 'weeks'}</option>
				</select>
			</div>

			{#if unit === 'month'}
				<label for="rec-days">On days</label>
				<div class="days">
					<input id="rec-days" type="text" inputmode="decimal" autocomplete="off" bind:value={monthDays} placeholder="e.g. 1, 15" />
					<span class="hint">A day the month doesn't have means its last day.</span>
				</div>
			{:else}
				<span class="label">On</span>
				<div class="weekdays" role="group" aria-label="Weekdays">
					{#each WEEKDAYS as day, i (day)}
						<label class="check"><input type="checkbox" bind:checked={weekdays[i]} /> {day}</label>
					{/each}
				</div>
			{/if}

			<label for="rec-start">Starts</label>
			<DateInput id="rec-start" bind:value={start} />

			<label for="rec-end">Ends</label>
			<div class="days">
				<DateInput id="rec-end" bind:value={end} bind:invalid={endInvalid} />
				<span class="hint">Leave it empty for no end.</span>
			</div>
		</div>

		<p class="preview" id="rec-schedule" aria-live="polite">
			{#if schedule}
				{describeSchedule(schedule)}{ask ? ', the amount asked each time' : amount !== null ? `, ${formatEuro(amount)}` : ''}.
				{#if preview}
					{preview.length > 0 ? `Next: ${preview.slice(0, 4).map(formatDate).join(', ')}${preview.length > 4 ? ', …' : ''}` : 'No more occurrences.'}
				{/if}
			{:else}
				&nbsp;
			{/if}
		</p>

		{#if error ?? failure}<p class="error" role="alert">{error ?? failure}</p>{/if}

		<div class="buttons">
			<button type="button" onclick={onclose}>Cancel</button>
			<button type="submit" class="primary" title="Enter">Save</button>
		</div>
	</form>
</Modal>

<style>
	.fields {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.75rem 1rem;
		align-items: center;
	}
	label,
	.label {
		color: var(--muted);
	}
	label.check {
		color: var(--text);
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
	}
	.check input {
		min-height: 0;
		margin: 0;
	}
	.amount,
	.days {
		display: grid;
		gap: 0.35rem;
	}
	.every {
		display: flex;
		gap: 0.5rem;
	}
	.every input {
		width: 5rem;
	}
	.weekdays {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.9rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.preview {
		margin: 1rem 0 0;
		padding: 0.6rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--accent-soft);
		font-size: 0.9rem;
	}
	.error {
		color: var(--negative);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
	@media (max-width: 40rem) {
		.fields {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.25rem;
		}
		label:not(.check),
		.label {
			margin-top: 0.5rem;
		}
	}
</style>
