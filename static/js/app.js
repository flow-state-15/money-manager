/** App init, routing state, orchestration. */

import * as api from './api.js';
import {
  renderCategoryStack,
  onCategoryDrop,
  onCategorySelect,
  getSelectedScope,
  getSelectedCategoryId,
  getSelectedCategoryName,
  getSelectedCategoryType,
  isUncategorizedSelected,
  getApiCategoryParams,
  resolveCategorizeTarget,
  selectCategory,
  getUncategorizedId,
  highlightCategory,
  updateCategoryDisplayName,
} from './categories.js';
import {
  renderCategoryTransactionList,
  getDragMatchIds,
  getDragPayee,
  onCategoryRename,
} from './transactions.js';
import {
  renderChart,
  setChartType,
  getChartType,
  destroyChart,
  setChartOptionsLocked,
  setCategoryTrend,
  clearCategoryTrend,
} from './charts.js';
import { initProjections, runProjection, setProjectionContext, syncPeriodToggleUI } from './projections.js';
import { initUpload } from './upload.js';
import {
  $, $$, formatCurrency, showToast, setLoading, ApiError,
} from './utils.js';
import { initTheme } from './theme.js';

const INBOX_WIDTH_KEY = 'inboxPanelWidth';
const INBOX_MIN_WIDTH = 280;
const INBOX_MAX_WIDTH = 720;

const PERIOD_LABELS = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  total: 'Total',
};

const state = {
  accountId: null,
  accounts: [],
  period: 'monthly',
  whatIfStatsPeriod: 'monthly',
  sliderPeriod: 'monthly',
  whatIfStatsPeriodOverride: false,
  sliderPeriodOverride: false,
  chartType: 'inflow-outflow',
  categories: [],
  analytics: null,
  categoryTrend: null,
  categoryTransactions: [],
  defaultCategorySelected: false,
  backendOk: false,
  categoryDisplayOverrides: {},
};

let analyticsRequestId = 0;

async function init() {
  initTheme();
  initInboxResize();
  bindControls();
  updateStatLabels();
  bindBulkCategorizeModal();
  initUpload(refreshAll, () => state.accountId);
  onCategoryDrop(handleCategorize);
  onCategorySelect(handleCategorySelect);
  onCategoryRename(handleCategoryRename);

  const projContainer = $('#projections-controls');
  if (projContainer) {
    initProjections(projContainer, {
      scope: { type: 'total' },
      sliderPeriod: state.sliderPeriod,
      statsPeriod: state.whatIfStatsPeriod,
      onStatsPeriodChange: (period) => {
        state.whatIfStatsPeriodOverride = true;
        state.whatIfStatsPeriod = period;
      },
      onSliderPeriodChange: (period) => {
        state.sliderPeriodOverride = true;
        state.sliderPeriod = period;
        updateProjectionBaseline();
      },
    });
  }

  await checkBackend();
  if (state.backendOk) {
    await refreshAll();
  } else {
    showOfflineState();
  }
}

function bindControls() {
  $('#period-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    $$('#period-toggle .btn-toggle').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.period = btn.dataset.period;
    updateStatLabels();
    syncWhatIfPeriodsFromTop();
    void loadAnalytics().then(() => refreshDrawerDisplay());
  });

  $('#chart-type-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chart]');
    if (!btn || btn.disabled) return;
    $$('#chart-type-toggle .btn-toggle').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.chartType = btn.dataset.chart;
    setChartType(state.chartType);
    if (state.analytics) {
      renderChart($('#main-chart'), state.analytics, state.chartType);
    }
  });

  $('#account-select')?.addEventListener('change', (e) => {
    state.accountId = e.target.value || null;
    refreshAll();
  });

  $('#btn-add-category')?.addEventListener('click', openCategoryModal);
  $('#category-close')?.addEventListener('click', closeCategoryModal);
  $('#category-cancel')?.addEventListener('click', closeCategoryModal);
  $('#category-form')?.addEventListener('submit', handleCreateCategory);
}

