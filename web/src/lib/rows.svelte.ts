/**
 * What the breakdown and the comparison share: a row per category, or per description within one
 * category, that filters by its category or searches for its description.
 */
import { categoryColor, categoryLabel } from './display';
import { filter } from './filter.svelte';
import type { Category, Id } from '../core';

export interface RowTarget {
	label: string;
	color?: string;
	/** What clicking the row does (shown as its title) */
	title?: string;
	/** null: nothing to choose (an empty description can't be searched for) */
	choose: (() => void) | null;
}

/** The row of a category, or of a description (`byDescription`) */
export function rowTarget(key: string, byDescription: boolean, categories: ReadonlyMap<Id, Category>): RowTarget {
	if (byDescription)
		return key
			? { label: key, title: `Search for “${key}”`, choose: () => filter.set({ text: key }) }
			: { label: '(no description)', choose: null };
	const id = key as Id;
	return { label: categoryLabel(id, categories.get(id)), color: categoryColor(categories.get(id)), title: 'Show only this category', choose: () => filter.set({ categories: [id] }) };
}
