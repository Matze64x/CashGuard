<!--
	Income (up) and expenses (down) per month for what the filter selects, apart from its period, in
	light colors, with the month's net as a narrow solid bar in front and the running balance of all
	transactions as a line on top (both can be switched off). The filter's period is highlighted;
	clicking a month sets it (Shift+click extends it). Made for the mouse and touch: the same period
	can be set with the keyboard in the filter dialog. Shows the last 24 months (12 on phones) at
	first; the wheel, pinching or the slider zoom.
-->
<script lang="ts">
	import type { EChartsType } from 'echarts/core';
	import { untrack } from 'svelte';
	import { applyFilter, chartPeriod, monthlyTotals, monthOf, monthsBetween, today, type CivilDate, type Filter, type Transaction } from '../../core';
	import { describePeriod, formatDate, formatEuro, plural } from '../display';
	import { filter } from '../filter.svelte';
	import type { Workspace } from '../workspace.svelte';
	import Chart from './Chart.svelte';
	import { theme } from './theme.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	const all = $derived(workspace.data.transactions);
	const range = $derived(chartPeriod(all, today()));
	const months = $derived(range.period ? monthsBetween(range.period.from, range.period.to) : []);

	// everything the filter selects except its period (the chart shows all months for context);
	// kept while only the period changes, which is what clicking the chart does
	let cached: { key: string; all: readonly Transaction[]; matching: readonly Transaction[] } | null = null;
	const matching = $derived.by(() => {
		const rest: Filter = { ...filter.current, from: null, to: null };
		const key = JSON.stringify(rest);
		if (cached?.key !== key || cached.all !== all) cached = { key, all, matching: applyFilter(all, workspace.data.categories, rest).transactions };
		return cached.matching;
	});
	const totals = $derived(monthlyTotals(matching, all, months));
	const labels = $derived(months.map(monthLabel));

	function monthLabel(month: CivilDate): string {
		const [year, m] = month.split('-').map(Number) as [number, number];
		// en-US: "Sep 24" (en-GB writes "Sept 24")
		return new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
	}

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
			const point = [event.offsetX, event.offsetY];
			if (!instance.containPixel({ gridIndex: 0 }, point)) return;
			const [index] = instance.convertFromPixel({ gridIndex: 0 }, point) as unknown as number[];
			if (index !== undefined) select(Math.round(index), (event.event as MouseEvent | undefined)?.shiftKey ?? false);
		});
	}

	const euros = (cents: number) => cents / 100; // display only
	/** What a custom series' `renderItem` gets to work with (the part used here) */
	type CustomApi = { value: (dimension: number) => number; coord: (point: number[]) => [number, number]; size: (size: number[]) => [number, number] };
	const axisEuros = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

	const option = $derived.by(() => {
		const c = theme.colors;
		const axis = { axisLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border } } };
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
					const t = totals[params[0]?.dataIndex ?? -1];
					return t ? tooltipHtml(t.month, t.income, t.expenses, t.balance) : '';
				},
			},
			xAxis: { type: 'category', data: labels, ...axis, splitLine: { show: false }, axisTick: { show: false } },
			yAxis: [
				{ type: 'value', ...axis, axisLabel: { color: c.muted, formatter: (v: number) => axisEuros.format(v) } },
				{ type: 'value', show: showBalance, ...axis, splitLine: { show: false }, axisLabel: { color: c.accent, formatter: (v: number) => axisEuros.format(v) } },
			],
			series: [
				{
					name: 'Income',
					type: 'bar',
					stack: 'month',
					data: totals.map((t) => euros(t.income)),
					itemStyle: { color: c.positive, opacity: showNet ? 0.35 : 1 },
					markArea: {
						silent: true,
						itemStyle: { color: c['accent-soft'] },
						data: selection ? [[{ xAxis: labels[selection.start] }, { xAxis: labels[selection.end] }]] : [],
					},
				},
				{
					name: 'Expenses',
					type: 'bar',
					stack: 'month',
					data: totals.map((t) => euros(t.expenses)),
					itemStyle: { color: c.negative, opacity: showNet ? 0.35 : 1 },
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

	function tooltipHtml(month: CivilDate, income: number, expenses: number, balance: number): string {
		const row = (label: string, value: number) => `<div style="display:flex;justify-content:space-between;gap:1rem"><span>${label}</span><b>${formatEuro(value as never)}</b></div>`;
		return `<div style="font-weight:600;margin-bottom:0.25rem">${describePeriod(month, monthOf(month).to)}</div>${row('Income', income)}${row('Expenses', expenses)}${row('Net', income + expenses)}${row('Balance', balance)}`;
	}

</script>

<div class="layers">
	<label><input type="checkbox" bind:checked={showNet} /> <span class="swatch net"></span>Net</label>
	<label><input type="checkbox" bind:checked={showBalance} /> <span class="swatch balance"></span>Balance</label>
</div>
<!-- the numbers are in the tooltip and in the totals below; the chart itself is for looking at -->
<div aria-hidden="true">
	<Chart {option} {onready} />
</div>
<p class="hint">Click a month to show it, Shift+click for several months. Zoom with the wheel or the slider.</p>
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
		justify-content: flex-end;
		gap: 1rem;
		font-size: 0.9rem;
		color: var(--muted);
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
