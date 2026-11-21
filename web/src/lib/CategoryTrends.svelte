<!--
	How each category's expenses (or income) developed, for what the filter selects apart from its
	period: a line per category through its whole months (the last 24) or years (up to 10; for
	irregular categories like vacations, whose single months say little), scaled to its own amounts so
	ups and downs show, with its average dotted, and dashed at the end where the current month or
	year is heading (what it has so far plus what usually comes in the rest of one). Next to it the
	average and the latest whole month or year compared with it. A row filters by its category, like
	the breakdown.
-->
<script lang="ts">
	import { addMonths, categoryTotalsOverTime, chartPeriod, monthOf, monthsBetween, ofSide, projection, projectionBasis, yearOf, type Cents, type CivilDate, type Id, type Side, type Transaction } from '../core';
	import { clock } from './clock.svelte';
	import { formatEuro, formatMonth } from './display';
	import { rowTarget } from './rows.svelte';
	import Segmented from './ui/Segmented.svelte';
	import type { Workspace } from './workspace.svelte';

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

	let unit = $state<'month' | 'year'>('month');
	const UNITS = [
		{ value: 'month', label: 'Months' },
		{ value: 'year', label: 'Years' },
	] as const;

	const now = $derived(clock.today);
	const thisYear = $derived(Number(now.slice(0, 4)));
	// where the data starts, leaving out probably mistyped dates like the timeline does
	const range = $derived(chartPeriod(workspace.data.transactions, now));
	const firstMonth = $derived(range.period?.from ?? now);
	/** The first date with data: the month (or year) it falls in is only whole if the data starts on its first day */
	const oldest = $derived(range.oldest ?? now);

	/** The months or years shown, the current one last; which are partial (not whole), and their names */
	const buckets = $derived.by(() => {
		if (unit === 'month') {
			const start = addMonths(monthOf(now).from, -23);
			const months = monthsBetween(start > firstMonth ? start : firstMonth, now);
			return {
				keys: months.map((m) => m.slice(0, 7)),
				labels: months.map((m) => formatMonth(m, { year: 'numeric' })),
				partial: months.map((m, i) => i === months.length - 1 || m < oldest),
				of: (date: CivilDate) => date.slice(0, 7),
			};
		}
		const firstYear = Math.max(thisYear - 9, Number(firstMonth.slice(0, 4)));
		const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => String(firstYear + i));
		return { keys: years, labels: years, partial: years.map((y, i) => i === years.length - 1 || `${y}-01-01` < oldest), of: (date: CivilDate) => date.slice(0, 4) };
	});

	/** How to project the current month/year to its end; null if there's nothing to project */
	const basis = $derived(projectionBasis(unit === 'month' ? monthOf(now) : yearOf(now), now, range.oldest));

	interface Trend {
		key: Id;
		/** Amounts without sign, per bucket */
		values: number[];
		/** The whole buckets from the category's first use on: what the line and the average use */
		whole: { value: number; i: number }[];
		/** Whether the category is first used in the current bucket */
		isNew: boolean;
		/** The current bucket projected to its end */
		estimate: number | null;
	}
	const trends = $derived.by((): Trend[] => {
		const last = buckets.keys.length - 1;
		const sided = ofSide(matching, side);
		const project = basis && projection(basis, sided, (t) => t.categoryId);
		return (
			[...categoryTotalsOverTime(sided, buckets.keys, buckets.of)]
				.map(([key, totals]) => {
					const values = totals.map(Math.abs);
					const first = values.findIndex((v) => v > 0);
					const whole = values.map((value, i) => ({ value, i })).filter(({ i }) => i >= first && !buckets.partial[i]);
					const projected = project?.(key, totals[last]!) ?? null;
					// nothing so far and nothing expected: no estimate to draw
					const estimate = projected === null || (projected === 0 && values[last] === 0) ? null : Math.abs(projected);
					return { key, values, whole, isNew: first === last, estimate, sum: values.reduce((a, b) => a + b, 0) };
				})
				// only categories used in the buckets shown, the largest (in them) first
				.filter((t) => t.sum > 0)
				.sort((a, b) => b.sum - a.sum || (a.key < b.key ? -1 : 1))
		);
	});
	const categories = $derived(new Map(workspace.data.categories.map((c) => [c.id, c])));

	/** The average of the whole buckets, and the latest whole one compared with it; null without data in any */
	function summary(trend: Trend) {
		const average = trend.whole.reduce((sum, b) => sum + b.value, 0) / Math.max(1, trend.whole.length);
		const last = trend.whole.at(-1);
		if (!last || average === 0) return null;
		return { average, last: last.value, lastLabel: buckets.labels[last.i]!, ratio: last.value / average - 1 };
	}

	/**
	 * The line and its dots, and the average's height. Coordinates: x 10 per bucket, y 0–100 from the
	 * top: zero at `ZERO_Y`, the highest amount (of the line and the estimate) at `TOP_Y`, so all
	 * lines start at zero and the top line's label gives the scale.
	 */
		function sparkline(trend: Trend, average: number | null) {
		const { whole, estimate } = trend;
		const last = trend.values.length - 1;
		const scaled = estimate === null ? whole : [...whole, { value: estimate, i: last }];
		const highest = Math.max(0, ...scaled.map((p) => p.value));
		const y = (v: number) => (highest === 0 ? ZERO_Y : ZERO_Y - (v / highest) * (ZERO_Y - TOP_Y));
		const x = (i: number) => i * 10 + 5;
		return {
			highest,
			line: whole.map((p) => `${x(p.i)},${y(p.value)}`).join(' '),
			points: whole.map((p) => ({ x: x(p.i), y: y(p.value) })),
			average: average === null || whole.length === 0 ? null : { from: x(whole[0]!.i), y: y(average) },
			// dashed from the last whole month/year (if it's the one before) to the estimate
			estimate:
				estimate === null
					? null
					: { x: x(last), y: y(estimate), from: whole.at(-1)?.i === last - 1 ? `${x(last - 1)},${y(whole.at(-1)!.value)} ` : '' },
		};
	}

	const ZERO_Y = 94;
	/** (room above for the highest amount's label) */
	const TOP_Y = 24;

	const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
	const euros = (value: number) => formatEuro(Math.round(value) as Cents);
	/** Less spending (or more income) than usual is good */
	const good = (ratio: number) => (side === 'expense' ? ratio < 0 : ratio > 0);
	/** Why there's no average: the category is new, or only used in partial months/years so far */
	const missing = (trend: Trend) => (trend.isNew ? `new this ${unit}` : `no whole ${unit} with it yet`);
	/** The current month/year so far (not part of the line) and what's expected in it, if anything */
	const soFar = (trend: Trend) => {
		const value = trend.values.at(-1) ?? 0;
		const label = buckets.labels.at(-1);
		const expected = trend.estimate === null ? '' : `expected ${euros(trend.estimate)}`;
		if (value === 0) return expected ? `${label}: nothing yet, ${expected}` : '';
		// (when nothing more is expected, the amount so far says it all)
		return `${label} so far: ${euros(value)}${expected && trend.estimate !== value ? `, ${expected}` : ''}`;
	};
