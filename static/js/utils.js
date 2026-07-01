/** Shared formatting and DOM helpers. */

export function formatCurrency(amount, { signed = false } = {}) {
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
  if (!signed) return abs;
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

/** Value already in percent (e.g. 12.5 → "12.5%"). */
export function formatPercent(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function showToast(message, type = 'success') {
  const existing = $('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function setLoading(el, message = 'Loading…') {
  if (!el) return;
  el.innerHTML = `<div class="loading-placeholder">${message}</div>`;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
