import { store, formatDateTime, formatQuantity } from './store.js';
import { t, subscribe } from './i18n.js';
import { showAlert, showConfirm } from './dialog.js';

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
const medOnsetInput = document.getElementById('med-onset');
const medPeakInput = document.getElementById('med-peak');
const medHalfLifeInput = document.getElementById('med-half-life');
const medNoteInput = document.getElementById('med-note');

const stockModal = document.getElementById('stock-modal');
const stockForm = document.getElementById('stock-form');
const stockMedIdInput = document.getElementById('stock-med-id');
const stockDeltaInput = document.getElementById('stock-delta');
const stockNoteInput = document.getElementById('stock-note');

const logModal = document.getElementById('log-modal');
const logForm = document.getElementById('log-form');
const logModalTitle = document.getElementById('log-modal-title');
const logIdInput = document.getElementById('log-id');
const logMedRow = document.getElementById('log-med-row');
const logMedSelect = document.getElementById('log-med-id');
const logTimeInput = document.getElementById('log-time');
const logDeltaInput = document.getElementById('log-delta');
const logNoteInput = document.getElementById('log-note');

const medDbSearch = document.getElementById('med-db-search');
const medDbTags = document.getElementById('med-db-tags');
const medDbResults = document.getElementById('med-db-results');
const medToggleManual = document.getElementById('med-toggle-manual');
const medManualFields = document.getElementById('med-manual-fields');
const medScheduleList = document.getElementById('med-schedule-list');
const medScheduleTimeInput = document.getElementById('med-schedule-time');
const medAddScheduleBtn = document.getElementById('med-add-schedule');

let medDbData = [];
let medDbTagsList = [];
let medDbSelectedTag = '';
let manualFieldsVisible = false;
let currentSchedule = [];

async function loadMedDB() {
  try {
    const res = await fetch('MedDB.json');
    if (!res.ok) throw new Error('Failed to load MedDB');
    const data = await res.json();
    medDbData = data.medicines || [];
    medDbTagsList = Array.from(new Set(medDbData.flatMap(m => m.tags || []))).sort();
    renderTags();
  } catch (err) {
    medDbData = [];
    medDbTagsList = [];
  }
}

function renderTags() {
  medDbTags.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!medDbSelectedTag ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    medDbSelectedTag = '';
    renderTags();
    renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
  });
  medDbTags.appendChild(allBtn);

  medDbTagsList.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${medDbSelectedTag === tag ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      medDbSelectedTag = medDbSelectedTag === tag ? '' : tag;
      renderTags();
      renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
    });
    medDbTags.appendChild(btn);
  });
}

function filterMeds(query, tag) {
  const q = query.toLowerCase();
  return medDbData.filter(med => {
    const matchesQuery = !q ||
      med.name.toLowerCase().includes(q) ||
      (med.category && med.category.toLowerCase().includes(q)) ||
      (med.tags || []).some(tag => tag.toLowerCase().includes(q));
    const matchesTag = !tag || (med.tags || []).includes(tag);
    return matchesQuery && matchesTag;
  });
}

function renderMedResults(results) {
  medDbResults.innerHTML = '';
  if (!results.length) {
    medDbResults.innerHTML = `<div class="med-db-empty">${t('meds.form.dbNoResults')}</div>`;
    return;
  }
  results.forEach(med => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'med-db-result';
    item.innerHTML = `
      <span class="med-db-result-name">${med.name}</span>
      <span class="med-db-result-meta">${med.category || ''} · ${(med.tags || []).slice(0, 3).join(' / ')}</span>
    `;
    item.addEventListener('click', () => fillMedForm(med));
    medDbResults.appendChild(item);
  });
}

