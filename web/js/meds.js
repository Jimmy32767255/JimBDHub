import { store, formatDateTime, formatQuantity, getMaxLoadedRecords } from './store.js';
import { t, subscribe } from './i18n.js';
import { showAlert, showConfirm } from './dialog.js';
import { platform } from './platform.js';
import { getTheme, DEFAULT_MED_COLORS, subscribe as subscribeTheme } from './theme.js';

const medModal = document.getElementById('med-modal');
const medForm = document.getElementById('med-form');
const medModalTitle = document.getElementById('med-modal-title');
const medIdInput = document.getElementById('med-id');
const medNameInput = document.getElementById('med-name');
const medCategoryInput = document.getElementById('med-category');
const medTagsInput = document.getElementById('med-tags');
const medColorInput = document.getElementById('med-color');
const medBoxInput = document.getElementById('med-box');
const medBoardInput = document.getElementById('med-board');
const medPillsInput = document.getElementById('med-pills');
const medUnitInput = document.getElementById('med-unit');
const medDoseAmountInput = document.getElementById('med-dose-amount');
const medDosePerTabletInput = document.getElementById('med-dose-per-tablet');
const medDoseMassUnitInput = document.getElementById('med-dose-mass-unit');
const medRemainingInput = document.getElementById('med-remaining');
const medOnsetMinInput = document.getElementById('med-onset-min');
const medOnsetMaxInput = document.getElementById('med-onset-max');
const medPeakMinInput = document.getElementById('med-peak-min');
const medPeakMaxInput = document.getElementById('med-peak-max');
const medHalfLifeMinInput = document.getElementById('med-half-life-min');
const medHalfLifeMaxInput = document.getElementById('med-half-life-max');
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
const medAddReminderBtn = document.getElementById('med-add-reminder-btn');
const medsFilterTags = document.getElementById('meds-filter-tags');
const logsFilterTags = document.getElementById('logs-filter-tags');
const logsPeriodFilter = document.getElementById('logs-period-filter');
const logsCustomRange = document.getElementById('logs-custom-range');
const logsRangeStart = document.getElementById('logs-range-start');
const logsRangeEnd = document.getElementById('logs-range-end');

let medDbData = [];
let medDbTagsList = [];
let medDbSelectedTag = '';
let selectedDbMed = null;
let manualFieldsVisible = false;
let currentSchedule = [];
let medsSelectedTags = [];
let logsSelectedTags = [];

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
    selectedDbMed = null;
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
      selectedDbMed = null;
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
  if (selectedDbMed && !medDbSearch.value.trim() && !medDbSelectedTag) {
    medDbResults.innerHTML = `
      <div class="med-db-selected">
        <span class="med-db-selected-icon">✓</span>
        <span>${t('meds.form.dbSelected', { name: selectedDbMed.name })}</span>
      </div>
    `;
    return;
  }
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

function readRangeHours(med, arrayKey, minKey, maxKey, singleKey, fallback) {
  const arr = med[arrayKey];
  if (Array.isArray(arr) && arr.length >= 2) {
    return [arr[0], arr[1]];
  }
  if (med[minKey] !== undefined && med[maxKey] !== undefined) {
    return [med[minKey], med[maxKey]];
  }
  const single = med[singleKey];
  return [single ?? fallback, single ?? fallback];
}

function fillMedForm(med) {
  const [onsetMin, onsetMax] = readRangeHours(med, 'onsetRangeHours', 'onsetMinHours', 'onsetMaxHours', 'onsetHours', 1);
  const [peakMin, peakMax] = readRangeHours(med, 'peakRangeHours', 'peakMinHours', 'peakMaxHours', 'peakHours', 2);
  const [halfLifeMin, halfLifeMax] = readRangeHours(med, 'halfLifeRangeHours', 'halfLifeMinHours', 'halfLifeMaxHours', 'halfLifeHours', 12);

  medNameInput.value = med.name;
  medCategoryInput.value = med.category || '';
  medTagsInput.value = formatTagsInput(med.tags);
  medBoxInput.value = 1;
  medBoardInput.value = 1;
  medPillsInput.value = med.pillsPerBoard || 0;
  medUnitInput.value = med.unit || '片';
  medDoseAmountInput.value = med.doseAmount ?? 1;
  medDosePerTabletInput.value = med.dosePerTablet ?? 1;
  medDoseMassUnitInput.value = med.doseMassUnit ?? 'mg';
  medRemainingInput.value = med.pillsPerBoard || 0;
  medOnsetMinInput.value = onsetMin;
  medOnsetMaxInput.value = onsetMax;
  medPeakMinInput.value = peakMin;
  medPeakMaxInput.value = peakMax;
  medHalfLifeMinInput.value = halfLifeMin;
  medHalfLifeMaxInput.value = halfLifeMax;
  medNoteInput.value = med.note || '';
  medColorInput.value = defaultMedColor();
  resetSchedule();
  selectedDbMed = med;
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
  setManualFieldsVisible(false);
}

