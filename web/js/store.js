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

// ===== 数据加密 =====
// 加密后的数据以 jimbdhub_enc_ 为前缀存入 localStorage；
// 元数据键（salt、is_encrypted、语言、主题等）保持明文，以便启动时无需解锁即可读取。
const ENC_PREFIX = 'jimbdhub_enc_';
const SALT_KEY = 'jimbdhub_salt';
const ENCRYPTED_FLAG_KEY = 'jimbdhub_is_encrypted';
// 密码校验字段：启用加密时写入，解锁时尝试解密以验证主密码是否正确
const ENC_TEST_KEY = 'jimbdhub_enc_test';
const TEST_MARKER = 'jimbdhub-encryption-ok';
// PBKDF2 迭代次数与摘要算法
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_HASH = 'SHA-256';
// 备忘录同样是用户数据，加密启用后一并纳入加密
const MEMO_KEY = 'jimbdhub_memo';

// 内存中的 AES-GCM 密钥：解锁后保存，锁定后置 null
let encryptionKey = null;

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// PBKDF2 派生 AES-GCM 密钥（600000 次迭代，SHA-256）
async function deriveKey(masterPassword, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// AES-GCM 加密，返回 { iv, ciphertext }（均为 Base64 编码）
async function encryptData(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

// AES-GCM 解密，返回明文；密码错误/数据损坏时抛出异常
async function decryptData(ciphertext, iv, key) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext)
  );
  return new TextDecoder().decode(plain);
}

// 加密写入：key 为原始 localStorage 键名，实际存储键为 ENC_PREFIX + key
async function saveEncrypted(key, data) {
  const { iv, ciphertext } = await encryptData(JSON.stringify(data), encryptionKey);
  localStorage.setItem(ENC_PREFIX + key, JSON.stringify({ iv, ciphertext }));
}

// 加密读取：解密失败（密钥不匹配/数据损坏）时返回 fallback
async function loadEncrypted(key, fallback) {
  try {
    const raw = localStorage.getItem(ENC_PREFIX + key);
    if (!raw) return fallback;
    const { iv, ciphertext } = JSON.parse(raw);
    const plain = await decryptData(ciphertext, iv, encryptionKey);
    return JSON.parse(plain);
  } catch {
    return fallback;
  }
}

// 加密读取备忘录（纯字符串，不做 JSON 解析）
async function readMemoEncrypted() {
  try {
    const raw = localStorage.getItem(ENC_PREFIX + MEMO_KEY);
    if (!raw) return '';
    const { iv, ciphertext } = JSON.parse(raw);
    return await decryptData(ciphertext, iv, encryptionKey);
  } catch {
    return '';
  }
}

async function saveMemoEncrypted(text) {
  const { iv, ciphertext } = await encryptData(String(text ?? ''), encryptionKey);
  localStorage.setItem(ENC_PREFIX + MEMO_KEY, JSON.stringify({ iv, ciphertext }));
}

function isEncrypted() {
  return localStorage.getItem(ENCRYPTED_FLAG_KEY) === 'true';
}

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

