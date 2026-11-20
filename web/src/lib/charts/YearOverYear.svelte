<!--
	The expenses (or income) of what the filter selects, apart from its period, per month of the
	year: one line per year (the last 4 with data), the newest one bold. "Cumulative" adds the months
	up, which shows whether a year is ahead of the others. Clicking selects a month: in the year whose
	line is nearest to the click.
-->
<script lang="ts">
	import type { EChartsType } from 'echarts/core';
	import { cents, chartPeriod, civilDate, monthlyByYear, monthOf, ofSide, today, type Side, type Transaction } from '../../core';
	import { formatEuro, formatMonth } from '../display';
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
		/** What the filter selects apart from its period */
		matching: readonly Transaction[];
		side: Side;
	} = $props();

	const YEARS = 4;
	let cumulative = $state(false);

	const now = today();
	const thisYear = Number(now.slice(0, 4));
	const thisMonth = Number(now.slice(5, 7));
	// the data's months, leaving out probably mistyped dates like the timeline does
	const period = $derived(chartPeriod(workspace.data.transactions, now).period);
	/** The first month with data ("YYYY-MM"): earlier months are empty, not zero */
	const firstMonth = $derived(period?.from.slice(0, 7) ?? '');
	const sided = $derived(ofSide(matching, side));
	// the last years with data, up to this one
	const years = $derived.by(() => {
		const first = Number(firstMonth.slice(0, 4));
		const withData = new Set(sided.map((t) => Number(t.date.slice(0, 4))).filter((year) => year >= first && year <= thisYear));
		return [...withData].sort((a, b) => a - b).slice(-YEARS);
	});
	const byYear = $derived(monthlyByYear(sided, years));

	const MONTHS = Array.from({ length: 12 }, (_, i) => formatMonth(civilDate(2000, i + 1, 1)));

	/** Display values (euros, positive) of a year; null for months before the data or still to come */
	function values(year: number): (number | null)[] {
		let sum = 0;
		return byYear.get(year)!.map((v, month) => {
			if (year === thisYear && month + 1 > thisMonth) return null;
			if (`${year}-${String(month + 1).padStart(2, '0')}` < firstMonth) return null;
			sum += Math.abs(v);
			return (cumulative ? sum : Math.abs(v)) / 100; // display only
		});
	}

	const axisEuros = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

	/** Older years fade out */
	const yearColor = (i: number, count: number) => (i === count - 1 ? theme.colors.accent : theme.colors.muted);
	const yearOpacity = (i: number, count: number) => (i === count - 1 ? 1 : 0.35 + (0.5 * (i + 1)) / count);

	const option = $derived.by(() => {
		const c = theme.colors;
		const axis = { axisLine: { lineStyle: { color: c.border } }, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border } } };
		return {
			animation: false,
			grid: { left: 8, right: 8, top: 16, bottom: 8 },
			tooltip: {
				trigger: 'axis',
				backgroundColor: c.surface,
				borderColor: c.border,
				textStyle: { color: c.text },
				// (ECharts passes no number for empty months)
				valueFormatter: (v: unknown) => (typeof v === 'number' ? formatEuro(cents(Math.round(v * 100))) : '–'),
			},
			xAxis: { type: 'category', data: MONTHS, boundaryGap: false, ...axis, splitLine: { show: false }, axisTick: { show: false } },
			yAxis: { type: 'value', ...axis, axisLabel: { color: c.muted, formatter: (v: number) => axisEuros.format(v) } },
			series: years.map((year, i) => ({
				name: String(year),
				type: 'line',
				data: values(year),
				symbolSize: 6,
				lineStyle: { color: yearColor(i, years.length), width: i === years.length - 1 ? 3 : 2, opacity: yearOpacity(i, years.length) },
				itemStyle: { color: yearColor(i, years.length), opacity: yearOpacity(i, years.length) },
				z: i === years.length - 1 ? 3 : 2,
			})),
		};
	});

	function onready(instance: EChartsType) {
		// a click anywhere in a month's column: that month, in the year whose line is nearest (the
		// points alone are too small to hit, especially by touch)
		instance.getZr().on('click', (event) => {
			const point = [event.offsetX, event.offsetY];
			if (!instance.containPixel({ gridIndex: 0 }, point)) return;
			const [index, value] = instance.convertFromPixel({ gridIndex: 0 }, point) as unknown as [number, number];
			const month = Math.round(index);
			let nearest: number | null = null;
			let distance = Infinity;
			for (const year of years) {
				const v = values(year)[month];
				if (v !== null && v !== undefined && Math.abs(v - value) < distance) [nearest, distance] = [year, Math.abs(v - value)];
			}
			if (nearest === null) return;
			const { from, to } = monthOf(civilDate(nearest, month + 1, 1));
			filter.set({ from, to });
		});
	}
</script>

<div class="header">
	<h2>{side === 'expense' ? 'Expenses' : 'Income'} year over year</h2>
	{#if years.length > 0}
		<ul class="legend" aria-label="Years">
			{#each years as year, i (year)}
				<li><span class="swatch" style:background={yearColor(i, years.length)} style:opacity={yearOpacity(i, years.length)}></span>{year}</li>
			{/each}
		</ul>
		<label class="cumulative"><input type="checkbox" bind:checked={cumulative} /> Cumulative</label>
	{/if}
</div>
{#if years.length === 0}
	<p class="empty">Nothing here for the current filter.</p>
{:else}
	<!-- the numbers are in the tooltip; the chart is for looking at -->
	<div aria-hidden="true">
		<Chart {option} {onready} height="16rem" />
	</div>
	<p class="hint">Click a month to show it (in the year whose line is nearest).</p>
{/if}

<style>
	.header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-bottom: 0.5rem;
	}
	h2 {
		margin: 0 auto 0 0;
		font-size: 1.1rem;
	}
	.legend {
		display: flex;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.swatch {
		width: 1rem;
		height: 3px;
	}
	.cumulative {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.cumulative input {
		min-height: 0;
		margin: 0;
	}
	.empty,
	.hint {
		margin: 0.5rem 0 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
