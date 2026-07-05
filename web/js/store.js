const KEYS = {
  records: 'jim_mood_records',
  meds: 'jim_medications',
  logs: 'jim_med_logs'
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function nowHourFloor() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function sampleData() {
  const base = Date.now() - 1000 * 60 * 60 * 24 * 14;
  const records = [];
  for (let i = 0; i < 21; i++) {
    const t = base + i * 1000 * 60 * 60 * 16;
    const v = Math.round(Math.sin(i * 0.6) * 7 + (Math.random() - 0.5) * 4);
    const mixed = i % 5 === 0;
    records.push({
      id: generateId(),
      timestamp: t,
      value: Math.max(-10, Math.min(10, v)),
      mixed,
      mixedValue: mixed ? Math.max(-10, Math.min(10, -v + (Math.random() - 0.5) * 3)) : 0,
      medication: i % 2 === 0,
      medicationStrength: i % 2 === 0 ? 4 : 0,
      note: i % 3 === 0 ? '记录示例备注：睡眠与精力变化' : ''
    });
  }
  records.sort((a, b) => a.timestamp - b.timestamp);

  const meds = [
    { id: generateId(), name: '碳酸锂', category: '心境稳定剂', boxCount: 2, boardPerBox: 5, pillsPerBoard: 10, unit: '片', totalPills: 100, remainingPills: 72, note: '早晚各一片' },
    { id: generateId(), name: '喹硫平', category: '非典型抗精神病药', boxCount: 1, boardPerBox: 4, pillsPerBoard: 7, unit: '片', totalPills: 28, remainingPills: 19, note: '睡前服用' },
    { id: generateId(), name: '丙戊酸钠', category: '心境稳定剂', boxCount: 3, boardPerBox: 3, pillsPerBoard: 20, unit: '片', totalPills: 180, remainingPills: 156, note: '' }
  ];

  const logs = [
    { id: generateId(), medicationId: meds[0].id, name: meds[0].name, delta: -2, remainingAfter: 72, timestamp: Date.now() - 1000 * 60 * 60 * 8, note: '当日服用' },
    { id: generateId(), medicationId: meds[0].id, name: meds[0].name, delta: -2, remainingAfter: 74, timestamp: Date.now() - 1000 * 60 * 60 * 32, note: '当日服用' },
    { id: generateId(), medicationId: meds[1].id, name: meds[1].name, delta: -1, remainingAfter: 19, timestamp: Date.now() - 1000 * 60 * 60 * 10, note: '睡前服用' },
    { id: generateId(), medicationId: meds[1].id, name: meds[1].name, delta: 28, remainingAfter: 28, timestamp: Date.now() - 1000 * 60 * 60 * 240, note: '新开一盒' }
  ];

  return { records, meds, logs };
}

export const store = {
  data: {
    records: [],
    meds: [],
    logs: []
  },
  listeners: [],

  init() {
    this.data.records = load(KEYS.records, []);
    this.data.meds = load(KEYS.meds, []);
    this.data.logs = load(KEYS.logs, []);
    if (this.data.records.length === 0) {
      this.resetSample();
    }
  },

  resetSample() {
    const { records, meds, logs } = sampleData();
    this.data.records = records;
    this.data.meds = meds;
    this.data.logs = logs;
    this.persist();
    this.notify();
  },

  persist() {
    save(KEYS.records, this.data.records);
    save(KEYS.meds, this.data.meds);
    save(KEYS.logs, this.data.logs);
  },

  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  },

  notify() {
    this.listeners.forEach(fn => fn(this.data));
  },

  getRecordsInRange(range) {
    const now = Date.now();
    let start = 0;
    if (range === 'week') start = now - 7 * 24 * 60 * 60 * 1000;
    if (range === 'month') start = now - 30 * 24 * 60 * 60 * 1000;
    return this.data.records
      .filter(r => r.timestamp >= start)
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  addRecord(record) {
    const r = { ...record, id: generateId() };
    this.data.records.push(r);
    this.data.records.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
    return r;
  },

  updateRecord(id, patch) {
    const idx = this.data.records.findIndex(r => r.id === id);
    if (idx === -1) return;
    this.data.records[idx] = { ...this.data.records[idx], ...patch };
    this.data.records.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
  },

  deleteRecord(id) {
    this.data.records = this.data.records.filter(r => r.id !== id);
    this.persist();
    this.notify();
  },

  addMed(med) {
    const m = { ...med, id: generateId() };
    this.data.meds.push(m);
    this.persist();
    this.notify();
    return m;
  },

  updateMed(id, patch) {
    const idx = this.data.meds.findIndex(m => m.id === id);
    if (idx === -1) return;
    this.data.meds[idx] = { ...this.data.meds[idx], ...patch };
    this.persist();
    this.notify();
  },

  deleteMed(id) {
    this.data.meds = this.data.meds.filter(m => m.id !== id);
    this.persist();
    this.notify();
  },

  addLog(log) {
    const l = { ...log, id: generateId(), timestamp: log.timestamp || Date.now() };
    this.data.logs.unshift(l);
    this.persist();
    this.notify();
    return l;
  },

  changeMedStock(medId, delta, note = '') {
    const med = this.data.meds.find(m => m.id === medId);
    if (!med) return;
    const remainingAfter = Math.max(0, med.remainingPills + delta);
    med.remainingPills = remainingAfter;
    this.addLog({
      medicationId: medId,
      name: med.name,
      delta,
      remainingAfter,
      note
    });
    this.persist();
    this.notify();
  }
};

export function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatQuantity(med) {
  return `${med.boxCount}盒*${med.boardPerBox}${med.unit === '片' ? '板' : '瓶'}*${med.pillsPerBoard}${med.unit}`;
}

export { generateId, nowHourFloor };
