import { store, formatDateTime, formatQuantity, getMaxLoadedRecords } from './store.js';
import { t, subscribe } from './i18n.js';
import { showAlert, showConfirm } from './dialog.js';
import { platform } from './platform.js';
import { getTheme, DEFAULT_MED_COLORS, subscribe as subscribeTheme } from './theme.js';
import {
  ensureMedBoards,
  boardCapacityOf,
  groupBoardsByBox
} from './medInventory.js';

const medModal = document.getElementById('med-modal');
const medForm = document.getElementById('med-form');
const medModalTitle = document.getElementById('med-modal-title');
const medIdInput = document.getElementById('med-id');
const medNameInput = document.getElementById('med-name');
const medCategoryInput = document.getElementById('med-category');
const medTagsInput = document.getElementById('med-tags');
const medColorInput = document.getElementById('med-color');
const medBoxInput = document.getElementById('med-box');
const medBoardInput = document.getElementById('med-board');
const medPillsInput = document.getElementById('med-pills');
const medUnitInput = document.getElementById('med-unit');
const medDoseAmountInput = document.getElementById('med-dose-amount');
const medDosePerTabletInput = document.getElementById('med-dose-per-tablet');
const medDoseMassUnitInput = document.getElementById('med-dose-mass-unit');
const medRemainingInput = document.getElementById('med-remaining');
const medBoardsEditor = document.getElementById('med-boards-editor');
const medBoardsFillAllBtn = document.getElementById('med-boards-fill-all');
const medBoardsZeroAllBtn = document.getElementById('med-boards-zero-all');
const medOnsetMinInput = document.getElementById('med-onset-min');
const medOnsetMaxInput = document.getElementById('med-onset-max');
const medPeakMinInput = document.getElementById('med-peak-min');
const medPeakMaxInput = document.getElementById('med-peak-max');
const medHalfLifeMinInput = document.getElementById('med-half-life-min');
const medHalfLifeMaxInput = document.getElementById('med-half-life-max');
const medTherapeuticMinInput = document.getElementById('med-therapeutic-min');
const medTherapeuticMaxInput = document.getElementById('med-therapeutic-max');
const medTherapeuticUnitInput = document.getElementById('med-therapeutic-unit');
const medVdInput = document.getElementById('med-vd');
const medBioavailabilityInput = document.getElementById('med-bioavailability');
const medNoteInput = document.getElementById('med-note');

const stockModal = document.getElementById('stock-modal');
const stockForm = document.getElementById('stock-form');
const stockMedIdInput = document.getElementById('stock-med-id');
const stockDeltaInput = document.getElementById('stock-delta');
const stockNoteInput = document.getElementById('stock-note');
const stockBoardSelect = document.getElementById('stock-board');
const stockBoardRow = document.getElementById('stock-board-row');

const logModal = document.getElementById('log-modal');
const logForm = document.getElementById('log-form');
const logModalTitle = document.getElementById('log-modal-title');
const logIdInput = document.getElementById('log-id');
const logMedRow = document.getElementById('log-med-row');
const logMedSelect = document.getElementById('log-med-id');
const logTimeInput = document.getElementById('log-time');
const logDeltaInput = document.getElementById('log-delta');
const logNoteInput = document.getElementById('log-note');

const medDbSearch = document.getElementById('med-db-search');
const medDbTags = document.getElementById('med-db-tags');
const medDbResults = document.getElementById('med-db-results');
const medToggleManual = document.getElementById('med-toggle-manual');
const medManualFields = document.getElementById('med-manual-fields');
const medScheduleList = document.getElementById('med-schedule-list');
const medScheduleTimeInput = document.getElementById('med-schedule-time');
const medAddScheduleBtn = document.getElementById('med-add-schedule');
const medAddReminderBtn = document.getElementById('med-add-reminder-btn');
const medsFilterTags = document.getElementById('meds-filter-tags');
const logsFilterTags = document.getElementById('logs-filter-tags');
const logsPeriodFilter = document.getElementById('logs-period-filter');
const logsCustomRange = document.getElementById('logs-custom-range');
const logsRangeStart = document.getElementById('logs-range-start');
const logsRangeEnd = document.getElementById('logs-range-end');
const logsBatchBtn = document.getElementById('logs-batch-btn');
const logsBatchBar = document.getElementById('logs-batch-bar');
const logsBatchSelectAll = document.getElementById('logs-batch-select-all');
const logsBatchDelete = document.getElementById('logs-batch-delete');
const logsBatchSelectedCount = document.getElementById('logs-batch-count');

let medDbData = [];
let medDbTagsList = [];
let medDbSelectedTag = '';
let selectedDbMed = null;
let manualFieldsVisible = false;
let currentSchedule = [];
let medsSelectedTags = [];
let logsSelectedTags = [];
// 变更日志「批量管理」状态：logsBatchMode 是否处于批量模式；logsBatchSelected 为已勾选日志 id 集合；
// logsRenderedIds 为当前可见（筛选+截断后）日志 id 列表，用于“全选”与清除幽灵选中
let logsBatchMode = false;
let logsBatchSelected = new Set();
let logsRenderedIds = [];
// 编辑弹窗中的「板/瓶剩余」草稿：{id, remaining}[]
let boardDraft = [];
let boardDraftFresh = false; // 新建流程：规格初次确定后自动全满一次
let boardDetailModal = document.getElementById('board-detail-modal');
let boardDetailTree = document.getElementById('board-detail-tree');
let boardDetailCloseBtn = document.getElementById('board-detail-close');

async function loadMedDB() {
  try {
    const res = await fetch('MedDB.json');
    if (!res.ok) throw new Error('Failed to load MedDB');
    const data = await res.json();
    medDbData = data.medicines || [];
    medDbTagsList = Array.from(new Set(medDbData.flatMap(m => m.tags || []))).sort();
    renderTags();
  } catch (err) {
    medDbData = [];
    medDbTagsList = [];
  }
}

function renderTags() {
  medDbTags.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!medDbSelectedTag ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    medDbSelectedTag = '';
    selectedDbMed = null;
    renderTags();
    renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
  });
  medDbTags.appendChild(allBtn);

  medDbTagsList.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${medDbSelectedTag === tag ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      medDbSelectedTag = medDbSelectedTag === tag ? '' : tag;
      selectedDbMed = null;
      renderTags();
      renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
    });
    medDbTags.appendChild(btn);
  });
}

function filterMeds(query, tag) {
  const q = query.toLowerCase();
  return medDbData.filter(med => {
    const matchesQuery = !q ||
      med.name.toLowerCase().includes(q) ||
      (med.category && med.category.toLowerCase().includes(q)) ||
      (med.tags || []).some(tag => tag.toLowerCase().includes(q));
    const matchesTag = !tag || (med.tags || []).includes(tag);
    return matchesQuery && matchesTag;
  });
}