async function checkBackend() {
  const el = $('#backend-status');
  el.className = 'backend-status loading';
  el.textContent = 'Connecting…';
  el.removeAttribute('title');

  state.backendOk = await api.checkBackend();

  if (state.backendOk) {
    el.className = 'backend-status ok';
    el.textContent = 'Connected';
    el.title = 'Connected to local database';
    el.setAttribute('aria-label', 'Connected to local database');
  } else {
    el.className = 'backend-status error';
    el.textContent = 'Disconnected';
    el.title = 'Disconnected — start the server';
    el.setAttribute('aria-label', 'Disconnected — start the server');
  }
}

function showOfflineState() {
  setLoading($('#category-stack'), 'Start backend to load data');
  setLoading($('#transaction-list'), 'Backend not running');
  $('#stat-income').textContent = '—';
  $('#stat-burn').textContent = '—';
  $('#stat-net').textContent = '—';
  $('#stat-balance').textContent = '—';
  destroyChart();
  $('#chart-empty')?.classList.remove('hidden');
  $('#main-chart')?.classList.add('hidden');
}

async function refreshAll() {
  if (!state.backendOk) return;

  try {
    await Promise.all([loadAccounts(), loadCategories()]);
    await ensureDefaultCategorySelection();
    await loadAnalytics();
    await loadCategoryTransactions();
    runProjection(state.accountId);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 500) {
      showToast('Server error — check backend logs', 'error');
    }
  }
}

async function loadAccounts() {
  const accounts = await api.getAccounts();
  const select = $('#account-select');
  select.innerHTML = '';

  const list = Array.isArray(accounts) ? accounts : accounts?.accounts || [];
  state.accounts = list;

  if (!list.length) {
    select.innerHTML = '<option value="">No accounts — import CSV</option>';
    state.accountId = null;
    return;
  }

  for (const acc of list) {
    const opt = document.createElement('option');
    opt.value = acc.id;
    const balance = acc.balance != null ? ` (${formatCurrency(acc.balance)})` : '';
    opt.textContent = `${acc.name}${balance}`;
    select.appendChild(opt);
  }

  if (!state.accountId) state.accountId = list[0].id;
  select.value = state.accountId;
}

async function loadCategories() {
  const [data, overrides] = await Promise.all([
    api.getCategories(),
    api.getCategoryDisplayOverrides().catch(() => ({})),
  ]);
  state.categories = Array.isArray(data) ? data : data?.categories || [];
  state.categoryDisplayOverrides = overrides || {};
}

async function loadAnalytics() {
  const requestId = ++analyticsRequestId;
  const period = state.period;
  const params = { period };
  if (state.accountId) params.account_id = state.accountId;

  const analytics = await api.getAnalyticsSummary(params);
  if (requestId !== analyticsRequestId) return;

  state.analytics = analytics;

  updateStats(analytics);
  updateCategoryTotals(analytics);
  await refreshChartForSelection();
  updateProjectionBaseline();
}

async function loadCategoryTrend(categoryId) {
  const params = {
    period: state.period,
    ...categoryTrendApiParams(categoryId),
  };
  if (state.accountId) params.account_id = state.accountId;

  const trend = await api.getCategoryTrend(params);
  state.categoryTrend = trend;

  const label = getSelectedCategoryName() || categoryId.replace(/_/g, ' ');
  setCategoryTrend(trend, label, getSelectedCategoryType() || 'outflow');
  return trend;
}

function categoryTrendApiParams(categoryId) {
  if (categoryId === getUncategorizedId()) {
    return { category_id: 'personal', subcategory_id: 'uncategorized' };
  }
  return { category_id: categoryId };
}

async function handleCategorySelect(scope) {
  const categoryId = getSelectedCategoryId();

  if (categoryId) {
    setChartOptionsLocked(true);
    setChartType('trend');
    state.chartType = 'trend';
    $$('#chart-type-toggle .btn-toggle').forEach((b) => {
      b.classList.toggle('active', b.dataset.chart === 'trend');
    });
    await loadCategoryTrend(categoryId);
  } else {
    setChartOptionsLocked(false);
    clearCategoryTrend();
    state.categoryTrend = null;
  }

  if (state.analytics) {
    renderChart($('#main-chart'), state.analytics, state.chartType);
  }

  updateProjectionBaseline();
  runProjection(state.accountId);
  await loadCategoryTransactions();
}

