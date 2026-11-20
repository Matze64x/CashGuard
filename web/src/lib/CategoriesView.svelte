<!-- Categories: add, rename, recolor, delete (only unused ones). Same keys as the transaction list. -->
<script lang="ts">
	import { addCategory, categoryUsage, deleteCategory, updateCategory, type Category, type Id } from '../core';
	import { attempt } from './attempt';
	import { plural } from './display';
	import { CATEGORY_COLORS } from './palette';
	import { shortcuts } from './shortcuts.svelte';
	import ColorPicker from './ui/ColorPicker.svelte';
	import Modal from './ui/Modal.svelte';
	import SelectableList from './ui/SelectableList.svelte';
	import type { Workspace } from './workspace.svelte';

	let { workspace, active, notify }: { workspace: Workspace; active: boolean; notify: (text: string, undo?: boolean) => void } = $props();

	const categories = $derived([...workspace.data.categories].sort((a, b) => a.name.localeCompare(b.name)));
	const usage = $derived(categoryUsage(workspace.data));

	let selectedId = $state<Id | null>(null);
	const selectedIndex = $derived(categories.findIndex((c) => c.id === selectedId));
	const selected = $derived(categories[selectedIndex]);
	let editing = $state<{ id: Id | null; name: string; color: string } | null>(null);
	let saving = false;
	let list: SelectableList<Category, Id>;
	let listElement = $state<HTMLElement>();

	function openNew() {
		// a color that isn't used yet, if there is one
		const used = new Set(workspace.data.categories.map((c) => c.color));
		const color = CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[0]!;
		editing = { id: null, name: '', color };
	}

	function openEdit(c: Category | undefined) {
		if (c) editing = { id: c.id, name: c.name, color: c.color };
	}

	function close() {
		editing = null;
		list.focus();
	}

	async function save() {
		const target = editing;
		if (!target || saving) return;
		const name = target.name.trim();
		if (!name) return notify('Enter a name for the category.');
		saving = true;
		const saved = await attempt(notify, async () => {
			if (target.id === null) {
				let created: Id | null = null;
				await workspace.edit(`Add category “${name}”`, (d) => {
					const result = addCategory(d, name, target.color);
					created = result.id;
					return result.data;
				});
				selectedId = created;
			} else {
				const id = target.id;
				await workspace.edit(`Edit category “${name}”`, (d) => updateCategory(d, id, { name, color: target.color }));
			}
		});
		saving = false;
		if (saved) close();
	}

	async function remove(c: Category | undefined) {
		if (!c) return;
		const used = usage.get(c.id) ?? 0;
		if (used > 0) return notify(`“${c.name}” is used by ${plural(used, 'transaction')}, so it can't be deleted.`);
		const next = categories[selectedIndex + 1] ?? categories[selectedIndex - 1];
		if (await attempt(notify, () => workspace.edit(`Delete category “${c.name}”`, (d) => deleteCategory(d, c.id)))) {
			selectedId = next?.id ?? null;
			notify(`Deleted category “${c.name}”.`, true);
		}
	}

	$effect(() =>
		shortcuts.add([
			{ keys: ['n'], description: 'New category', group: 'Categories', when: () => active, run: openNew },
			// these act on the selection, so only while the list (not a button elsewhere) has the focus
			...[
				{ keys: ['Enter', 'e'], description: 'Edit the selected category', run: () => openEdit(selected) },
				{ keys: ['Delete', 'Backspace'], description: 'Delete the selected category (if unused)', run: () => void remove(selected) },
			].map((s) => ({ ...s, group: 'Categories', focusIn: () => listElement, visible: () => active, when: () => active && !!selected })),
		]),
	);
</script>

<div class="toolbar">
	<h2>Categories</h2>
	<button class="primary" onclick={openNew} title="n">New</button>
</div>

<SelectableList
	bind:this={list}
	bind:selected={selectedId}
	bind:element={listElement}
	items={categories}
	key={(c) => c.id}
	label="Categories"
	{active}
	group="Categories"
	itemName="category"
	onopen={openEdit}
>
	{#snippet row(c)}
		<div class="row">
			<span class="dot" style:background={c.color}></span>
			<span class="name">{c.name || '(unnamed)'}</span>
			<span class="usage">{usage.get(c.id) ? plural(usage.get(c.id)!, 'transaction') : 'unused'}</span>
		</div>
	{/snippet}
	{#snippet empty()}
		<p class="empty">No categories yet. Press <kbd>n</kbd> to add one.</p>
	{/snippet}
</SelectableList>

{#if editing}
	<Modal title={editing.id === null ? 'New category' : 'Edit category'} onclose={close}>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label for="category-name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="category-name" type="text" autocomplete="off" bind:value={editing.name} autofocus required />
			<ColorPicker bind:value={editing.color} />
			<div class="buttons">
				<button type="button" onclick={close}>Cancel</button>
				<button type="submit" class="primary">Save</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 0.75rem 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
	}
	.dot {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		flex: none;
	}
	.name {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.usage {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.empty {
		color: var(--muted);
		text-align: center;
		padding: 3rem 1rem;
	}
	form {
		display: grid;
		gap: 0.75rem;
	}
	label {
		color: var(--muted);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
