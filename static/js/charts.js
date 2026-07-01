/** Chart.js wrappers and view switching. */

import { formatCurrency } from './utils.js';

let chartInstance = null;
let currentType = 'inflow-outflow';
let lastCanvas = null;
let lastAnalytics = null;
let categoryTrendData = null;
let categoryLabel = null;
let categoryTrendType = 'outflow';
let chartOptionsLocked = false;

const CHART_COLORS = {
  palette: [
    '#2d7ab8', '#1f8f5f', '#c93c3c', '#b8740a', '#7b5fc7',
    '#2a9d8f', '#c45d8a', '#4a8fc4', '#a68b3d', '#5fa84a',
    '#c96a6a', '#4a6fa8',
  ],
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getChartTheme() {
  return {
    textPrimary: cssVar('--text-primary'),
    textSecondary: cssVar('--text-secondary'),
    textMuted: cssVar('--text-muted'),
    bgElevated: cssVar('--chart-tooltip-bg'),
    border: cssVar('--chart-tooltip-border'),
    gridColor: cssVar('--chart-grid'),
    pieBorder: cssVar('--chart-pie-border'),
    inflow: cssVar('--inflow'),
    outflow: cssVar('--outflow'),
    accent: cssVar('--accent'),
  };
}

function tooltipValue(ctx) {
  const parsed = ctx.parsed;
  if (parsed != null) {
    if (typeof parsed === 'object' && parsed.y != null) return parsed.y;
    if (typeof parsed === 'number') return parsed;
  }
  return ctx.raw;
}

function buildTooltipCallbacks({ pie = false } = {}) {
  return {
    title(items) {
      const item = items[0];
      return item?.label ?? '';
    },
    label(ctx) {
      if (pie) {
        const total = ctx.dataset.data.reduce((sum, n) => sum + n, 0);
        const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : '0.0';
        return ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${pct}%)`;
      }
      const series = ctx.dataset.label || '';
      const value = formatCurrency(tooltipValue(ctx));
      return series ? ` ${series}: ${value}` : ` ${value}`;
    },
  };
}

function rgbaFromHex(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildYScale(theme, values = [], { floorZero = false } = {}) {
  const y = {
    reverse: false,
    ticks: {
      color: theme.textMuted,
      font: { size: 10 },
      callback: (v) => formatCurrency(v),
    },
    grid: { color: theme.gridColor },
  };

  if (floorZero) {
    y.min = 0;
    if (values.length) {
      const maxVal = Math.max(...values);
      if (maxVal > 0) y.suggestedMax = maxVal * 1.08;
    }
    return y;
  }

  if (values.length) {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    y.min = Math.min(0, minVal);
    y.max = Math.max(0, maxVal);
    const span = y.max - y.min;
    if (span > 0) {
      const pad = span * 0.05;
      y.min -= pad;
      y.max += pad;
    }
  }

  return y;
}

function withSignedTooltip(options, signedValues, seriesLabel) {
  const base = buildTooltipCallbacks();
  return {
    ...options,
    plugins: {
      ...options.plugins,
      tooltip: {
        ...options.plugins.tooltip,
        callbacks: {
          ...base,
          label(ctx) {
            const signed = signedValues[ctx.dataIndex];
            const value = formatCurrency(signed != null ? signed : tooltipValue(ctx));
            const series = seriesLabel || ctx.dataset.label || '';
            return series ? ` ${series}: ${value}` : ` ${value}`;
          },
        },
      },
    },
  };
}

function periodSignedNet(p) {
  return p.net ?? (p.inflow ?? 0) - (p.outflow ?? 0);
}

function categoryTrendSeries(periods, categoryType) {
  const signed = periods.map(periodSignedNet);
  const display = periods.map((p) => (
    categoryType === 'inflow' ? (p.inflow ?? 0) : (p.outflow ?? 0)
  ));
  const labelSuffix = categoryType === 'inflow' ? 'income' : 'spending';
  return { display, signed, labelSuffix };
}

function netTrendSeries(periods) {
  const signed = periods.map(periodSignedNet);
  const allNonPositive = signed.length > 0 && signed.every((v) => v <= 0);
  const hasNegative = signed.some((v) => v < 0);
  const display = allNonPositive && hasNegative ? signed.map((v) => Math.abs(v)) : signed;
  return { display, signed, floorZero: allNonPositive || signed.every((v) => v >= 0) };
}

function buildDefaultOptions({ yValues = [], floorZero = false } = {}) {
  const theme = getChartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: theme.textSecondary, font: { family: "'DM Sans', sans-serif", size: 11 } },
      },
      tooltip: {
        backgroundColor: theme.bgElevated,
        borderColor: theme.border,
        borderWidth: 1,
        titleColor: theme.textPrimary,
        bodyColor: theme.textSecondary,
        footerColor: theme.textMuted,
        titleFont: { family: "'DM Sans', sans-serif", weight: '600' },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
        callbacks: buildTooltipCallbacks(),
      },
    },
    scales: {
      x: {
        ticks: { color: theme.textMuted, font: { size: 10 } },
        grid: { color: theme.gridColor },
      },
      y: buildYScale(theme, yValues, { floorZero }),
    },
  };
}

export function setChartType(type) {
  if (chartOptionsLocked && type !== 'trend') return;
  currentType = type;
}

export function getChartType() {
  return currentType;
}

export function setChartOptionsLocked(locked) {
  chartOptionsLocked = locked;
  updateChartToggleUI();
}

export function isChartOptionsLocked() {
  return chartOptionsLocked;
}

function updateChartToggleUI() {
  const toggle = document.getElementById('chart-type-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('[data-chart]').forEach((btn) => {
    const isTrend = btn.dataset.chart === 'trend';
    btn.disabled = chartOptionsLocked && !isTrend;
    btn.classList.toggle('disabled', chartOptionsLocked && !isTrend);
    btn.classList.toggle('active', btn.dataset.chart === currentType);
  });
}

export function setCategoryTrend(data, label, categoryType = 'outflow') {
  categoryTrendData = data;
  categoryLabel = label;
  categoryTrendType = categoryType;
}

export function clearCategoryTrend() {
  categoryTrendData = null;
  categoryLabel = null;
  categoryTrendType = 'outflow';
}

export function renderChart(canvas, analytics, chartType = currentType) {
  const emptyEl = document.getElementById('chart-empty');
  if (!canvas) return;

  lastCanvas = canvas;
  lastAnalytics = analytics;

  const useCategoryTrend = chartOptionsLocked && categoryTrendData;
  const dataSource = useCategoryTrend ? categoryTrendData : analytics;

  const hasData = dataSource && (
    dataSource.periods?.length ||
    dataSource.category_totals?.length ||
    dataSource.inflow != null
  );

  if (!hasData) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    canvas.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  emptyEl?.classList.add('hidden');

  if (chartInstance) chartInstance.destroy();

  const ctx = canvas.getContext('2d');
  const effectiveType = chartOptionsLocked ? 'trend' : chartType;

  switch (effectiveType) {
    case 'category-pie':
      chartInstance = buildPieChart(ctx, analytics);
      break;
    case 'trend':
      chartInstance = useCategoryTrend
        ? buildCategoryTrendChart(ctx, categoryTrendData, categoryLabel)
        : buildTrendChart(ctx, analytics);
      break;
    case 'inflow-outflow':
    default:
      chartInstance = buildInflowOutflowChart(ctx, analytics);
  }

  updateChartToggleUI();
}

function buildInflowOutflowChart(ctx, analytics) {
  const theme = getChartTheme();
  const inflowFill = rgbaFromHex(theme.inflow, 0.85);
  const outflowFill = rgbaFromHex(theme.outflow, 0.85);

  const periods = analytics.periods || [];
  const labels = periods.map((p) => p.label || p.key || p.period);
  const inflows = periods.map((p) => p.inflow ?? 0);
  const outflows = periods.map((p) => Math.abs(p.outflow ?? 0));
  const barValues = [...inflows, ...outflows];
  const options = buildDefaultOptions({ yValues: barValues, floorZero: true });

  if (!labels.length) {
    const totals = analytics.totals || {};
    const fallbackValues = [
      totals.inflow ?? analytics.inflow ?? 0,
      totals.outflow ?? Math.abs(analytics.outflow ?? 0),
    ];
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Current'],
        datasets: [
          { label: 'Inflow', data: [fallbackValues[0]], backgroundColor: inflowFill, borderColor: theme.inflow, borderWidth: 1 },
          { label: 'Outflow', data: [fallbackValues[1]], backgroundColor: outflowFill, borderColor: theme.outflow, borderWidth: 1 },
        ],
      },
      options: buildDefaultOptions({ yValues: fallbackValues, floorZero: true }),
    });
  }

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Inflow', data: inflows, backgroundColor: inflowFill, borderColor: theme.inflow, borderWidth: 1 },
        { label: 'Outflow', data: outflows, backgroundColor: outflowFill, borderColor: theme.outflow, borderWidth: 1 },
      ],
    },
    options,
  });
}

function buildPieChart(ctx, analytics) {
  const theme = getChartTheme();
  const raw = analytics.category_totals || {};
  const totals = (Array.isArray(raw) ? raw : Object.entries(raw).map(([key, total]) => {
    const [catId] = key.split('/');
    return { id: catId, name: catId.replace(/_/g, ' '), total, type: total >= 0 ? 'inflow' : 'outflow' };
  }))
    .filter((c) => c.type !== 'inflow' && Math.abs(c.total ?? 0) > 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  const top = totals.slice(0, 10);
  const otherSum = totals.slice(10).reduce((s, c) => s + Math.abs(c.total), 0);

  const labels = top.map((c) => c.name || c.category_name);
  const data = top.map((c) => Math.abs(c.total));
  if (otherSum > 0) {
    labels.push('Other');
    data.push(otherSum);
  }

  const defaultOptions = buildDefaultOptions();

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: CHART_COLORS.palette.slice(0, labels.length),
        borderColor: theme.pieBorder,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: theme.textSecondary, font: { size: 10 }, boxWidth: 12 },
        },
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: buildTooltipCallbacks({ pie: true }),
        },
      },
    },
  });
}

function buildTrendChart(ctx, analytics) {
  const theme = getChartTheme();
  const periods = analytics.periods || [];
  const labels = periods.map((p) => p.label || p.key || p.period);
  const { display, signed, floorZero } = netTrendSeries(periods);
  const options = withSignedTooltip(
    buildDefaultOptions({ yValues: display, floorZero }),
    signed,
    'Net cashflow',
  );

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net cashflow',
        data: display,
        borderColor: theme.accent,
        backgroundColor: rgbaFromHex(theme.accent, 0.1),
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: theme.accent,
      }],
    },
    options,
  });
}

function buildCategoryTrendChart(ctx, trendData, label) {
  const theme = getChartTheme();
  const periods = trendData.periods || [];
  const labels = periods.map((p) => p.label || p.key || p.period);
  const { display, signed, labelSuffix } = categoryTrendSeries(periods, categoryTrendType);
  const seriesLabel = label ? `${label} ${labelSuffix}` : `Category ${labelSuffix}`;
  const options = withSignedTooltip(
    buildDefaultOptions({ yValues: display, floorZero: true }),
    signed,
    seriesLabel,
  );

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: seriesLabel,
        data: display,
        borderColor: theme.accent,
        backgroundColor: rgbaFromHex(theme.accent, 0.12),
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: theme.accent,
      }],
    },
    options,
  });
}

export function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  lastCanvas = null;
  lastAnalytics = null;
  categoryTrendData = null;
  categoryLabel = null;
  categoryTrendType = 'outflow';
  chartOptionsLocked = false;
  updateChartToggleUI();
}

document.addEventListener('themechange', () => {
  if (lastCanvas && (lastAnalytics || categoryTrendData)) {
    renderChart(lastCanvas, lastAnalytics, currentType);
  }
});