async function refreshChartForSelection() {
  const categoryId = getSelectedCategoryId();
  if (categoryId) {
    setChartOptionsLocked(true);
    setChartType('trend');
    state.chartType = 'trend';
    await loadCategoryTrend(categoryId);
  } else {
    setChartOptionsLocked(false);
    clearCategoryTrend();
  }
  renderChart($('#main-chart'), state.analytics, state.chartType);
}

function periodLabel() {
  return PERIOD_LABELS[state.period] || PERIOD_LABELS.monthly;
}

function updateStatLabels() {
  const prefix = periodLabel();
  $('#stat-label-income').textContent = `${prefix} income`;
  $('#stat-label-burn').textContent = `${prefix} burn`;
  $('#stat-label-net').textContent = `${prefix} net flow`;
  $('#stat-label-balance').textContent = `${prefix} balance`;
}

function getSelectedAccountBalance() {
  const acc = state.accounts.find((a) => String(a.id) === String(state.accountId));
  return acc?.balance ?? null;
}

function meanOf(periods, field) {
  if (!periods?.length) return null;
  const sum = periods.reduce((s, p) => s + (Number(p[field]) || 0), 0);
  return sum / periods.length;
}

function sumOf(periods, field) {
  if (!periods?.length) return null;
  return periods.reduce((s, p) => s + (Number(p[field]) || 0), 0);
}

function computePeriodAverages(analytics, period, categoryId = null) {
  if (period === 'total') {
    if (categoryId && state.categoryTrend?.periods?.length) {
      const periods = state.categoryTrend.periods;
      return {
        income: sumOf(periods, 'inflow'),
        burn: sumOf(periods, 'outflow'),
        net: sumOf(periods, 'net'),
        balance: getSelectedAccountBalance(),
      };
    }

    const totals = analytics?.totals || {};
    const periods = analytics?.periods || [];
    const lastBalance = periods.length
      ? Number(periods[periods.length - 1].ending_balance)
      : null;

    return {
      income: totals.inflow ?? null,
      burn: totals.outflow ?? null,
      net: totals.net ?? null,
      balance: getSelectedAccountBalance() ?? lastBalance,
    };
  }

  let periods = analytics?.periods || [];
  if (categoryId && state.categoryTrend?.periods?.length) {
    periods = state.categoryTrend.periods;
  }

  if (!periods.length) {
    return { income: null, burn: null, net: null, balance: null };
  }

  const income = meanOf(periods, 'inflow');
  const burn = meanOf(periods, 'outflow');
  const net = meanOf(periods, 'net');
  let balance = meanOf(periods, 'ending_balance');

  if (!categoryId) {
    balance = balance ?? getSelectedAccountBalance();
  } else {
    balance = getSelectedAccountBalance() ?? balance;
  }

  return { income, burn, net, balance };
}

function setStatValue(el, value, className) {
  if (!el) return;
  if (value == null || Number.isNaN(value)) {
    el.textContent = '—';
    el.className = 'stat-value';
    return;
  }
  el.textContent = formatCurrency(value, { signed: className.includes('signed') });
  el.className = className;
}

function updateStats(analytics) {
  const avg = computePeriodAverages(analytics, state.period);
  const inflow = avg.income;
  const burn = avg.burn;
  const net = avg.net;
  const balance = avg.balance;

  setStatValue($('#stat-income'), inflow, 'stat-value positive');
  setStatValue($('#stat-burn'), burn, 'stat-value negative');

  const netEl = $('#stat-net');
  if (net != null && !Number.isNaN(net)) {
    netEl.textContent = formatCurrency(net, { signed: true });
    netEl.className = `stat-value${Number(net) < 0 ? ' negative' : ''}`;
  } else {
    netEl.textContent = '—';
    netEl.className = 'stat-value';
  }

  const balanceEl = $('#stat-balance');
  if (balance != null && !Number.isNaN(balance)) {
    balanceEl.textContent = formatCurrency(balance, { signed: true });
    balanceEl.className = `stat-value${Number(balance) < 0 ? ' balance-negative' : ''}`;
  } else {
    balanceEl.textContent = '—';
    balanceEl.className = 'stat-value';
  }
}

