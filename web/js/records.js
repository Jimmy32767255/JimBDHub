import { store, formatDateTime, formatDuration, nowHourFloor } from './store.js';
import { t, subscribe } from './i18n.js';
import { showAlert, showConfirm } from './dialog.js';

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
const medicationInput = document.getElementById('record-medication');
const dosesField = document.getElementById('medication-doses-field');
const dosesList = document.getElementById('medication-doses-list');
const noteInput = document.getElementById('record-note');
const cancelBtn = document.getElementById('record-cancel');

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
const eventCancelBtn = document.getElementById('event-cancel');

function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateRangeOutputs() {
  valueOut.textContent = valueInput.value;
  mixedValueOut.textContent = mixedValueInput.value;
  sleepQualityOut.textContent = sleepQualityInput.value;
}

function resetForm() {
  moodForm.reset();
  idInput.value = '';
  timeInput.value = toDatetimeLocal(nowHourFloor());
  mixedValueRow.hidden = true;
  dosesField.hidden = true;
  renderDoses([]);
  updateRangeOutputs();
}

function editRecord(record) {
  idInput.value = record.id;
  timeInput.value = toDatetimeLocal(record.timestamp);
  valueInput.value = record.value;
  mixedInput.checked = record.mixed;
  mixedValueInput.value = record.mixedValue;
  medicationInput.checked = !!record.doses && record.doses.length > 0;
  noteInput.value = record.note || '';
  mixedValueRow.hidden = !record.mixed;
  dosesField.hidden = !medicationInput.checked;
  renderDoses(record.doses || []);
  updateRangeOutputs();
  switchForm('mood');
}

function renderDoses(selectedDoses = []) {
  dosesList.innerHTML = '';
  if (store.data.meds.length === 0) {
    dosesList.innerHTML = `<div class="doses-empty">${t('records.moodForm.noMeds')}</div>`;
    return;
  }
  const byId = Object.fromEntries(selectedDoses.map(d => [d.medicationId, d]));
  store.data.meds.forEach(med => {
    const existing = byId[med.id];
    const row = document.createElement('label');
    row.className = 'dose-row';
    row.innerHTML = `
      <input type="checkbox" class="dose-check" data-id="${med.id}" ${existing ? 'checked' : ''}>
      <span class="dose-name">${med.name}</span>
      <input type="number" class="dose-amount" data-id="${med.id}" min="0.1" step="0.1" value="${existing ? existing.amount : 1}" ${existing ? '' : 'disabled'}>
      <span class="dose-unit">${med.unit}</span>
    `;
    dosesList.appendChild(row);
  });

  dosesList.querySelectorAll('.dose-check').forEach(check => {
    check.addEventListener('change', () => {
      const rowEl = check.closest('.dose-row');
      const amountInput = rowEl.querySelector(`.dose-amount[data-id="${check.dataset.id}"]`);
      if (amountInput) amountInput.disabled = !check.checked;
    });
  });
}

