<!--
	A keyboard-operated list (listbox): the focus stays on the list while j/k or the arrow keys
	(PageUp/PageDown, Home/End) move the selection. A double click or the view's own shortcut (Enter)
	opens a row. Without a selection, moving starts at the first row on screen, so nothing jumps.
	Showing the view (`active` becomes true) puts the focus into the list.
-->
<script lang="ts" generics="T, K extends string">
	import { tick, type Snippet } from 'svelte';
	import { shortcuts } from '../shortcuts.svelte';

	let {
		items,
		key,
		selected = $bindable(),
		element = $bindable(),
		label,
		active,
		group,
		itemName,
		onopen,
		row,
		empty,
	}: {
		items: readonly T[];
		/** Identifies an item (unique within the list) */
		key: (item: T) => K;
		/** The key of the selected item, or null */
		selected: K | null;
		/** The list element, e.g. for shortcuts that only apply while it has the focus */
		element?: HTMLElement;
		label: string;
		/** Whether the list's view is the one shown (its keys only apply then) */
		active: boolean;
		/** Heading in the shortcut help, e.g. 'Transactions' */
		group: string;
		/** What an item is called in the help, e.g. 'transaction' */
		itemName: string;
		onopen: (item: T) => void;
		row: Snippet<[T]>;
		empty: Snippet;
	} = $props();

	const prefix = `option-${Math.random().toString(36).slice(2)}`;
	const selectedIndex = $derived(items.findIndex((item) => key(item) === selected));
	const domId = (k: K) => `${prefix}-${k}`;

	/** Focuses the list without scrolling; after a dialog is gone, since closing one returns the focus */
	export function focus(): void {
		void tick().then(() => element?.focus({ preventScroll: true }));
	}

	// svelte-ignore state_referenced_locally
	let wasActive = active;
	$effect(() => {
		if (active && !wasActive) focus();
		wasActive = active;
	});

	// keep the selection visible
	$effect(() => {
		if (selected !== null) document.getElementById(domId(selected))?.scrollIntoView({ block: 'nearest' });
	});

	/** The index of the first row on screen (below the sticky header); rows are stacked, so a binary search finds it */
	function firstRowOnScreen(): number {
		const rows = element?.querySelectorAll<HTMLElement>('[role="option"]') ?? [];
		const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
		let low = 0;
		let high = rows.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (rows[mid]!.getBoundingClientRect().bottom > top) high = mid;
			else low = mid + 1;
		}
		return low < rows.length ? low : 0;
	}

	function move(by: number) {
		if (items.length === 0) return;
		const index =
			selectedIndex < 0 && Number.isFinite(by) ? firstRowOnScreen() : Math.max(0, Math.min(items.length - 1, (selectedIndex < 0 ? (by > 0 ? -1 : items.length) : selectedIndex) + by));
		selected = key(items[index]!);
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['j', 'ArrowDown'], description: `Next ${itemName}`, group, repeat: true, when: () => active, run: () => move(1) },
			{ keys: ['k', 'ArrowUp'], description: `Previous ${itemName}`, group, repeat: true, when: () => active, run: () => move(-1) },
			{ keys: ['PageDown'], description: `10 ${itemName}s down`, group, repeat: true, when: () => active, run: () => move(10) },
			{ keys: ['PageUp'], description: `10 ${itemName}s up`, group, repeat: true, when: () => active, run: () => move(-10) },
			{ keys: ['Home'], description: `First ${itemName}`, group, when: () => active, run: () => move(-Infinity) },
			{ keys: ['End'], description: `Last ${itemName}`, group, when: () => active, run: () => move(Infinity) },
		]),
	);

	/** The item of the row a mouse event happened in */
	function itemAt(event: MouseEvent): T | undefined {
		const k = (event.target as HTMLElement).closest('[data-key]')?.getAttribute('data-key');
		return k == null ? undefined : items.find((item) => key(item) === k);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (the keys are shortcuts, see the registry) -->
<div
	bind:this={element}
	class="list"
	role="listbox"
	tabindex="0"
	aria-label={label}
	aria-activedescendant={selectedIndex >= 0 && selected !== null ? domId(selected) : undefined}
	onfocus={() => {
		if (selectedIndex < 0) move(1);
	}}
	onclick={(e) => {
		const item = itemAt(e);
		if (item !== undefined) selected = key(item);
	}}
	ondblclick={(e) => {
		const item = itemAt(e);
		if (item !== undefined) onopen(item);
	}}
>
	{#each items as item (key(item))}
		<div id={domId(key(item))} data-key={key(item)} class="option" class:selected={key(item) === selected} role="option" aria-selected={key(item) === selected}>
			{@render row(item)}
		</div>
	{:else}
		{@render empty()}
	{/each}
</div>

<style>
	.list:focus-visible {
		/* the selected row shows the focus instead */
		outline: none;
	}
	.option {
		border-bottom: 1px solid var(--border);
		cursor: default;
		/* lets the browser skip rendering rows far outside the screen */
		content-visibility: auto;
		contain-intrinsic-size: auto 2.6rem;
	}
	.option.selected {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	/* a grey bar: the keys don't go to the list right now */
	.list:not(:focus) .option.selected {
		box-shadow: inset 3px 0 0 var(--control-border);
	}
</style>
