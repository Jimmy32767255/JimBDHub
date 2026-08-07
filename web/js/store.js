import { getLanguage, t } from './i18n.js';
import { getTheme, setTheme } from './theme.js';
import { needsUpgrade, runUpgrade, CURRENT_DB_VERSION } from './dbUpgrade.js';

const KEYS = {
  records: 'jimbdhub_mood_records',
  meds: 'jimbdhub_medications',
  logs: 'jimbdhub_med_logs',
  sleeps: 'jimbdhub_sleep_records',
  events: 'jimbdhub_events',
  medHistory: 'jimbdhub_med_history'
};

// 本地数据库版本标记：升级完成后持久化，避免每次启动都误判为旧格式
const VERSION_KEY = 'jimbdhub_db_version';

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

function readVersion() {
  const v = load(VERSION_KEY, 0);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function readRawData() {
  return {
    meds: load(KEYS.meds, []),
    medHistory: load(KEYS.medHistory, []),
    records: load(KEYS.records, []),
    logs: load(KEYS.logs, []),
    sleeps: load(KEYS.sleeps, []),
    events: load(KEYS.events, []),
    version: readVersion(),
    // 旧格式：药物标记颜色存在主题里，按药品列表索引上色
    medColors: getTheme().medColors
  };
}

function nowHourFloor() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function nowMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 列表/图表单次最多加载的记录条数，防止记录过多导致卡顿或 OOM
export const MAX_LOADED_RECORDS = 100;

function recalcLogRemainingAfter(medId) {
  const med = store.data.meds.find(m => m.id === medId);
  const logs = store.data.logs.filter(l => l.medicationId === medId);
  if (!med || !logs.length) return;
  const sumDeltas = logs.reduce((sum, l) => sum + (Number(l.delta) || 0), 0);
  let base = med.remainingPills - sumDeltas;
  logs
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(log => {
      base += Number(log.delta) || 0;
      log.remainingAfter = Math.max(0, base);
    });
}

function migrateMed(m) {
  if (!m) return m;
  const onset = m.onsetHours ?? 1;
  const peak = m.peakHours ?? 2;
  const halfLife = m.halfLifeHours ?? 12;
  return {
    ...m,
    tags: Array.isArray(m.tags) ? m.tags : [],
    dosePerTablet: m.dosePerTablet ?? 1,
    doseMassUnit: m.doseMassUnit ?? 'mg',
    onsetMinHours: m.onsetMinHours ?? onset,
    onsetMaxHours: m.onsetMaxHours ?? onset,
    peakMinHours: m.peakMinHours ?? peak,
    peakMaxHours: m.peakMaxHours ?? peak,
    halfLifeMinHours: m.halfLifeMinHours ?? halfLife,
    halfLifeMaxHours: m.halfLifeMaxHours ?? halfLife
  };
}

function migrateDose(d, medMap) {
  if (!d) return d;
  const med = d.medicationId ? medMap[d.medicationId] : null;
  const onset = d.onsetHours ?? (med ? med.onsetMinHours : 1);
  const peak = d.peakHours ?? (med ? med.peakMinHours : 2);
  const halfLife = d.halfLifeHours ?? (med ? med.halfLifeMinHours : 12);
  return {
    ...d,
    dosePerTablet: d.dosePerTablet ?? (med ? med.dosePerTablet : 1),
    doseMassUnit: d.doseMassUnit ?? (med ? med.doseMassUnit : 'mg'),
    onsetMinHours: d.onsetMinHours ?? onset,
    onsetMaxHours: d.onsetMaxHours ?? onset,
    peakMinHours: d.peakMinHours ?? peak,
    peakMaxHours: d.peakMaxHours ?? peak,
    halfLifeMinHours: d.halfLifeMinHours ?? halfLife,
    halfLifeMaxHours: d.halfLifeMaxHours ?? halfLife
  };
}

function migrateMedHistory(h, medMap) {
  if (!h) return h;
  const med = h.medicationId ? medMap[h.medicationId] : null;
  return {
    ...h,
    name: h.name || (med ? med.name : t('records.moodForm.legacyMedication')),
    unit: h.unit || (med ? med.unit : '片'),
    amount: h.amount ?? (med ? med.doseAmount : 1),
    dosePerTablet: h.dosePerTablet ?? (med ? med.dosePerTablet : 1),
    doseMassUnit: h.doseMassUnit ?? (med ? med.doseMassUnit : 'mg'),
    schedule: Array.isArray(h.schedule) ? h.schedule : (med ? med.schedule : []),
    onsetMinHours: h.onsetMinHours ?? (med ? med.onsetMinHours : 1),
    onsetMaxHours: h.onsetMaxHours ?? (med ? med.onsetMaxHours : 1),
    peakMinHours: h.peakMinHours ?? (med ? med.peakMinHours : 2),
    peakMaxHours: h.peakMaxHours ?? (med ? med.peakMaxHours : 2),
    halfLifeMinHours: h.halfLifeMinHours ?? (med ? med.halfLifeMinHours : 12),
    halfLifeMaxHours: h.halfLifeMaxHours ?? (med ? med.halfLifeMaxHours : 12)
  };
}

function migrateRecord(r, medMap, keepCompat = false) {
  let rec = r;
  // 旧格式：情绪记录中同时包含单条服药信息。
  // keepCompat=true 时保留在原记录内（仅用于 init 升级前的兜底，后续会被 runUpgrade 拆分）。
  if (r.medication && !Array.isArray(r.doses)) {
    rec = {
      ...r,
      doses: [migrateDose({
        medicationId: null,
        name: r.medicationName || t('records.moodForm.legacyMedication'),
        amount: r.medicationAmount || 1,
        unit: r.medicationUnit || '片',
        onsetHours: 1,
        peakHours: 2,
        halfLifeHours: 12
      }, medMap)]
    };
  }
  if (Array.isArray(rec.doses)) {
    rec = { ...rec, doses: rec.doses.map(d => migrateDose(d, medMap)) };
  }
  return rec;
}

export const store = {
  data: {
    records: [],
    meds: [],
    logs: [],
    sleeps: [],
    events: [],
    medHistory: []
  },
  listeners: [],

  checkNeedsUpgrade() {
    return needsUpgrade(readRawData());
  },

  init() {
    const raw = readRawData();

    if (needsUpgrade(raw)) {
      const result = runUpgrade(raw);
      if (!result.success) {
        throw new Error(result.error || 'Database upgrade failed');
      }
      const upgraded = result.data;
      this.data.meds = upgraded.meds;
      this.data.medHistory = upgraded.medHistory;
      this.data.records = upgraded.records;
      this.data.logs = upgraded.logs;
      this.data.sleeps = upgraded.sleeps;
      this.data.events = upgraded.events;
      // 旧调色板已按索引写入对应药品，从主题中移除，避免每次启动都触发升级
      if (Array.isArray(raw.medColors) && raw.medColors.length) {
        setTheme({ medColors: undefined });
      }
      this.persist();
      return;
    }

    this.data.meds = raw.meds.map(migrateMed);
    const medMap = Object.fromEntries(this.data.meds.map(m => [m.id, m]));
    this.data.medHistory = raw.medHistory.map(h => migrateMedHistory(h, medMap));
    this.data.records = raw.records.map(r => migrateRecord(r, medMap, true));
    this.data.logs = raw.logs;
    this.data.sleeps = raw.sleeps;
    this.data.events = raw.events;
    // 补写版本标记，避免下次启动误判为旧格式
    this.persist();
  },

  persist() {
    save(KEYS.records, this.data.records);
    save(KEYS.meds, this.data.meds);
    save(KEYS.logs, this.data.logs);
    save(KEYS.sleeps, this.data.sleeps);
    save(KEYS.events, this.data.events);
    save(KEYS.medHistory, this.data.medHistory);
    save(VERSION_KEY, CURRENT_DB_VERSION);
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
    let start = 0;
    let end = Infinity;
    if (range && typeof range === 'object') {
      start = range.start ?? 0;
      end = range.end ?? Infinity;
    } else {
      const now = Date.now();
      if (range === 'week') start = now - 7 * DAY_MS;
      if (range === 'month') start = now - 30 * DAY_MS;
    }
    return this.data.records
      .filter(r => r.timestamp >= start && r.timestamp <= end)
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  getSleepsInRange(range) {
    let start = 0;
    let end = Infinity;
    if (range && typeof range === 'object') {
      start = range.start ?? 0;
      end = range.end ?? Infinity;
    } else {
      const now = Date.now();
      if (range === 'week') start = now - 7 * DAY_MS;
      if (range === 'month') start = now - 30 * DAY_MS;
    }
    return this.data.sleeps
      .filter(s => s.startTime <= end && s.endTime >= start)
      .sort((a, b) => a.startTime - b.startTime);
  },

  getEventsInRange(range) {
    let start = 0;
    let end = Infinity;
    if (range && typeof range === 'object') {
      start = range.start ?? 0;
      end = range.end ?? Infinity;
    } else {
      const now = Date.now();
      if (range === 'week') start = now - 7 * DAY_MS;
      if (range === 'month') start = now - 30 * DAY_MS;
    }
    return this.data.events
      .filter(e => e.timestamp >= start && e.timestamp <= end)
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

  addEvent(event) {
    const e = { ...event, id: generateId() };
    this.data.events.push(e);
    this.data.events.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
    return e;
  },

  updateEvent(id, patch) {
    const idx = this.data.events.findIndex(e => e.id === id);
    if (idx === -1) return;
    this.data.events[idx] = { ...this.data.events[idx], ...patch };
    this.data.events.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
  },

  deleteEvent(id) {
    this.data.events = this.data.events.filter(e => e.id !== id);
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
    recalcLogRemainingAfter(id);
    this.persist();
    this.notify();
  },

  deleteMed(id) {
    this.data.meds = this.data.meds.filter(m => m.id !== id);
    this.persist();
    this.notify();
  },

  addMedHistory(entry) {
    const e = { ...entry, id: generateId() };
    this.data.medHistory.push(e);
    this.data.medHistory.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
    return e;
  },

  updateMedHistory(id, patch) {
    const idx = this.data.medHistory.findIndex(e => e.id === id);
    if (idx === -1) return;
    this.data.medHistory[idx] = { ...this.data.medHistory[idx], ...patch };
    this.data.medHistory.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify();
  },

  deleteMedHistory(id) {
    this.data.medHistory = this.data.medHistory.filter(e => e.id !== id);
    this.persist();
    this.notify();
  },

  addLog(log) {
    const l = { ...log, id: generateId(), timestamp: log.timestamp || Date.now() };
    this.data.logs.unshift(l);
    recalcLogRemainingAfter(l.medicationId);
    this.persist();
    this.notify();
    return l;
  },

  updateLog(id, patch) {
    const idx = this.data.logs.findIndex(l => l.id === id);
    if (idx === -1) return;
    const log = this.data.logs[idx];
    const med = this.data.meds.find(m => m.id === log.medicationId);
    if (med && patch.delta !== undefined) {
      med.remainingPills = Math.max(0, med.remainingPills + (Number(patch.delta) - log.delta));
    }
    this.data.logs[idx] = { ...log, ...patch };
    this.data.logs.sort((a, b) => b.timestamp - a.timestamp);
    if (med) recalcLogRemainingAfter(med.id);
    this.persist();
    this.notify();
  },

  deleteLog(id) {
    const idx = this.data.logs.findIndex(l => l.id === id);
    if (idx === -1) return;
    const log = this.data.logs[idx];
    const med = this.data.meds.find(m => m.id === log.medicationId);
    if (med) {
      med.remainingPills = Math.max(0, med.remainingPills - log.delta);
    }
    this.data.logs.splice(idx, 1);
    if (med) recalcLogRemainingAfter(med.id);
    this.persist();
    this.notify();
  },

  changeMedStock(medId, delta, note = '', timestamp = null) {
    const med = this.data.meds.find(m => m.id === medId);
    if (!med) return;
    const remainingAfter = Math.max(0, med.remainingPills + delta);
    med.remainingPills = remainingAfter;
    this.addLog({
      medicationId: medId,
      name: med.name,
      delta,
      remainingAfter,
      note,
      timestamp: timestamp || Date.now()
    });
    this.persist();
    this.notify();
  },

  addHistoricalLog(medId, { timestamp, delta, note = '' }) {
    const med = this.data.meds.find(m => m.id === medId);
    if (!med) return;
    const log = {
      id: generateId(),
      medicationId: medId,
      name: med.name,
      timestamp: timestamp || Date.now(),
      delta,
      note,
      remainingAfter: 0
    };
    this.data.logs.unshift(log);
    this.data.logs.sort((a, b) => b.timestamp - a.timestamp);
    recalcLogRemainingAfter(medId);
    this.persist();
    this.notify();
    return log;
  },

  buildBackup() {
    const theme = { ...getTheme() };
    // 自动备份相关设置是设备专属的（路径随操作系统而异），不写入备份/同步文件，
    // 避免跨设备同步时把自动备份写入不该写的目录
    delete theme.autoBackupFolder;
    delete theme.autoBackupEnabled;
    delete theme.autoBackupMaxCount;
    return {
      version: CURRENT_DB_VERSION,
      exportedAt: new Date().toISOString(),
      records: this.data.records,
      meds: this.data.meds,
      logs: this.data.logs,
      sleeps: this.data.sleeps,
      events: this.data.events,
      medHistory: this.data.medHistory,
      language: getLanguage(),
      theme
    };
  },

  clearAll() {
    this.data.records = [];
    this.data.meds = [];
    this.data.logs = [];
    this.data.sleeps = [];
    this.data.events = [];
    this.data.medHistory = [];
    this.persist();
    this.notify();
  },

  validateBackup(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.records)) return false;
    if (!Array.isArray(data.meds)) return false;
    if (!Array.isArray(data.logs)) return false;
    if ('sleeps' in data && !Array.isArray(data.sleeps)) return false;
    if ('events' in data && !Array.isArray(data.events)) return false;
    if ('medHistory' in data && !Array.isArray(data.medHistory)) return false;
    if ('language' in data && typeof data.language !== 'string') return false;
    if ('theme' in data && (typeof data.theme !== 'object' || data.theme === null)) return false;
    return true;
  },

  restoreBackup(data) {
    if (!this.validateBackup(data)) return false;
    // 导入/同步/自动备份恢复统一先走升级与修复，避免旧格式或上次误换算过的数据回流，
    // 否则每次启动都会因结构检测再次弹出升级提示。
    const upgradeResult = runUpgrade(data);
    if (upgradeResult.success && upgradeResult.upgraded) {
      data = upgradeResult.data;
    }
    const version = data.version || 0;
    // version < 2 的旧备份在这里只做兜底；导入流程中 settings.js 会先用 runUpgrade 升级，
    // 但如果直接调用 restoreBackup，仍需能正确还原旧数据。
    const needSplitOldMood = version < 2;
    const meds = (data.meds || []).map(migrateMed);
    // 旧备份兜底：主题里的药物标记颜色按索引写入对应药品
    const legacyColors = data.theme && Array.isArray(data.theme.medColors) ? data.theme.medColors : null;
    if (legacyColors && legacyColors.length) {
      meds.forEach((m, i) => {
        if (m) m.color = legacyColors[i % legacyColors.length];
      });
    }
    const medMap = Object.fromEntries(meds.map(m => [m.id, m]));
    const records = (data.records || []).map(r => migrateRecord(r, medMap, needSplitOldMood));
    this.data.records = records;
    this.data.meds = meds;
    this.data.logs = data.logs;
    this.data.sleeps = data.sleeps || [];
    this.data.events = data.events || [];
    this.data.medHistory = (data.medHistory || []).map(h => migrateMedHistory(h, medMap));
    if (data.theme) {
      const theme = { ...data.theme };
      // 旧调色板已写入对应药品，不再写入主题
      delete theme.medColors;
      // 自动备份相关设置是设备专属的，不随备份/同步恢复，避免覆盖本机路径
      delete theme.autoBackupFolder;
      delete theme.autoBackupEnabled;
      delete theme.autoBackupMaxCount;
      setTheme(theme);
    }
    this.persist();
    this.notify();
    return data.language || getLanguage();
  },

};

if (typeof window !== 'undefined') {
  window.__widgetAddSleep = (sleep) => {
    store.addSleep({
      ...sleep,
      quality: sleep.quality ?? 0,
      interruptions: sleep.interruptions ?? [],
      note: sleep.note || t('records.widgetNote') || 'Widget'
    });
  };

  if (window.AndroidBridge && typeof window.AndroidBridge.onWidgetReady === 'function') {
    window.AndroidBridge.onWidgetReady();
  }

  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.onWidgetReady === 'function') {
    window.pywebview.api.onWidgetReady();
  }
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(ms) {
  if (ms <= 0) return t('duration.minutes', { m: 0 });
  const minutes = Math.round(ms / (60 * 1000));
  const d = Math.floor(minutes / 1440);
  const remainingMinutes = minutes % 1440;
  const h = Math.floor(remainingMinutes / 60);
  const m = remainingMinutes % 60;
  if (d > 0) {
    if (h === 0 && m === 0) return t('duration.days', { d });
    if (h === 0) return t('duration.daysMinutes', { d, m });
    if (m === 0) return t('duration.daysHours', { d, h });
    return t('duration.daysHoursMinutes', { d, h, m });
  }
  if (h === 0) return t('duration.minutes', { m });
  if (m === 0) return t('duration.hours', { h });
  return t('duration.hoursMinutes', { h, m });
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

export { generateId, nowHourFloor, nowMinute };