// 加密状态下的数据读取：先解密再按结构返回（需已解锁）
async function readRawDataDecrypted() {
  const [meds, medHistory, records, logs, sleeps, events] = await Promise.all([
    loadEncrypted(KEYS.meds, []),
    loadEncrypted(KEYS.medHistory, []),
    loadEncrypted(KEYS.records, []),
    loadEncrypted(KEYS.logs, []),
    loadEncrypted(KEYS.sleeps, []),
    loadEncrypted(KEYS.events, [])
  ]);
  return {
    meds,
    medHistory,
    records,
    logs,
    sleeps,
    events,
    version: readVersion(),
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
  // 备忘录（用户数据）：未加密时直接读写 localStorage，加密时仅驻留内存 + 异步加密写
  memo: '',
  listeners: [],
  // 最后一次数据变更的原因，供自动备份等订阅者读取以生成更友好的文件名
  lastMutation: { reason: 'Init' },

  // 是否已启用加密（localStorage 明文标记）
  hasPassword() {
    return isEncrypted();
  },

  // 当前是否已解锁（内存中存在可用密钥）
  isUnlocked() {
    return encryptionKey !== null;
  },

  // 验证主密码并解锁：成功设置内存密钥并返回 true
  async unlock(masterPassword) {
    if (!this.hasPassword()) return false;
    const saltB64 = localStorage.getItem(SALT_KEY);
    if (!saltB64) return false;
    let key;
    try {
      key = await deriveKey(String(masterPassword ?? ''), base64ToBytes(saltB64));
    } catch {
      return false;
    }
    // 一致性校验：优先解密测试字段；测试字段缺失/损坏时回退到解密数据键，
    // 避免修改密码中途异常留下的不一致状态导致用户被永久锁在门外。
    let verified = false;
    const testRaw = localStorage.getItem(ENC_PREFIX + ENC_TEST_KEY);
    if (testRaw) {
      try {
        const { iv, ciphertext } = JSON.parse(testRaw);
        await decryptData(ciphertext, iv, key);
        verified = true;
      } catch { /* 测试字段解密失败，尝试回退 */ }
    }
    if (!verified) {
      const dataKeys = Object.values(KEYS).filter(k => localStorage.getItem(ENC_PREFIX + k) != null);
      for (const k of dataKeys) {
        try {
          const raw = localStorage.getItem(ENC_PREFIX + k);
          const { iv, ciphertext } = JSON.parse(raw);
          await decryptData(ciphertext, iv, key);
          verified = true;
          break;
        } catch { /* 继续尝试下一个 */ }
      }
    }
    if (!verified) return false;
    encryptionKey = key;
    return true;
  },

  // 锁定：清空内存密钥
  lock() {
    encryptionKey = null;
  },

  // 首次启用加密：生成盐与密钥，迁移现有明文数据为加密存储
  async enableEncryption(masterPassword) {
    if (this.hasPassword()) return { ok: false, reason: 'already-enabled' };
    if (!masterPassword || typeof masterPassword !== 'string' || masterPassword.length < 4) {
      return { ok: false, reason: 'weak-password' };
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(masterPassword, salt);
    // 在内存中迁移：先把明文数据载入内存，再切换为加密写入
    const raw = readRawData();
    this.data.records = raw.records;
    this.data.meds = raw.meds;
    this.data.logs = raw.logs;
    this.data.sleeps = raw.sleeps;
    this.data.events = raw.events;
    this.data.medHistory = raw.medHistory;
    try {
      this.memo = localStorage.getItem(MEMO_KEY) || '';
    } catch {
      this.memo = '';
    }
    // 置为加密状态
    localStorage.setItem(ENCRYPTED_FLAG_KEY, 'true');
    localStorage.setItem(SALT_KEY, bytesToBase64(salt));
    encryptionKey = key;
    await this.persist();
    await saveMemoEncrypted(this.memo);
    // 最后写入密码校验字段
    localStorage.setItem(ENC_PREFIX + ENC_TEST_KEY, JSON.stringify(await encryptData(TEST_MARKER, key)));
    // 清除明文键（保留元数据键）
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(MEMO_KEY);
    return { ok: true };
  },

  // 修改主密码：验证旧密码后，用新密钥重新加密全部数据
  async changePassword(oldPassword, newPassword) {
    if (!this.hasPassword()) return { ok: false, reason: 'not-enabled' };
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
      return { ok: false, reason: 'weak-password' };
    }
    if (!(await this.unlock(oldPassword))) return { ok: false, reason: 'wrong-password' };
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const newKey = await deriveKey(newPassword, salt);
      // 切换为新盐与新密钥，数据在内存中保持不变，重新加密后写回
      localStorage.setItem(SALT_KEY, bytesToBase64(salt));
      encryptionKey = newKey;
      await this.persist();
      await saveMemoEncrypted(this.memo);
      localStorage.setItem(ENC_PREFIX + ENC_TEST_KEY, JSON.stringify(await encryptData(TEST_MARKER, newKey)));
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'error', error: err };
    }
  },

  // 关闭加密：验证当前密码后，将内存数据解密为明文存储
  async disableEncryption(masterPassword) {
    if (!this.hasPassword()) return { ok: false, reason: 'not-enabled' };
    if (!(await this.unlock(masterPassword))) return { ok: false, reason: 'wrong-password' };
    try {
      save(KEYS.records, this.data.records);
      save(KEYS.meds, this.data.meds);
      save(KEYS.logs, this.data.logs);
      save(KEYS.sleeps, this.data.sleeps);
      save(KEYS.events, this.data.events);
      save(KEYS.medHistory, this.data.medHistory);
      save(VERSION_KEY, CURRENT_DB_VERSION);
      try {
        localStorage.setItem(MEMO_KEY, this.memo || '');
      } catch { /* 忽略 */ }
      // 清理加密标记与加密键
      localStorage.removeItem(ENCRYPTED_FLAG_KEY);
      localStorage.removeItem(SALT_KEY);
      Object.values(KEYS).forEach(k => localStorage.removeItem(ENC_PREFIX + k));
      localStorage.removeItem(ENC_PREFIX + MEMO_KEY);
      localStorage.removeItem(ENC_PREFIX + ENC_TEST_KEY);
      this.lock();
      return { ok: true };
    } catch (err) {
      this.lock();
      return { ok: false, reason: 'error', error: err };
    }
  },

  // 备忘录读写：加密时写入内存并异步加密落盘
  getMemo() {
    return this.memo || '';
  },

  setMemo(text) {
    this.memo = String(text ?? '');
    if (this.hasPassword()) {
      if (this.isUnlocked()) {
        saveMemoEncrypted(this.memo).catch(() => {});
      }
      return;
    }
    try {
      localStorage.setItem(MEMO_KEY, this.memo);
    } catch { /* 忽略 */ }
  },

  checkNeedsUpgrade() {
    // 加密状态下原始数据不可读（需要先解锁），启动流程会跳过此检测，改在解锁后由 init 处理
    if (this.hasPassword()) return false;
    return needsUpgrade(readRawData());
  },

  async init() {
    let raw;
    if (this.hasPassword()) {
      if (!this.isUnlocked()) {
        throw new Error('Database is locked');
      }
      raw = await readRawDataDecrypted();
      this.memo = await readMemoEncrypted();
    } else {
      raw = readRawData();
      try {
        this.memo = localStorage.getItem(MEMO_KEY) || '';
      } catch {
        this.memo = '';
      }
    }

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
      await this.persist();
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
    await this.persist();
  },

  async persist() {
    // 加密写入是异步的，而 CRUD 调用点多为同步调用（不 await）。
    // 用队列保证写入按调用顺序串行完成，避免旧快照后写入覆盖新数据。
    if (!this._persistChain) this._persistChain = Promise.resolve();
    const run = this._persistChain.then(() => this._persistNow());
    this._persistChain = run.catch(() => {});
    return run;
  },

  async _persistNow() {
    if (this.hasPassword() && !this.isUnlocked()) {
      // 已加密但未解锁：数据被锁定界面隔离，不允许写入，直接跳过
      return;
    }
    if (this.hasPassword()) {
      await Promise.all([
        saveEncrypted(KEYS.records, this.data.records),
        saveEncrypted(KEYS.meds, this.data.meds),
        saveEncrypted(KEYS.logs, this.data.logs),
        saveEncrypted(KEYS.sleeps, this.data.sleeps),
        saveEncrypted(KEYS.events, this.data.events),
        saveEncrypted(KEYS.medHistory, this.data.medHistory)
      ]);
      save(VERSION_KEY, CURRENT_DB_VERSION);
    } else {
      save(KEYS.records, this.data.records);
      save(KEYS.meds, this.data.meds);
      save(KEYS.logs, this.data.logs);
      save(KEYS.sleeps, this.data.sleeps);
      save(KEYS.events, this.data.events);
      save(KEYS.medHistory, this.data.medHistory);
      save(VERSION_KEY, CURRENT_DB_VERSION);
    }
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
      med.remainingPills = Math.max(0, med.remainingPills + (Number(patch.delta) - log.delta));
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
      med.remainingPills = Math.max(0, med.remainingPills - log.delta);
    }
    this.data.logs.splice(idx, 1);
    if (med) recalcLogRemainingAfter(med.id);
    this.persist();
    this.notify('DeleteLog');
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