function fillMedForm(med) {
  medNameInput.value = med.name;
  medCategoryInput.value = med.category || '';
  medBoxInput.value = 1;
  medBoardInput.value = 1;
  medPillsInput.value = med.pillsPerBoard || 0;
  medUnitInput.value = med.unit || '片';
  medRemainingInput.value = med.pillsPerBoard || 0;
  medOnsetInput.value = med.onsetHours ?? 1;
  medPeakInput.value = med.peakHours ?? 2;
  medHalfLifeInput.value = med.halfLifeHours ?? 12;
  medNoteInput.value = med.note || '';
  resetSchedule();
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
  setManualFieldsVisible(false);
}

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
      <footer class="log-actions">
        <button class="btn btn-icon btn-sm" data-action="edit-log" data-id="${log.id}">${t('common.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-log" data-id="${log.id}">${t('common.delete')}</button>
      </footer>
    `;
    list.appendChild(item);
  });
}

function renderScheduleList() {
  medScheduleList.innerHTML = '';
  currentSchedule.forEach((time, idx) => {
    const chip = document.createElement('span');
    chip.className = 'schedule-chip';
    chip.innerHTML = `<span>${time}</span><button type="button" data-idx="${idx}" aria-label="${t('common.delete')}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      currentSchedule.splice(idx, 1);
      renderScheduleList();
    });
    medScheduleList.appendChild(chip);
  });
}

function addScheduleTime() {
  const time = medScheduleTimeInput.value;
  if (!time || currentSchedule.includes(time)) return;
  currentSchedule.push(time);
  currentSchedule.sort();
  medScheduleTimeInput.value = '';
  renderScheduleList();
}

function resetSchedule() {
  currentSchedule = [];
  medScheduleTimeInput.value = '';
  renderScheduleList();
}

function setManualFieldsVisible(visible) {
  manualFieldsVisible = visible;
  medManualFields.hidden = !visible;
  medToggleManual.textContent = visible ? t('meds.form.manualToggleHide') : t('meds.form.manualToggle');
  medNameInput.required = visible;
  medOnsetInput.required = visible;
  medPeakInput.required = visible;
  medHalfLifeInput.required = visible;
}

function toggleManualFields() {
  setManualFieldsVisible(!manualFieldsVisible);
  if (manualFieldsVisible) {
    medNameInput.focus();
  }
}

function openModal(med = null) {
  medForm.reset();
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
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
    medOnsetInput.value = med.onsetHours ?? 1;
    medPeakInput.value = med.peakHours ?? 2;
    medHalfLifeInput.value = med.halfLifeHours ?? 12;
    medNoteInput.value = med.note;
    currentSchedule = Array.isArray(med.schedule) ? [...med.schedule] : [];
    renderScheduleList();
    setManualFieldsVisible(true);
  } else {
    medModalTitle.textContent = t('meds.modal.addTitle');
    medIdInput.value = '';
    medOnsetInput.value = 1;
    medPeakInput.value = 2;
    medHalfLifeInput.value = 12;
    resetSchedule();
    setManualFieldsVisible(false);
  }
  medModal.setAttribute('aria-hidden', 'false');
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

function formatDateTimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderLogMedOptions(selectedId = '') {
  logMedSelect.innerHTML = '';
  if (store.data.meds.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('records.moodForm.noMeds');
    logMedSelect.appendChild(option);
    return;
  }
  store.data.meds.forEach(med => {
    const option = document.createElement('option');
    option.value = med.id;
    option.textContent = med.name;
    if (med.id === selectedId) option.selected = true;
    logMedSelect.appendChild(option);
  });
}

function openLogModal(log) {
  logForm.reset();
  logIdInput.value = log.id;
  logMedRow.hidden = true;
  logModalTitle.textContent = t('meds.log.modalTitle');
  logTimeInput.value = formatDateTimeLocal(log.timestamp);
  logDeltaInput.value = log.delta;
  logNoteInput.value = log.note || '';
  logModal.setAttribute('aria-hidden', 'false');
  logTimeInput.focus();
}

