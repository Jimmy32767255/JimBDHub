import { store, formatDateTime, nowHourFloor } from './store.js';
import { t, subscribe } from './i18n.js';

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
const strengthField = document.getElementById('medication-strength-field');
const strengthInput = document.getElementById('record-medication-strength');
const strengthOut = document.getElementById('strength-out');
const noteInput = document.getElementById('record-note');
const cancelBtn = document.getElementById('record-cancel');

const sleepForm = document.getElementById('sleep-form');
const sleepIdInput = document.getElementById('sleep-id');
const sleepStartInput = document.getElementById('sleep-start');
const sleepEndInput = document.getElementById('sleep-end');
const sleepQualityInput = document.getElementById('sleep-quality');
const sleepQualityOut = document.getElementById('sleep-quality-out');
const sleepInterruptions = document.getElementById('sleep-interruptions');
const addInterruptionBtn = document.getElementById('add-interruption-btn');
const sleepNoteInput = document.getElementById('sleep-note');
const sleepCancelBtn = document.getElementById('sleep-cancel');

function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateRangeOutputs() {
  valueOut.textContent = valueInput.value;
  mixedValueOut.textContent = mixedValueInput.value;
  strengthOut.textContent = strengthInput.value;
  sleepQualityOut.textContent = sleepQualityInput.value;
}

function resetForm() {
  moodForm.reset();
  idInput.value = '';
  timeInput.value = toDatetimeLocal(nowHourFloor());
  mixedValueRow.hidden = true;
  strengthField.hidden = true;
  updateRangeOutputs();
}

function editRecord(record) {
  idInput.value = record.id;
  timeInput.value = toDatetimeLocal(record.timestamp);
  valueInput.value = record.value;
  mixedInput.checked = record.mixed;
  mixedValueInput.value = record.mixedValue;
  medicationInput.checked = record.medication;
  strengthInput.value = record.medicationStrength;
  noteInput.value = record.note || '';
  mixedValueRow.hidden = !record.mixed;
  strengthField.hidden = !record.medication;
  updateRangeOutputs();
  switchForm('mood');
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
  sleepQualityInput.value = sleep.quality;
  sleepNoteInput.value = sleep.note || '';
  sleepInterruptions.innerHTML = '';
  (sleep.interruptions || []).forEach(i => addInterruptionRow(i.awakeAt, i.asleepAt));
  updateRangeOutputs();
  switchForm('sleep');
}