</script>

<div class="header">
	<h2>{side === 'expense' ? 'Expenses' : 'Income'} over time, by category</h2>
	<Segmented bind:value={unit} options={UNITS} label="Months or years" />
</div>
<p class="hint">
	Each line runs from zero up to its highest amount (the top line) and shows whole {unit}s{basis
		? `, then dashed where this ${unit} is heading ${basis.kind === 'usual' ? `by what usually comes in the rest of a ${unit}` : 'at its pace so far'}`
		: ''}; the dotted line is the average.{unit === 'year'
		? ' Years suit irregular categories like vacations.'
		: ''} Click a category to show only it.
</p>

{#if trends.length === 0}
	<p class="hint">Nothing here for the current filter.</p>
{:else}
	<ul class="trends">
		{#each trends as trend (trend.key)}
			{@const target = rowTarget(trend.key, false, categories)}
			{@const s = summary(trend)}
			{@const line = sparkline(trend, s?.average ?? null)}
			{@const current = soFar(trend)}
			<li>
				<button
					class="trend"
					onclick={target.choose}
					title={target.title}
					aria-label={`${target.label}: ${
						s ? `on average ${euros(s.average)} per ${unit}; ${s.lastLabel}: ${euros(s.last)}, ${percent.format(s.ratio)}` : missing(trend)
					}${current ? `; ${current}` : ''}`}
				>
					<span class="name"><span class="dot" style:background={target.color}></span><span class="label">{target.label}</span></span>
					<span class="spark">
					<span class="top-label" aria-hidden="true">{euros(line.highest)}</span>
					<svg viewBox={`0 0 ${trend.values.length * 10} 100`} preserveAspectRatio="none" aria-hidden="true">
						<!-- zero and the highest amount: the scale -->
						<line class="guide" x1="0" x2={trend.values.length * 10} y1={ZERO_Y} y2={ZERO_Y} vector-effect="non-scaling-stroke" />
						<line class="guide" x1="0" x2={trend.values.length * 10} y1={TOP_Y} y2={TOP_Y} vector-effect="non-scaling-stroke" />
						{#if line.average}
							<line class="average-line" x1={line.average.from} x2={trend.values.length * 10} y1={line.average.y} y2={line.average.y} vector-effect="non-scaling-stroke" />
						{/if}
						<polyline points={line.line} stroke={target.color} vector-effect="non-scaling-stroke" />
						<!-- a dot per month/year: a line without length, whose round ends stay round however the
							 chart is stretched -->
						{#each line.points as point}
							<line class="point" x1={point.x} x2={point.x} y1={point.y} y2={point.y} stroke={target.color} vector-effect="non-scaling-stroke" />
						{/each}
						<!-- where the current month/year is heading: dashed, with a hollow dot -->
						{#if line.estimate}
							{@const e = line.estimate}
							{#if e.from}<polyline class="projection" points={`${e.from}${e.x},${e.y}`} stroke={target.color} vector-effect="non-scaling-stroke" />{/if}
							<line class="point" x1={e.x} x2={e.x} y1={e.y} y2={e.y} stroke={target.color} vector-effect="non-scaling-stroke" />
							<line class="hollow" x1={e.x} x2={e.x} y1={e.y} y2={e.y} vector-effect="non-scaling-stroke" />
						{/if}
						<!-- each month/year's amount on hover (on phones, the current one shows as text) -->
						{#each trend.values as value, i}
							<rect x={i * 10} y="0" width="10" height="100" fill="transparent"
								><title>{(i === trend.values.length - 1 && soFar(trend)) || `${buckets.labels[i]}: ${euros(value)}`}</title></rect
							>
						{/each}
					</svg>
					</span>
					{#if s}
						<span class="average"><span class="muted">Ø per {unit}</span> {euros(s.average)}</span>
						<span class="last">
							<span class="muted">{s.lastLabel}</span>
							{euros(s.last)}
							<span class="percent" class:good={Math.abs(s.ratio) >= 0.005 && good(s.ratio)} class:bad={Math.abs(s.ratio) >= 0.005 && !good(s.ratio)}>
								{percent.format(s.ratio)}
							</span>
						</span>
					{:else}
						<span class="average muted">{missing(trend)}</span>
						<span class="last"></span>
					{/if}
					{#if current}<span class="so-far muted">{current}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.hint {
		margin: 0.4rem 0 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.trends {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
	}
	.trend {
		width: 100%;
		display: grid;
		grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) 9.5rem 12rem;
		gap: 0.25rem 1rem;
		align-items: center;
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: none;
		text-align: left;
		min-height: 0;
		font-variant-numeric: tabular-nums;
	}
	.trend:hover {
		background: var(--accent-soft);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		flex: none;
	}
	.spark {
		position: relative;
		display: block;
		height: 3.6rem;
	}
	.spark svg {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}
	/* the highest amount, above the top line */
	.top-label {
		position: absolute;
		top: -0.15rem;
		left: 0;
		color: var(--muted);
		font-size: 0.7rem;
		line-height: 1;
	}
	.spark .guide {
		stroke: var(--border);
		stroke-width: 1;
	}
	.spark polyline,
	.spark line {
		fill: none;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.spark .point {
		stroke-width: 6;
	}
	/* (round caps would close the gaps) */
	.spark .projection {
		stroke-linecap: butt;
		stroke-dasharray: 4 3;
	}
	/* the estimate's dot: hollow, a smaller dot in the row's background color inside */
	.spark .hollow {
		stroke: var(--surface);
		stroke-width: 2.5;
	}
	.trend:hover .hollow {
		stroke: var(--accent-soft-on-surface);
	}
	.spark .average-line {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 2 4;
		opacity: 0.6;
	}
	.average,
	.last {
		text-align: right;
		white-space: nowrap;
	}
	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.percent {
		display: inline-block;
		min-width: 3rem;
		font-size: 0.85rem;
	}
	.good {
		color: var(--positive);
	}
	.bad {
		color: var(--negative);
	}
	/* the current month/year so far: on hover on computers, as text on phones (no hover there) */
	.so-far {
		display: none;
	}
	/* phones: name and numbers above the chart */
	@media (max-width: 40rem) {
		.trend {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'name last' 'spark spark' 'average average' 'so-far so-far';
		}
		.name {
			grid-area: name;
		}
		.spark {
			grid-area: spark;
		}
		.average {
			grid-area: average;
			text-align: left;
		}
		.last {
			grid-area: last;
		}
		.so-far {
			display: block;
			grid-area: so-far;
		}
	}
</style>
