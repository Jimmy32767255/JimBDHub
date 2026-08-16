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

// 列表/图表单次最多加载的记录条数，防止记录过多导致卡顿或 OOM。
// 数值可在设置页调整（100~1000），保存在主题设置中
const MIN_LOADED_RECORDS = 100;
const MAX_LOADED_RECORDS_LIMIT = 1000;

export function getMaxLoadedRecords() {
  const n = Number(getTheme().maxLoadedRecords);
  return Number.isInteger(n) && n >= MIN_LOADED_RECORDS && n <= MAX_LOADED_RECORDS_LIMIT
    ? n
    : MIN_LOADED_RECORDS;
}

function recalcLogRemainingAfter(medId) {
  const med = store.data.meds.find(m => m.id === medId);
  const logs = store.data.logs.filter(l => l.medicationId === medId);
  if (!med || !logs.length) return;
  const sumDeltas = logs.reduce((sum, l) => sum + (Number(l.delta) || 0), 0);
  let base = calcTotalPills(med) - sumDeltas;
  logs
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(log => {
      base += Number(log.delta) || 0;
      log.remainingAfter = Math.max(0, base);
    });
}

/**
 * 计算药品总片数：盒数×每盒板数×每板片数 + 板数×每板片数 + 散装药
 */
export function calcTotalPills(med) {
  const pillsPerBoard = Number(med.pillsPerBoard) || 0;
  const boardPerBox = Number(med.boardPerBox) || 0;
  return (Number(med.boxCount) || 0) * (boardPerBox || 0) * (pillsPerBoard || 0)
    + (Number(med.boardCount) || 0) * (pillsPerBoard || 0)
    + (Number(med.loosePills) || 0);
}

/**
 * 应用库存变化：
 * - 库存模型：boxCount（未开封盒数）、boardCount（已开封整板数）、loosePills（散装药）。
 * - 扣减（delta < 0）开封逻辑：
 *   1) 先消耗散装药（loosePills）；
 *   2) 散装药 = 0 时，打开一板：boardCount - 1，loosePills = 每板片数；
 *   3) 无已开封板时，开封新盒：boxCount - 1，boardCount += 每盒板数，再打开一板；
 *   4) 循环直到消耗完或库存耗尽。
 * - 增加（delta > 0）：直接增加到散装药（loosePills）。
 */
function applyStockDelta(med, delta) {
  if (delta < 0) {
    let need = -delta;
    const pillsPerBoard = Number(med.pillsPerBoard) || 0;
    const boardPerBox = Number(med.boardPerBox) || 0;
    let loose = Math.max(0, Number(med.loosePills) || 0);
    let boards = Math.max(0, Number(med.boardCount) || 0);
    let boxes = Math.max(0, Number(med.boxCount) || 0);

    while (need > 0) {
      // 1. 先消耗散装药
      if (loose > 0) {
        const take = Math.min(loose, need);
        loose -= take;
        need -= take;
        continue;
      }
      // 2. 散装药 = 0，打开一板（若已有已开封板）
      if (boards > 0 && pillsPerBoard > 0) {
        boards -= 1;
        loose = pillsPerBoard;
        continue;
      }
      // 3. 无已开封板，开封新盒
      if (boxes > 0 && boardPerBox > 0 && pillsPerBoard > 0) {
        boxes -= 1;
        boards += boardPerBox;
        continue;
      }
      // 4. 库存耗尽
      break;
    }
    // 写回
    med.loosePills = loose;
    med.boardCount = boards;
    med.boxCount = boxes;
  } else {
    // 增加：直接加到散装药
    med.loosePills = Math.max(0, (Number(med.loosePills) || 0) + delta);
  }
}