function percent(med) {
  return med.totalPills > 0 ? Math.round((med.remainingPills / med.totalPills) * 100) : 0;
}

function parseTagsInput(value) {
  return value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function formatTagsInput(tags) {
  return (tags || []).join(', ');
}

function getAllMedTags() {
  const tags = new Set();
  store.data.meds.forEach(med => {
    if (med.category) tags.add(med.category);
    (med.tags || []).forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

function medHasAnyTag(med, selectedTags) {
  if (!selectedTags || selectedTags.length === 0) return true;
  const medTags = new Set(med.tags || []);
  if (med.category) medTags.add(med.category);
  return selectedTags.some(tag => medTags.has(tag));
}

function parseRangeDate(dateStr, endOfDay) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, 0);
  return d.getTime();
}

function getLogsCustomRange() {
  const start = parseRangeDate(logsRangeStart?.value, false);
  const end = parseRangeDate(logsRangeEnd?.value, true);
  return start !== null && end !== null ? { start, end } : null;
}

export function predictDepletion(med) {
  if (!Array.isArray(med.schedule) || med.schedule.length === 0) return null;
  if (med.remainingPills <= 0) return -1;
  const now = Date.now();
  const sortedSchedule = [...med.schedule].sort();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayFutureTimes = sortedSchedule
    .map(time => {
      const [h, min] = time.split(':').map(Number);
      return todayStart + h * 3600000 + min * 60000;
    })
    .filter(ts => ts > now);
  let remaining = med.remainingPills;
  for (const ts of todayFutureTimes) {
    remaining--;
    if (remaining <= 0) return ts;
  }
  const dailyCount = sortedSchedule.length;
  const fullDays = Math.floor((remaining - 1) / dailyCount);
  const remainder = (remaining - 1) % dailyCount;
  const [h, min] = sortedSchedule[remainder].split(':').map(Number);
  return todayStart + (fullDays + 1) * DAY_MS + h * 3600000 + min * 60000;
}

function formatDepletion(depletionTs) {
  if (depletionTs === -1) return t('meds.depletion.exhausted');
  const diff = depletionTs - Date.now();
  if (diff <= 0) return t('meds.depletion.exhausted');
  const totalMinutes = Math.floor(diff / 60000);
  const totalHours = Math.floor(diff / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days >= 1 && hours > 0) {
    return t('meds.depletion.daysHours', { d: days, h: hours });
  } else if (days >= 1) {
    return t('meds.depletion.days', { d: days });
  } else if (totalHours >= 1) {
    return t('meds.depletion.hours', { h: totalHours });
  } else {
    return t('meds.depletion.minutes', { m: totalMinutes });
  }
}

function renderMeds() {
  const tbody = document.querySelector('#meds-table tbody');
  tbody.innerHTML = '';
  const filtered = medsSelectedTags.length
    ? store.data.meds.filter(med => medHasAnyTag(med, medsSelectedTags))
    : store.data.meds;
  filtered.forEach(med => {
    const tr = document.createElement('tr');
    const pct = percent(med);
    // 截断渐变：渐变覆盖整个条宽，填充宽度截断可见部分
    const fillStyle = `width: ${pct}%; background: linear-gradient(90deg, #ef4444, #eab308 50%, #22c55e); background-size: 120px 100%; background-repeat: no-repeat;`;
    const depletionTs = predictDepletion(med);
    const depletionLine = depletionTs === null ? '' : formatDepletion(depletionTs);
    const tagsHtml = (med.tags || []).slice(0, 3).map(tag => `<span class="med-tag-chip">${tag}</span>`).join('');
    const showDepletionBtn = platform.isAndroid() && depletionTs !== null && depletionTs > 0;
    tr.innerHTML = `
      <td><strong>${med.name}</strong></td>
      <td>${med.category || t('meds.table.emptyNote')}</td>
      <td>
        <div class="progress-bar"><div class="progress-fill" style="${fillStyle}"></div></div>
        <small style="color: var(--text-muted)">${pct}% · ${med.remainingPills}${med.unit}</small>
        ${depletionLine ? `<small style="color: var(--text-muted); display: block">${depletionLine}</small>` : ''}
      </td>
      <td>${formatQuantity(med)}</td>
      <td>${med.note || t('meds.table.emptyNote')}${tagsHtml ? `<div class="med-tags-cell">${tagsHtml}</div>` : ''}</td>
      <td>
        <div class="med-actions">
          ${showDepletionBtn ? `<button class="btn btn-sm" data-action="add-depletion-reminder" data-id="${med.id}" title="${t('meds.table.addDepletionReminder')}">${t('meds.table.addDepletionReminder')}</button>` : ''}
          <button class="btn btn-icon" data-action="adjust" data-id="${med.id}" title="${t('meds.adjustTitle')}">${t('meds.adjust')}</button>
          <button class="btn btn-icon" data-action="edit" data-id="${med.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${med.id}">${t('common.delete')}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  renderMedsTagFilter();
}

function renderMedsTagFilter() {
  if (!medsFilterTags) return;
  medsFilterTags.innerHTML = '';
  const tags = getAllMedTags();
  medsFilterTags.hidden = false;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!medsSelectedTags.length ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    medsSelectedTags = [];
    renderMeds();
  });
  medsFilterTags.appendChild(allBtn);

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${medsSelectedTags.includes(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      const idx = medsSelectedTags.indexOf(tag);
      if (idx >= 0) medsSelectedTags.splice(idx, 1);
      else medsSelectedTags.push(tag);
      renderMeds();
    });
    medsFilterTags.appendChild(btn);
  });

  if (tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'med-db-tag-hint';
    hint.textContent = t('meds.form.tagFilterHint');
    medsFilterTags.appendChild(hint);
  }
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '';
  const medMap = Object.fromEntries(store.data.meds.map(m => [m.id, m]));

  const periodValue = logsPeriodFilter?.value || 'all';
  const customRange = periodValue === 'custom' ? getLogsCustomRange() : null;
  const periodDays = periodValue === 'all' || periodValue === 'custom' ? null : Number(periodValue);
  const periodCutoff = periodDays ? Date.now() - periodDays * 24 * 60 * 60 * 1000 : null;

  let logs = store.data.logs;
  if (customRange) {
    logs = logs.filter(l => l.timestamp >= customRange.start && l.timestamp <= customRange.end);
  } else if (periodCutoff) {
    logs = logs.filter(l => l.timestamp >= periodCutoff);
  }
  if (logsSelectedTags.length) {
    logs = logs.filter(log => {
      const med = medMap[log.medicationId];
      return med && medHasAnyTag(med, logsSelectedTags);
    });
  }
  // 仅加载最近的日志，避免日志过多导致卡顿
  const limitHint = document.getElementById('logs-limit-hint');
  const maxLoaded = getMaxLoadedRecords();
  const limited = logs.length > maxLoaded;
  if (limited) {
    logs = logs.slice(0, maxLoaded);
  }
  if (limitHint) {
    limitHint.hidden = !limited;
    if (limited) limitHint.textContent = t('records.history.limitHint', { count: maxLoaded });
  }
  const maxDelta = Math.max(1, ...logs.map(l => Math.abs(l.delta)));
  // 记录越多，渐入动画步长越小，避免末尾项目等待过久
  let animStep = 60;
  if (getTheme().dynamicAnimationSpeed !== false && logs.length > 10) {
    animStep = Math.max(8, Math.min(animStep, Math.floor(3000 / logs.length)));
  }
  logs.forEach((log, idx) => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.style.animationDelay = `${idx * animStep}ms`;
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
  renderLogsTagFilter();
}

function renderLogsTagFilter() {
  if (!logsFilterTags) return;
  logsFilterTags.innerHTML = '';
  const tags = getAllMedTags();
  logsFilterTags.hidden = false;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!logsSelectedTags.length ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    logsSelectedTags = [];
    renderLogs();
  });
  logsFilterTags.appendChild(allBtn);

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${logsSelectedTags.includes(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      const idx = logsSelectedTags.indexOf(tag);
      if (idx >= 0) logsSelectedTags.splice(idx, 1);
      else logsSelectedTags.push(tag);
      renderLogs();
    });
    logsFilterTags.appendChild(btn);
  });

  if (tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'med-db-tag-hint';
    hint.textContent = t('meds.form.tagFilterHint');
    logsFilterTags.appendChild(hint);
  }
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

function defaultMedColor() {
  return DEFAULT_MED_COLORS[store.data.meds.length % DEFAULT_MED_COLORS.length];
}

function setManualFieldsVisible(visible) {
  manualFieldsVisible = visible;
  medManualFields.hidden = !visible;
  medToggleManual.textContent = visible ? t('meds.form.manualToggleHide') : t('meds.form.manualToggle');
  medNameInput.required = visible;
  medBoxInput.required = visible;
  medBoardInput.required = visible;
  medPillsInput.required = visible;
  medUnitInput.required = visible;
  medDoseAmountInput.required = visible;
  medDosePerTabletInput.required = visible;
  medDoseMassUnitInput.required = visible;
  medRemainingInput.required = visible;
  medOnsetMinInput.required = visible;
  medOnsetMaxInput.required = visible;
  medPeakMinInput.required = visible;
  medPeakMaxInput.required = visible;
  medHalfLifeMinInput.required = visible;
  medHalfLifeMaxInput.required = visible;
}

function toggleManualFields() {
  setManualFieldsVisible(!manualFieldsVisible);
  if (manualFieldsVisible) {
    medNameInput.focus();
  }
}

function openModal(med = null) {
  medForm.reset();
  selectedDbMed = null;
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
  if (med) {
    medModalTitle.textContent = t('meds.modal.editTitle');
    medIdInput.value = med.id;
    medNameInput.value = med.name;
    medCategoryInput.value = med.category;
    medTagsInput.value = formatTagsInput(med.tags);
    medBoxInput.value = med.boxCount;
    const [onsetMin, onsetMax] = readRangeHours(med, 'onsetRangeHours', 'onsetMinHours', 'onsetMaxHours', 'onsetHours', 1);
    const [peakMin, peakMax] = readRangeHours(med, 'peakRangeHours', 'peakMinHours', 'peakMaxHours', 'peakHours', 2);
    const [halfLifeMin, halfLifeMax] = readRangeHours(med, 'halfLifeRangeHours', 'halfLifeMinHours', 'halfLifeMaxHours', 'halfLifeHours', 12);

    medBoardInput.value = med.boardPerBox;
    medPillsInput.value = med.pillsPerBoard;
    medUnitInput.value = med.unit;
    medDoseAmountInput.value = med.doseAmount ?? 1;
    medDosePerTabletInput.value = med.dosePerTablet ?? 1;
    medDoseMassUnitInput.value = med.doseMassUnit ?? 'mg';
    medRemainingInput.value = med.remainingPills;
    medOnsetMinInput.value = onsetMin;
    medOnsetMaxInput.value = onsetMax;
    medPeakMinInput.value = peakMin;
    medPeakMaxInput.value = peakMax;
    medHalfLifeMinInput.value = halfLifeMin;
    medHalfLifeMaxInput.value = halfLifeMax;
    medNoteInput.value = med.note;
    if (medColorInput) {
      const medIdx = store.data.meds.findIndex(m => m.id === med.id);
      medColorInput.value = med.color || DEFAULT_MED_COLORS[medIdx % DEFAULT_MED_COLORS.length];
    }
    currentSchedule = Array.isArray(med.schedule) ? [...med.schedule] : [];
    renderScheduleList();
    setManualFieldsVisible(true);
  } else {
    medModalTitle.textContent = t('meds.modal.addTitle');
    medIdInput.value = '';
    medDoseAmountInput.value = 1;
    medDosePerTabletInput.value = 1;
    medDoseMassUnitInput.value = 'mg';
    medOnsetMinInput.value = 1;
    medOnsetMaxInput.value = 1;
    medPeakMinInput.value = 2;
    medPeakMaxInput.value = 2;
    medHalfLifeMinInput.value = 12;
    medHalfLifeMaxInput.value = 12;
    medColorInput.value = defaultMedColor();
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
  const onsetMin = Math.max(0, Number(medOnsetMinInput.value) || 0);
  const peakMin = Math.max(0, Number(medPeakMinInput.value) || 0);
  const halfLifeMin = Math.max(0.1, Number(medHalfLifeMinInput.value) || 0.1);
  const payload = {
    name: medNameInput.value.trim(),
    category: medCategoryInput.value.trim(),
    tags: parseTagsInput(medTagsInput.value),
    boxCount: box,
    boardPerBox: board,
    pillsPerBoard: pills,
    unit: medUnitInput.value,
    doseAmount: Math.max(0.1, Number(medDoseAmountInput.value) || 1),
    dosePerTablet: Math.max(0.01, Number(medDosePerTabletInput.value) || 1),
    doseMassUnit: medDoseMassUnitInput.value || 'mg',
    totalPills: total,
    remainingPills: remaining,
    onsetMinHours: onsetMin,
    onsetMaxHours: Math.max(onsetMin, Number(medOnsetMaxInput.value) || onsetMin),
    peakMinHours: peakMin,
    peakMaxHours: Math.max(peakMin, Number(medPeakMaxInput.value) || peakMin),
    halfLifeMinHours: halfLifeMin,
    halfLifeMaxHours: Math.max(halfLifeMin, Number(medHalfLifeMaxInput.value) || halfLifeMin),
    color: medColorInput.value,
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
  if (medAddReminderBtn) {
    medAddReminderBtn.hidden = !platform.isMedicationReminderSupported();
  }

  document.getElementById('add-med-btn').addEventListener('click', () => openModal());
  document.getElementById('med-cancel').addEventListener('click', closeModal);
  medModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  medForm.addEventListener('submit', handleFormSubmit);
  medAddReminderBtn?.addEventListener('click', async () => {
    const name = medNameInput.value.trim();
    if (!name || currentSchedule.length === 0) {
      await showAlert(t('meds.validation.requiredReminder'));
      return;
    }
    await platform.addMedicationReminders({
      name,
      times: [...currentSchedule]
    });
  });
  medToggleManual.addEventListener('click', toggleManualFields);
  medAddScheduleBtn.addEventListener('click', addScheduleTime);
  medScheduleTimeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addScheduleTime();
    }
  });

  medDbSearch.addEventListener('input', () => {
    selectedDbMed = null;
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
    } else if (action === 'add-depletion-reminder') {
      const depletionTs = predictDepletion(med);
      if (!depletionTs || depletionTs <= 0) {
        await showAlert(t('meds.validation.requiredDepletionReminder'));
        return;
      }
      await platform.addEventReminder({
        title: t('meds.depletion.reminderTitle', { name: med.name }),
        description: t('meds.depletion.reminderDesc', { name: med.name, remaining: med.remainingPills, unit: med.unit }),
        beginTime: depletionTs,
        endTime: depletionTs + 60 * 60 * 1000
      });
      await showAlert(t('meds.depletion.reminderAdded', { name: med.name }));
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
  subscribeTheme(() => {
    renderMeds();
    renderLogs();
  });

  logsPeriodFilter?.addEventListener('change', () => {
    if (logsCustomRange) logsCustomRange.hidden = logsPeriodFilter?.value !== 'custom';
    renderLogs();
  });
  logsRangeStart?.addEventListener('change', () => renderLogs());
  logsRangeEnd?.addEventListener('change', () => renderLogs());

  renderMeds();
  renderLogs();
  loadMedDB();
}

export { initMeds };
