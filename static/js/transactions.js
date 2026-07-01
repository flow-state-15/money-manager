/** Selected-category transaction drawer — drag source for re-categorization. */

import { formatCurrency, formatDate, $ } from './utils.js';
import * as api from './api.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

let dragStartHandler = null;
let renameHandler = null;

/** @type {{ tx: object, matchIds: number[], ready: Promise<void> } | null} */
let dragContext = null;

/** @type {object[]} */
let cachedTransactions = [];

let headerState = {
  categoryId: null,
  categoryName: null,
  count: 0,
};

export function setCachedTransactions(transactions) {
  cachedTransactions = transactions || [];
}

export function getCachedTransactions() {
  return cachedTransactions;
}

export function onCategoryRename(handler) {
  renameHandler = handler;
}

function formatDrawerTitle(categoryName, count) {
  return `${categoryName} (${count})`;
}

function setRenameButtonVisible(visible) {
  const btn = $('#drawer-rename-btn');
  if (btn) btn.classList.toggle('hidden', !visible);
}

function renderDrawerTitleText(categoryName, count) {
  const title = $('#drawer-title');
  if (!title) return;
  title.textContent = formatDrawerTitle(categoryName, count);
  title.classList.remove('hidden');
  title.dataset.categoryName = categoryName;
}

export function updateDrawerHeader({ categoryId = null, categoryName = null, count = 0 } = {}) {
  const title = $('#drawer-title');
  const hint = $('#drawer-hint');
  if (!title) return;

  headerState = { categoryId, categoryName, count };

  if (!categoryName) {
    title.textContent = 'Transactions';
    delete title.dataset.categoryName;
    if (hint) hint.textContent = 'Select a category on the left to view its transactions';
    setRenameButtonVisible(false);
    return;
  }

  renderDrawerTitleText(categoryName, count);
  if (hint) {
    hint.textContent = 'Drag transactions onto a category card to re-categorize';
  }
  setRenameButtonVisible(Boolean(categoryId));
}

function startInlineRename() {
  const { categoryId, categoryName, count } = headerState;
  if (!categoryId || !categoryName) return;

  const title = $('#drawer-title');
  const row = title?.closest('.drawer-title-row');
  if (!title || !row || row.querySelector('.drawer-title-input')) return;

  title.classList.add('hidden');
  setRenameButtonVisible(false);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'drawer-title-input';
  input.value = categoryName;
  input.setAttribute('aria-label', 'Category name');
  input.maxLength = 128;
  row.insertBefore(input, title.nextSibling);
  input.focus();
  input.select();

  let finished = false;

  const finish = async (save) => {
    if (finished) return;
    finished = true;

    const nextName = input.value.trim();
    input.remove();

    if (save && nextName && nextName !== categoryName && renameHandler) {
      const ok = await renameHandler(categoryId, nextName);
      if (ok) return;
    }

    renderDrawerTitleText(categoryName, count);
    setRenameButtonVisible(true);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });

  input.addEventListener('blur', () => finish(true));
}

function bindRenameButton() {
  const btn = $('#drawer-rename-btn');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    startInlineRename();
  });
}

bindRenameButton();

