import { generateId } from './store.js';
import { ensureMedBoards } from './medInventory.js';

// dbUpgrade.js 不直接调用 t()，避免 i18n 初始化前加载失败。
const LEGACY_MED_NAME = '药物';

const CURRENT_DB_VERSION = 4;

function isLegacyMoodWithMedication(r) {
  return r && (r.medication || r.medicationName || r.medicationAmount !== undefined || r.medicationUnit) && !Array.isArray(r.doses);
}

function hasLegacyDoses(r, medMap) {
  return r && Array.isArray(r.doses) && r.doses.some(d => isLegacyDose(d) || isMisconvertedDose(d, medMap));
}

const MASS_UNITS = ['mg', 'g', 'mcg', 'ug', 'kg'];

function isMassUnit(unit) {
  return MASS_UNITS.includes(String(unit || '').toLowerCase());
}

const COUNTABLE_UNIT_RE = /^(片|粒|颗|pill|tablet|cap)$/i;

function isCountableUnit(unit) {
  return COUNTABLE_UNIT_RE.test(String(unit || ''));
}

// 剂量字段缺失即视为旧格式。amount 始终表示“片/粒”数量，unit 为药品单位；
// 可数单位（片/粒/颗）本身是当前格式，不应被当作旧数据。
function isLegacyDose(d) {
  if (!d) return false;
  return d.dosePerTablet === undefined || d.doseMassUnit === undefined ||
    d.onsetMinHours === undefined || d.peakMinHours === undefined || d.halfLifeMinHours === undefined;
}

// 上一版升级曾把“片数 × 每片质量”写进 amount 并把单位改成质量单位（如 250mg/片被记成一次吃 250）。
// 药品单位是可数单位、记录单位却是质量单位的剂量属于误换算，需要还原为片数。
function isMisconvertedDose(d, medMap) {
  if (!d || !d.medicationId) return false;
  const med = medMap[d.medicationId];
  if (!med) return false;
  return isMassUnit(d.unit) && isCountableUnit(med.unit) && Number(med.dosePerTablet) > 0;
}

function isLegacyMed(m) {
  if (!m) return false;
  return m.dosePerTablet === undefined || m.doseMassUnit === undefined ||
    m.onsetMinHours === undefined || m.peakMinHours === undefined || m.halfLifeMinHours === undefined;
}

function isLegacyMedHistory(h) {
  if (!h) return false;
  return h.dosePerTablet === undefined || h.doseMassUnit === undefined ||
    h.onsetMinHours === undefined || h.peakMinHours === undefined || h.halfLifeMinHours === undefined;
}

function isMisconvertedMedHistory(h, medMap) {
  if (!h || !h.medicationId) return false;
  const med = medMap[h.medicationId];
  if (!med) return false;
  return isMassUnit(h.unit) && isCountableUnit(med.unit) && Number(med.dosePerTablet) > 0;
}

// 旧格式：药物标记颜色保存在主题的 medColors 数组（按药品列表索引上色）。
// 本地数据来自 store.readRawData()（顶层 medColors 字段），旧备份则是 theme.medColors。
function extractMedColors(data) {
  if (Array.isArray(data.medColors) && data.medColors.length > 0) return data.medColors;
  if (data.theme && Array.isArray(data.theme.medColors) && data.theme.medColors.length > 0) return data.theme.medColors;
  return null;
}

function hasLegacyFormats(data) {
  const medMap = buildMedMap(data.meds);
  const hasLegacy = (data.records || []).some(r => isLegacyMoodWithMedication(r) || hasLegacyDoses(r, medMap));
  const hasLegacyMeds = (data.meds || []).some(isLegacyMed);
  const hasLegacyHistory = (data.medHistory || []).some(h => isLegacyMedHistory(h) || isMisconvertedMedHistory(h, medMap));
  const hasLegacyMedColors = extractMedColors(data) != null;
  return hasLegacy || hasLegacyMeds || hasLegacyHistory || hasLegacyMedColors;
}

function buildMedMap(meds) {
  return Object.fromEntries((meds || []).map(m => [m.id, m]).filter(Boolean));
}

