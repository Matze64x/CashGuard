<!--
	A modal dialog: traps the focus, closes on Escape, and returns the focus where it was when it
	closes. While it's open, only shortcuts marked `inDialog` apply.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { shortcuts } from '../shortcuts.svelte';

	let {
		title,
		onclose,
		wide = false,
		children,
	}: { title: string; onclose: () => void; wide?: boolean; children: Snippet } = $props();

	let dialog: HTMLDialogElement;
	const id = `dialog-${Math.random().toString(36).slice(2)}`;

	// closing because the component goes away (e.g. replaced by the next dialog) isn't the user
	// closing it, so `onclose` must not fire then
	let unmounting = false;
	$effect(() => {
		const closeScope = shortcuts.openDialog();
		dialog.showModal();
		return () => {
			unmounting = true;
			closeScope();
			dialog.close();
		};
	});
</script>

<dialog
	bind:this={dialog}
	class:wide
	aria-labelledby={id}
	onclose={() => {
		if (!unmounting) onclose();
	}}
>
	<h2 {id}>{title}</h2>
	{@render children()}
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--surface);
		color: var(--text);
		padding: 1.25rem;
		overflow: auto;
	}
	dialog.wide {
		width: min(52rem, calc(100vw - 2rem));
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	h2 {
		margin: 0 0 1rem;
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
	/* phones: full screen, like a native sheet */
	@media (max-width: 40rem) {
		dialog,
		dialog.wide {
			width: 100vw;
			max-width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			margin: 0;
			border: none;
			border-radius: 0;
			padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom))
				max(1rem, env(safe-area-inset-left));
		}
	}
</style>