function renderMedResults(results) {
  medDbResults.innerHTML = '';
  if (selectedDbMed && !medDbSearch.value.trim() && !medDbSelectedTag) {
    medDbResults.innerHTML = `
      <div class="med-db-selected">
        <span class="med-db-selected-icon">✓</span>
        <span>${t('meds.form.dbSelected', { name: selectedDbMed.name })}</span>
      </div>
    `;
    return;
  }
  if (!results.length) {
    medDbResults.innerHTML = `<div class="med-db-empty">${t('meds.form.dbNoResults')}</div>`;
    return;
  }
  results.forEach(med => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'med-db-result';
    item.innerHTML = `
      <span class="med-db-result-name">${med.name}</span>
      <span class="med-db-result-meta">${med.category || ''} · ${(med.tags || []).slice(0, 3).join(' / ')}</span>
    `;
    item.addEventListener('click', () => fillMedForm(med));
    medDbResults.appendChild(item);
  });
}

function readRangeHours(med, arrayKey, minKey, maxKey, singleKey, fallback) {
  const arr = med[arrayKey];
  if (Array.isArray(arr) && arr.length >= 2) {
    return [arr[0], arr[1]];
  }
  if (med[minKey] !== undefined && med[maxKey] !== undefined) {
    return [med[minKey], med[maxKey]];
  }
  const single = med[singleKey];
  return [single ?? fallback, single ?? fallback];
}

// 读取治疗窗（血药浓度范围）：支持 DB 的 therapeuticRange 数组和已保存药品的扁平字段。
function readTherapeuticWindow(med) {
  if (!med) return null;
  let min, max, unit;
  if (Array.isArray(med.therapeuticRange) && med.therapeuticRange.length >= 2) {
    min = med.therapeuticRange[0];
    max = med.therapeuticRange[1];
    unit = med.therapeuticUnit || '';
  } else {
    min = med.therapeuticMin;
    max = med.therapeuticMax;
    unit = med.therapeuticUnit || '';
  }
  min = Number(min);
  max = Number(max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0 || min < 0) return null;
  return { min, max, unit };
}

function setTherapeuticForm(med) {
  const tw = readTherapeuticWindow(med);
  medTherapeuticMinInput.value = tw ? tw.min : '';
  medTherapeuticMaxInput.value = tw ? tw.max : '';
  medTherapeuticUnitInput.value = tw ? tw.unit : '';
}

// 填充计算真实血药浓度所需的分布容积与生物利用度；留空表示暂不启用真实浓度计算。
function setConcentrationParamsForm(med) {
  const vdPerKg = med ? Number(med.vdPerKg) : NaN;
  const f = med ? Number(med.bioavailability) : NaN;
  medVdInput.value = Number.isFinite(vdPerKg) && vdPerKg > 0 ? vdPerKg : '';
  medBioavailabilityInput.value = Number.isFinite(f) && f > 0 && f <= 1 ? f : '';
}

function fillMedForm(med) {
  const [onsetMin, onsetMax] = readRangeHours(med, 'onsetRangeHours', 'onsetMinHours', 'onsetMaxHours', 'onsetHours', 1);
  const [peakMin, peakMax] = readRangeHours(med, 'peakRangeHours', 'peakMinHours', 'peakMaxHours', 'peakHours', 2);
  const [halfLifeMin, halfLifeMax] = readRangeHours(med, 'halfLifeRangeHours', 'halfLifeMinHours', 'halfLifeMaxHours', 'halfLifeHours', 12);

  medNameInput.value = med.name;
  medCategoryInput.value = med.category || '';
  medTagsInput.value = formatTagsInput(med.tags);
  medBoxInput.value = 1;
  medBoardInput.value = 1;
  medPillsInput.value = med.pillsPerBoard || 0;
  medUnitInput.value = med.unit || '片';
  medDoseAmountInput.value = med.doseAmount ?? 1;
  medDosePerTabletInput.value = med.dosePerTablet ?? 1;
  medDoseMassUnitInput.value = med.doseMassUnit ?? 'mg';
  medRemainingInput.value = med.pillsPerBoard || 0;
  medOnsetMinInput.value = onsetMin;
  medOnsetMaxInput.value = onsetMax;
  medPeakMinInput.value = peakMin;
  medPeakMaxInput.value = peakMax;
  medHalfLifeMinInput.value = halfLifeMin;
  medHalfLifeMaxInput.value = halfLifeMax;
  setTherapeuticForm(med);
  setConcentrationParamsForm(med);
  medNoteInput.value = med.note || '';
  medColorInput.value = defaultMedColor();
  resetSchedule();
  // 从内置库选取后按默认规格（1 盒 × 1 板/瓶）重建板草稿，默认整板/瓶全满
  boardDraft = [];
  initBoardDraftForMed(null);
  renderBoardEditor();
  selectedDbMed = med;
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
  setManualFieldsVisible(false);
}

function percent(med) {
  return med.totalPills > 0 ? Math.round((med.remainingPills / med.totalPills) * 100) : 0;
}

