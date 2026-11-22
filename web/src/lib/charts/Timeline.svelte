<!--
	Income (up) and expenses (down) per month for what the filter selects, apart from its period, in
	light colors, with the month's net as a narrow solid bar in front and the running balance of all
	transactions as a line on top (both can be switched off). The current month also shows, dashed,
	where it's heading: what it has so far plus what usually comes in the rest of a month. Or, "by category": the expenses (or
	income) of the largest categories stacked per month, clicking one filters by it. The filter's
	period is highlighted; clicking a month sets it (Shift+click extends it). Made for the mouse and touch: the same period
	can be set with the keyboard in the filter dialog. Shows the last 24 months (12 on phones) at
	first; the wheel, pinching or the slider zoom.
-->
<script lang="ts">
	import { touchFirst } from '../pointer';
	import type { EChartsType } from 'echarts/core';
	import { untrack } from 'svelte';
	import {
		chartPeriod,
		monthlyByCategory,
		monthlyTotals,
		monthOf,
		monthsBetween,
		ofSide,
		projection,
		projectionBasis,
		totalsByCategory,
		type Cents,
		type CivilDate,
		type Id,
		type Side,
		type Transaction,
	} from '../../core';
	import { categoryColor, categoryLabel, describePeriod, formatDate, formatEuro, formatMonth, plural } from '../display';
	import Segmented from '../ui/Segmented.svelte';
	import { clock } from '../clock.svelte';
	import { filter } from '../filter.svelte';
	import type { Workspace } from '../workspace.svelte';
	import Chart from './Chart.svelte';
	import { theme } from './theme.svelte';

	let {
		workspace,
		matching,
		side,
	}: {
		workspace: Workspace;
		/** What the filter selects apart from its period (the chart shows all months for context) */
		matching: readonly Transaction[];
		side: Side;
	} = $props();

	let view = $state<'totals' | 'categories'>('totals');
	const VIEWS = [
		{ value: 'totals', label: 'Income & expenses' },
		{ value: 'categories', label: 'By category' },
	] as const;
	/** How many categories get their own color; the rest are "Other" */
	const TOP_CATEGORIES = 8;

	const all = $derived(workspace.data.transactions);
	const range = $derived(chartPeriod(all, clock.today));
	const months = $derived(range.period ? monthsBetween(range.period.from, range.period.to) : []);

	const totals = $derived(monthlyTotals(matching, all, months));

	/** The current month, if it's in the chart and not over: its index and how to project it */
	const current = $derived.by(() => {
		const index = months.indexOf(monthOf(clock.today).from);
		const basis = projectionBasis(monthOf(clock.today), clock.today, range.oldest);
		return index >= 0 && basis !== null ? { index, basis } : null;
	});
	/** The current month's totals projected to its end, as far as there is something to project */
	const estimate = $derived.by(() => {
		const t = current && totals[current.index];
		if (!current || !t) return null;
		const project = projection(current.basis, matching, (t) => (t.amount > 0 ? 'income' : 'expense'));
		const income = project('income', t.income);
		const expenses = project('expense', t.expenses);
		// (nothing more expected: nothing to show)
		return income === null || expenses === null || (income === t.income && expenses === t.expenses) ? null : { index: current.index, income, expenses };
	});
	/** Only the current month's value, the rest empty: for the dashed "still to come" bars */
	const onlyCurrent = (value: number) => months.map((_, i) => (i === current?.index && value !== 0 ? value : null));

	// by category: the side's transactions of the largest categories, as positive amounts
	const stacks = $derived.by(() => {
		if (view !== 'categories') return null;
		const sided = ofSide(matching, side);
		const all = totalsByCategory(sided);
		const top = all.slice(0, TOP_CATEGORIES).map((s) => s.key);
		const { byCategory, other } = monthlyByCategory(sided, months, top);
		const names = new Map(workspace.data.categories.map((c) => [c.id, c]));
		return {
			/** Whether there are more categories than shown on their own */
			more: all.length > TOP_CATEGORIES,
			series: top.map((id) => ({
				id,
				name: categoryLabel(id, names.get(id)),
				color: categoryColor(names.get(id)),
				values: byCategory.get(id)!.map((v) => Math.abs(v)),
			})),
			other: other.map((v) => Math.abs(v)),
			/** The side's total of the current month projected to its end */
			estimate: (() => {
				if (!estimate) return null;
				const key = side === 'expense' ? 'expenses' : 'income';
				const sum = Math.abs(totals[estimate.index]![key]);
				const value = Math.abs(estimate[key]);
				return value === sum ? null : { index: estimate.index, sum, value };
			})(),
		};
	});
	const labels = $derived(months.map((month) => formatMonth(month, { year: '2-digit' })));


	// the highlighted months: the filter's period, as far as it overlaps the chart
	const selection = $derived.by(() => {
		const { from, to } = filter.current;
		const first = months[0];
		const last = months.at(-1);
		if (!first || !last || (from === null && to === null)) return null;
		if ((from && from > monthOf(last).to) || (to && to < first)) return null;
		return {
			start: from && from > first ? months.indexOf(monthOf(from).from) : 0,
			end: to && to < last ? months.indexOf(monthOf(to).from) : months.length - 1,
		};
	});

	/** Selects a month; `extend`: grows the selected period up to it instead */
	function select(index: number, extend: boolean) {
		const i = Math.max(0, Math.min(months.length - 1, index));
		const [start, end] = extend && selection ? [Math.min(selection.start, i), Math.max(selection.end, i)] : [i, i];
		filter.set({ from: months[start]!, to: monthOf(months[end]!).to });
	}

	let showNet = $state(true);
	let showBalance = $state(true);

	/** The shown months (indices); null: the last 24 (12 on phones) */
	let zoom = $state<{ start: number; end: number } | null>(null);
	const initialMonths = matchMedia('(max-width: 40rem)').matches ? 12 : 24;
	const shown = $derived.by(() => {
		const last = months.length - 1;
		if (!zoom) return { start: Math.max(0, last - initialMonths + 1), end: last };
		const start = Math.max(0, Math.min(zoom.start, last));
		return { start, end: Math.max(start, Math.min(zoom.end, last)) };
	});

	// a period chosen elsewhere (e.g. a preset) that isn't in view: move the view there, keeping its
	// width (only on selection changes, so panning and zooming away stay possible)
	$effect(() => {
		if (!selection) return;
		const { start, end } = untrack(() => shown);
		if (selection.end < start || selection.start > end) {
			const width = end - start;
			const from = Math.max(0, Math.min(months.length - 1 - width, selection.end - width));
			zoom = { start: from, end: from + width };
		}
	});

	function onready(instance: EChartsType) {
		// remember zooming with the wheel or the slider, so updates keep it
		instance.on('datazoom', () => {
			const [zoomed] = (instance.getOption() as { dataZoom?: { startValue?: number; endValue?: number }[] }).dataZoom ?? [];
			if (zoomed?.startValue !== undefined && zoomed.endValue !== undefined) zoom = { start: zoomed.startValue, end: zoomed.endValue };
		});
		// a click anywhere in a month's column selects it, not just on its bars
		instance.getZr().on('click', (event) => {
			// by category, a click on a bar filters by its category (below) instead
			if (view === 'categories' && event.target) return;
			const point = [event.offsetX, event.offsetY];
			if (!instance.containPixel({ gridIndex: 0 }, point)) return;
			const [index] = instance.convertFromPixel({ gridIndex: 0 }, point) as unknown as number[];
			if (index !== undefined) select(Math.round(index), (event.event as MouseEvent | undefined)?.shiftKey ?? false);
		});
		instance.on('click', (params) => {
			if (view !== 'categories') return;
			const { seriesId, dataIndex, event } = params as { seriesId?: string; dataIndex: number; event?: { event?: MouseEvent } };
			if (seriesId?.startsWith('category-')) filter.set({ categories: [seriesId.slice('category-'.length) as Id] });
			// "Other" is no single category: the month, as a click next to the bars
			else select(dataIndex, event?.event?.shiftKey ?? false);
		});
	}

	const euros = (cents: number) => cents / 100; // display only
	/** What a custom series' `renderItem` gets to work with (the part used here) */
	type CustomApi = { value: (dimension: number) => number; coord: (point: number[]) => [number, number]; size: (size: number[]) => [number, number] };
	const axisEuros = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
	/** The rest of a month's projection: an outline with a dashed border */
	const dashed = (color: string) => ({ color: 'transparent', borderColor: color, borderWidth: 1.5, borderType: 'dashed' as const });

	const option = $derived.by(() => {
		const c = theme.colors;
		const axis = { axisLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border } } };
		// the filter's period
		const highlight = { silent: true, itemStyle: { color: c['accent-soft'] }, data: selection ? [[{ xAxis: labels[selection.start] }, { xAxis: labels[selection.end] }]] : [] };
		return {
			animation: false,
			grid: { left: 8, right: 8, top: 16, bottom: 56 },
			dataZoom: [
				{ type: 'inside', startValue: shown.start, endValue: shown.end, minValueSpan: 1 },
				{
					type: 'slider',
					startValue: shown.start,
					endValue: shown.end,
					minValueSpan: 1,
					height: 20,
					bottom: 8,
					borderColor: c.border,
					fillerColor: c['accent-soft'],
					handleStyle: { color: c.surface, borderColor: c.muted },
					moveHandleStyle: { color: c.border },
					textStyle: { color: c.muted },
					dataBackground: { lineStyle: { color: c.border }, areaStyle: { color: c.border } },
					brushSelect: false,
				},
			],
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				backgroundColor: c.surface,
				borderColor: c.border,
				textStyle: { color: c.text },
				formatter: (params: { dataIndex: number }[]) => {
					const i = params[0]?.dataIndex ?? -1;
					const t = totals[i];
					if (!t) return '';
					return stacks ? categoryTooltip(t.month, i) : tooltipHtml(t.month, t.income, t.expenses, t.balance, i);
				},
			},
			xAxis: { type: 'category', data: labels, ...axis, splitLine: { show: false }, axisTick: { show: false } },
			yAxis: [
				{ type: 'value', ...axis, axisLabel: { color: c.muted, formatter: (v: number) => axisEuros.format(v) } },
				{ type: 'value', show: !stacks && showBalance, ...axis, splitLine: { show: false }, axisLabel: { color: c.accent, formatter: (v: number) => axisEuros.format(v) } },
			],
			series: stacks
				? [
						...stacks.series.map((category, i) => ({
							id: `category-${category.id}`,
							name: category.name,
							type: 'bar',
							stack: 'category',
							data: category.values.map(euros),
							itemStyle: { color: category.color },
							...(i === 0 && { markArea: highlight }),
						})),
						{ id: 'other', name: 'Other', type: 'bar', stack: 'category', data: stacks.other.map(euros), itemStyle: { color: c.border }, ...(stacks.series.length === 0 && { markArea: highlight }) },
						{
							id: 'projected',
							name: 'Projected',
							type: 'bar',
							stack: 'category',
							silent: true,
							data: stacks.estimate ? onlyCurrent(euros(stacks.estimate.value - stacks.estimate.sum)) : [],
							itemStyle: dashed(c.muted),
						},
					]
				: [
				{
					name: 'Income',
					type: 'bar',
					stack: 'month',
					data: totals.map((t) => euros(t.income)),
					itemStyle: { color: c.positive, opacity: showNet ? 0.35 : 1 },
					markArea: highlight,
				},
				{
					name: 'Expenses',
					type: 'bar',
					stack: 'month',
					data: totals.map((t) => euros(t.expenses)),
					itemStyle: { color: c.negative, opacity: showNet ? 0.35 : 1 },
				},
				{
					// what the current month is heading for, on top of what it has so far
					name: 'Income projected',
					type: 'bar',
					stack: 'month',
					silent: true,
					data: estimate ? onlyCurrent(euros(estimate.income - totals[estimate.index]!.income)) : [],
					itemStyle: dashed(c.positive),
				},
				{
					name: 'Expenses projected',
					type: 'bar',
					stack: 'month',
					silent: true,
					data: estimate ? onlyCurrent(euros(estimate.expenses - totals[estimate.index]!.expenses)) : [],
					itemStyle: dashed(c.negative),
				},
				{
					// the net: a narrow bar centered on the month, in front of income and expenses
					name: 'Net',
					type: 'custom',
					z: 3,
					data: showNet ? totals.map((t, i) => [i, euros(t.income + t.expenses)]) : [],
					renderItem: (_: unknown, api: CustomApi) => {
						const [x, y0] = api.coord([api.value(0), 0]);
						const [, y1] = api.coord([api.value(0), api.value(1)]);
						const width = Math.max(3, api.size([1, 0])[0] * 0.3);
						return {
							type: 'rect',
							shape: { x: x - width / 2, y: Math.min(y0, y1), width, height: Math.abs(y1 - y0) },
							style: { fill: api.value(1) >= 0 ? c.positive : c.negative },
						};
					},
				},
				{
					// a wider line in the background color under the balance: an outline that keeps it
					// visible where it crosses bars
					name: 'Balance outline',
					type: 'line',
					yAxisIndex: 1,
					z: 4,
					silent: true,
					data: showBalance ? totals.map((t) => euros(t.balance)) : [],
					symbol: 'none',
					lineStyle: { color: c.surface, width: 7 },
				},
				{
					name: 'Balance',
					type: 'line',
					yAxisIndex: 1,
					z: 5,
					data: showBalance ? totals.map((t) => euros(t.balance)) : [],
					symbol: 'none',
					lineStyle: { color: c.accent, width: 3 },
					itemStyle: { color: c.accent },
				},
				],
		};
	});

	const tooltipRow = (label: string, value: number, color?: string) =>
		`<div style="display:flex;justify-content:space-between;gap:1rem"><span>${color ? `<span style="display:inline-block;width:0.6rem;height:0.6rem;border-radius:50%;margin-right:0.35rem;background:${color}"></span>` : ''}${escapeHtml(label)}</span><b>${formatEuro(value as Cents)}</b></div>`;
	const tooltipTitle = (month: CivilDate) => `<div style="font-weight:600;margin-bottom:0.25rem">${describePeriod(month, monthOf(month).to)}</div>`;

	/** The month's end projected (see `estimate`) under a heading, for the tooltip */
	const tooltipEstimate = (rows: string) =>
		`<div style="margin-top:0.4rem;padding-top:0.3rem;border-top:1px dashed ${theme.colors.border};color:${theme.colors.muted}">Expected by the month's end</div>${rows}`;

	function tooltipHtml(month: CivilDate, income: number, expenses: number, balance: number, i: number): string {
		const rest =
			estimate?.index === i
				? tooltipEstimate(`${tooltipRow('Income', estimate.income)}${tooltipRow('Expenses', estimate.expenses)}${tooltipRow('Net', estimate.income + estimate.expenses)}`)
				: '';
		return `${tooltipTitle(month)}${tooltipRow('Income', income)}${tooltipRow('Expenses', expenses)}${tooltipRow('Net', income + expenses)}${tooltipRow('Balance', balance)}${rest}`;
	}

	/** The month's categories, largest first (without the empty ones) */
	function categoryTooltip(month: CivilDate, i: number): string {
		if (!stacks) return '';
		const rows = [...stacks.series.map((s) => ({ name: s.name, color: s.color, value: s.values[i]! })), { name: 'Other', color: theme.colors.border, value: stacks.other[i]! }]
			.filter((r) => r.value !== 0)
			.sort((a, b) => b.value - a.value);
		const sum = rows.reduce((total, r) => total + r.value, 0);
		const name = side === 'expense' ? 'Expenses' : 'Income';
		const rest = stacks.estimate?.index === i ? tooltipEstimate(tooltipRow(name, stacks.estimate.value)) : '';
		return `${tooltipTitle(month)}${rows.map((r) => tooltipRow(r.name, r.value, r.color)).join('')}${tooltipRow(name, sum)}${rest}`;
	}

	/** Category names are the user's text: shown as text, not as markup */
	const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