/** Roll subcategory keys into top-level ids; uncategorized subcats → virtual card. */
function aggregateCategoryTotals(categoryTotals) {
  const map = {};
  let uncategorizedTotal = 0;
  if (!categoryTotals) return { map, uncategorizedTotal };

  if (Array.isArray(categoryTotals)) {
    for (const t of categoryTotals) {
      const key = t.category_id ?? t.id;
      if (String(key).endsWith('/uncategorized') || key === 'uncategorized') {
        uncategorizedTotal += t.total;
      } else {
        map[key] = t.total;
      }
    }
    return { map, uncategorizedTotal };
  }

  for (const [key, total] of Object.entries(categoryTotals)) {
    const parts = key.split('/');
    const catId = parts[0];
    const subId = parts[1];
    if (subId === 'uncategorized' || catId === 'uncategorized') {
      uncategorizedTotal += total;
      continue;
    }
    map[catId] = (map[catId] || 0) + total;
  }
  return { map, uncategorizedTotal };
}

/** Signed period average → positive spend/inflow magnitude for card display. */
function categoryCardAmount(cat, signedTotal) {
  const n = Number(signedTotal) || 0;
  if (cat.type === 'inflow') {
    return n > 0 ? n : 0;
  }
  return n < 0 ? -n : n;
}

function updateCategoryTotals(analytics) {
  const { map: totalsMap, uncategorizedTotal } = aggregateCategoryTotals(analytics.category_totals);
  const uncatId = getUncategorizedId();

  const cats = state.categories.length
    ? state.categories.map((c) => ({
        id: c.id,
        name: state.categoryDisplayOverrides[c.id] || c.name,
        type: c.type || 'outflow',
        total: categoryCardAmount(c, totalsMap[c.id] ?? 0),
      }))
    : Object.entries(totalsMap).map(([id, total]) => ({
        id,
        name: id.replace(/_/g, ' '),
        type: total >= 0 ? 'inflow' : 'outflow',
        total: Math.abs(total),
      }));

  const uncatCard = {
    id: uncatId,
    name: state.categoryDisplayOverrides[uncatId] || 'Uncategorized',
    type: 'outflow',
    total: categoryCardAmount({ type: 'outflow' }, uncategorizedTotal),
  };

  cats.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  cats.push(uncatCard);
  renderCategoryStack($('#category-stack'), cats);
}

async function ensureDefaultCategorySelection() {
  if (!state.defaultCategorySelected) {
    selectCategory(getUncategorizedId(), { notify: false });
    state.defaultCategorySelected = true;
  }
}

function drawerRenderOptions() {
  const categoryId = getSelectedCategoryId();
  return {
    period: state.period,
    categoryId,
    categoryName: getSelectedCategoryName(),
    categoryType: getSelectedCategoryType() || 'outflow',
    isUncategorized: isUncategorizedSelected(),
  };
}

async function handleCategoryRename(categoryId, name) {
  try {
    await api.updateCategory(categoryId, { name });

    if (categoryId === getUncategorizedId()) {
      state.categoryDisplayOverrides[categoryId] = name;
    } else {
      const cat = state.categories.find((c) => c.id === categoryId);
      if (cat) cat.name = name;
    }

    updateCategoryDisplayName(categoryId, name);

    if (state.analytics) {
      updateCategoryTotals(state.analytics);
    }

    refreshDrawerDisplay();
    updateProjectionBaseline();

    const categoryIdSelected = getSelectedCategoryId();
    if (categoryIdSelected === categoryId && state.chartType === 'trend') {
      setCategoryTrend(state.categoryTrend, name, getSelectedCategoryType() || 'outflow');
    }

    showToast(`Renamed to "${name}"`);
    return true;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Rename failed';
    showToast(msg, 'error');
    return false;
  }
}

