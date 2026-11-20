<!--
	An ECharts chart that follows its `option` and the size of its box. ECharts is loaded on first
	use. `chart` gives the instance to the parent (e.g. for highlighting with the keyboard).
-->
<script lang="ts">
	import type { EChartsCoreOption, EChartsType } from 'echarts/core';

	let {
		option,
		chart = $bindable(),
		height = '20rem',
		onready,
	}: {
		option: EChartsCoreOption;
		chart?: EChartsType;
		height?: string;
		/** Once the chart exists, e.g. to listen to its events */
		onready?: (chart: EChartsType) => void;
	} = $props();

	let element: HTMLDivElement;
	let failed = $state(false);

	$effect(() => {
		let instance: EChartsType | undefined;
		let disposed = false;
		const loading = import('./echarts');
		// created once the box has a size (a hidden view's chart waits until it's shown)
		const resize = new ResizeObserver(() => {
			if (instance) return instance.resize();
			if (element.clientWidth === 0) return;
			loading
				.then(({ echarts }) => {
					if (disposed || instance) return;
					instance = echarts.init(element, null, { renderer: 'svg' });
					chart = instance;
					onready?.(instance);
				})
				.catch(() => (failed = true));
		});
		resize.observe(element);
		return () => {
			disposed = true;
			resize.disconnect();
			instance?.dispose();
			chart = undefined;
		};
	});

	// replaces the whole chart (in the given order), so state that should survive an update, like
	// the zoom, belongs in `option`. A shown tooltip goes first: it would refer to old series.
	$effect(() => {
		if (!chart) return;
		chart.dispatchAction({ type: 'hideTip' });
		chart.setOption(option, { notMerge: true });
	});
</script>

<div bind:this={element} class="chart" style:height>
	{#if failed}<p class="failed">The chart couldn't be loaded. Reload the page to try again.</p>{/if}
</div>

<style>
	.chart {
		width: 100%;
	}
	.failed {
		color: var(--muted);
		text-align: center;
		padding-top: 4rem;
	}
</style>