</script>

<div class="layers">
	<Segmented bind:value={view} options={VIEWS} label="Chart" />
	{#if view === 'totals'}
		<label><input type="checkbox" bind:checked={showNet} /> <span class="swatch net"></span>Net</label>
		<label><input type="checkbox" bind:checked={showBalance} /> <span class="swatch balance"></span>Balance</label>
	{:else}
		<span class="legend">
			{side === 'expense' ? 'Expenses' : 'Income'}
			{stacks?.more ? `of the ${TOP_CATEGORIES} largest categories` : 'by category'}{filter.current.categories.length === 1 ? '' : `; ${touchFirst ? 'tap' : 'click'} one to show only it`}
		</span>
	{/if}
</div>
<!-- the numbers are in the tooltip and in the totals below; the chart itself is for looking at -->
<div aria-hidden="true">
	<Chart {option} {onready} />
</div>
<p class="hint">
	{touchFirst ? 'Tap a month to show it. Pinch or use the slider to zoom.' : 'Click a month to show it, Shift+click for several. Zoom with the wheel or the slider.'}{current && (stacks ? stacks.estimate : estimate) ? ' Dashed: where this month is heading.' : ''}
</p>
{#if range.outside.length > 0}
	<p class="outside" role="note">
		Not in the chart, the {plural(range.outside.length, 'date seems', 'dates seem')} mistyped:
		{range.outside
			.slice(0, 3)
			.map((t) => `${formatDate(t.date)} “${t.description || 'no description'}”`)
			.join(', ')}{range.outside.length > 3 ? ', …' : ''}
	</p>
{/if}

<style>
	.layers {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem 1rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.layers > :global(:first-child) {
		margin-right: auto;
	}
	.legend {
		font-size: 0.85rem;
	}
	.layers label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		cursor: pointer;
	}
	.layers input {
		min-height: 0;
		margin: 0;
	}
	.swatch {
		display: inline-block;
		width: 0.9rem;
	}
	.swatch.net {
		height: 0.7rem;
		background: linear-gradient(to right, var(--positive) 50%, var(--negative) 50%);
	}
	.swatch.balance {
		height: 3px;
		background: var(--accent);
	}
	.hint,
	.outside {
		margin: 0.5rem 0 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.outside {
		color: var(--warning);
	}
</style>