function openAddLogModal() {
  logForm.reset();
  logIdInput.value = '';
  logMedRow.hidden = false;
  logModalTitle.textContent = t('meds.log.addModalTitle');
  renderLogMedOptions();
  logTimeInput.value = formatDateTimeLocal(Date.now());
  logDeltaInput.value = '';
  logNoteInput.value = '';
  logModal.setAttribute('aria-hidden', 'false');
  logMedSelect.focus();
}

function closeLogModal() {
  logModal.setAttribute('aria-hidden', 'true');
}

function handleFormSubmit(e) {
  e.preventDefault();
  if (!manualFieldsVisible && !medNameInput.value.trim()) {
    setManualFieldsVisible(true);
    medNameInput.focus();
    return;
  }
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
    onsetHours: Math.max(0, Number(medOnsetInput.value) || 0),
    peakHours: Math.max(0, Number(medPeakInput.value) || 0),
    halfLifeHours: Math.max(0.1, Number(medHalfLifeInput.value) || 0.1),
    schedule: [...currentSchedule],
    note: medNoteInput.value.trim()
  };
  if (medIdInput.value) {
    store.updateMed(medIdInput.value, payload);
  } else {
    store.addMed({ ...payload, totalPills: total || remaining, remainingPills: remaining });
  }
  closeModal();
}

async function handleStockSubmit(e) {
  e.preventDefault();
  const id = stockMedIdInput.value;
  const delta = Number(stockDeltaInput.value) || 0;
  const note = stockNoteInput.value.trim();
  if (delta === 0) {
    await showAlert(t('meds.validation.stockZero'));
    return;
  }
  store.changeMedStock(id, delta, note || t('meds.stock.defaultReason'));
  closeStockModal();
}

async function handleLogSubmit(e) {
  e.preventDefault();
  const id = logIdInput.value;
  const timestamp = new Date(logTimeInput.value).getTime();
  const delta = Number(logDeltaInput.value) || 0;
  const note = logNoteInput.value.trim();
  if (Number.isNaN(timestamp)) {
    await showAlert(t('records.validation.endAfterStart'));
    return;
  }
  if (id) {
    store.updateLog(id, { timestamp, delta, note });
  } else {
    const medId = logMedSelect.value;
    if (!medId) {
      await showAlert(t('records.moodForm.noMeds'));
      return;
    }
    store.addHistoricalLog(medId, { timestamp, delta, note });
  }
  closeLogModal();
}

function initMeds() {
  document.getElementById('add-med-btn').addEventListener('click', () => openModal());
  document.getElementById('med-cancel').addEventListener('click', closeModal);
  medModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  medForm.addEventListener('submit', handleFormSubmit);
  medToggleManual.addEventListener('click', toggleManualFields);
  medAddScheduleBtn.addEventListener('click', addScheduleTime);
  medScheduleTimeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addScheduleTime();
    }
  });

  medDbSearch.addEventListener('input', () => {
    renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
  });

  document.getElementById('stock-cancel').addEventListener('click', closeStockModal);
  stockModal.querySelector('.modal-backdrop').addEventListener('click', closeStockModal);
  stockForm.addEventListener('submit', handleStockSubmit);

  document.getElementById('log-cancel').addEventListener('click', closeLogModal);
  logModal.querySelector('.modal-backdrop').addEventListener('click', closeLogModal);
  logForm.addEventListener('submit', handleLogSubmit);
  document.getElementById('add-log-btn').addEventListener('click', () => openAddLogModal());

  document.querySelector('#meds-table tbody').addEventListener('click', async e => {
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
      if (await showConfirm(t('meds.confirm.delete', { name: med.name }))) {
        store.deleteMed(id);
      }
    }
  });

  document.getElementById('logs-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const log = store.data.logs.find(l => l.id === id);
    if (!log) return;

    if (action === 'edit-log') {
      openLogModal(log);
    } else if (action === 'delete-log') {
      if (await showConfirm(t('meds.log.confirmDelete', { name: log.name }))) {
        store.deleteLog(id);
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
    renderTags();
  });
  renderMeds();
  renderLogs();
  loadMedDB();
}

export { initMeds };
