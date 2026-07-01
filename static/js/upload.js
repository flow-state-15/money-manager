/** Modal CSV upload with drag-and-drop. */

import { $, showToast } from './utils.js';
import * as api from './api.js';

let onSuccess = null;
let getAccountId = () => null;

export function initUpload(onImportSuccess, accountIdGetter) {
  onSuccess = onImportSuccess;
  getAccountId = accountIdGetter || (() => null);

  const modal = $('#import-modal');
  const btnImport = $('#btn-import');
  const btnClose = $('#import-close');
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  btnImport?.addEventListener('click', () => openModal());
  btnClose?.addEventListener('click', () => closeModal());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput?.click();
    }
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });
}

function openModal() {
  const modal = $('#import-modal');
  resetModalState();
  modal?.showModal();
}

function closeModal() {
  const modal = $('#import-modal');
  modal?.close();
  resetModalState();
}

function resetModalState() {
  const progress = $('#import-progress');
  const result = $('#import-result');
  const dropZone = $('#drop-zone');
  progress?.classList.add('hidden');
  result?.classList.add('hidden');
  dropZone?.classList.remove('hidden');
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please select a CSV file', 'error');
    return;
  }

  const progress = $('#import-progress');
  const result = $('#import-result');
  const dropZone = $('#drop-zone');

  dropZone?.classList.add('hidden');
  progress?.classList.remove('hidden');
  result?.classList.add('hidden');

  try {
    const stats = await api.importCsv(file, getAccountId());
    progress?.classList.add('hidden');
    result?.classList.remove('hidden');

    const imported = stats.rows_new ?? stats.imported ?? 0;
    const skipped = stats.rows_duplicate ?? stats.skipped ?? 0;
    const uncat = stats.rows_uncategorized ?? stats.uncategorized ?? '—';

    result.className = 'import-result success';
    result.innerHTML = `
      <strong>Import complete</strong><br>
      ${imported} imported · ${skipped} skipped · ${uncat} uncategorized
    `;

    showToast(`Imported ${imported} transactions`);
    if (onSuccess) onSuccess(stats);

    setTimeout(closeModal, 1800);
  } catch (err) {
    progress?.classList.add('hidden');
    dropZone?.classList.remove('hidden');
    result?.classList.remove('hidden');
    result.className = 'import-result error';
    result.textContent = err.message || 'Import failed';
    showToast('Import failed — is the backend running?', 'error');
  }
}
