/** Fetch wrappers for /api/* endpoints. */

import { ApiError } from './utils.js';

const BASE = '';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(String(detail), res.status);
  }

  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/** Health check via dedicated endpoint. */
export async function checkBackend() {
  try {
    await request('/api/health');
    return true;
  } catch {
    return false;
  }
}

export function getAccounts() {
  return request('/api/accounts');
}

export function getCategories() {
  return request('/api/categories');
}

export function createCategory(data) {
  return request('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getCategoryDisplayOverrides() {
  return request('/api/categories/overrides');
}

export function updateCategory(categoryId, data) {
  return request(`/api/categories/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getTransactions(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return request(`/api/transactions${q ? `?${q}` : ''}`);
}

export function categorizeTransaction(id, body) {
  return request(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function bulkCategorizeTransactions(body) {
  return request('/api/transactions/bulk-categorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getAnalyticsSummary(params = {}) {
  const qs = new URLSearchParams(params);
  return request(`/api/analytics/summary?${qs}`);
}

export function getCategoryTrend(params = {}) {
  const qs = new URLSearchParams(params);
  return request(`/api/analytics/category-trend?${qs}`);
}

export function getSimilarTransactions(transactionId, limit = 500) {
  return request(`/api/transactions/${transactionId}/similar?limit=${limit}`);
}

export function postProjections(body) {
  return request('/api/projections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function importCsv(file, accountId = null) {
  const form = new FormData();
  form.append('files', file);
  const qs = accountId ? `?account_id=${accountId}` : '';
  return request(`/api/import${qs}`, { method: 'POST', body: form });
}