function parseTagsInput(value) {
  return value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function formatTagsInput(tags) {
  return (tags || []).join(', ');
}

function getAllMedTags() {
  const tags = new Set();
  store.data.meds.forEach(med => {
    if (med.category) tags.add(med.category);
    (med.tags || []).forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

function medHasAnyTag(med, selectedTags) {
  if (!selectedTags || selectedTags.length === 0) return true;
  const medTags = new Set(med.tags || []);
  if (med.category) medTags.add(med.category);
  return selectedTags.some(tag => medTags.has(tag));
}

function parseRangeDate(dateStr, endOfDay) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date();
  d.setFullYear(year, month - 1, day);
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, 0);
  return d.getTime();
}

function getLogsCustomRange() {
  const start = parseRangeDate(logsRangeStart?.value, false);
  const end = parseRangeDate(logsRangeEnd?.value, true);
  return start !== null && end !== null ? { start, end } : null;
}

// 预测药品耗尽时间：按剩余片数与「每次服用量」逐次推算（各次消耗 doseAmount，
// 兼容半片/1.5 片等小数余量与 doseAmount；整数片只是其中特例）。
// 返回耗尽时间戳；无计划/耗尽已过或不足一次时返回 -1；无计划返回 null。
export function predictDepletion(med) {
  if (!Array.isArray(med.schedule) || med.schedule.length === 0) return null;
  const dailyCount = med.schedule.length;
  if (dailyCount <= 0) return null;
  const remaining = Number(med.remainingPills);
  if (!Number.isFinite(remaining) || remaining <= 0) return -1;
  const perIntake = Number(med.doseAmount) || 1;
  if (!(perIntake > 0)) return null;
  const now = Date.now();
  const sortedSchedule = [...med.schedule].sort();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  // 还能按计划完整服用的次数（剩余片数 ÷ 每次用量，向下取整）
  const intakes = Math.floor(remaining / perIntake);
  if (intakes <= 0) return -1;
  const todayFutureTimes = sortedSchedule
    .map(time => {
      const [h, min] = time.split(':').map(Number);
      return todayStart + h * 3600000 + min * 60000;
    })
    .filter(ts => ts > now);
  // 第 intakes 次服药（1 起）会用完库存。今天剩余时刻够用就耗尽在今天。
  if (todayFutureTimes.length > 0 && intakes <= todayFutureTimes.length) {
    return todayFutureTimes[intakes - 1];
  }
  // 今天用完仍不够：从明天算起还有 k 次可完整服用，耗尽发生在第 k 次。
  // n = k-1 是未来计划序列里的 0 起下标，换算为“距今天的天数 d+1 + 当天第 i 个时刻”。
  const k = intakes - todayFutureTimes.length;
  const n = k - 1;
  const d = Math.floor(n / dailyCount);
  const i = n % dailyCount;
  const [h, min] = sortedSchedule[i].split(':').map(Number);
  return todayStart + (d + 1) * DAY_MS + h * 3600000 + min * 60000;
}

function formatDepletion(depletionTs) {
  if (depletionTs === -1) return t('meds.depletion.exhausted');
  const diff = depletionTs - Date.now();
  if (diff <= 0) return t('meds.depletion.exhausted');
  const totalMinutes = Math.floor(diff / 60000);
  const totalHours = Math.floor(diff / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days >= 1 && hours > 0) {
    return t('meds.depletion.daysHours', { d: days, h: hours });
  } else if (days >= 1) {
    return t('meds.depletion.days', { d: days });
  } else if (totalHours >= 1) {
    return t('meds.depletion.hours', { h: totalHours });
  } else {
    return t('meds.depletion.minutes', { m: totalMinutes });
  }
}

function renderMeds() {
  const tbody = document.querySelector('#meds-table tbody');
  tbody.innerHTML = '';
  const filtered = medsSelectedTags.length
    ? store.data.meds.filter(med => medHasAnyTag(med, medsSelectedTags))
    : store.data.meds;
  filtered.forEach(med => {
    const tr = document.createElement('tr');
    const pct = percent(med);
    // 截断渐变：渐变覆盖整个条宽，填充宽度截断可见部分
    const fillStyle = `width: ${pct}%; background: linear-gradient(90deg, #ef4444, #eab308 50%, #22c55e); background-size: 120px 100%; background-repeat: no-repeat;`;
    const depletionTs = predictDepletion(med);
    const depletionLine = depletionTs === null ? '' : formatDepletion(depletionTs);
    const tagsHtml = (med.tags || []).slice(0, 3).map(tag => `<span class="med-tag-chip">${tag}</span>`).join('');
    const showDepletionBtn = platform.isAndroid() && depletionTs !== null && depletionTs > 0;
    tr.innerHTML = `
      <td><strong>${med.name}</strong></td>
      <td>${med.category || t('meds.table.emptyNote')}</td>
      <td>
        <div class="progress-bar"><div class="progress-fill" style="${fillStyle}"></div></div>
        <small style="color: var(--theme-text-muted)">${pct}% · ${med.remainingPills}${med.unit}</small>
        <div class="med-remaining-extra">
          ${med.boards && med.boards.length ? `<button class="btn btn-sm" data-action="board-detail" data-id="${med.id}" title="${t('meds.boardDetail.button')}">${t('meds.boardDetail.button')}</button>` : ''}
          ${depletionLine ? `<small style="color: var(--theme-text-muted)">${depletionLine}</small>` : ''}
        </div>
      </td>
      <td>${formatQuantity(med)}</td>
      <td>${med.note || t('meds.table.emptyNote')}${tagsHtml ? `<div class="med-tags-cell">${tagsHtml}</div>` : ''}</td>
      <td>
        <div class="med-actions">
          ${showDepletionBtn ? `<button class="btn btn-sm" data-action="add-depletion-reminder" data-id="${med.id}" title="${t('meds.table.addDepletionReminder')}">${t('meds.table.addDepletionReminder')}</button>` : ''}
          <button class="btn btn-icon" data-action="adjust" data-id="${med.id}" title="${t('meds.adjustTitle')}">${t('meds.adjust')}</button>
          <button class="btn btn-icon" data-action="edit" data-id="${med.id}">${t('common.edit')}</button>
          <button class="btn btn-danger" data-action="delete" data-id="${med.id}">${t('common.delete')}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  renderMedsTagFilter();
}

function renderMedsTagFilter() {
  if (!medsFilterTags) return;
  medsFilterTags.innerHTML = '';
  const tags = getAllMedTags();
  medsFilterTags.hidden = false;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!medsSelectedTags.length ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    medsSelectedTags = [];
    renderMeds();
  });
  medsFilterTags.appendChild(allBtn);

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${medsSelectedTags.includes(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      const idx = medsSelectedTags.indexOf(tag);
      if (idx >= 0) medsSelectedTags.splice(idx, 1);
      else medsSelectedTags.push(tag);
      renderMeds();
    });
    medsFilterTags.appendChild(btn);
  });

  if (tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'med-db-tag-hint';
    hint.textContent = t('meds.form.tagFilterHint');
    medsFilterTags.appendChild(hint);
  }
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '';
  const medMap = Object.fromEntries(store.data.meds.map(m => [m.id, m]));

  const periodValue = logsPeriodFilter?.value || 'all';
  const customRange = periodValue === 'custom' ? getLogsCustomRange() : null;
  const periodDays = periodValue === 'all' || periodValue === 'custom' ? null : Number(periodValue);
  const periodCutoff = periodDays ? Date.now() - periodDays * 24 * 60 * 60 * 1000 : null;

  let logs = store.data.logs;
  if (customRange) {
    logs = logs.filter(l => l.timestamp >= customRange.start && l.timestamp <= customRange.end);
  } else if (periodCutoff) {
    logs = logs.filter(l => l.timestamp >= periodCutoff);
  }
  if (logsSelectedTags.length) {
    logs = logs.filter(log => {
      const med = medMap[log.medicationId];
      return med && medHasAnyTag(med, logsSelectedTags);
    });
  }
  // 仅加载最近的日志，避免日志过多导致卡顿
  const limitHint = document.getElementById('logs-limit-hint');
  const maxLoaded = getMaxLoadedRecords();
  const limited = logs.length > maxLoaded;
  if (limited) {
    logs = logs.slice(0, maxLoaded);
  }
  if (limitHint) {
    limitHint.hidden = !limited;
    if (limited) limitHint.textContent = t('records.history.limitHint', { count: maxLoaded });
  }

  // 可见（即渲染出的）日志 id 集合：筛选+截断后的当前结果
  logsRenderedIds = logs.map(l => l.id);
  // 清除不在当前结果里的勾选（例如筛选/时间段变化后残留的“幽灵”选中）
  if (logsBatchMode) {
    [...logsBatchSelected].forEach(id => {
      if (!logsRenderedIds.includes(id)) logsBatchSelected.delete(id);
    });
  }
  // 批量模式：当前结果里没有任何日志时自动退出批量模式，避免留下空操作条
  if (logs.length === 0 && logsBatchMode) {
    logsBatchMode = false;
    logsBatchSelected.clear();
  }

  const maxDelta = Math.max(1, ...logs.map(l => Math.abs(l.delta)));
  // 记录越多，渐入动画步长越小，避免末尾项目等待过久
  let animStep = 60;
  if (getTheme().dynamicAnimationSpeed !== false && logs.length > 10) {
    animStep = Math.max(8, Math.min(animStep, Math.floor(3000 / logs.length)));
  }
  logs.forEach((log, idx) => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.style.animationDelay = `${idx * animStep}ms`;
    if (logsBatchMode) {
      item.classList.add('log-selectable');
      if (logsBatchSelected.has(log.id)) item.classList.add('selected');
    }
    const width = Math.max(4, (Math.abs(log.delta) / maxDelta) * 160);
    const sign = log.delta > 0 ? '+' : '';
    const checkedAttr = logsBatchSelected.has(log.id) ? 'checked' : '';
    const checkHtml = logsBatchMode
      ? `<label class="log-check"><input type="checkbox" data-action="toggle-log" data-id="${log.id}" ${checkedAttr}></label>`
      : '';
    const actionsHtml = logsBatchMode ? '' : `
      <footer class="log-actions">
        <button class="btn btn-icon btn-sm" data-action="edit-log" data-id="${log.id}">${t('common.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-log" data-id="${log.id}">${t('common.delete')}</button>
      </footer>
    `;
    item.innerHTML = `
      <div class="log-item-top">
        ${checkHtml}
        <header>
          <span class="name">${log.name}</span>
          <time>${formatDateTime(log.timestamp)}</time>
        </header>
      </div>
      <div class="log-bar-wrap">
        <div class="log-bar ${log.delta < 0 ? 'negative' : ''}" style="width: ${width}px"></div>
        <span class="log-delta ${log.delta < 0 ? 'negative' : 'positive'}">${sign}${log.delta}</span>
      </div>
      ${log.note ? `<small style="color: var(--theme-text-muted); display: block; margin-top: 6px">${log.note}</small>` : ''}
      ${actionsHtml}
    `;
    list.appendChild(item);
  });
  updateLogsBatchUI();
  renderLogsTagFilter();
}

// 切换「批量管理」模式
function setLogsBatchMode(on) {
  if (logsBatchMode === on) return;
  logsBatchMode = on;
  if (!on) logsBatchSelected.clear();
  updateLogsBatchUI();
  renderLogs();
}

// 同步批量模式相关 UI：按钮文案/高亮、操作条显隐、删除按钮可用性、全选态与计数
function updateLogsBatchUI() {
  if (logsBatchBtn) {
    logsBatchBtn.textContent = logsBatchMode
      ? t('meds.logs.batchExit')
      : t('meds.logs.batch');
    logsBatchBtn.classList.toggle('active', logsBatchMode);
    logsBatchBtn.disabled = store.data.logs.length === 0;
  }
  if (logsBatchBar) {
    logsBatchBar.hidden = !logsBatchMode;
  }
  if (logsBatchDelete) {
    logsBatchDelete.disabled = logsBatchSelected.size === 0;
  }
  if (logsBatchSelectAll) {
    if (logsBatchMode) {
      const selectedCount = logsRenderedIds.filter(id => logsBatchSelected.has(id)).length;
      logsBatchSelectAll.checked = logsRenderedIds.length > 0 && selectedCount === logsRenderedIds.length;
      logsBatchSelectAll.indeterminate = selectedCount > 0 && selectedCount < logsRenderedIds.length;
      logsBatchSelectAll.disabled = logsRenderedIds.length === 0;
    } else {
      logsBatchSelectAll.checked = false;
      logsBatchSelectAll.indeterminate = false;
      logsBatchSelectAll.disabled = true;
    }
  }
  if (logsBatchSelectedCount) {
    logsBatchSelectedCount.textContent = String(logsBatchSelected.size);
  }
}

function renderLogsTagFilter() {
  if (!logsFilterTags) return;
  logsFilterTags.innerHTML = '';
  const tags = getAllMedTags();
  logsFilterTags.hidden = false;
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `med-db-tag ${!logsSelectedTags.length ? 'active' : ''}`;
  allBtn.textContent = t('meds.form.dbTagAll');
  allBtn.addEventListener('click', () => {
    logsSelectedTags = [];
    renderLogs();
  });
  logsFilterTags.appendChild(allBtn);

  tags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `med-db-tag ${logsSelectedTags.includes(tag) ? 'active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      const idx = logsSelectedTags.indexOf(tag);
      if (idx >= 0) logsSelectedTags.splice(idx, 1);
      else logsSelectedTags.push(tag);
      renderLogs();
    });
    logsFilterTags.appendChild(btn);
  });

  if (tags.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'med-db-tag-hint';
    hint.textContent = t('meds.form.tagFilterHint');
    logsFilterTags.appendChild(hint);
  }
}

function renderScheduleList() {
  medScheduleList.innerHTML = '';
  currentSchedule.forEach((time, idx) => {
    const chip = document.createElement('span');
    chip.className = 'schedule-chip';
    chip.innerHTML = `<span>${time}</span><button type="button" data-idx="${idx}" aria-label="${t('common.delete')}">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      currentSchedule.splice(idx, 1);
      renderScheduleList();
    });
    medScheduleList.appendChild(chip);
  });
}

function addScheduleTime() {
  const time = medScheduleTimeInput.value;
  if (!time || currentSchedule.includes(time)) return;
  currentSchedule.push(time);
  currentSchedule.sort();
  medScheduleTimeInput.value = '';
  renderScheduleList();
}

function resetSchedule() {
  currentSchedule = [];
  medScheduleTimeInput.value = '';
  renderScheduleList();
}

// ===== 板/瓶明细（编辑与详情） =====

// 当前表单规格下的板/瓶单位文案（「板」/「瓶」/自定义），依赖药品单位
function boardUnitName() {
  const unit = medUnitInput.value || '粒';
  return unit === '片' ? t('unit.board') : t('unit.bottle');
}

// 当前表单规格：应有多少行板/瓶（0 表示规格未确定，散装容器）
function boardRowsByForm() {
  const box = Math.max(0, Math.floor(Number(medBoxInput.value) || 0));
  const board = Math.max(0, Math.floor(Number(medBoardInput.value) || 0));
  return box * board;
}

function boardCapacityByForm() {
  const pills = Math.max(0, Math.floor(Number(medPillsInput.value) || 0));
  return pills > 0 ? pills : null;
}

function sumBoardDraft() {
  return boardDraft.reduce((s, b) => s + (Math.max(0, Number(b.remaining) || 0)), 0);
}

// 依据当前规格把 boardDraft 校准到正确行数。保留旧剩余（按序映射）。
// seedTotal：boardDraft 为空时使用的总剩余种子。
function normalizeBoardDraft(seedTotal) {
  const expected = boardRowsByForm();
  const cap = boardCapacityByForm();
  const rows = expected > 0 ? expected : 1;
  // 新建流程：规格一旦完整且尚未手工编辑过，自动全满一次（每板都满，方便直接录入）。
  if (!boardDraftFresh && expected > 0 && cap != null) {
    boardDraft = [];
    for (let i = 0; i < rows; i++) {
      boardDraft.push({ id: Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6), remaining: cap });
    }
    boardDraftFresh = true;
    return;
  }
  if (boardDraft.length === rows) return;
  if (boardDraft.length === 0) {
    // 初次：全满（散装无容量时单行用种子/0）
    const seed = Math.max(0, Number(seedTotal) || 0);
    boardDraft = [];
    for (let i = 0; i < rows; i++) {
      boardDraft.push({ id: Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6), remaining: cap == null ? (i === 0 ? seed : 0) : cap });
    }
    return;
  }
  // 行数变化：保留前 min(旧, 新) 行原值；新增行按容量补满；减少行把多余剩余并入末行。
  const keep = Math.min(boardDraft.length, rows);
  const next = boardDraft.slice(0, keep).map(b => ({ ...b }));
  if (rows > boardDraft.length) {
    for (let i = boardDraft.length; i < rows; i++) {
      next.push({ id: Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6), remaining: cap == null ? 0 : cap });
    }
  } else {
    let extra = 0;
    for (let i = rows; i < boardDraft.length; i++) {
      extra += Math.max(0, Number(boardDraft[i].remaining) || 0);
    }
    if (next.length && extra > 0) {
      next[next.length - 1].remaining = Math.max(0, Number(next[next.length - 1].remaining) || 0) + extra;
    }
  }
  boardDraft = next;
}

// 重新渲染板编辑器并更新总剩余显示
function renderBoardEditor() {
  if (!medBoardsEditor) return;
  normalizeBoardDraft();
  const box = Math.max(0, Math.floor(Number(medBoxInput.value) || 0));
  const board = Math.max(0, Math.floor(Number(medBoardInput.value) || 0));
  const cap = boardCapacityByForm();
  const count = boardDraft.length;
  const unitName = boardUnitName();
  medBoardsEditor.innerHTML = '';

  // 计算分组（盒层级），只有 box>1 且 board>1 时才显示盒分组
  const showBoxGroup = box > 1 && board > 1;
  const groups = showBoxGroup
    ? Array.from({ length: box }, (_, bi) => ({ boxIndex: bi, from: bi * board, to: (bi + 1) * board }))
    : [{ boxIndex: null, from: 0, to: count }];

  groups.forEach(g => {
    const slice = boardDraft.slice(g.from, Math.min(g.to, count));
    if (slice.length === 0) return;
    const frag = document.createElement('div');
    frag.className = 'board-group';
    if (showBoxGroup) {
      const header = document.createElement('div');
      header.className = 'board-group-title';
      header.textContent = t('meds.boardDetail.boxLabel', { n: g.boxIndex + 1 });
      frag.appendChild(header);
    }
    slice.forEach((bd, localIdx) => {
      const globalIdx = g.from + localIdx;
      const row = document.createElement('div');
      row.className = 'board-edit-row';
      const label = showBoxGroup
        ? `${unitName} ${localIdx + 1}`
        : `${unitName} ${globalIdx + 1}`;
      row.innerHTML = `
        <span class="board-edit-label">${label}</span>
        <input type="number" class="board-remaining-input" min="0" step="any" value="${bd.remaining}" data-id="${bd.id}">
        <span class="board-edit-capacity">/ ${cap == null ? t('meds.boardDetail.loose') : `${cap}${medUnitInput.value || ''}`}</span>
      `;
      row.querySelector('input').addEventListener('input', () => {
        const val = Number(row.querySelector('input').value);
        const id = bd.id;
        const item = boardDraft.find(b => b.id === id);
        if (item) item.remaining = Math.max(0, val || 0);
        boardDraftFresh = true;
        updateRemainingTotalInput();
      });
      frag.appendChild(row);
    });
    medBoardsEditor.appendChild(frag);
  });
  updateRemainingTotalInput();
}

function updateRemainingTotalInput() {
  if (!medRemainingInput) return;
  medRemainingInput.value = sumBoardDraft();
}

// 从当前板编辑器草稿生成 payload 的 boards 与总剩余
function collectBoardsPayload() {
  normalizeBoardDraft();
  const cap = boardCapacityByForm();
  const capFinite = boardRowsByForm() > 0 ? cap : null;
  return {
    boards: boardDraft.map(b => ({
      id: b.id,
      remaining: Math.max(0, Number(b.remaining) || 0),
      capacity: capFinite != null ? capFinite : null
    })),
    remainingPills: sumBoardDraft()
  };
}

// 打开药品编辑弹窗时，用已有 med 初始化 boardDraft
function initBoardDraftForMed(med) {
  if (med && Array.isArray(med.boards) && med.boards.length) {
    boardDraft = med.boards.map(b => ({ id: b.id, remaining: b.remaining }));
    boardDraftFresh = true;
  } else if (med) {
    const ensure = ensureMedBoards({ ...med });
    boardDraft = (ensure.boards || []).map(b => ({ id: b.id, remaining: b.remaining }));
    boardDraftFresh = true;
  } else {
    boardDraft = [];
    boardDraftFresh = false;
  }
  normalizeBoardDraft();
}

// 全部补满 / 全部清零
function fillAllBoards() {
  const cap = boardCapacityByForm();
  boardDraft.forEach(b => { b.remaining = cap == null ? 0 : cap; });
  renderBoardEditor();
}

function zeroAllBoards() {
  boardDraft.forEach(b => { b.remaining = 0; });
  renderBoardEditor();
}

// 只读树形详情（药品库表格「详情」按钮）
function openBoardDetail(med) {
  if (!boardDetailModal) return;
  ensureMedBoards(med);
  const boardUnit = med.unit === '片' ? t('unit.board') : t('unit.bottle');
  const tree = boardDetailTree;
  tree.innerHTML = '';
  const cap = boardCapacityOf(med);
  const subtitle = document.getElementById('board-detail-sub');
  if (subtitle) {
    subtitle.textContent = `${med.name} · ${t('meds.boardDetail.total', { n: med.remainingPills, u: med.unit })} · ${med.boards.length} ${boardUnit}`;
  }
  const groups = groupBoardsByBox(med);
  groups.forEach((g, gi) => {
    const grp = document.createElement('div');
    grp.className = 'board-tree-group';
    if (g.boxIndex != null) {
      const h = document.createElement('div');
      h.className = 'board-tree-group-title';
      h.textContent = t('meds.boardDetail.boxLabel', { n: g.boxIndex + 1 });
      grp.appendChild(h);
    }
    g.boards.forEach(b => {
      const row = document.createElement('div');
      row.className = 'board-tree-row';
      const label = g.boxIndex != null
        ? `${boardUnit} ${(g.boards.indexOf(b) + 1)}`
        : `${boardUnit} ${b.index + 1}`;
      const pct = b.capacity ? Math.round((b.remaining / b.capacity) * 100) : null;
      const emptyCls = b.remaining <= 0 ? 'board-tree-empty' : '';
      row.innerHTML = `
        <span class="board-tree-name ${emptyCls}">${label}</span>
        <div class="board-tree-bar-wrap">
          <div class="board-tree-bar ${emptyCls}" style="width: ${pct == null ? 100 : Math.max(0, Math.min(100, pct))}%"></div>
        </div>
        <span class="board-tree-value ${emptyCls}">${b.remaining}${med.unit}${b.capacity ? ' / ' + b.capacity + med.unit : ''}</span>
      `;
      grp.appendChild(row);
    });
    tree.appendChild(grp);
  });
  boardDetailModal.setAttribute('aria-hidden', 'false');
}

function closeBoardDetail() {
  if (boardDetailModal) boardDetailModal.setAttribute('aria-hidden', 'true');
}

function defaultMedColor() {
  return DEFAULT_MED_COLORS[store.data.meds.length % DEFAULT_MED_COLORS.length];
}

function setManualFieldsVisible(visible) {
  manualFieldsVisible = visible;
  medManualFields.hidden = !visible;
  medToggleManual.textContent = visible ? t('meds.form.manualToggleHide') : t('meds.form.manualToggle');
  medNameInput.required = visible;
  medBoxInput.required = visible;
  medBoardInput.required = visible;
  medPillsInput.required = visible;
  medUnitInput.required = visible;
  medDoseAmountInput.required = visible;
  medDosePerTabletInput.required = visible;
  medDoseMassUnitInput.required = visible;
  medOnsetMinInput.required = visible;
  medOnsetMaxInput.required = visible;
  medPeakMinInput.required = visible;
  medPeakMaxInput.required = visible;
  medHalfLifeMinInput.required = visible;
  medHalfLifeMaxInput.required = visible;
}

function toggleManualFields() {
  setManualFieldsVisible(!manualFieldsVisible);
  if (manualFieldsVisible) {
    medNameInput.focus();
  }
}

function openModal(med = null) {
  medForm.reset();
  selectedDbMed = null;
  medDbSearch.value = '';
  medDbSelectedTag = '';
  renderTags();
  renderMedResults([]);
  if (med) {
    medModalTitle.textContent = t('meds.modal.editTitle');
    medIdInput.value = med.id;
    medNameInput.value = med.name;
    medCategoryInput.value = med.category;
    medTagsInput.value = formatTagsInput(med.tags);
    medBoxInput.value = med.boxCount;
    const [onsetMin, onsetMax] = readRangeHours(med, 'onsetRangeHours', 'onsetMinHours', 'onsetMaxHours', 'onsetHours', 1);
    const [peakMin, peakMax] = readRangeHours(med, 'peakRangeHours', 'peakMinHours', 'peakMaxHours', 'peakHours', 2);
    const [halfLifeMin, halfLifeMax] = readRangeHours(med, 'halfLifeRangeHours', 'halfLifeMinHours', 'halfLifeMaxHours', 'halfLifeHours', 12);

    medBoardInput.value = med.boardPerBox;
    medPillsInput.value = med.pillsPerBoard;
    medUnitInput.value = med.unit;
    medDoseAmountInput.value = med.doseAmount ?? 1;
    medDosePerTabletInput.value = med.dosePerTablet ?? 1;
    medDoseMassUnitInput.value = med.doseMassUnit ?? 'mg';
    medRemainingInput.value = med.remainingPills;
    medOnsetMinInput.value = onsetMin;
    medOnsetMaxInput.value = onsetMax;
    medPeakMinInput.value = peakMin;
    medPeakMaxInput.value = peakMax;
    medHalfLifeMinInput.value = halfLifeMin;
    medHalfLifeMaxInput.value = halfLifeMax;
    setTherapeuticForm(med);
    setConcentrationParamsForm(med);
    medNoteInput.value = med.note;
    if (medColorInput) {
      const medIdx = store.data.meds.findIndex(m => m.id === med.id);
      medColorInput.value = med.color || DEFAULT_MED_COLORS[medIdx % DEFAULT_MED_COLORS.length];
    }
    currentSchedule = Array.isArray(med.schedule) ? [...med.schedule] : [];
    renderScheduleList();
    initBoardDraftForMed(med);
    renderBoardEditor();
    setManualFieldsVisible(true);
  } else {
    medModalTitle.textContent = t('meds.modal.addTitle');
    medIdInput.value = '';
    medBoxInput.value = 1;
    medBoardInput.value = 1;
    medPillsInput.value = '';
    medUnitInput.value = '粒';
    medDoseAmountInput.value = 1;
    medDosePerTabletInput.value = 1;
    medDoseMassUnitInput.value = 'mg';
    medOnsetMinInput.value = 1;
    medOnsetMaxInput.value = 1;
    medPeakMinInput.value = 2;
    medPeakMaxInput.value = 2;
    medHalfLifeMinInput.value = 12;
    medHalfLifeMaxInput.value = 12;
    medTherapeuticMinInput.value = '';
    medTherapeuticMaxInput.value = '';
    medTherapeuticUnitInput.value = '';
    medVdInput.value = '';
    medBioavailabilityInput.value = '';
    medColorInput.value = defaultMedColor();
    resetSchedule();
    boardDraft = [];
    initBoardDraftForMed(null);
    renderBoardEditor();
    setManualFieldsVisible(false);
  }
  medModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  medModal.setAttribute('aria-hidden', 'true');
}

function openStockModal(med) {
  stockForm.reset();
  stockMedIdInput.value = med.id;
  // 填充「板/瓶来源」选择（多板时可用）
  if (stockBoardSelect && stockBoardRow) {
    ensureMedBoards(med);
    const boards = med.boards || [];
    const boardUnit = med.unit === '片' ? t('unit.board') : t('unit.bottle');
    stockBoardSelect.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('meds.stock.autoBoard');
    stockBoardSelect.appendChild(auto);
    if (boards.length > 1) {
      boards.forEach((b, i) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${boardUnit} ${i + 1}（${t('meds.boardDetail.total', { n: Math.max(0, Number(b.remaining) || 0), u: med.unit })}）`;
        stockBoardSelect.appendChild(opt);
      });
      stockBoardRow.hidden = false;
    } else {
      stockBoardRow.hidden = true;
    }
  }
  stockModal.setAttribute('aria-hidden', 'false');
  stockDeltaInput.focus();
}

function closeStockModal() {
  stockModal.setAttribute('aria-hidden', 'true');
}

function formatDateTimeLocal(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderLogMedOptions(selectedId = '') {
  logMedSelect.innerHTML = '';
  if (store.data.meds.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('records.moodForm.noMeds');
    logMedSelect.appendChild(option);
    return;
  }
  store.data.meds.forEach(med => {
    const option = document.createElement('option');
    option.value = med.id;
    option.textContent = med.name;
    if (med.id === selectedId) option.selected = true;
    logMedSelect.appendChild(option);
  });
}

function openLogModal(log) {
  logForm.reset();
  logIdInput.value = log.id;
  logMedRow.hidden = true;
  logModalTitle.textContent = t('meds.log.modalTitle');
  logTimeInput.value = formatDateTimeLocal(log.timestamp);
  logDeltaInput.value = log.delta;
  logNoteInput.value = log.note || '';
  logModal.setAttribute('aria-hidden', 'false');
  logTimeInput.focus();
}

function openAddLogModal() {
  logForm.reset();
  logIdInput.value = '';
  logMedRow.hidden = false;
  logModalTitle.textContent = t('meds.log.addModalTitle');
  renderLogMedOptions();
  logTimeInput.value = formatDateTimeLocal(Date.now());
  logDeltaInput.value = '';
  logNoteInput.value = '';
  logModal.setAttribute('aria-hidden', 'false');
  logMedSelect.focus();
}

function closeLogModal() {
  logModal.setAttribute('aria-hidden', 'true');
}

function handleFormSubmit(e) {
  e.preventDefault();
  if (!manualFieldsVisible && !medNameInput.value.trim()) {
    setManualFieldsVisible(true);
    medNameInput.focus();
    return;
  }
  const box = Number(medBoxInput.value) || 0;
  const board = Number(medBoardInput.value) || 0;
  const pills = Number(medPillsInput.value) || 0;
  const total = box * board * pills;
  const boardPayload = collectBoardsPayload();
  const remaining = boardPayload.remainingPills;
  const onsetMin = Math.max(0, Number(medOnsetMinInput.value) || 0);
  const peakMin = Math.max(0, Number(medPeakMinInput.value) || 0);
  const halfLifeMin = Math.max(0.1, Number(medHalfLifeMinInput.value) || 0.1);
  const therapeuticMinRaw = medTherapeuticMinInput.value.trim();
  const therapeuticMaxRaw = medTherapeuticMaxInput.value.trim();
  const therapeuticMin = therapeuticMinRaw === '' ? null : Math.max(0, Number(therapeuticMinRaw) || 0);
  const therapeuticMax = therapeuticMaxRaw === '' ? null : Math.max(0, Number(therapeuticMaxRaw) || 0);
  const hasWindow = therapeuticMin !== null && therapeuticMax !== null && therapeuticMax > 0;
  const vdRaw = medVdInput.value.trim();
  const fRaw = medBioavailabilityInput.value.trim();
  const vdPerKg = vdRaw === '' ? null : Math.max(0, Number(vdRaw) || 0);
  const bioavailability = fRaw === '' ? null : Math.min(1, Math.max(0, Number(fRaw) || 0));
  // mmol/L 浓度所需的化学常数（分子量 g/mol、每摩尔活性离子数）取自内置数据库；编辑时保留已保存值。
  const existingMed = medIdInput.value ? store.data.meds.find(m => m.id === medIdInput.value) : null;
  const pkSource = selectedDbMed || existingMed || {};
  const molarMass = Number(pkSource.molarMass) || null;
  const activeRatio = Number(pkSource.activeRatio) || null;
  const payload = {
    name: medNameInput.value.trim(),
    category: medCategoryInput.value.trim(),
    tags: parseTagsInput(medTagsInput.value),
    boxCount: box,
    boardPerBox: board,
    pillsPerBoard: pills,
    unit: medUnitInput.value,
    doseAmount: Math.max(0.1, Number(medDoseAmountInput.value) || 1),
    dosePerTablet: Math.max(0.01, Number(medDosePerTabletInput.value) || 1),
    doseMassUnit: medDoseMassUnitInput.value || 'mg',
    totalPills: total,
    remainingPills: remaining,
    boards: boardPayload.boards,
    onsetMinHours: onsetMin,
    onsetMaxHours: Math.max(onsetMin, Number(medOnsetMaxInput.value) || onsetMin),
    peakMinHours: peakMin,
    peakMaxHours: Math.max(peakMin, Number(medPeakMaxInput.value) || peakMin),
    halfLifeMinHours: halfLifeMin,
    halfLifeMaxHours: Math.max(halfLifeMin, Number(medHalfLifeMaxInput.value) || halfLifeMin),
    therapeuticMin: hasWindow ? therapeuticMin : null,
    therapeuticMax: hasWindow ? therapeuticMax : null,
    therapeuticUnit: hasWindow ? (medTherapeuticUnitInput.value || '') : '',
    vdPerKg: vdPerKg && vdPerKg > 0 ? vdPerKg : null,
    bioavailability: bioavailability && bioavailability > 0 && bioavailability <= 1 ? bioavailability : null,
    molarMass,
    activeRatio,
    color: medColorInput.value,
    schedule: [...currentSchedule],
    note: medNoteInput.value.trim()
  };
  if (medIdInput.value) {
    store.updateMed(medIdInput.value, payload);
  } else {
    store.addMed({ ...payload, totalPills: total || remaining, remainingPills: remaining });
  }
  closeModal();
}

async function handleStockSubmit(e) {
  e.preventDefault();
  const id = stockMedIdInput.value;
  const delta = Number(stockDeltaInput.value) || 0;
  const note = stockNoteInput.value.trim();
  if (delta === 0) {
    await showAlert(t('meds.validation.stockZero'));
    return;
  }
  store.changeMedStock(id, delta, note || t('meds.stock.defaultReason'), null, stockBoardSelect?.value || null);
  closeStockModal();
}

async function handleLogSubmit(e) {
  e.preventDefault();
  const id = logIdInput.value;
  const timestamp = new Date(logTimeInput.value).getTime();
  const delta = Number(logDeltaInput.value) || 0;
  const note = logNoteInput.value.trim();
  if (Number.isNaN(timestamp)) {
    await showAlert(t('records.validation.endAfterStart'));
    return;
  }
  if (id) {
    store.updateLog(id, { timestamp, delta, note });
  } else {
    const medId = logMedSelect.value;
    if (!medId) {
      await showAlert(t('records.moodForm.noMeds'));
      return;
    }
    store.addHistoricalLog(medId, { timestamp, delta, note });
  }
  closeLogModal();
}

function initMeds() {
  if (medAddReminderBtn) {
    medAddReminderBtn.hidden = !platform.isMedicationReminderSupported();
  }

  document.getElementById('add-med-btn').addEventListener('click', () => openModal());
  document.getElementById('med-cancel').addEventListener('click', closeModal);
  medModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  medForm.addEventListener('submit', handleFormSubmit);
  medAddReminderBtn?.addEventListener('click', async () => {
    const name = medNameInput.value.trim();
    if (!name || currentSchedule.length === 0) {
      await showAlert(t('meds.validation.requiredReminder'));
      return;
    }
    await platform.addMedicationReminders({
      name,
      times: [...currentSchedule]
    });
  });
  medToggleManual.addEventListener('click', toggleManualFields);
  medAddScheduleBtn.addEventListener('click', addScheduleTime);
  medScheduleTimeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addScheduleTime();
    }
  });

  medDbSearch.addEventListener('input', () => {
    selectedDbMed = null;
    renderMedResults(filterMeds(medDbSearch.value.trim(), medDbSelectedTag));
  });

  document.getElementById('stock-cancel').addEventListener('click', closeStockModal);
  stockModal.querySelector('.modal-backdrop').addEventListener('click', closeStockModal);
  stockForm.addEventListener('submit', handleStockSubmit);

  document.getElementById('log-cancel').addEventListener('click', closeLogModal);
  logModal.querySelector('.modal-backdrop').addEventListener('click', closeLogModal);
  logForm.addEventListener('submit', handleLogSubmit);
  document.getElementById('add-log-btn').addEventListener('click', () => openAddLogModal());

  // 板/瓶剩余编辑器：规格变化时重绘（保留已有剩余草稿）
  [medBoxInput, medBoardInput, medPillsInput, medUnitInput].forEach(el => {
    el.addEventListener('change', () => {
      renderBoardEditor();
    });
  });
  medBoardsFillAllBtn?.addEventListener('click', fillAllBoards);
  medBoardsZeroAllBtn?.addEventListener('click', zeroAllBoards);

  // 剩余详情弹窗
  boardDetailCloseBtn?.addEventListener('click', closeBoardDetail);
  boardDetailModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeBoardDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && boardDetailModal && boardDetailModal.getAttribute('aria-hidden') === 'false') {
      closeBoardDetail();
    }
  });

  document.querySelector('#meds-table tbody').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const med = store.data.meds.find(m => m.id === id);
    if (!med) return;

    if (action === 'adjust') {
      openStockModal(med);
    } else if (action === 'board-detail') {
      openBoardDetail(med);
    } else if (action === 'add-depletion-reminder') {
      const depletionTs = predictDepletion(med);
      if (!depletionTs || depletionTs <= 0) {
        await showAlert(t('meds.validation.requiredDepletionReminder'));
        return;
      }
      await platform.addEventReminder({
        title: t('meds.depletion.reminderTitle', { name: med.name }),
        description: t('meds.depletion.reminderDesc', { name: med.name, remaining: med.remainingPills, unit: med.unit }),
        beginTime: depletionTs,
        endTime: depletionTs + 60 * 60 * 1000
      });
      await showAlert(t('meds.depletion.reminderAdded', { name: med.name }));
    } else if (action === 'edit') {
      openModal(med);
    } else if (action === 'delete') {
      if (await showConfirm(t('meds.confirm.delete', { name: med.name }))) {
        store.deleteMed(id);
      }
    }
  });

  document.getElementById('logs-list').addEventListener('click', async e => {
    const target = e.target;
    // 批量模式下行内复选框：点击时同步勾选状态
    if (target?.matches('input[data-action="toggle-log"]')) {
      const id = target.dataset.id;
      if (!id) return;
      if (target.checked) logsBatchSelected.add(id);
      else logsBatchSelected.delete(id);
      const item = target.closest('.log-item');
      if (item) item.classList.toggle('selected', target.checked);
      updateLogsBatchUI();
      return;
    }
    const btn = target.closest('button[data-action]');
    if (!btn && logsBatchMode) {
      // 批量模式下点击日志行（空白区域）也可切换选中，checkbox/按钮除外
      const item = target.closest('.log-item');
      if (item && !target.closest('input,label')) {
        const cb = item.querySelector('input[data-action="toggle-log"]');
        const id = cb?.dataset.id;
        if (id) {
          if (logsBatchSelected.has(id)) logsBatchSelected.delete(id);
          else logsBatchSelected.add(id);
          cb.checked = logsBatchSelected.has(id);
          item.classList.toggle('selected', cb.checked);
          updateLogsBatchUI();
        }
      }
      return;
    }
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    // 批量模式下操作按钮不可见，此处仅处理浏览模式的按钮
    if (action === 'edit-log') {
      const log = store.data.logs.find(l => l.id === id);
      if (!log) return;
      openLogModal(log);
    } else if (action === 'delete-log') {
      const log = store.data.logs.find(l => l.id === id);
      if (!log) return;
      if (await showConfirm(t('meds.log.confirmDelete', { name: log.name }))) {
        store.deleteLog(id);
      }
    }
  });

  // 变更日志批量管理入口/操作条
  logsBatchBtn?.addEventListener('click', () => {
    setLogsBatchMode(!logsBatchMode);
  });
  logsBatchSelectAll?.addEventListener('click', () => {
    if (!logsBatchMode) return;
    if (logsBatchSelectAll.checked) {
      logsRenderedIds.forEach(id => logsBatchSelected.add(id));
    } else {
      logsRenderedIds.forEach(id => logsBatchSelected.delete(id));
    }
    renderLogs();
  });
  logsBatchDelete?.addEventListener('click', async () => {
    const ids = [...logsBatchSelected];
    if (ids.length === 0) return;
    const ok = await showConfirm(t('meds.logs.batchDeleteConfirm', { count: ids.length }));
    if (!ok) return;
    // deleteLogs 同步通知触发 store.subscribe → renderLogs，内部会清理已选状态并刷新操作条
    store.deleteLogs(ids);
  });

  store.subscribe(() => {
    renderMeds();
    renderLogs();
  });
  subscribe(() => {
    renderMeds();
    renderLogs();
    renderTags();
  });
  subscribeTheme(() => {
    renderMeds();
    renderLogs();
  });

  logsPeriodFilter?.addEventListener('change', () => {
    if (logsCustomRange) logsCustomRange.hidden = logsPeriodFilter?.value !== 'custom';
    renderLogs();
  });
  logsRangeStart?.addEventListener('change', () => renderLogs());
  logsRangeEnd?.addEventListener('change', () => renderLogs());

  renderMeds();
  renderLogs();
  loadMedDB();
}

export { initMeds };
