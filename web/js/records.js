import { store, formatDateTime, nowHourFloor } from './store.js';

const form = document.getElementById('record-form');
const formTitle = document.getElementById('record-form-title');
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

function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateRangeOutputs() {
  valueOut.textContent = valueInput.value;
  mixedValueOut.textContent = mixedValueInput.value;
  strengthOut.textContent = strengthInput.value;
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formTitle.textContent = '新增情绪记录';
  timeInput.value = toDatetimeLocal(nowHourFloor());
  mixedValueRow.hidden = true;
  strengthField.hidden = true;
  updateRangeOutputs();
}

function editRecord(record) {
  idInput.value = record.id;
  formTitle.textContent = '编辑情绪记录';
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
}

function renderRecords() {
  const list = document.getElementById('records-list');
  list.innerHTML = '';
  const sorted = [...store.data.records].sort((a, b) => b.timestamp - a.timestamp);
  sorted.forEach((r, idx) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.style.animationDelay = `${idx * 50}ms`;
    const mainClass = r.value === 0 ? 'neutral' : (r.value > 0 ? 'positive' : 'negative');
    const mixedText = r.mixed ? ` / ${r.mixedValue > 0 ? '+' : ''}${r.mixedValue}` : '';
    const medText = r.medication ? ` · 药效 ±${r.medicationStrength}` : '';
    item.innerHTML = `
      <header>
        <span class="value-badge ${mainClass}">${r.value > 0 ? '+' : ''}${r.value}${mixedText}</span>
        <time>${formatDateTime(r.timestamp)}${medText}</time>
      </header>
      ${r.note ? `<p class="note">${r.note}</p>` : ''}
      <footer>
        <button class="btn btn-icon" data-action="edit" data-id="${r.id}">编辑</button>
        <button class="btn btn-danger" data-action="delete" data-id="${r.id}">删除</button>
      </footer>
    `;
    list.appendChild(item);
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

function initRecords() {
  timeInput.value = toDatetimeLocal(nowHourFloor());
  updateRangeOutputs();

  valueInput.addEventListener('input', updateRangeOutputs);
  mixedValueInput.addEventListener('input', updateRangeOutputs);
  strengthInput.addEventListener('input', updateRangeOutputs);

  mixedInput.addEventListener('change', () => {
    mixedValueRow.hidden = !mixedInput.checked;
  });
  medicationInput.addEventListener('change', () => {
    strengthField.hidden = !medicationInput.checked;
  });
  cancelBtn.addEventListener('click', resetForm);
  form.addEventListener('submit', handleSubmit);

  document.getElementById('records-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const record = store.data.records.find(r => r.id === id);
    if (!record) return;
    if (action === 'edit') {
      editRecord(record);
    } else if (action === 'delete') {
      if (confirm('确定删除这条记录吗？')) {
        store.deleteRecord(id);
      }
    }
  });

  store.subscribe(() => renderRecords());
  renderRecords();
}

export { initRecords };
