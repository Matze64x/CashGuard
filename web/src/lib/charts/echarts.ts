/**
 * The parts of ECharts the app uses, registered once. Imported on demand (by `Chart.svelte`), so
 * the charting code only loads when a chart is shown.
 */
import { BarChart, CustomChart, LineChart } from 'echarts/charts';
import { DataZoomInsideComponent, DataZoomSliderComponent, GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, CustomChart, LineChart, DataZoomInsideComponent, DataZoomSliderComponent, GridComponent, MarkAreaComponent, TooltipComponent, SVGRenderer]);

export { echarts };