function refreshDrawerDisplay() {
  const container = $('#transaction-list');
  if (!container) return;

  if (state.categoryTransactions.length) {
    renderCategoryTransactionList(container, state.categoryTransactions, drawerRenderOptions());
    return;
  }

  if (getSelectedCategoryId()) {
    rerenderDrawerFromCache(drawerRenderOptions());
    return;
  }

  renderCategoryTransactionList(container, [], drawerRenderOptions());
}

async function loadCategoryTransactions() {
  const categoryId = getSelectedCategoryId();
  const container = $('#transaction-list');

  if (!categoryId) {
    state.categoryTransactions = [];
    renderCategoryTransactionList(container, [], drawerRenderOptions());
    return;
  }

  const params = { limit: 5000, ...getApiCategoryParams(categoryId) };
  if (state.accountId) params.account_id = state.accountId;

  const data = await api.getTransactions(params);
  const txs = Array.isArray(data) ? data : data?.transactions || [];
  state.categoryTransactions = txs;

  renderCategoryTransactionList(container, txs, drawerRenderOptions());
}

function syncWhatIfPeriodsFromTop() {
  let changed = false;
  if (!state.whatIfStatsPeriodOverride) {
    state.whatIfStatsPeriod = state.period;
    changed = true;
  }
  if (!state.sliderPeriodOverride) {
    state.sliderPeriod = state.period;
    changed = true;
  }
  if (changed) {
    syncPeriodToggleUI(state.whatIfStatsPeriod, state.sliderPeriod);
  }
}

function updateProjectionBaseline() {
  const scope = getSelectedScope();
  const categoryId = getSelectedCategoryId();
  const samePeriod = state.sliderPeriod === state.period;
  const sliderBaseline = samePeriod
    ? computePeriodAverages(state.analytics, state.sliderPeriod, categoryId)
    : { income: 0, burn: 0, net: 0, balance: 0 };

  setProjectionContext({
    scope,
    scopeDisplayName: getSelectedCategoryName(),
    sliderPeriod: state.sliderPeriod,
    statsPeriod: state.whatIfStatsPeriod,
    baseline: {
      income: sliderBaseline.income ?? 0,
      burn: sliderBaseline.burn ?? 0,
      net: sliderBaseline.net ?? 0,
      balance: sliderBaseline.balance ?? 0,
    },
    acctId: state.accountId,
  });
}

async function handleCategorize(txId, categoryId, categoryName) {
  try {
    const matchIds = await getDragMatchIds(txId);
    if (matchIds.length > 1) {
      const choice = await showBulkCategorizeModal(
        matchIds.length,
        categoryName,
        getDragPayee(txId),
      );
      if (choice === null) return;
      if (choice === 'all') {
        await categorizeMany(matchIds, categoryId, categoryName);
        return;
      }
    }
    await categorizeOne(txId, categoryId, categoryName);
  } catch (err) {
    showToast(err.message || 'Failed to categorize', 'error');
  }
}

async function resolveSubcategoryId(txId, targetCategoryId) {
  const target = resolveCategorizeTarget(targetCategoryId);
  if (target.subcategory_id) return target.subcategory_id;

  let subcategoryId = null;
  const cat = state.categories.find((c) => c.id === target.category_id);
  try {
    const sim = await api.getSimilarTransactions(txId);
    const sug = sim?.suggested_category;
    if (sug?.category_id === target.category_id && sug.subcategory_id) {
      subcategoryId = sug.subcategory_id;
    }
  } catch {
    /* similar hints optional */
  }
  if (!subcategoryId && cat?.subcategories?.length === 1) {
    subcategoryId = cat.subcategories[0].id;
  }
  return subcategoryId;
}