export function renderCategoryTransactionList(container, transactions, options = {}) {
  const {
    period = 'monthly',
    categoryType = 'outflow',
    isUncategorized = false,
    categoryName = null,
    categoryId = null,
  } = options;

  cachedTransactions = transactions || [];
  updateDrawerHeader({ categoryId, categoryName, count: 0 });

  if (!categoryName) {
    container.innerHTML = `
      <div class="inbox-empty">
        <div class="icon">←</div>
        <p>Select a category</p>
        <p class="muted">Choose a category card to see its transactions here</p>
      </div>`;
    return;
  }

  const filtered = filterByCategoryType(transactions, categoryType, isUncategorized);
  updateDrawerHeader({ categoryId, categoryName, count: filtered.length });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="inbox-empty">
        <div class="icon">—</div>
        <p>No transactions</p>
        <p class="muted">Nothing in this category for this account</p>
      </div>`;
    return;
  }

  container.innerHTML = '';

  if (period === 'total') {
    const sorted = sortByDateDesc(filtered);
    for (const tx of sorted) {
      container.appendChild(buildTransactionRow(tx));
    }
    return;
  }

  const sorted = sortByDateDesc(filtered);
  const minDate = parseTxnDate(sorted[sorted.length - 1].date);
  const maxDate = parseTxnDate(sorted[0].date);
  const periodKeys = listPeriodKeys(minDate, maxDate, period);
  const byPeriod = groupByPeriod(sorted, period);

  for (const key of periodKeys) {
    container.appendChild(buildPeriodSeparator(key, period));
    const rows = byPeriod.get(key) || [];
    for (const tx of rows) {
      container.appendChild(buildTransactionRow(tx));
    }
  }
}

function filterByCategoryType(transactions, categoryType, isUncategorized) {
  if (!transactions?.length) return [];
  if (isUncategorized) return [...transactions];
  if (categoryType === 'inflow') {
    return transactions.filter((t) => Number(t.amount) > 0);
  }
  return transactions.filter((t) => Number(t.amount) < 0);
}

function parseTxnDate(iso) {
  return new Date(`${iso}T00:00:00`);
}

function sortByDateDesc(transactions) {
  return [...transactions].sort((a, b) => {
    const da = parseTxnDate(a.date).getTime();
    const db = parseTxnDate(b.date).getTime();
    if (db !== da) return db - da;
    return (b.id || 0) - (a.id || 0);
  });
}

function periodKeyForDate(d, period) {
  if (period === 'monthly') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (period === 'quarterly') {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  if (period === 'yearly') {
    return String(d.getFullYear());
  }
  return 'total';
}

function listPeriodKeys(minDate, maxDate, period) {
  const keys = [];
  if (period === 'monthly') {
    let y = minDate.getFullYear();
    let m = minDate.getMonth();
    const endY = maxDate.getFullYear();
    const endM = maxDate.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${String(m + 1).padStart(2, '0')}`);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  } else if (period === 'quarterly') {
    let y = minDate.getFullYear();
    let q = Math.floor(minDate.getMonth() / 3) + 1;
    const endY = maxDate.getFullYear();
    const endQ = Math.floor(maxDate.getMonth() / 3) + 1;
    while (y < endY || (y === endY && q <= endQ)) {
      keys.push(`${y}-Q${q}`);
      q += 1;
      if (q > 4) {
        q = 1;
        y += 1;
      }
    }
  } else if (period === 'yearly') {
    for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y += 1) {
      keys.push(String(y));
    }
  }
  return keys.reverse();
}

function groupByPeriod(transactions, period) {
  const map = new Map();
  for (const tx of transactions) {
    const key = periodKeyForDate(parseTxnDate(tx.date), period);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tx);
  }
  for (const [, rows] of map) {
    rows.sort((a, b) => {
      const da = parseTxnDate(a.date).getTime();
      const db = parseTxnDate(b.date).getTime();
      if (db !== da) return db - da;
      return (b.id || 0) - (a.id || 0);
    });
  }
  return map;
}

function formatPeriodLabel(key, period) {
  if (period === 'monthly') {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }
  if (period === 'quarterly') {
    return key.replace('-', ' ');
  }
  return key;
}

function buildPeriodSeparator(key, period) {
  const sep = document.createElement('div');
  sep.className = 'period-separator';
  sep.setAttribute('role', 'separator');
  sep.setAttribute('aria-label', formatPeriodLabel(key, period));
  sep.innerHTML = `<span class="period-separator-label">${escapeHtml(formatPeriodLabel(key, period))}</span>`;
  return sep;
}

