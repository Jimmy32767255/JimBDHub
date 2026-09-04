import { store, formatDateTime, formatDuration, nowMinute, getMaxLoadedRecords, updateSamplingRate } from './store.js';
import { t, subscribe } from './i18n.js';
import { showAlert, showConfirm } from './dialog.js';
import { platform } from './platform.js';
import { getTheme, subscribe as subscribeTheme } from './theme.js';
import { groupBoardsByBox } from './medInventory.js';

const formTabs = document.querySelectorAll('.form-tab');

const moodForm = document.getElementById('record-form');
const idInput = document.getElementById('record-id');
const timeInput = document.getElementById('record-time');
const valueInput = document.getElementById('record-value');
const valueOut = document.getElementById('value-out');
const mixedInput = document.getElementById('record-mixed');
const mixedValueRow = document.getElementById('mixed-value-row');
const mixedValueInput = document.getElementById('record-mixed-value');
const mixedValueOut = document.getElementById('mixed-value-out');
const noteInput = document.getElementById('record-note');
const cancelBtn = document.getElementById('record-cancel');

const moodTimeNormal = document.getElementById('mood-time-normal');
const moodTimeSimpleDay = document.getElementById('mood-time-simple-day');
const moodTimeSimplePeriod = document.getElementById('mood-time-simple-period');
const recordDate = document.getElementById('record-date');
const recordDatePeriod = document.getElementById('record-date-period');
const recordPeriodGroup = document.getElementById('record-period-group');

const medicationForm = document.getElementById('medication-form');
const medicationIdInput = document.getElementById('medication-id');
const medicationTimeInput = document.getElementById('medication-time');
const medicationTimeNormal = document.getElementById('medication-time-normal');
const medicationTimeSimpleDay = document.getElementById('medication-time-simple-day');
const medicationTimeSimplePeriod = document.getElementById('medication-time-simple-period');
const medicationDate = document.getElementById('medication-date');
const medicationDatePeriod = document.getElementById('medication-date-period');
const medicationPeriodGroup = document.getElementById('medication-period-group');
const medicationDosesList = document.getElementById('medication-doses-list');
const medicationNoteInput = document.getElementById('medication-note');
const medicationCancelBtn = document.getElementById('medication-cancel');

const sleepForm = document.getElementById('sleep-form');
const sleepIdInput = document.getElementById('sleep-id');
const sleepStartInput = document.getElementById('sleep-start');
const sleepEndInput = document.getElementById('sleep-end');
const sleepBedTimeInput = document.getElementById('sleep-bed-time');
const sleepGetOutOfBedTimeInput = document.getElementById('sleep-get-out-of-bed-time');
const sleepQualityInput = document.getElementById('sleep-quality');
const sleepQualityOut = document.getElementById('sleep-quality-out');
const sleepInterruptions = document.getElementById('sleep-interruptions');
const addInterruptionBtn = document.getElementById('add-interruption-btn');
const sleepNoteInput = document.getElementById('sleep-note');
const sleepCancelBtn = document.getElementById('sleep-cancel');

const eventForm = document.getElementById('event-form');
const eventIdInput = document.getElementById('event-id');
const eventTimeInput = document.getElementById('event-time');
const eventTitleInput = document.getElementById('event-title');
const eventNoteInput = document.getElementById('event-note');
const eventShowElapsedInput = document.getElementById('event-show-elapsed');
const eventColorEnabledInput = document.getElementById('event-color-enabled');
const eventColorInput = document.getElementById('event-color');
const eventColorRow = document.getElementById('event-color-row');
const eventAddReminderBtn = document.getElementById('event-add-reminder-btn');
const eventCancelBtn = document.getElementById('event-cancel');

const recordsSearchInput = document.getElementById('records-search');
const recordsPeriodFilter = document.getElementById('records-period-filter');
const recordsTypeFilter = document.getElementById('records-type-filter');
const recordsCustomRange = document.getElementById('records-custom-range');
const recordsRangeStart = document.getElementById('records-range-start');
const recordsRangeEnd = document.getElementById('records-range-end');
const dosesFilterTags = document.getElementById('doses-filter-tags');

let dosesSelectedTags = [];