async function categorizeOne(txId, categoryId, categoryName) {
  const target = resolveCategorizeTarget(categoryId);
  const subcategoryId = await resolveSubcategoryId(txId, categoryId);
  await api.categorizeTransaction(txId, {
    category_id: target.category_id,
    subcategory_id: subcategoryId,
  });
  showToast(`Categorized as ${categoryName}`);
  highlightCategory(categoryId);
  await Promise.all([loadCategoryTransactions(), loadAnalytics()]);
}

async function categorizeMany(matchIds, categoryId, categoryName) {
  const target = resolveCategorizeTarget(categoryId);
  const subcategoryId = await resolveSubcategoryId(matchIds[0], categoryId);
  const result = await api.bulkCategorizeTransactions({
    ids: matchIds,
    category_id: target.category_id,
    subcategory_id: subcategoryId,
  });
  const count = result?.updated ?? matchIds.length;
  showToast(`Categorized ${count} entries as ${categoryName}`);
  highlightCategory(categoryId);
  await Promise.all([loadCategoryTransactions(), loadAnalytics()]);
}

let bulkModalResolver = null;

function bindBulkCategorizeModal() {
  const modal = $('#bulk-categorize-modal');
  if (!modal) return;

  const finish = (value) => {
    modal.close();
    const resolve = bulkModalResolver;
    bulkModalResolver = null;
    resolve?.(value);
  };

  $('#bulk-categorize-all')?.addEventListener('click', () => finish('all'));
  $('#bulk-categorize-one')?.addEventListener('click', () => finish('one'));
  $('#bulk-categorize-cancel')?.addEventListener('click', () => finish(null));
  modal.addEventListener('cancel', (e) => {
    e.preventDefault();
    finish(null);
  });
}

function showBulkCategorizeModal(count, categoryName, payee) {
  const modal = $('#bulk-categorize-modal');
  const msg = $('#bulk-categorize-message');
  if (!modal || !msg) return Promise.resolve('one');

  const payeeLabel = payee ? ` from “${payee}”` : '';
  msg.textContent = `Apply “${categoryName}” to all ${count} matching entries${payeeLabel}?`;

  return new Promise((resolve) => {
    bulkModalResolver = resolve;
    modal.showModal();
  });
}

function openCategoryModal() {
  $('#category-name').value = '';
  $('#category-type').value = 'outflow';
  $('#category-modal')?.showModal();
}

function closeCategoryModal() {
  $('#category-modal')?.close();
}

function initInboxResize() {
  const handle = document.querySelector('.inbox-resize-handle');
  const panel = document.querySelector('.inbox-panel');
  if (!handle || !panel) return;

  const saved = localStorage.getItem(INBOX_WIDTH_KEY);
  if (saved) {
    const width = Math.min(INBOX_MAX_WIDTH, Math.max(INBOX_MIN_WIDTH, Number(saved)));
    if (!Number.isNaN(width)) {
      document.documentElement.style.setProperty('--inbox-width', `${width}px`);
    }
  }

  let startX = 0;
  let startWidth = 0;

  const onMove = (e) => {
    const delta = startX - e.clientX;
    const next = Math.min(INBOX_MAX_WIDTH, Math.max(INBOX_MIN_WIDTH, startWidth + delta));
    document.documentElement.style.setProperty('--inbox-width', `${next}px`);
  };

  const onUp = () => {
    handle.classList.remove('resizing');
    document.body.classList.remove('resizing-inbox');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    localStorage.setItem(INBOX_WIDTH_KEY, String(panel.offsetWidth));
  };

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('resizing');
    document.body.classList.add('resizing-inbox');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

async function handleCreateCategory(e) {
  e.preventDefault();
  const name = $('#category-name').value.trim();
  const type = $('#category-type').value;
  if (!name) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!id || !/^[a-z][a-z0-9_]*$/.test(id)) {
    showToast('Category name must start with a letter', 'error');
    return;
  }

  try {
    await api.createCategory({ id, name, type });
    showToast(`Created category "${name}"`);
    closeCategoryModal();
    await loadCategories();
    await loadAnalytics();
  } catch (err) {
    showToast(err.message || 'Failed to create category', 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);

export { state, refreshAll };
