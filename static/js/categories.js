/** Category card stack — left sidebar with selectable scope. */

import { formatCurrency, $ } from './utils.js';

const UNCATEGORIZED_ID = 'uncategorized';

let dropHandler = null;
let selectHandler = null;
let selectedCategoryId = null;

/**
 * @param {HTMLElement} container
 * @param {Array} categories
 */
export function renderCategoryStack(container, categories) {
  if (!categories?.length) {
    container.innerHTML = '<div class="loading-placeholder">No categories</div>';
    return;
  }

  container.innerHTML = '';

  for (const cat of categories) {
    const total = cat.total ?? 0;
    const type = cat.type || (cat.id === 'income' ? 'inflow' : 'outflow');
    const isUncat = cat.id === UNCATEGORIZED_ID;

    container.appendChild(buildCard({
      id: cat.id,
      name: cat.name,
      type,
      total,
      isUncat,
    }));
  }
}

function buildCard({ id, name, type, total, isUncat = false }) {
  const isSelected = selectedCategoryId === id;

  const card = document.createElement('div');
  card.className = [
    'category-card',
    type,
    isUncat ? 'uncategorized' : '',
    isSelected ? 'selected' : '',
  ].filter(Boolean).join(' ');
  card.dataset.categoryId = id;
  card.dataset.categoryName = name;
  card.dataset.categoryType = type;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

  card.innerHTML = `
    <span class="category-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
    <span class="category-amount">${formatCurrency(total)}</span>
  `;

  card.addEventListener('dragover', onDragOver);
  card.addEventListener('dragleave', onDragLeave);
  card.addEventListener('drop', onDrop);

  card.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    handleSelect(id);
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect(id);
    }
  });

  return card;
}

function handleSelect(id) {
  const next = selectedCategoryId === id ? null : id;
  applySelection(next);
  if (selectHandler) selectHandler(getSelectedScope());
}

function applySelection(id) {
  selectedCategoryId = id;
  const cards = document.querySelectorAll('.category-card');
  cards.forEach((card) => {
    const cid = card.dataset.categoryId;
    const selected = id === cid;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

/** Programmatically select a category and optionally fire the select handler. */
export function selectCategory(categoryId, { notify = true } = {}) {
  applySelection(categoryId);
  if (notify && selectHandler) selectHandler(getSelectedScope());
}

export function getUncategorizedId() {
  return UNCATEGORIZED_ID;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drop-target');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drop-target');
}

async function onDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');
  const txId = e.dataTransfer.getData('text/transaction-id');
  const categoryId = e.currentTarget.dataset.categoryId;
  if (txId && categoryId && dropHandler) {
    await dropHandler(txId, categoryId, e.currentTarget.dataset.categoryName);
  }
}

export function onCategoryDrop(handler) {
  dropHandler = handler;
}

export function onCategorySelect(handler) {
  selectHandler = handler;
}

export function getSelectedCategoryId() {
  return selectedCategoryId;
}

export function getSelectedCategoryName() {
  const id = getSelectedCategoryId();
  if (!id) return null;
  const card = document.querySelector(`.category-card[data-category-id="${id}"]`);
  return card?.dataset.categoryName || id.replace(/_/g, ' ');
}

/** Update displayed name on a category card after rename. */
export function updateCategoryDisplayName(categoryId, name) {
  const card = document.querySelector(`.category-card[data-category-id="${categoryId}"]`);
  if (!card) return;
  card.dataset.categoryName = name;
  const label = card.querySelector('.category-name');
  if (label) {
    label.textContent = name;
    label.title = name;
  }
}

export function getSelectedCategoryType() {
  const id = getSelectedCategoryId();
  if (!id) return null;
  const card = document.querySelector(`.category-card[data-category-id="${id}"]`);
  return card?.dataset.categoryType || 'outflow';
}

export function isUncategorizedSelected() {
  return getSelectedCategoryId() === UNCATEGORIZED_ID;
}

/** Scope object for API: { type: 'total' } or { type: 'category', category_id [, subcategory_id] }. */
export function getSelectedScope() {
  const id = getSelectedCategoryId();
  if (!id) return { type: 'total' };
  if (id === UNCATEGORIZED_ID) {
    return {
      type: 'category',
      category_id: 'personal',
      subcategory_id: 'uncategorized',
    };
  }
  return { type: 'category', category_id: id };
}

/** Map UI category id to API category_id for transactions/trend queries. */
export function getApiCategoryParams(categoryId = getSelectedCategoryId()) {
  if (!categoryId) return {};
  if (categoryId === UNCATEGORIZED_ID) {
    return { uncategorized_only: true };
  }
  return { category_id: categoryId };
}

/** Map drop/select target id to categorize API body fields. */
export function resolveCategorizeTarget(categoryId) {
  if (categoryId === UNCATEGORIZED_ID) {
    return { category_id: 'personal', subcategory_id: 'uncategorized' };
  }
  return { category_id: categoryId, subcategory_id: null };
}

export function highlightCategory(categoryId) {
  const card = $(`.category-card[data-category-id="${categoryId}"]`);
  if (card) {
    card.classList.add('drop-target');
    setTimeout(() => card.classList.remove('drop-target'), 600);
  }
}

export function setSelectedCategory(categoryId) {
  applySelection(categoryId);
}
