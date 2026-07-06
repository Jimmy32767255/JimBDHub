import { getLanguage, t } from './i18n.js';

const KEYS = {
  records: 'jim_mood_records',
  meds: 'jim_medications',
  logs: 'jim_med_logs',
  sleeps: 'jim_sleep_records'
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

export const store = {
  data: {
    records: [],
    meds: [],
    logs: [],
    sleeps: []
  },
  listeners: [],

  init() {
    this.data.records = load(KEYS.records, []);
    this.data.meds = load(KEYS.meds, []);
    this.data.logs = load(KEYS.logs, []);
    this.data.sleeps = load(KEYS.sleeps, []);
  },

  persist() {
    save(KEYS.records, this.data.records);
    save(KEYS.meds, this.data.meds);
    save(KEYS.logs, this.data.logs);
    save(KEYS.sleeps, this.data.sleeps);
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

  getSleepsInRange(range) {
    const now = Date.now();
    let start = 0;
    if (range === 'week') start = now - 7 * 24 * 60 * 60 * 1000;
    if (range === 'month') start = now - 30 * 24 * 60 * 60 * 1000;
    return this.data.sleeps
      .filter(s => s.startTime >= start)
      .sort((a, b) => a.startTime - b.startTime);
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

  addSleep(sleep) {
    const s = { ...sleep, id: generateId() };
    this.data.sleeps.push(s);
    this.data.sleeps.sort((a, b) => a.startTime - b.startTime);
    this.persist();
    this.notify();
    return s;
  },

  updateSleep(id, patch) {
    const idx = this.data.sleeps.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.data.sleeps[idx] = { ...this.data.sleeps[idx], ...patch };
    this.data.sleeps.sort((a, b) => a.startTime - b.startTime);
    this.persist();
    this.notify();
  },

  deleteSleep(id) {
    this.data.sleeps = this.data.sleeps.filter(s => s.id !== id);
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
  },

  buildBackup() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      records: this.data.records,
      meds: this.data.meds,
      logs: this.data.logs,
      sleeps: this.data.sleeps,
      language: getLanguage()
    };
  },

  validateBackup(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.version !== 1) return false;
    if (!Array.isArray(data.records)) return false;
    if (!Array.isArray(data.meds)) return false;
    if (!Array.isArray(data.logs)) return false;
    if ('sleeps' in data && !Array.isArray(data.sleeps)) return false;
    if ('language' in data && typeof data.language !== 'string') return false;
    return true;
  },

  restoreBackup(data) {
    if (!this.validateBackup(data)) return false;
    this.data.records = data.records;
    this.data.meds = data.meds;
    this.data.logs = data.logs;
    this.data.sleeps = data.sleeps || [];
    this.persist();
    this.notify();
    return data.language || getLanguage();
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
  const boardUnit = med.unit === '片' ? 'unit.board' : 'unit.bottle';
  const pillUnit = med.unit === '片' ? 'unit.tablet' : 'unit.pill';
  return `${med.boxCount}${t('unit.box')}*${med.boardPerBox}${t(boardUnit)}*${med.pillsPerBoard}${t(pillUnit)}`;
}

export { generateId, nowHourFloor };