function buildTransactionRow(tx) {
  const row = document.createElement('div');
  row.className = 'transaction-row';
  row.draggable = true;
  row.dataset.transactionId = tx.id;

  const isCredit = Number(tx.amount) > 0;
  row.innerHTML = `
    <span class="tx-date">${formatDate(tx.date)}</span>
    <span class="tx-desc" title="${escapeAttr(tx.description || tx.normalized_payee || '')}">${escapeHtml(tx.description || tx.normalized_payee || '—')}</span>
    <span class="tx-amount ${isCredit ? 'credit' : 'debit'}">${formatCurrency(tx.amount, { signed: true })}</span>
  `;

  row.addEventListener('dragstart', (e) => onDragStart(e, tx));
  row.addEventListener('dragend', onDragEnd);

  loadSimilarHint(row, tx.id);
  return row;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

async function loadSimilarHint(row, txId) {
  try {
    const data = await api.getSimilarTransactions(txId);
    const similar = data?.similar || [];
    const suggested = data?.suggested_category;
    if (!similar.length && !suggested) return;

    const hint = document.createElement('div');
    hint.className = 'tx-similar';
    if (suggested?.category_id) {
      const name = suggested.category_id.replace(/_/g, ' ');
      hint.textContent = `Similar: ${similar.length} past → ${name}`;
    } else if (similar.length) {
      hint.textContent = `Similar: ${similar.length} matching payee`;
    }
    row.appendChild(hint);
  } catch {
    /* endpoint may not exist yet */
  }
}

function onDragStart(e, tx) {
  e.dataTransfer.setData('text/transaction-id', String(tx.id));
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');

  dragContext = {
    tx,
    matchIds: [tx.id],
    ready: loadDragMatches(tx),
  };

  if (dragStartHandler) dragStartHandler(tx, e);
  showSimilarTooltip(tx, e);
}

async function loadDragMatches(tx) {
  try {
    const data = await api.getSimilarTransactions(tx.id);
    const similar = data?.similar || [];
    const ids = new Set([tx.id, ...similar.map((s) => s.id)]);
    if (dragContext?.tx?.id === tx.id) {
      dragContext.matchIds = [...ids];
    }
  } catch {
    /* similar hints optional */
  }
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  hideSimilarTooltip();
  dragContext = null;
}

async function showSimilarTooltip(tx, e) {
  const el = $('#similar-hint');
  if (!el) return;

  try {
    const data = await api.getSimilarTransactions(tx.id);
    const similar = data?.similar || [];
    const suggested = data?.suggested_category;
    if (!similar.length && !suggested) return;

    const parts = [];
    if (similar.length) parts.push(`${similar.length} same-payee transaction(s)`);
    if (suggested?.category_id) {
      parts.push(`suggested: ${suggested.category_id.replace(/_/g, ' ')}`);
    }
    el.textContent = parts.join(' · ');
    el.classList.remove('hidden');
    positionTooltip(el, e);
  } catch {
    /* ignore */
  }
}

function positionTooltip(el, e) {
  el.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 300)}px`;
  el.style.top = `${e.clientY + 16}px`;
}

function hideSimilarTooltip() {
  const el = $('#similar-hint');
  if (el) el.classList.add('hidden');
}

export function onTransactionDragStart(handler) {
  dragStartHandler = handler;
}

export async function getDragMatchIds(txId) {
  if (!dragContext || String(dragContext.tx.id) !== String(txId)) {
    return [Number(txId)];
  }
  await dragContext.ready;
  return dragContext.matchIds.length ? dragContext.matchIds : [Number(txId)];
}

export function getDragPayee(txId) {
  if (dragContext && String(dragContext.tx.id) === String(txId)) {
    return dragContext.tx.normalized_payee || dragContext.tx.description || '';
  }
  return '';
}

/** Re-render drawer from cache when only period grouping changes. */
export function rerenderDrawerFromCache(options) {
  const container = $('#transaction-list');
  if (!container) return;
  renderCategoryTransactionList(container, cachedTransactions, options);
}
