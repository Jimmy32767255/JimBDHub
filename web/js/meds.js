import { store, formatDateTime, formatQuantity } from './store.js';
import { t, subscribe } from './i18n.js';

const medModal = document.getElementById('med-modal');
const medForm = document.getElementById('med-form');
const medModalTitle = document.getElementById('med-modal-title');
const medIdInput = document.getElementById('med-id');
const medNameInput = document.getElementById('med-name');
const medCategoryInput = document.getElementById('med-category');
const medBoxInput = document.getElementById('med-box');
const medBoardInput = document.getElementById('med-board');
const medPillsInput = document.getElementById('med-pills');
const medUnitInput = document.getElementById('med-unit');
const medRemainingInput = document.getElementById('med-remaining');
const medNoteInput = document.getElementById('med-note');

const stockModal = document.getElementById('stock-modal');
const stockForm = document.getElementById('stock-form');
const stockMedIdInput = document.getElementById('stock-med-id');
const stockDeltaInput = document.getElementById('stock-delta');
const stockNoteInput = document.getElementById('stock-note');

function percent(med) {
  return med.totalPills > 0 ? Math.round((med.remainingPills / med.totalPills) * 100) : 0;
}

function renderMeds() {
  const tbody = document.querySelector('#meds-table tbody');
  tbody.innerHTML = '';
  store.data.meds.forEach(med => {
    const tr = document.createElement('tr');
    const pct = percent(med);
    tr.innerHTML = `
      <td><strong>${med.name}</strong></td>
      <td>${med.category || t('meds.table.emptyNote')}</td>
      <td>
        <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
        <small style="color: var(--text-muted)">${pct}% · ${med.remainingPills}${med.unit}</small>
      </td>
      <td>${formatQuantity(med)}</td>
      <td>${med.note || t('meds.table.emptyNote')}</td>
      <td>
        <div class="med-actions">
          <button class="btn btn-icon" data-action="adjust" data-id="${med.id}" title="${t('meds.adjustTitle')}">${t('meds.adjust')}</button>
          <button class="btn btn-icon" data-action="edit" data-id="${med.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${med.id}">${t('common.delete')}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '';
  const maxDelta = Math.max(1, ...store.data.logs.map(l => Math.abs(l.delta)));
  store.data.logs.forEach((log, idx) => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.style.animationDelay = `${idx * 60}ms`;
    const width = Math.max(4, (Math.abs(log.delta) / maxDelta) * 160);
    const sign = log.delta > 0 ? '+' : '';
    item.innerHTML = `
      <header>
        <span class="name">${log.name}</span>
        <time>${formatDateTime(log.timestamp)}</time>
      </header>
      <div class="log-bar-wrap">
        <div class="log-bar ${log.delta < 0 ? 'negative' : ''}" style="width: ${width}px"></div>
        <span class="log-delta ${log.delta < 0 ? 'negative' : 'positive'}">${sign}${log.delta}</span>
      </div>
      ${log.note ? `<small style="color: var(--text-muted); display: block; margin-top: 6px">${log.note}</small>` : ''}
    `;
    list.appendChild(item);
  });
}

function openModal(med = null) {
  medForm.reset();
  if (med) {
    medModalTitle.textContent = t('meds.modal.editTitle');
    medIdInput.value = med.id;
    medNameInput.value = med.name;
    medCategoryInput.value = med.category;
    medBoxInput.value = med.boxCount;
    medBoardInput.value = med.boardPerBox;
    medPillsInput.value = med.pillsPerBoard;
    medUnitInput.value = med.unit;
    medRemainingInput.value = med.remainingPills;
    medNoteInput.value = med.note;
  } else {
    medModalTitle.textContent = t('meds.modal.addTitle');
    medIdInput.value = '';
  }
  medModal.setAttribute('aria-hidden', 'false');
  medNameInput.focus();
}

function closeModal() {
  medModal.setAttribute('aria-hidden', 'true');
}

function openStockModal(med) {
  stockForm.reset();
  stockMedIdInput.value = med.id;
  stockModal.setAttribute('aria-hidden', 'false');
  stockDeltaInput.focus();
}

function closeStockModal() {
  stockModal.setAttribute('aria-hidden', 'true');
}

function handleFormSubmit(e) {
  e.preventDefault();
  const box = Number(medBoxInput.value) || 0;
  const board = Number(medBoardInput.value) || 0;
  const pills = Number(medPillsInput.value) || 0;
  const remaining = Number(medRemainingInput.value) || 0;
  const total = box * board * pills;
  const payload = {
    name: medNameInput.value.trim(),
    category: medCategoryInput.value.trim(),
    boxCount: box,
    boardPerBox: board,
    pillsPerBoard: pills,
    unit: medUnitInput.value,
    totalPills: total,
    remainingPills: remaining,
    note: medNoteInput.value.trim()
  };
  if (medIdInput.value) {
    store.updateMed(medIdInput.value, payload);
  } else {
    store.addMed({ ...payload, totalPills: total || remaining, remainingPills: remaining });
  }
  closeModal();
}

function handleStockSubmit(e) {
  e.preventDefault();
  const id = stockMedIdInput.value;
  const delta = Number(stockDeltaInput.value) || 0;
  const note = stockNoteInput.value.trim();
  if (delta === 0) {
    alert(t('meds.validation.stockZero'));
    return;
  }
  store.changeMedStock(id, delta, note || t('meds.stock.defaultReason'));
  closeStockModal();
}

function initMeds() {
  document.getElementById('add-med-btn').addEventListener('click', () => openModal());
  document.getElementById('med-cancel').addEventListener('click', closeModal);
  medModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  medForm.addEventListener('submit', handleFormSubmit);

  document.getElementById('stock-cancel').addEventListener('click', closeStockModal);
  stockModal.querySelector('.modal-backdrop').addEventListener('click', closeStockModal);
  stockForm.addEventListener('submit', handleStockSubmit);

  document.querySelector('#meds-table tbody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const med = store.data.meds.find(m => m.id === id);
    if (!med) return;

    if (action === 'adjust') {
      openStockModal(med);
    } else if (action === 'edit') {
      openModal(med);
    } else if (action === 'delete') {
      if (confirm(t('meds.confirm.delete', { name: med.name }))) {
        store.deleteMed(id);
      }
    }
  });

  store.subscribe(() => {
    renderMeds();
    renderLogs();
  });
  subscribe(() => {
    renderMeds();
    renderLogs();
  });
  renderMeds();
  renderLogs();
}

export { initMeds };