function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInputValue(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PERIOD_HOURS = { morning: 8, afternoon: 14, evening: 20 };

function getPeriodFromHour(hour) {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDatePeriodTimestamp(dateInput, periodGroup) {
  if (!dateInput || !dateInput.value) return Number.NaN;
  const activeBtn = periodGroup?.querySelector('.segment-btn.active');
  const period = activeBtn?.dataset.period || 'morning';
  const d = parseLocalDate(dateInput.value);
  d.setHours(PERIOD_HOURS[period], 0, 0, 0);
  return d.getTime();
}

function setDatePeriodForm(ts, dateDayInput, datePeriodInput, periodGroup) {
  const dateVal = toDateInputValue(ts);
  if (dateDayInput) dateDayInput.value = dateVal;
  if (datePeriodInput) datePeriodInput.value = dateVal;
  const period = getPeriodFromHour(new Date(ts).getHours());
  periodGroup?.querySelectorAll('.segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
}

function getMoodTimestampFromForm() {
  const theme = getTheme();
  if (theme.simpleMode && theme.simpleModeMood !== false) {
    if (theme.simpleModeGranularity === 'day') {
      const dateVal = recordDate.value;
      if (!dateVal) return Number.NaN;
      const d = parseLocalDate(dateVal);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    }
    return getDatePeriodTimestamp(recordDatePeriod, recordPeriodGroup);
  }
  return new Date(timeInput.value).getTime();
}

function setMoodFormTimestamp(ts) {
  const theme = getTheme();
  if (theme.simpleMode && theme.simpleModeMood !== false) {
    if (theme.simpleModeGranularity === 'day') {
      if (recordDate) recordDate.value = toDateInputValue(ts);
    } else {
      setDatePeriodForm(ts, null, recordDatePeriod, recordPeriodGroup);
    }
  } else if (timeInput) {
    timeInput.value = toDatetimeLocal(ts);
  }
}

function getMedicationTimestampFromForm() {
  const theme = getTheme();
  if (theme.simpleMode && theme.simpleModeMedication !== false) {
    if (theme.simpleModeGranularity === 'day') {
      const dateVal = medicationDate.value;
      if (!dateVal) return Number.NaN;
      const d = parseLocalDate(dateVal);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    }
    return getDatePeriodTimestamp(medicationDatePeriod, medicationPeriodGroup);
  }
  return new Date(medicationTimeInput.value).getTime();
}

function setMedicationFormTimestamp(ts) {
  const theme = getTheme();
  if (theme.simpleMode && theme.simpleModeMedication !== false) {
    if (theme.simpleModeGranularity === 'day') {
      if (medicationDate) medicationDate.value = toDateInputValue(ts);
    } else {
      setDatePeriodForm(ts, null, medicationDatePeriod, medicationPeriodGroup);
    }
  } else if (medicationTimeInput) {
    medicationTimeInput.value = toDatetimeLocal(ts);
  }
}

function applySimpleModeUI() {
  const theme = getTheme();
  const simple = theme.simpleMode === true;
  const simpleMood = simple && theme.simpleModeMood !== false;
  const simpleMedication = simple && theme.simpleModeMedication !== false;
  const granularity = theme.simpleModeGranularity || 'day';
  if (moodTimeNormal) moodTimeNormal.hidden = simpleMood;
  if (moodTimeSimpleDay) moodTimeSimpleDay.hidden = !simpleMood || granularity !== 'day';
  if (moodTimeSimplePeriod) moodTimeSimplePeriod.hidden = !simpleMood || granularity !== 'period';
  if (timeInput) timeInput.required = !simpleMood;
  if (recordDate) recordDate.required = simpleMood && granularity === 'day';
  if (recordDatePeriod) recordDatePeriod.required = simpleMood && granularity === 'period';
  if (medicationTimeNormal) medicationTimeNormal.hidden = simpleMedication;
  if (medicationTimeSimpleDay) medicationTimeSimpleDay.hidden = !simpleMedication || granularity !== 'day';
  if (medicationTimeSimplePeriod) medicationTimeSimplePeriod.hidden = !simpleMedication || granularity !== 'period';
  if (medicationTimeInput) medicationTimeInput.required = !simpleMedication;
  if (medicationDate) medicationDate.required = simpleMedication && granularity === 'day';
  if (medicationDatePeriod) medicationDatePeriod.required = simpleMedication && granularity === 'period';
}

function updateRangeOutputs() {
  valueOut.textContent = valueInput.value;
  mixedValueOut.textContent = mixedValueInput.value;
  sleepQualityOut.textContent = sleepQualityInput.value;
}

function resetForm() {
  moodForm.reset();
  idInput.value = '';
  setMoodFormTimestamp(nowMinute());
  mixedValueRow.hidden = true;
  updateRangeOutputs();
}

function editRecord(record) {
  idInput.value = record.id;
  setMoodFormTimestamp(record.timestamp);
  valueInput.value = record.value;
  mixedInput.checked = record.mixed;
  mixedValueInput.value = record.mixedValue;
  noteInput.value = record.note || '';
  mixedValueRow.hidden = !record.mixed;
  updateRangeOutputs();
  switchForm('mood');
}

function renderDoses(selectedDoses = []) {
  medicationDosesList.innerHTML = '';
  if (store.data.meds.length === 0) {
    medicationDosesList.innerHTML = `<div class="doses-empty">${t('records.moodForm.noMeds')}</div>`;
    return;
  }
  const byId = Object.fromEntries(selectedDoses.map(d => [d.medicationId, d]));
  let meds = store.data.meds;
  if (dosesSelectedTags.length) {
    meds = meds.filter(med => {
      const medTags = new Set(med.tags || []);
      if (med.category) medTags.add(med.category);
      return dosesSelectedTags.some(tag => medTags.has(tag));
    });
  }
  meds.forEach(med => {
    const existing = byId[med.id];
    const row = document.createElement('div');
    row.className = 'dose-row';
    row.innerHTML = `
      <label class="dose-head">
        <input type="checkbox" class="dose-check" data-id="${med.id}" ${existing ? 'checked' : ''}>
        <span class="dose-name">${med.name}</span>
        <input type="number" class="dose-amount" data-id="${med.id}" min="0.1" step="0.01" value="${existing ? existing.amount : 1}" ${existing ? '' : 'disabled'}>
        <span class="dose-unit">${med.unit}</span>
      </label>
    `;
    medicationDosesList.appendChild(row);
    const srcWrap = renderDoseSourcePicker(row, med, existing);
    srcWrap.hidden = srcWrap.hidden || !existing; // 未勾选时不显示来源选择
    row.appendChild(srcWrap);
  });

  medicationDosesList.querySelectorAll('.dose-check').forEach(check => {
    check.addEventListener('change', () => {
      const rowEl = check.closest('.dose-row');
      const amountInput = rowEl.querySelector(`.dose-amount[data-id="${check.dataset.id}"]`);
      const sourceWrap = rowEl.querySelector('.dose-source-wrap');
      if (amountInput) amountInput.disabled = !check.checked;
      if (sourceWrap && !sourceWrap.dataset.none) sourceWrap.hidden = !check.checked;
    });
  });
  renderDosesTagFilter();
}

// 药品来源板/瓶选择器（树形下拉）。仅当该药存在多块/瓶或非散装容器时展示。
function renderDoseSourcePicker(rowEl, med, existing) {
  const boards = (med.boards || []);
  const wrap = document.createElement('div');
  wrap.className = 'dose-source-wrap';
  if (!Array.isArray(boards) || boards.length <= 1 || !(boards.some(b => (b.remaining || 0) > 0) || existing?.boardId)) {
    // 单板/瓶、无明细（散装/旧数据）：不显示来源选择；扣减自动处理
    wrap.hidden = true;
    wrap.dataset.none = '1';
    return wrap;
  }
  const pickName = `dose-board-${med.id}`;
  const boardUnit = med.unit === '片' ? t('unit.board') : t('unit.bottle');
  const selectedId = existing?.boardId;
  const firstNonEmpty = boards.find(b => (b.remaining || 0) > 0) || null;
  const defaultId = selectedId || (firstNonEmpty ? firstNonEmpty.id : (boards[0] ? boards[0].id : null));
  if (defaultId && !rowEl.dataset.boardId) rowEl.dataset.boardId = defaultId;
  const selectEl = document.createElement('div');
  selectEl.className = 'dose-board-pick';
  const groups = groupBoardsByBox(med);
  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'dose-board-preview';
  previewBtn.innerHTML = `<span class="dot"></span><span class="txt">${t('records.medicationForm.sourceLabel')}</span>`;
  const treeBox = document.createElement('div');
  treeBox.className = 'dose-board-tree';
  treeBox.hidden = true;
  previewBtn.addEventListener('click', e => {
    e.stopPropagation();
    treeBox.hidden = !treeBox.hidden;
    previewBtn.classList.toggle('open', !treeBox.hidden);
  });
  groups.forEach(g => {
    if (!g.boards.length) return;
    const grp = document.createElement('div');
    grp.className = 'dose-board-group';
    if (g.boxIndex != null) {
      const h = document.createElement('div');
      h.className = 'dose-board-group-title';
      h.textContent = t('meds.boardDetail.boxLabel', { n: g.boxIndex + 1 });
      grp.appendChild(h);
    }
    g.boards.forEach(b => {
      const lab = document.createElement('label');
      lab.className = 'dose-board-item';
      const empty = (b.remaining || 0) <= 0;
      const rd = document.createElement('input');
      rd.type = 'radio';
      rd.name = pickName;
      rd.value = b.id;
      if (b.id === defaultId) rd.checked = true;
      const labelText = g.boxIndex != null
        ? `${boardUnit} ${g.boards.indexOf(b) + 1}`
        : `${boardUnit} ${b.index + 1}`;
      lab.innerHTML = '';
      lab.appendChild(rd);
      const span = document.createElement('span');
      span.className = 'dose-board-item-label';
      span.innerHTML = `${empty ? '○' : '●'} ${labelText} <small>${t('records.medicationForm.sourceRemaining', { n: Math.max(0, Number(b.remaining) || 0), u: med.unit })}</small>`;
      lab.appendChild(span);
      rd.addEventListener('change', () => {
        rowEl.dataset.boardId = b.id;
        updateSourcePreview(previewBtn, med, b.id);
      });
      grp.appendChild(lab);
    });
    treeBox.appendChild(grp);
  });
  selectEl.appendChild(previewBtn);
  selectEl.appendChild(treeBox);
  wrap.appendChild(selectEl);

  // 默认预览：当前选中板或第一个非空板
  updateSourcePreview(previewBtn, med, defaultId);
  return wrap;
}

function updateSourcePreview(btn, med, boardId) {
  const boards = med.boards || [];
  const txt = btn.querySelector('.txt');
  const dot = btn.querySelector('.dot');
  let picked = boardId ? boards.find(b => b.id === boardId) : null;
  if (!picked) picked = boards.find(b => (b.remaining || 0) > 0) || boards[0];
  if (!picked) {
    if (txt) txt.textContent = t('records.medicationForm.sourceLabel');
    return;
  }
  const boardUnit = med.unit === '片' ? t('unit.board') : t('unit.bottle');
  const label = `${boardUnit} ${boards.indexOf(picked) + 1}`;
  if (dot) dot.style.background = (picked.remaining || 0) > 0 ? 'var(--accent-green)' : 'var(--theme-text-muted)';
  if (txt) txt.textContent = `${label} · ${t('records.medicationForm.sourceRemaining', { n: Math.max(0, Number(picked.remaining) || 0), u: med.unit })}`;
}

function getAllMedTags() {
  const tags = new Set();
  store.data.meds.forEach(med => {
    if (med.category) tags.add(med.category);
    (med.tags || []).forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

function renderDosesTagFilter() {
  if (!dosesFilterTags) return;
  dosesFilterTags.innerHTML = '';
  const tags = getAllMedTags();
  dosesFilterTags.hidden = false;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `dose-tag-btn ${!dosesSelectedTags.length ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    dosesSelectedTags = [];
    renderDoses();
  });
  dosesFilterTags.appendChild(allBtn);

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dose-tag-btn ${dosesSelectedTags.includes(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      const idx = dosesSelectedTags.indexOf(tag);
      if (idx >= 0) dosesSelectedTags.splice(idx, 1);
      else dosesSelectedTags.push(tag);
      renderDoses();
    });
    dosesFilterTags.appendChild(btn);
  });

  if (tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'med-db-tag-hint';
    hint.textContent = t('meds.form.tagFilterHint');
    dosesFilterTags.appendChild(hint);
  }
}

function collectDoses() {
  const rows = medicationDosesList.querySelectorAll('.dose-row');
  const doses = [];
  rows.forEach(row => {
    const check = row.querySelector('.dose-check');
    const amountInput = row.querySelector('.dose-amount');
    if (!check || !check.checked) return;
    const med = store.data.meds.find(m => m.id === check.dataset.id);
    if (!med) return;
    doses.push({
      medicationId: med.id,
      name: med.name,
      amount: Math.max(0.1, Number(amountInput.value) || 1),
      unit: med.unit,
      boardId: row.dataset.boardId || null,
      dosePerTablet: med.dosePerTablet ?? 1,
      doseMassUnit: med.doseMassUnit ?? 'mg',
      onsetMinHours: med.onsetMinHours ?? med.onsetHours ?? 1,
      onsetMaxHours: med.onsetMaxHours ?? med.onsetHours ?? 1,
      peakMinHours: med.peakMinHours ?? med.peakHours ?? 2,
      peakMaxHours: med.peakMaxHours ?? med.peakHours ?? 2,
      halfLifeMinHours: med.halfLifeMinHours ?? med.halfLifeHours ?? 12,
      halfLifeMaxHours: med.halfLifeMaxHours ?? med.halfLifeHours ?? 12
    });
  });
  return doses;
}

function defaultSleepTimes() {
  const end = new Date();
  end.setHours(7, 0, 0, 0);
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);
  if (end.getTime() > Date.now()) {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  return { start: start.getTime(), end: end.getTime() };
}

function resetSleepForm() {
  sleepForm.reset();
  sleepIdInput.value = '';
  const defaults = defaultSleepTimes();
  sleepStartInput.value = toDatetimeLocal(defaults.start);
  sleepEndInput.value = toDatetimeLocal(defaults.end);
  sleepBedTimeInput.value = '';
  sleepGetOutOfBedTimeInput.value = '';
  sleepQualityInput.value = 3;
  sleepInterruptions.innerHTML = '';
  sleepNoteInput.value = '';
  updateRangeOutputs();
}

function addInterruptionRow(awakeAt = null, asleepAt = null) {
  const defaults = defaultSleepTimes();
  const awakeVal = awakeAt ? toDatetimeLocal(awakeAt) : toDatetimeLocal(defaults.start + 3 * 60 * 60 * 1000);
  const asleepVal = asleepAt ? toDatetimeLocal(asleepAt) : toDatetimeLocal(defaults.start + 3.5 * 60 * 60 * 1000);
  const row = document.createElement('div');
  row.className = 'interruption-row';
  row.innerHTML = `
    <label class="form-field">
      <span class="form-label">${t('records.sleepForm.awakeTime')}</span>
      <input type="datetime-local" class="interrupt-awake" value="${awakeVal}" required>
    </label>
    <label class="form-field">
      <span class="form-label">${t('records.sleepForm.asleepTime')}</span>
      <input type="datetime-local" class="interrupt-asleep" value="${asleepVal}" required>
    </label>
    <button type="button" class="btn btn-danger btn-sm remove-interruption">${t('common.delete')}</button>
  `;
  sleepInterruptions.appendChild(row);
}

function collectInterruptions() {
  const rows = sleepInterruptions.querySelectorAll('.interruption-row');
  const interruptions = [];
  rows.forEach(row => {
    const awake = row.querySelector('.interrupt-awake').value;
    const asleep = row.querySelector('.interrupt-asleep').value;
    if (awake && asleep) {
      interruptions.push({ awakeAt: new Date(awake).getTime(), asleepAt: new Date(asleep).getTime() });
    }
  });
  return interruptions.sort((a, b) => a.awakeAt - b.awakeAt);
}

function editSleep(sleep) {
  sleepIdInput.value = sleep.id;
  sleepStartInput.value = toDatetimeLocal(sleep.startTime);
  sleepEndInput.value = toDatetimeLocal(sleep.endTime);
  sleepBedTimeInput.value = sleep.bedTime ? toDatetimeLocal(sleep.bedTime) : '';
  sleepGetOutOfBedTimeInput.value = sleep.getOutOfBedTime ? toDatetimeLocal(sleep.getOutOfBedTime) : '';
  sleepQualityInput.value = sleep.quality;
  sleepNoteInput.value = sleep.note || '';
  sleepInterruptions.innerHTML = '';
  (sleep.interruptions || []).forEach(i => addInterruptionRow(i.awakeAt, i.asleepAt));
  updateRangeOutputs();
  switchForm('sleep');
}

function calcSleepDuration(sleep) {
  const total = Math.max(0, sleep.endTime - sleep.startTime);
  const awakeTotal = (sleep.interruptions || []).reduce((sum, i) => {
    return sum + Math.max(0, i.asleepAt - i.awakeAt);
  }, 0);
  const asleep = Math.max(0, total - awakeTotal);
  return { total, awakeTotal, asleep };
}

function parseRangeDate(dateStr, endOfDay) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, 0);
  return d.getTime();
}

function getCustomRange() {
  const start = parseRangeDate(recordsRangeStart?.value, false);
  const end = parseRangeDate(recordsRangeEnd?.value, true);
  return start !== null && end !== null ? { start, end } : null;
}

// 从 dose.boardId 解析板/瓶标签（如「板1」「瓶2」），未设置/找不到时返回空
function boardLabelOf(d) {
  if (!d || !d.boardId) return '';
  const med = store.data.meds.find(m => m.id === d.medicationId);
  const boards = med && Array.isArray(med.boards) ? med.boards : null;
  if (!boards) return '';
  const idx = boards.findIndex(b => b.id === d.boardId);
  if (idx < 0) return '';
  const boardUnit = med.unit === '片' ? t('unit.board') : t('unit.bottle');
  return `${boardUnit} ${idx + 1}`;
}

// 剂量显示文案（可附带来源板）
function formatDose(d) {
  const src = boardLabelOf(d);
  return `${d.name} ${d.amount}${d.unit}${src ? `（${src}）` : ''}`;
}

function itemText(item) {
  const d = item.data;
  const parts = [];
  if (item.kind === 'mood') {
    parts.push(String(d.value), d.note || '');
  } else if (item.kind === 'medication') {
    parts.push(...(d.doses || []).map(x => formatDose(x)), d.note || '');
  } else if (item.kind === 'sleep') {
    parts.push(d.note || '', String(d.quality || ''));
  } else if (item.kind === 'event') {
    parts.push(d.title || '', d.note || '');
  }
  return parts.join(' ').toLowerCase();
}

function renderRecords() {
  const list = document.getElementById('records-list');
  list.innerHTML = '';

  const periodValue = recordsPeriodFilter?.value || 'all';
  const typeValue = recordsTypeFilter?.value || 'all';
  const searchQuery = (recordsSearchInput?.value || '').trim().toLowerCase();
  const customRange = periodValue === 'custom' ? getCustomRange() : null;
  const periodDays = periodValue === 'all' || periodValue === 'custom' ? null : Number(periodValue);
  const periodCutoff = periodDays ? Date.now() - periodDays * 24 * 60 * 60 * 1000 : null;

  const isMoodRecord = r => r.type !== 'medication';
  const isMedicationRecord = r => r.type === 'medication';
  let moodItems = store.data.records.filter(isMoodRecord).map(r => ({ kind: 'mood', data: r, time: r.timestamp }));
  let medicationItems = store.data.records.filter(isMedicationRecord).map(r => ({ kind: 'medication', data: r, time: r.timestamp }));
  let sleepItems = store.data.sleeps.map(s => ({ kind: 'sleep', data: s, time: s.startTime }));
  let eventItems = store.data.events.map(e => ({ kind: 'event', data: e, time: e.timestamp }));

  // Filter by record type
  if (typeValue !== 'all') {
    moodItems = typeValue === 'mood' ? moodItems : [];
    medicationItems = typeValue === 'medication' ? medicationItems : [];
    sleepItems = typeValue === 'sleep' ? sleepItems : [];
    eventItems = typeValue === 'event' ? eventItems : [];
  }

  if (customRange) {
    moodItems = moodItems.filter(i => i.time >= customRange.start && i.time <= customRange.end);
    medicationItems = medicationItems.filter(i => i.time >= customRange.start && i.time <= customRange.end);
    sleepItems = sleepItems.filter(i => i.time >= customRange.start && i.time <= customRange.end);
    eventItems = eventItems.filter(i => i.time >= customRange.start && i.time <= customRange.end);
  } else if (periodCutoff) {
    moodItems = moodItems.filter(i => i.time >= periodCutoff);
    medicationItems = medicationItems.filter(i => i.time >= periodCutoff);
    sleepItems = sleepItems.filter(i => i.time >= periodCutoff);
    eventItems = eventItems.filter(i => i.time >= periodCutoff);
  }

  let all = [...moodItems, ...medicationItems, ...sleepItems, ...eventItems].sort((a, b) => b.time - a.time);

  // 采样率：当前筛选范围内情绪记录的平均每日数据点数（Dp/d）
  updateSamplingRate(document.getElementById('history-sampling-rate'), moodItems.map(i => i.data));

  if (searchQuery) {
    all = all.filter(item => itemText(item).includes(searchQuery));
  }

  // 仅加载最近的记录，避免记录过多导致卡顿
  const limitHint = document.getElementById('records-limit-hint');
  const maxLoaded = getMaxLoadedRecords();
  const limited = all.length > maxLoaded;
  if (limited) {
    all = all.slice(0, maxLoaded);
  }
  if (limitHint) {
    limitHint.hidden = !limited;
    if (limited) limitHint.textContent = t('records.history.limitHint', { count: maxLoaded });
  }

  // 记录越多，渐入动画步长越小，避免末尾项目等待过久
  let animStep = 50;
  if (getTheme().dynamicAnimationSpeed !== false && all.length > 10) {
    animStep = Math.max(8, Math.min(animStep, Math.floor(3000 / all.length)));
  }

  all.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'record-item';
    el.style.animationDelay = `${idx * animStep}ms`;
    el.dataset.kind = item.kind;
    el.dataset.id = item.data.id;

    if (item.kind === 'mood') {
      const r = item.data;
      const mainClass = r.value === 0 ? 'neutral' : (r.value > 0 ? 'positive' : 'negative');
      const mixedText = r.mixed ? ` / ${r.mixedValue > 0 ? '+' : ''}${r.mixedValue}` : '';
      el.innerHTML = `
        <header>
          <span class="value-badge ${mainClass}">${r.value > 0 ? '+' : ''}${r.value}${mixedText}</span>
          <time>${formatDateTime(r.timestamp)}</time>
        </header>
        ${r.note ? `<p class="note">${r.note}</p>` : ''}
        <footer>
          <button class="btn btn-icon" data-action="edit" data-id="${r.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${r.id}">${t('common.delete')}</button>
        </footer>
      `;
    } else if (item.kind === 'medication') {
      const r = item.data;
      const medText = (r.doses || []).map(d => formatDose(d)).join('、');
      el.innerHTML = `
        <header>
          <span class="event-badge">${t('records.history.medication')}</span>
          <time>${formatDateTime(r.timestamp)} · ${medText}</time>
        </header>
        ${r.note ? `<p class="note">${r.note}</p>` : ''}
        <footer>
          <button class="btn btn-icon" data-action="edit" data-id="${r.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${r.id}">${t('common.delete')}</button>
        </footer>
      `;
    } else if (item.kind === 'sleep') {
      const s = item.data;
      const { total, asleep } = calcSleepDuration(s);
      el.innerHTML = `
        <header>
          <span class="quality-badge">${t('records.history.qualityUnit', { value: s.quality })}</span>
          <time>${formatDateTime(s.startTime)} ~ ${formatDateTime(s.endTime)}</time>
        </header>
        <div class="sleep-meta">
          <span>${t('records.history.totalDuration', { duration: formatDuration(total) })}</span>
          <span>·</span>
          <span>${t('records.history.asleepDuration', { duration: formatDuration(asleep) })}</span>
        </div>
        ${s.note ? `<p class="note">${s.note}</p>` : ''}
        <footer>
          <button class="btn btn-icon" data-action="edit" data-id="${s.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${s.id}">${t('common.delete')}</button>
        </footer>
      `;
    } else {
      const ev = item.data;
      let elapsedText = '';
      if (ev.showElapsedTime) {
        const diff = Date.now() - ev.timestamp;
        const suffix = diff >= 0 ? 'past' : 'future';
        elapsedText = t(`records.history.elapsedTime.${suffix}`, { duration: formatDuration(Math.abs(diff)) });
      }
      el.innerHTML = `
        <header>
          <span class="event-badge">${t('records.history.event')}</span>
          <time>${formatDateTime(ev.timestamp)}</time>
        </header>
        <h4 style="margin: 8px 0 4px; font-size: 15px; font-weight: 600;">${ev.title}</h4>
        ${elapsedText ? `<div class="elapsed-time">${elapsedText}</div>` : ''}
        ${ev.note ? `<p class="note">${ev.note}</p>` : ''}
        <footer>
          <button class="btn btn-icon" data-action="edit" data-id="${ev.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${ev.id}">${t('common.delete')}</button>
        </footer>
      `;
    }
    list.appendChild(el);
  });
}

function hasDuplicateRecord(timestamp, excludeId, isMedication) {
  return store.data.records.some(r =>
    r.id !== excludeId &&
    (r.type === 'medication') === isMedication &&
    Math.abs(r.timestamp - timestamp) < 60000
  );
}

async function notifyAdded(key) {
  if (getTheme().recordAddToast === false) return;
  await showAlert(t(key));
}

async function handleSubmit(e) {
  e.preventDefault();
  const payload = {
    timestamp: getMoodTimestampFromForm(),
    value: Number(valueInput.value),
    mixed: mixedInput.checked,
    mixedValue: mixedInput.checked ? Number(mixedValueInput.value) : 0,
    note: noteInput.value.trim(),
    type: 'mood'
  };
  if (hasDuplicateRecord(payload.timestamp, idInput.value, false)) {
    await showAlert(t('records.validation.duplicateMood'));
    return;
  }
  if (idInput.value) {
    store.updateRecord(idInput.value, payload);
  } else {
    store.addRecord(payload);
    await notifyAdded('records.toast.addedMood');
  }
  resetForm();
}

function adjustStockForDoses(doses, noteKey, multiplier = -1) {
  doses.forEach(d => {
    if (!d.medicationId) return;
    // multiplier=-1：服药扣减；=1：删除退还。preferredBoardId 决定从哪个板/瓶扣/退
    store.changeMedStock(d.medicationId, multiplier * d.amount, t(noteKey), null, d.boardId || null);
  });
}

function sumDosesByMed(doses) {
  const map = {};
  doses.forEach(d => {
    if (!d.medicationId) return;
    map[d.medicationId] = (map[d.medicationId] || 0) + d.amount;
  });
  return map;
}

// 记录板/瓶来源（取该药首个有效 dose 的 boardId）
function boardOfDoses(doses) {
  const map = {};
  doses.forEach(d => {
    if (!d.medicationId) return;
    if (!map[d.medicationId] && d.boardId) map[d.medicationId] = d.boardId;
  });
  return map;
}

// 编辑服药记录时校正库存：按药品净差调整。减少时优先扣到新剂量指定的来源板，
// 增加（退回）时回补到旧剂量指定的来源板。
function adjustStockForEdit(oldRecord, newRecord) {
  const oldByMed = sumDosesByMed(oldRecord.doses || []);
  const newByMed = sumDosesByMed(newRecord.doses || []);
  const oldBoard = boardOfDoses(oldRecord.doses || []);
  const newBoard = boardOfDoses(newRecord.doses || []);
  const allIds = new Set([...Object.keys(oldByMed), ...Object.keys(newByMed)]);
  allIds.forEach(medId => {
    const diff = (newByMed[medId] || 0) - (oldByMed[medId] || 0);
    if (diff !== 0) {
      const boardId = diff < 0 ? (newBoard[medId] || null) : (oldBoard[medId] || null);
      store.changeMedStock(medId, -diff, t('records.moodForm.doseAdjustLogNote'), null, boardId);
    }
  });
}

async function validateSleep(payload, interruptions, excludeId = '') {
  if (payload.endTime <= payload.startTime) {
    await showAlert(t('records.validation.endAfterStart'));
    return false;
  }
  for (const i of interruptions) {
    if (i.asleepAt <= i.awakeAt) {
      await showAlert(t('records.validation.interruptionOrder'));
      return false;
    }
    if (i.awakeAt < payload.startTime || i.asleepAt > payload.endTime) {
      await showAlert(t('records.validation.interruptionRange'));
      return false;
    }
  }
  if (payload.bedTime !== null && payload.startTime < payload.bedTime) {
    await showAlert(t('records.validation.startBeforeBed'));
    return false;
  }
  if (payload.getOutOfBedTime !== null && payload.endTime > payload.getOutOfBedTime) {
    await showAlert(t('records.validation.endAfterOutOfBed'));
    return false;
  }
  const newBedStart = payload.bedTime || payload.startTime;
  const newBedEnd = payload.getOutOfBedTime || payload.endTime;
  const overlapping = store.data.sleeps.some(s => {
    if (s.id === excludeId) return false;
    const bedStart = s.bedTime || s.startTime;
    const bedEnd = s.getOutOfBedTime || s.endTime;
    return newBedStart < bedEnd && bedStart < newBedEnd;
  });
  if (overlapping) {
    await showAlert(t('records.validation.sleepOverlap'));
    return false;
  }
  return true;
}

async function handleSleepSubmit(e) {
  e.preventDefault();
  const interruptions = collectInterruptions();
  const payload = {
    startTime: new Date(sleepStartInput.value).getTime(),
    endTime: new Date(sleepEndInput.value).getTime(),
    bedTime: sleepBedTimeInput.value ? new Date(sleepBedTimeInput.value).getTime() : null,
    getOutOfBedTime: sleepGetOutOfBedTimeInput.value ? new Date(sleepGetOutOfBedTimeInput.value).getTime() : null,
    quality: Number(sleepQualityInput.value),
    interruptions,
    note: sleepNoteInput.value.trim()
  };
  if (!(await validateSleep(payload, interruptions, sleepIdInput.value))) return;
  if (sleepIdInput.value) {
    store.updateSleep(sleepIdInput.value, payload);
  } else {
    store.addSleep(payload);
    await notifyAdded('records.toast.addedSleep');
  }
  resetSleepForm();
}

function resetEventForm() {
  eventForm.reset();
  eventIdInput.value = '';
  eventTimeInput.value = toDatetimeLocal(nowMinute());
  eventTitleInput.value = '';
  eventNoteInput.value = '';
  eventShowElapsedInput.checked = false;
  eventColorEnabledInput.checked = false;
  eventColorRow.hidden = true;
  eventColorInput.value = getTheme().accentColor;
}

function editEvent(event) {
  eventIdInput.value = event.id;
  eventTimeInput.value = toDatetimeLocal(event.timestamp);
  eventTitleInput.value = event.title || '';
  eventNoteInput.value = event.note || '';
  eventShowElapsedInput.checked = event.showElapsedTime === true;
  const hasColor = !!event.color;
  eventColorEnabledInput.checked = hasColor;
  eventColorRow.hidden = !hasColor;
  eventColorInput.value = event.color || getTheme().accentColor;
  switchForm('event');
}

function resetMedicationForm() {
  medicationForm.reset();
  medicationIdInput.value = '';
  setMedicationFormTimestamp(nowMinute());
  renderDoses([]);
  medicationNoteInput.value = '';
}

function editMedicationRecord(record) {
  medicationIdInput.value = record.id;
  setMedicationFormTimestamp(record.timestamp);
  renderDoses(record.doses || []);
  medicationNoteInput.value = record.note || '';
  switchForm('medication');
}

async function handleMedicationSubmit(e) {
  e.preventDefault();
  const doses = collectDoses();
  const timestamp = getMedicationTimestampFromForm();
  if (hasDuplicateRecord(timestamp, medicationIdInput.value, true)) {
    await showAlert(t('records.validation.duplicateMedication'));
    return;
  }
  const payload = {
    timestamp,
    doses,
    note: medicationNoteInput.value.trim(),
    type: 'medication'
  };
  if (medicationIdInput.value) {
    const oldRecord = store.data.records.find(r => r.id === medicationIdInput.value);
    store.updateRecord(medicationIdInput.value, payload);
    adjustStockForEdit(oldRecord, payload);
  } else {
    store.addRecord(payload);
    adjustStockForDoses(doses, 'records.moodForm.doseLogNote', -1);
    await notifyAdded('records.toast.addedMedication');
  }
  resetMedicationForm();
}

function switchForm(name) {
  formTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.form === name);
  });
  moodForm.hidden = name !== 'mood';
  medicationForm.hidden = name !== 'medication';
  sleepForm.hidden = name !== 'sleep';
  eventForm.hidden = name !== 'event';
}

function loadMemo() {
  // 备忘录归入数据层统一管理：未加密时读取明文，加密时读取内存中的解密缓存
  return store.getMemo();
}

function saveMemo(text) {
  store.setMemo(text);
}

function initMemo() {
  const textarea = document.getElementById('memo-text');
  if (!textarea) return;
  textarea.value = loadMemo();
  let saveTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveMemo(textarea.value), 300);
  });
}

function refreshCurrentTimes() {
  if (!idInput.value && !moodForm.hidden) {
    setMoodFormTimestamp(nowMinute());
  }
  if (!medicationIdInput.value && medicationForm && !medicationForm.hidden) {
    setMedicationFormTimestamp(nowMinute());
  }
  if (!eventIdInput.value && !eventForm.hidden) {
    eventTimeInput.value = toDatetimeLocal(nowMinute());
  }
}

function initRecords() {
  if (eventAddReminderBtn) {
    eventAddReminderBtn.hidden = !platform.isEventReminderSupported();
  }

  initMemo();
  setMoodFormTimestamp(nowMinute());
  resetMedicationForm();
  applySimpleModeUI();
  updateRangeOutputs();

  valueInput.addEventListener('input', updateRangeOutputs);
  mixedValueInput.addEventListener('input', updateRangeOutputs);
  sleepQualityInput.addEventListener('input', updateRangeOutputs);

  mixedInput.addEventListener('change', () => {
    mixedValueRow.hidden = !mixedInput.checked;
  });
  cancelBtn.addEventListener('click', resetForm);
  moodForm.addEventListener('submit', handleSubmit);

  recordPeriodGroup?.addEventListener('click', e => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    recordPeriodGroup.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  medicationPeriodGroup?.addEventListener('click', e => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    medicationPeriodGroup.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  medicationCancelBtn?.addEventListener('click', resetMedicationForm);
  medicationForm?.addEventListener('submit', handleMedicationSubmit);

  formTabs.forEach(tab => {
    tab.addEventListener('click', () => switchForm(tab.dataset.form));
  });

  sleepCancelBtn.addEventListener('click', resetSleepForm);
  sleepForm.addEventListener('submit', handleSleepSubmit);
  addInterruptionBtn.addEventListener('click', () => addInterruptionRow());
  sleepInterruptions.addEventListener('click', e => {
    const btn = e.target.closest('.remove-interruption');
    if (btn) btn.closest('.interruption-row').remove();
  });

  eventCancelBtn.addEventListener('click', resetEventForm);
  eventForm.addEventListener('submit', handleEventSubmit);
  eventColorEnabledInput?.addEventListener('change', () => {
    const enabled = eventColorEnabledInput.checked;
    eventColorRow.hidden = !enabled;
    if (enabled && !eventColorInput.value) eventColorInput.value = getTheme().accentColor;
  });
  eventAddReminderBtn?.addEventListener('click', async () => {
    const timestamp = new Date(eventTimeInput.value).getTime();
    const title = eventTitleInput.value.trim();
    if (Number.isNaN(timestamp) || !title) {
      await showAlert(t('records.validation.requiredEventReminder'));
      return;
    }
    await platform.addEventReminder({
      title,
      description: eventNoteInput.value.trim(),
      beginTime: timestamp,
      endTime: timestamp + 60 * 60 * 1000
    });
  });

  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === 'records') {
      refreshCurrentTimes();
    }
  });

  recordsSearchInput?.addEventListener('input', () => renderRecords());
  recordsPeriodFilter?.addEventListener('change', () => {
    if (recordsCustomRange) recordsCustomRange.hidden = recordsPeriodFilter?.value !== 'custom';
    renderRecords();
  });
  recordsTypeFilter?.addEventListener('change', () => renderRecords());
  recordsRangeStart?.addEventListener('change', () => renderRecords());
  recordsRangeEnd?.addEventListener('change', () => renderRecords());

  document.getElementById('records-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const itemEl = btn.closest('.record-item');
    const kind = itemEl.dataset.kind;

    if (kind === 'mood') {
      const record = store.data.records.find(r => r.id === id);
      if (!record) return;
      if (action === 'edit') {
        editRecord(record);
      } else if (action === 'delete') {
        if (await showConfirm(t('records.confirm.deleteMood'))) {
          store.deleteRecord(id);
        }
      }
    } else if (kind === 'medication') {
      const record = store.data.records.find(r => r.id === id);
      if (!record) return;
      if (action === 'edit') {
        editMedicationRecord(record);
      } else if (action === 'delete') {
        if (await showConfirm(t('records.confirm.deleteMedication'))) {
          adjustStockForDoses(record.doses || [], 'records.moodForm.doseDeleteLogNote', 1);
          store.deleteRecord(id);
        }
      }
    } else if (kind === 'sleep') {
      const sleep = store.data.sleeps.find(s => s.id === id);
      if (!sleep) return;
      if (action === 'edit') {
        editSleep(sleep);
      } else if (action === 'delete') {
        if (await showConfirm(t('records.confirm.deleteSleep'))) {
          store.deleteSleep(id);
        }
      }
    } else {
      const event = store.data.events.find(ev => ev.id === id);
      if (!event) return;
      if (action === 'edit') {
        editEvent(event);
      } else if (action === 'delete') {
        if (await showConfirm(t('records.confirm.deleteEvent'))) {
          store.deleteEvent(id);
        }
      }
    }
  });

  store.subscribe(() => renderRecords());
  subscribe(() => renderRecords());
  subscribeTheme(() => {
    applySimpleModeUI();
    renderRecords();
    if (!idInput.value) {
      setMoodFormTimestamp(nowMinute());
    }
  });
  renderRecords();
}

async function handleEventSubmit(e) {
  e.preventDefault();
  const timestamp = new Date(eventTimeInput.value).getTime();
  const payload = {
    timestamp,
    title: eventTitleInput.value.trim(),
    note: eventNoteInput.value.trim(),
    showElapsedTime: eventShowElapsedInput.checked,
    color: eventColorEnabledInput.checked ? eventColorInput.value : ''
  };
  if (eventIdInput.value) {
    store.updateEvent(eventIdInput.value, payload);
  } else {
    store.addEvent(payload);
    await notifyAdded('records.toast.addedEvent');
  }
  resetEventForm();
}

export { initRecords };
