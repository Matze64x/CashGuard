<!--
	Choosing a category (a combobox): the field shows the chosen one with its color. Typing filters
	the list (names containing the text, those starting with it first); ↓/↑ move through it, Enter
	or Tab take the highlighted one, Esc closes it and keeps the choice. A click or tap on the field
	opens the whole list. Leaving the field without taking one keeps the choice.
-->
<script lang="ts">
	import { NO_CATEGORY, type Category, type Id } from '../../core';
	import { categoryColor, categoryLabel } from '../display';

	let {
		value = $bindable(),
		categories,
		id,
		label = 'Category',
	}: {
		value: Id;
		/** In the order to list them */
		categories: readonly Category[];
		id?: string;
		label?: string;
	} = $props();

	interface Option {
		readonly id: Id;
		readonly name: string;
		readonly color: string;
	}

	const uid = $props.id();
	const listId = `category-list-${uid}`;
	const byId = $derived(new Map(categories.map((c) => [c.id, c])));
	const options = $derived<Option[]>([
		{ id: NO_CATEGORY, name: categoryLabel(NO_CATEGORY, undefined), color: categoryColor(undefined) },
		...categories.map((c) => ({ id: c.id, name: categoryLabel(c.id, c), color: categoryColor(c) })),
	]);

	/** What's typed (null: nothing, the field shows the chosen category) */
	let query = $state<string | null>(null);
	let open = $state(false);
	let active = $state(-1);

	const matches = $derived.by(() => {
		const q = query?.trim().toLocaleLowerCase() ?? '';
		if (!q) return options;
		const hits = options.filter((o) => o.name.toLocaleLowerCase().includes(q));
		return [...hits.filter((o) => o.name.toLocaleLowerCase().startsWith(q)), ...hits.filter((o) => !o.name.toLocaleLowerCase().startsWith(q))];
	});
	const chosen = $derived<Option>({ id: value, name: categoryLabel(value, byId.get(value)), color: categoryColor(byId.get(value)) });
	/** The dot: the highlighted category while choosing, else the chosen one */
	const shown = $derived(open && matches[active] ? matches[active]! : chosen);

	function openList() {
		open = true;
		active = Math.max(0, matches.findIndex((o) => o.id === value));
	}

	function close() {
		open = false;
		query = null;
		active = -1;
	}

	function take(option: Option) {
		value = option.id;
		close();
	}

	function onkeydown(event: KeyboardEvent) {
		const count = matches.length;
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			if (!open) return openList();
			if (count > 0) active = event.key === 'ArrowDown' ? (active + 1) % count : active <= 0 ? count - 1 : active - 1;
		} else if (event.key === 'Enter' && open && matches[active]) {
			// (takes the category; doesn't save the form)
			event.preventDefault();
			take(matches[active]!);
		} else if (event.key === 'Tab' && open && query !== null && matches[active]) {
			take(matches[active]!);
		} else if (event.key === 'Escape' && open) {
			// close the list, not the dialog
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}

	/**
	 * Where the list goes: right under the field (or above it, if there's more room there), placed
	 * on the screen rather than in the dialog, so the dialog's edge doesn't cut it off.
	 */
	let field = $state<HTMLInputElement>();
	let place = $state({ left: 0, top: 0, width: 0, maxHeight: 0, above: false });
	function measure() {
		if (!field) return;
		const r = field.getBoundingClientRect();
		const below = innerHeight - r.bottom - 8;
		const aboveRoom = r.top - 8;
		const above = below < 160 && aboveRoom > below;
		// at least wide enough for longer names (a split part's field is narrow), and on the screen
		const width = Math.min(Math.max(r.width, 240), innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, innerWidth - width - 8));
		place = { left, top: above ? r.top - 3 : r.bottom + 3, width, maxHeight: Math.min(256, above ? aboveRoom : below), above };
	}
	$effect(() => {
		if (!open) return;
		measure();
		// (the dialog or the page scrolled, or the window changed: follow the field)
		addEventListener('scroll', measure, true);
		addEventListener('resize', measure);
		return () => {
			removeEventListener('scroll', measure, true);
			removeEventListener('resize', measure);
		};
	});

	// keeps the highlighted option in view
	let list = $state<HTMLElement>();
	$effect(() => {
		if (open && active >= 0) list?.children[active]?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="picker">
	<span class="dot" style:background={shown.color} aria-hidden="true"></span>
	<input
		bind:this={field}
		id={id ?? `category-${uid}`}
		type="text"
		autocomplete="off"
		spellcheck="false"
		aria-label={label}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
		value={query ?? chosen.name}
		onfocus={(e) => e.currentTarget.select()}
		onclick={(e) => {
			// (a tap on a phone puts the caret at the end instead of keeping the text selected)
			if (query === null) e.currentTarget.setSelectionRange(0, e.currentTarget.value.length);
			if (!open) openList();
		}}
		oninput={(e) => {
			const text = e.currentTarget.value;
			// typing replaces the shown name, also where the browser didn't keep it selected
			query = query === null && text.startsWith(chosen.name) ? text.slice(chosen.name.length) : text;
			if (query !== text) e.currentTarget.value = query;
			open = true;
			active = matches.length > 0 ? 0 : -1;
		}}
		{onkeydown}
		onblur={close}
	/>
	<span class="chevron" aria-hidden="true">▾</span>
	{#if open}
		<ul
			bind:this={list}
			id={listId}
			role="listbox"
			aria-label="Categories"
			class:above={place.above}
			style:left={`${place.left}px`}
			style:top={`${place.top}px`}
			style:width={`${place.width}px`}
			style:max-height={`${place.maxHeight}px`}
		>
			{#each matches as option, i (option.id)}
				<li
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onpointerdown={(e) => {
						// keep the focus in the field
						e.preventDefault();
						take(option);
					}}
				>
					<span class="dot" style:background={option.color}></span>{option.name}
				</li>
			{:else}
				<li class="none">No category like that</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}
	input {
		width: 100%;
		padding-left: 2rem;
		padding-right: 1.75rem;
		text-overflow: ellipsis;
	}
	.dot {
		display: inline-block;
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
	}
	.picker > .dot {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	.chevron {
		position: absolute;
		right: 0.7rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--muted);
		pointer-events: none;
	}
	ul {
		position: fixed;
		z-index: 2;
		margin: 0;
		padding: 0.25rem 0;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--control-border);
		border-radius: 0.5rem;
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.15);
		overflow: auto;
	}
	ul.above {
		transform: translateY(-100%);
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
	}
	li.active {
		background: var(--accent-soft);
	}
	@media (hover: hover) {
		li:hover {
			background: var(--accent-soft);
		}
	}
	li.none {
		color: var(--muted);
		cursor: default;
		background: none;
	}
</style>