function migrateMed(m) {
  if (!m) return m;
  const onset = m.onsetHours ?? 1;
  const peak = m.peakHours ?? 2;
  const halfLife = m.halfLifeHours ?? 12;
  const doseAmount = m.doseAmount ?? 1;
  // 旧数据迁移：boardCount（已开封整板数）
  // 旧模型 remainingPills 是"总数（含散装药）"，新模型拆分为 boardCount + loosePills
  let boardCount = Number.isFinite(Number(m.boardCount)) ? Math.max(0, Number(m.boardCount)) : null;
  let loosePills = Number.isFinite(Number(m.loosePills)) ? Math.max(0, Number(m.loosePills)) : 0;
  if (boardCount === null) {
    // 从旧数据反推：整板部分 = 总数 - 散装药
    const pillsPerBoard = Number(m.pillsPerBoard) || 0;
    const oldTotal = Math.max(0, Number(m.remainingPills) || 0);
    const boardPills = Math.max(0, oldTotal - loosePills);
    boardCount = pillsPerBoard > 0 ? Math.floor(boardPills / pillsPerBoard) : 0;
    // 不足一板的余量并入散装药
    if (pillsPerBoard > 0) {
      loosePills += boardPills % pillsPerBoard;
    }
  }
  return {
    ...m,
    tags: Array.isArray(m.tags) ? m.tags : [],
    dosePerTablet: m.dosePerTablet ?? 1,
    doseMassUnit: m.doseMassUnit ?? 'mg',
    // 四时段剂量：早/午/晚/睡前；旧数据无 doseAmounts 时用 doseAmount 填充
    doseAmounts: m.doseAmounts && typeof m.doseAmounts === 'object'
      ? {
          morning: m.doseAmounts.morning === undefined || m.doseAmounts.morning === null || !Number.isFinite(Number(m.doseAmounts.morning)) ? doseAmount : Number(m.doseAmounts.morning),
          afternoon: m.doseAmounts.afternoon === undefined || m.doseAmounts.afternoon === null || !Number.isFinite(Number(m.doseAmounts.afternoon)) ? doseAmount : Number(m.doseAmounts.afternoon),
          evening: m.doseAmounts.evening === undefined || m.doseAmounts.evening === null || !Number.isFinite(Number(m.doseAmounts.evening)) ? doseAmount : Number(m.doseAmounts.evening),
          bedtime: m.doseAmounts.bedtime === undefined || m.doseAmounts.bedtime === null || !Number.isFinite(Number(m.doseAmounts.bedtime)) ? doseAmount : Number(m.doseAmounts.bedtime)
        }
      : { morning: doseAmount, afternoon: doseAmount, evening: doseAmount, bedtime: doseAmount },
    // 已开封整板数
    boardCount,
    // 散装药数量（不足一板的药物），服用时优先扣减
    loosePills,
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
  // 最后一次数据变更的原因，供自动备份等订阅者读取以生成更友好的文件名
  lastMutation: { reason: 'Init' },

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
        setTheme({ medColors: undefined }, 'Internal');
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

  notify(reason = 'DataChange') {
    this.lastMutation = { reason };
    this.listeners.forEach(fn => fn(this.data, reason));
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
    this.notify('AddRecord');
    return r;
  },

  updateRecord(id, patch) {
    const idx = this.data.records.findIndex(r => r.id === id);
    if (idx === -1) return;
    this.data.records[idx] = { ...this.data.records[idx], ...patch };
    this.data.records.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify('UpdateRecord');
  },

  deleteRecord(id) {
    this.data.records = this.data.records.filter(r => r.id !== id);
    this.persist();
    this.notify('DeleteRecord');
  },

  addSleep(sleep) {
    const s = { ...sleep, id: generateId() };
    this.data.sleeps.push(s);
    this.data.sleeps.sort((a, b) => a.startTime - b.startTime);
    this.persist();
    this.notify('AddSleep');
    return s;
  },

  updateSleep(id, patch) {
    const idx = this.data.sleeps.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.data.sleeps[idx] = { ...this.data.sleeps[idx], ...patch };
    this.data.sleeps.sort((a, b) => a.startTime - b.startTime);
    this.persist();
    this.notify('UpdateSleep');
  },

  deleteSleep(id) {
    this.data.sleeps = this.data.sleeps.filter(s => s.id !== id);
    this.persist();
    this.notify('DeleteSleep');
  },

  addEvent(event) {
    const e = { ...event, id: generateId() };
    this.data.events.push(e);
    this.data.events.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify('AddEvent');
    return e;
  },

  updateEvent(id, patch) {
    const idx = this.data.events.findIndex(e => e.id === id);
    if (idx === -1) return;
    this.data.events[idx] = { ...this.data.events[idx], ...patch };
    this.data.events.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify('UpdateEvent');
  },

  deleteEvent(id) {
    this.data.events = this.data.events.filter(e => e.id !== id);
    this.persist();
    this.notify('DeleteEvent');
  },

  addMed(med) {
    const m = { ...med, id: generateId() };
    this.data.meds.push(m);
    this.persist();
    this.notify('AddMed');
    return m;
  },

  updateMed(id, patch) {
    const idx = this.data.meds.findIndex(m => m.id === id);
    if (idx === -1) return;
    this.data.meds[idx] = { ...this.data.meds[idx], ...patch };
    recalcLogRemainingAfter(id);
    this.persist();
    this.notify('UpdateMed');
  },

  deleteMed(id) {
    this.data.meds = this.data.meds.filter(m => m.id !== id);
    this.persist();
    this.notify('DeleteMed');
  },

  addMedHistory(entry) {
    const e = { ...entry, id: generateId() };
    this.data.medHistory.push(e);
    this.data.medHistory.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify('AddMedHistory');
    return e;
  },

  updateMedHistory(id, patch) {
    const idx = this.data.medHistory.findIndex(e => e.id === id);
    if (idx === -1) return;
    this.data.medHistory[idx] = { ...this.data.medHistory[idx], ...patch };
    this.data.medHistory.sort((a, b) => a.timestamp - b.timestamp);
    this.persist();
    this.notify('UpdateMedHistory');
  },

  deleteMedHistory(id) {
    this.data.medHistory = this.data.medHistory.filter(e => e.id !== id);
    this.persist();
    this.notify('DeleteMedHistory');
  },

  addLog(log, reason = 'AddLog') {
    const l = { ...log, id: generateId(), timestamp: log.timestamp || Date.now() };
    this.data.logs.unshift(l);
    recalcLogRemainingAfter(l.medicationId);
    this.persist();
    this.notify(reason);
    return l;
  },

  updateLog(id, patch) {
    const idx = this.data.logs.findIndex(l => l.id === id);
    if (idx === -1) return;
    const log = this.data.logs[idx];
    const med = this.data.meds.find(m => m.id === log.medicationId);
    if (med && patch.delta !== undefined) {
      // 撤销旧扣减，再应用新扣减（delta 为负表示扣减）
      applyStockDelta(med, -log.delta);
      applyStockDelta(med, Number(patch.delta));
    }
    this.data.logs[idx] = { ...log, ...patch };
    this.data.logs.sort((a, b) => b.timestamp - b.timestamp);
    if (med) recalcLogRemainingAfter(med.id);
    this.persist();
    this.notify('UpdateLog');
  },

  deleteLog(id) {
    const idx = this.data.logs.findIndex(l => l.id === id);
    if (idx === -1) return;
    const log = this.data.logs[idx];
    const med = this.data.meds.find(m => m.id === log.medicationId);
    if (med) {
      // 删除日志 = 撤销该次扣减（delta 为负表示扣减，撤销即加回）
      applyStockDelta(med, -log.delta);
    }
    this.data.logs.splice(idx, 1);
    if (med) recalcLogRemainingAfter(med.id);
    this.persist();
    this.notify('DeleteLog');
  },

  changeMedStock(medId, delta, note = '', timestamp = null) {
    const med = this.data.meds.find(m => m.id === medId);
    if (!med) return;
    applyStockDelta(med, delta);
    const remainingAfter = calcTotalPills(med);
    this.addLog({
      medicationId: medId,
      name: med.name,
      delta,
      remainingAfter,
      note,
      timestamp: timestamp || Date.now()
    }, 'TakeMed');
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
    this.notify('AddHistoricalLog');
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
    this.notify('ClearAll');
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
      setTheme(theme, 'RestoreBackup');
    }
    this.persist();
    this.notify('RestoreBackup');
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

/**
 * 根据库存模型计算"盒数/板数/散装"：
 * - boxCount：未开封盒数；
 * - boardCount：已开封整板数；
 * - loosePills：散装药（不足一板，片）。
 * 返回 { boxes, boards, loose }。
 */
export function calcRemainingBreakdown(med) {
  const boxes = Math.max(0, Number(med.boxCount) || 0);
  const boards = Math.max(0, Number(med.boardCount) || 0);
  const loose = Math.max(0, Number(med.loosePills) || 0);
  return { boxes, boards, loose };
}

export { generateId, nowHourFloor, nowMinute };