function formatDuration(ms) {
  if (ms <= 0) return t('duration.minutes', { m: 0 });
  const minutes = Math.round(ms / (60 * 1000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('duration.minutes', { m });
  if (m === 0) return t('duration.hours', { h });
  return t('duration.hoursMinutes', { h, m });
}

function calcSleepDuration(sleep) {
  const total = Math.max(0, sleep.endTime - sleep.startTime);
  const awakeTotal = (sleep.interruptions || []).reduce((sum, i) => {
    return sum + Math.max(0, i.asleepAt - i.awakeAt);
  }, 0);
  const asleep = Math.max(0, total - awakeTotal);
  return { total, awakeTotal, asleep };
}

function buildSleepBar(sleep) {
  const { total } = calcSleepDuration(sleep);
  if (total === 0) return '<div class="sleep-bar"></div>';

  const interruptions = [...(sleep.interruptions || [])].sort((a, b) => a.awakeAt - b.awakeAt);
  const segments = [];
  let cursor = sleep.startTime;

  interruptions.forEach(i => {
    if (i.awakeAt > cursor) {
      segments.push({ type: 'asleep', start: cursor, end: i.awakeAt });
    }
    segments.push({ type: 'awake', start: i.awakeAt, end: i.asleepAt });
    cursor = i.asleepAt;
  });
  if (cursor < sleep.endTime) {
    segments.push({ type: 'asleep', start: cursor, end: sleep.endTime });
  }

  const parts = segments.map(seg => {
    const pct = ((seg.end - seg.start) / total) * 100;
    return `<div class="sleep-segment ${seg.type}" style="width:${pct}%"></div>`;
  });

  interruptions.forEach(i => {
    const awakePct = ((i.awakeAt - sleep.startTime) / total) * 100;
    const asleepPct = ((i.asleepAt - sleep.startTime) / total) * 100;
    parts.push(`<div class="sleep-interruption-line" style="left:${awakePct}%"></div>`);
    parts.push(`<div class="sleep-interruption-line" style="left:${asleepPct}%"></div>`);
  });

  return `<div class="sleep-bar">${parts.join('')}</div>`;
}

function renderRecords() {
  const list = document.getElementById('records-list');
  list.innerHTML = '';

  const moodItems = store.data.records.map(r => ({ kind: 'mood', data: r, time: r.timestamp }));
  const sleepItems = store.data.sleeps.map(s => ({ kind: 'sleep', data: s, time: s.startTime }));
  const all = [...moodItems, ...sleepItems].sort((a, b) => b.time - a.time);

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
      const medText = r.medication ? t('records.history.medicationEffect', { strength: r.medicationStrength }) : '';
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
    } else {
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
        <div class="sleep-bar-wrap">${buildSleepBar(s)}</div>
        ${s.note ? `<p class="note">${s.note}</p>` : ''}
        <footer>
          <button class="btn btn-icon" data-action="edit" data-id="${s.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${s.id}">${t('common.delete')}</button>
        </footer>
      `;
    }
    list.appendChild(el);
  });
}

function handleSubmit(e) {
  e.preventDefault();
  const payload = {
    timestamp: new Date(timeInput.value).getTime(),
    value: Number(valueInput.value),
    mixed: mixedInput.checked,
    mixedValue: mixedInput.checked ? Number(mixedValueInput.value) : 0,
    medication: medicationInput.checked,
    medicationStrength: medicationInput.checked ? Number(strengthInput.value) : 0,
    note: noteInput.value.trim()
  };
  if (idInput.value) {
    store.updateRecord(idInput.value, payload);
  } else {
    store.addRecord(payload);
  }
  resetForm();
}

function validateSleep(payload, interruptions) {
  if (payload.endTime <= payload.startTime) {
    alert(t('records.validation.endAfterStart'));
    return false;
  }
  for (const i of interruptions) {
    if (i.asleepAt <= i.awakeAt) {
      alert(t('records.validation.interruptionOrder'));
      return false;
    }
    if (i.awakeAt < payload.startTime || i.asleepAt > payload.endTime) {
      alert(t('records.validation.interruptionRange'));
      return false;
    }
  }
  return true;
}

function handleSleepSubmit(e) {
  e.preventDefault();
  const interruptions = collectInterruptions();
  const payload = {
    startTime: new Date(sleepStartInput.value).getTime(),
    endTime: new Date(sleepEndInput.value).getTime(),
    quality: Number(sleepQualityInput.value),
    interruptions,
    note: sleepNoteInput.value.trim()
  };
  if (!validateSleep(payload, interruptions)) return;
  if (sleepIdInput.value) {
    store.updateSleep(sleepIdInput.value, payload);
  } else {
    store.addSleep(payload);
  }
  resetSleepForm();
}

function switchForm(name) {
  formTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.form === name);
  });
  if (name === 'mood') {
    moodForm.hidden = false;
    sleepForm.hidden = true;
  } else {
    moodForm.hidden = true;
    sleepForm.hidden = false;
  }
}

function initRecords() {
  timeInput.value = toDatetimeLocal(nowHourFloor());
  updateRangeOutputs();

  valueInput.addEventListener('input', updateRangeOutputs);
  mixedValueInput.addEventListener('input', updateRangeOutputs);
  strengthInput.addEventListener('input', updateRangeOutputs);
  sleepQualityInput.addEventListener('input', updateRangeOutputs);

  mixedInput.addEventListener('change', () => {
    mixedValueRow.hidden = !mixedInput.checked;
  });
  medicationInput.addEventListener('change', () => {
    strengthField.hidden = !medicationInput.checked;
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

  document.getElementById('records-list').addEventListener('click', e => {
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
        if (confirm(t('records.confirm.deleteMood'))) {
          store.deleteRecord(id);
        }
      }
    } else {
      const sleep = store.data.sleeps.find(s => s.id === id);
      if (!sleep) return;
      if (action === 'edit') {
        editSleep(sleep);
      } else if (action === 'delete') {
        if (confirm(t('records.confirm.deleteSleep'))) {
          store.deleteSleep(id);
        }
      }
    }
  });

  store.subscribe(() => renderRecords());
  subscribe(() => renderRecords());
  renderRecords();
}

export { initRecords };
