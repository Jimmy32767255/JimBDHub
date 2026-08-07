import { generateId } from './store.js';

// dbUpgrade.js 不直接调用 t()，避免 i18n 初始化前加载失败。
const LEGACY_MED_NAME = '药物';

const CURRENT_DB_VERSION = 2;

function isLegacyMoodWithMedication(r) {
  return r && (r.medication || r.medicationName || r.medicationAmount !== undefined || r.medicationUnit) && !Array.isArray(r.doses);
}

function hasLegacyDoses(r) {
  return r && Array.isArray(r.doses) && r.doses.some(isLegacyDose);
}

const MASS_UNITS = ['mg', 'g', 'mcg', 'ug', 'kg'];

function isMassUnit(unit) {
  return MASS_UNITS.includes(String(unit || '').toLowerCase());
}

function isLegacyDose(d) {
  if (!d) return false;
  // 旧数据：剂量以“片/粒/颗”为单位记录 amount=1，药品库以 dosePerTablet 表示每片质量。
  // 升级目标：把 amount 改为质量（amount * dosePerTablet），unit 改为 doseMassUnit。
  const isCountableUnit = /^(片|粒|颗|pill|tablet|cap)$/i.test(String(d.unit || ''));
  return d.dosePerTablet === undefined || d.doseMassUnit === undefined ||
    d.onsetMinHours === undefined || d.peakMinHours === undefined || d.halfLifeMinHours === undefined ||
    isCountableUnit;
}

function isLegacyMed(m) {
  if (!m) return false;
  return m.dosePerTablet === undefined || m.doseMassUnit === undefined ||
    m.onsetMinHours === undefined || m.peakMinHours === undefined || m.halfLifeMinHours === undefined;
}

function isLegacyMedHistory(h) {
  if (!h) return false;
  const isCountableUnit = /^(片|粒|颗|pill|tablet|cap)$/i.test(String(h.unit || ''));
  return h.dosePerTablet === undefined || h.doseMassUnit === undefined ||
    h.onsetMinHours === undefined || h.peakMinHours === undefined || h.halfLifeMinHours === undefined ||
    isCountableUnit;
}

// 旧格式：药物标记颜色保存在主题的 medColors 数组（按药品列表索引上色）。
// 本地数据来自 store.readRawData()（顶层 medColors 字段），旧备份则是 theme.medColors。
function extractMedColors(data) {
  if (Array.isArray(data.medColors) && data.medColors.length > 0) return data.medColors;
  if (data.theme && Array.isArray(data.theme.medColors) && data.theme.medColors.length > 0) return data.theme.medColors;
  return null;
}

function hasLegacyFormats(data) {
  const hasLegacy = (data.records || []).some(r => isLegacyMoodWithMedication(r) || hasLegacyDoses(r));
  const hasLegacyMeds = (data.meds || []).some(isLegacyMed);
  const hasLegacyHistory = (data.medHistory || []).some(isLegacyMedHistory);
  const hasLegacyMedColors = extractMedColors(data) != null;
  return hasLegacy || hasLegacyMeds || hasLegacyHistory || hasLegacyMedColors;
}

function normalizeMed(m) {
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

function normalizeDose(d, medMap) {
  if (!d) return d;
  const med = d.medicationId ? medMap[d.medicationId] : null;
  const dosePerTablet = d.dosePerTablet ?? (med ? med.dosePerTablet : 1);
  const doseMassUnit = d.doseMassUnit ?? (med ? med.doseMassUnit : 'mg');
  // 只有unit是片/粒/颗等非质量单位，并且药品库明确给了每片质量，才做换算。
  // 如果本身就是质量单位（mg/g...），保持原值；如果没有药品库信息，也保持原值。
  const isCountableUnit = /^(片|粒|颗|pill|tablet|cap)$/i.test(String(d.unit || ''));
  const needsConvert = isCountableUnit && med && med.dosePerTablet != null && med.dosePerTablet !== 0;
  const amount = needsConvert
    ? ((d.amount ?? 1) * med.dosePerTablet)
    : (d.amount ?? 1);
  const unit = needsConvert ? doseMassUnit : (isMassUnit(d.unit) ? d.unit : doseMassUnit);
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
  const dosePerTablet = h.dosePerTablet ?? (med ? med.dosePerTablet : 1);
  const doseMassUnit = h.doseMassUnit ?? (med ? med.doseMassUnit : 'mg');
  const isCountableUnit = /^(片|粒|颗|pill|tablet|cap)$/i.test(String(h.unit || ''));
  const needsConvert = isCountableUnit && med && med.dosePerTablet != null && med.dosePerTablet !== 0;
  const amount = needsConvert
    ? ((h.amount ?? (med ? med.doseAmount : 1)) * med.dosePerTablet)
    : (h.amount ?? (med ? med.doseAmount : 1));
  const unit = needsConvert ? doseMassUnit : (isMassUnit(h.unit) ? h.unit : doseMassUnit);
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

  const medMap = Object.fromEntries(result.meds.map(m => [m.id, m]).filter(Boolean));

  result.medHistory = (data.medHistory || []).map(h => normalizeMedHistory(h, medMap));

  const legacyMedications = [];
  (data.records || []).forEach(r => {
    if (isLegacyMoodWithMedication(r)) {
      const { moodRecord, medicationRecord } = splitMoodAndMedication(r, medMap);
      legacyMedications.push(medicationRecord);
      result.records.push(moodRecord);
    } else if (hasLegacyDoses(r)) {
      const { moodRecord, medicationRecord } = splitRecordDoses(r, medMap);
      legacyMedications.push(medicationRecord);
      result.records.push(moodRecord);
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