function collectDoses() {
  const rows = dosesList.querySelectorAll('.dose-row');
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
      onsetHours: med.onsetHours ?? 1,
      peakHours: med.peakHours ?? 2,
      halfLifeHours: med.halfLifeHours ?? 12
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
  sleepEyeOpenTimeInput.value = '';
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

function renderRecords() {
  const list = document.getElementById('records-list');
  list.innerHTML = '';

  const moodItems = store.data.records.map(r => ({ kind: 'mood', data: r, time: r.timestamp }));
  const sleepItems = store.data.sleeps.map(s => ({ kind: 'sleep', data: s, time: s.startTime }));
  const eventItems = store.data.events.map(e => ({ kind: 'event', data: e, time: e.timestamp }));
  const all = [...moodItems, ...sleepItems, ...eventItems].sort((a, b) => b.time - a.time);

  all.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'record-item';
    el.style.animationDelay = `${idx * 50}ms`;
    el.dataset.kind = item.kind;
    el.dataset.id = item.data.id;

    if (item.kind === 'mood') {
      const r = item.data;
      const mainClass = r.value === 0 ? 'neutral' : (r.value > 0 ? 'positive' : 'negative');
      const mixedText = r.mixed ? ` / ${r.mixedValue > 0 ? '+' : ''}${r.mixedValue}` : '';
      const medText = (r.doses || []).length
        ? t('records.history.medicationDoses', { names: r.doses.map(d => `${d.name} ${d.amount}${d.unit}`).join('、') })
        : '';
      el.innerHTML = `
        <header>
          <span class="value-badge ${mainClass}">${r.value > 0 ? '+' : ''}${r.value}${mixedText}</span>
          <time>${formatDateTime(r.timestamp)}${medText}</time>
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

function handleSubmit(e) {
  e.preventDefault();
  const doses = medicationInput.checked ? collectDoses() : [];
  const payload = {
    timestamp: new Date(timeInput.value).getTime(),
    value: Number(valueInput.value),
    mixed: mixedInput.checked,
    mixedValue: mixedInput.checked ? Number(mixedValueInput.value) : 0,
    doses,
    note: noteInput.value.trim()
  };
  if (idInput.value) {
    const oldRecord = store.data.records.find(r => r.id === idInput.value);
    store.updateRecord(idInput.value, payload);
    adjustStockForEdit(oldRecord, payload);
  } else {
    store.addRecord(payload);
    adjustStockForDoses(doses, 'records.moodForm.doseLogNote', -1);
  }
  resetForm();
}

function adjustStockForDoses(doses, noteKey, multiplier = -1) {
  doses.forEach(d => {
    if (!d.medicationId) return;
    store.changeMedStock(d.medicationId, multiplier * d.amount, t(noteKey));
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

function adjustStockForEdit(oldRecord, newRecord) {
  const oldByMed = sumDosesByMed(oldRecord.doses || []);
  const newByMed = sumDosesByMed(newRecord.doses || []);
  const allIds = new Set([...Object.keys(oldByMed), ...Object.keys(newByMed)]);
  allIds.forEach(medId => {
    const diff = (newByMed[medId] || 0) - (oldByMed[medId] || 0);
    if (diff !== 0) {
      store.changeMedStock(medId, -diff, t('records.moodForm.doseAdjustLogNote'));
    }
  });
}

async function validateSleep(payload, interruptions) {
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
  if (!(await validateSleep(payload, interruptions))) return;
  if (sleepIdInput.value) {
    store.updateSleep(sleepIdInput.value, payload);
  } else {
    store.addSleep(payload);
  }
  resetSleepForm();
}

function resetEventForm() {
  eventForm.reset();
  eventIdInput.value = '';
  eventTimeInput.value = toDatetimeLocal(nowHourFloor());
  eventTitleInput.value = '';
  eventNoteInput.value = '';
  eventShowElapsedInput.checked = false;
}

function editEvent(event) {
  eventIdInput.value = event.id;
  eventTimeInput.value = toDatetimeLocal(event.timestamp);
  eventTitleInput.value = event.title || '';
  eventNoteInput.value = event.note || '';
  eventShowElapsedInput.checked = event.showElapsedTime === true;
  switchForm('event');
}

function switchForm(name) {
  formTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.form === name);
  });
  moodForm.hidden = name !== 'mood';
  sleepForm.hidden = name !== 'sleep';
  eventForm.hidden = name !== 'event';
}

const MEMO_KEY = 'jimbdhub_memo';

function loadMemo() {
  try {
    return localStorage.getItem(MEMO_KEY) || '';
  } catch { return ''; }
}

function saveMemo(text) {
  try { localStorage.setItem(MEMO_KEY, text); } catch {}
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

function initRecords() {
  initMemo();
  timeInput.value = toDatetimeLocal(nowHourFloor());
  updateRangeOutputs();

  valueInput.addEventListener('input', updateRangeOutputs);
  mixedValueInput.addEventListener('input', updateRangeOutputs);
  sleepQualityInput.addEventListener('input', updateRangeOutputs);

  mixedInput.addEventListener('change', () => {
    mixedValueRow.hidden = !mixedInput.checked;
  });
  medicationInput.addEventListener('change', () => {
    dosesField.hidden = !medicationInput.checked;
    if (medicationInput.checked) renderDoses();
  });
  cancelBtn.addEventListener('click', resetForm);
  moodForm.addEventListener('submit', handleSubmit);

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
  renderRecords();
}

function handleEventSubmit(e) {
  e.preventDefault();
  const payload = {
    timestamp: new Date(eventTimeInput.value).getTime(),
    title: eventTitleInput.value.trim(),
    note: eventNoteInput.value.trim(),
    showElapsedTime: eventShowElapsedInput.checked
  };
  if (eventIdInput.value) {
    store.updateEvent(eventIdInput.value, payload);
  } else {
    store.addEvent(payload);
  }
  resetEventForm();
}

export { initRecords };