function normalizeMed(m) {
  if (!m) return m;
  const onset = m.onsetHours ?? 1;
  const peak = m.peakHours ?? 2;
  const halfLife = m.halfLifeHours ?? 12;
  const out = {
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
  // v3：补齐每板/瓶剩余明细（保持 sum(boards)=remainingPills）
  ensureMedBoards(out);
  return out;
}

// 记录剂量归一化：自 v4 起，同一条服药记录允许同一药品出现多条 dose（每条指向
// 一个板/瓶来源及其数量），用于“一次从多个板/瓶各取若干”。本函数按条逐一归一化，
// 不去重、不合并同药记录，保证旧版单条结构与新版多条结构都能正确读取。
function normalizeDose(d, medMap) {
  if (!d) return d;
  const med = d.medicationId ? medMap[d.medicationId] : null;
  let amount = d.amount ?? 1;
  let unit = d.unit || (med ? med.unit : '片');
  let dosePerTablet = d.dosePerTablet ?? (med ? med.dosePerTablet : 1);
  const doseMassUnit = d.doseMassUnit ?? (med ? med.doseMassUnit : 'mg');
  // 修复上一版升级的误换算：amount 已被写成质量（amount × 每片质量），这里还原为片数。
  // amount 在全应用里始终表示“片/粒”数量，质量由 doseMass = amount × dosePerTablet 换算。
  if (med && isMassUnit(unit) && isCountableUnit(med.unit) && Number(med.dosePerTablet) > 0) {
    amount = Math.round((amount / med.dosePerTablet) * 100) / 100;
    unit = med.unit;
    dosePerTablet = med.dosePerTablet;
  }
  const onset = d.onsetHours ?? (med ? med.onsetMinHours : 1);
  const peak = d.peakHours ?? (med ? med.peakMinHours : 2);
  const halfLife = d.halfLifeHours ?? (med ? med.halfLifeMinHours : 12);
  return {
    ...d,
    amount,
    unit,
    dosePerTablet,
    doseMassUnit,
    onsetMinHours: d.onsetMinHours ?? onset,
    onsetMaxHours: d.onsetMaxHours ?? onset,
    peakMinHours: d.peakMinHours ?? peak,
    peakMaxHours: d.peakMaxHours ?? peak,
    halfLifeMinHours: d.halfLifeMinHours ?? halfLife,
    halfLifeMaxHours: d.halfLifeMaxHours ?? halfLife
  };
}

function normalizeMedHistory(h, medMap) {
  if (!h) return h;
  const med = h.medicationId ? medMap[h.medicationId] : null;
  let amount = h.amount ?? (med ? med.doseAmount : 1);
  let unit = h.unit || (med ? med.unit : '片');
  let dosePerTablet = h.dosePerTablet ?? (med ? med.dosePerTablet : 1);
  const doseMassUnit = h.doseMassUnit ?? (med ? med.doseMassUnit : 'mg');
  // 与 normalizeDose 相同：还原被误换算为质量的 amount
  if (med && isMassUnit(unit) && isCountableUnit(med.unit) && Number(med.dosePerTablet) > 0) {
    amount = Math.round((amount / med.dosePerTablet) * 100) / 100;
    unit = med.unit;
    dosePerTablet = med.dosePerTablet;
  }
  return {
    ...h,
    name: h.name || (med ? med.name : ''),
    unit,
    amount,
    dosePerTablet,
    doseMassUnit,
    schedule: Array.isArray(h.schedule) ? h.schedule : (med ? med.schedule : []),
    onsetMinHours: h.onsetMinHours ?? (med ? med.onsetMinHours : 1),
    onsetMaxHours: h.onsetMaxHours ?? (med ? med.onsetMaxHours : 1),
    peakMinHours: h.peakMinHours ?? (med ? med.peakMinHours : 2),
    peakMaxHours: h.peakMaxHours ?? (med ? med.peakMaxHours : 2),
    halfLifeMinHours: h.halfLifeMinHours ?? (med ? med.halfLifeMinHours : 12),
    halfLifeMaxHours: h.halfLifeMaxHours ?? (med ? med.halfLifeMaxHours : 12)
  };
}

function splitMoodAndMedication(r, medMap) {
  const medicationRecord = {
    id: generateId(),
    timestamp: r.timestamp,
    type: 'medication',
    doses: [normalizeDose({
        medicationId: null,
        name: r.medicationName || LEGACY_MED_NAME,
        amount: r.medicationAmount ?? 1,
        unit: r.medicationUnit || '片',
        onsetHours: 1,
        peakHours: 2,
        halfLifeHours: 12,
        dosePerTablet: 1,
        doseMassUnit: 'mg'
      }, medMap)],
    note: r.note || ''
  };
  const moodRecord = { ...r };
  delete moodRecord.medication;
  delete moodRecord.medicationName;
  delete moodRecord.medicationAmount;
  delete moodRecord.medicationUnit;
  delete moodRecord.medicationStrength;
  moodRecord.doses = [];
  return { moodRecord, medicationRecord };
}

function splitRecordDoses(r, medMap) {
  const medicationRecord = {
    id: generateId(),
    timestamp: r.timestamp,
    type: 'medication',
    doses: r.doses.map(d => normalizeDose(d, medMap)),
    note: r.note || ''
  };
  const moodRecord = { ...r };
  moodRecord.doses = [];
  return { moodRecord, medicationRecord };
}

function upgradeData(data) {
  const result = {
    version: CURRENT_DB_VERSION,
    records: [],
    meds: [],
    logs: [],
    sleeps: [],
    events: [],
    medHistory: []
  };

  result.meds = (data.meds || []).map(m => normalizeMed(m));

  // 旧格式：主题里的药物标记颜色按索引写入对应药品
  const medColors = extractMedColors(data);
  if (medColors) {
    result.meds.forEach((m, i) => {
      if (m) m.color = medColors[i % medColors.length];
    });
  }

  const medMap = buildMedMap(result.meds);

  result.medHistory = (data.medHistory || []).map(h => normalizeMedHistory(h, medMap));

  const legacyMedications = [];
  (data.records || []).forEach(r => {
    if (isLegacyMoodWithMedication(r)) {
      // 旧格式：情绪记录内嵌单条服药信息 → 拆分为独立的服药记录
      const { moodRecord, medicationRecord } = splitMoodAndMedication(r, medMap);
      legacyMedications.push(medicationRecord);
      result.records.push(moodRecord);
    } else if (hasLegacyDoses(r, medMap)) {
      if (r.type === 'medication') {
        // 已是独立服药记录：仅修复/补齐字段，避免重复拆分
        result.records.push(r);
      } else {
        // 旧格式：情绪记录携带 doses → 拆分为服药记录
        const { moodRecord, medicationRecord } = splitRecordDoses(r, medMap);
        legacyMedications.push(medicationRecord);
        result.records.push(moodRecord);
      }
    } else {
      result.records.push(r);
    }
  });
  result.records.push(...legacyMedications);

  result.records = result.records.map(r => {
    if (Array.isArray(r.doses)) {
      return { ...r, doses: r.doses.map(d => normalizeDose(d, medMap)) };
    }
    return r;
  });

  result.logs = Array.isArray(data.logs) ? data.logs : [];
  result.sleeps = Array.isArray(data.sleeps) ? data.sleeps : [];
  result.events = Array.isArray(data.events) ? data.events : [];

  return result;
}

export function needsUpgrade(data) {
  if (!data || typeof data !== 'object') return false;
  // 本地数据此前不持久化 version，因此目前以结构检测为准：
  // 全新用户、已是新格式的数据（仅缺版本标记）不需要升级。
  // 未来如有无法结构检测的迁移，可在此按 version 分支处理。
  return hasLegacyFormats(data);
}

export function runUpgrade(data) {
  if (!needsUpgrade(data)) {
    return { success: true, data, upgraded: false };
  }
  try {
    const upgraded = upgradeData(data);
    return { success: true, data: upgraded, upgraded: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

export { CURRENT_DB_VERSION };