export function formatQuantity(med) {
  const boardUnit = med.unit === '片' ? 'unit.board' : 'unit.bottle';
  const pillUnit = med.unit === '片' ? 'unit.tablet' : 'unit.pill';
  return `${med.boxCount}${t('unit.box')}*${med.boardPerBox}${t(boardUnit)}*${med.pillsPerBoard}${t(pillUnit)}`;
}

// 采样率：仅统计情绪记录（mood），即"平均每日数据点数"（Dp/d）。
// 时间跨度取首条与末条记录之间的天数，避免除以 0。
function computeSamplingRate(records) {
  const moodRecords = (records || []).filter(r => r.type !== 'medication');
  if (moodRecords.length === 0) return null;
  const spanDays = Math.max(1, (moodRecords[moodRecords.length - 1].timestamp - moodRecords[0].timestamp) / DAY_MS);
  return moodRecords.length / spanDays;
}

function formatSamplingRate(rate) {
  return rate < 0.01 ? rate.toFixed(3) : rate.toFixed(2);
}

// 更新采样率显示元素；无情绪记录时隐藏。
export function updateSamplingRate(el, records) {
  if (!el) return;
  const rate = computeSamplingRate(records);
  el.hidden = rate === null;
  if (rate === null) return;
  el.textContent = t('samplingRate.label', { value: formatSamplingRate(rate) });
  const full = t('samplingRate.full');
  if (full) el.title = full;
  else el.removeAttribute('title');
}

export { generateId, nowHourFloor, nowMinute };
