import { store, formatDateTime, formatDuration } from './store.js';
import { t } from './i18n.js';
import { getTheme, DEFAULT_MED_COLORS } from './theme.js';

const PADDING = { top: 30, right: 40, bottom: 40, left: 44 };
const PX_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAD_HOURS = 6;
export const MAX_MOOD_RANGE_MS = 30 * DAY_MS;
const MAX_EFFECT_RANGE_MS = 7 * DAY_MS;
const MAX_EFFECT_FUTURE_MS = 7 * DAY_MS;
// 药物浓度低于该值时截断曲线，不再继续渲染
export const EFFECT_VISIBLE_THRESHOLD = 0.01;

function isScrollLocked() {
  return getTheme().scrollLock === true;
}

function formatAxisTime(ts, spanHours, timeStepHours = 24) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');

  // 跨度超过24小时时显示日期
  const showDate = spanHours > 24;
  // 步长小于24小时时显示小时（否则小时不重要）
  const showHour = timeStepHours < 24;

  if (showDate && showHour) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
  } else if (showDate) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } else {
    return `${pad(d.getHours())}:00`;
  }
}

function getTimeStepHours(spanHours, pxPerHour = PX_PER_HOUR) {
  // 目标：每个时间标签之间至少有80像素间距，避免重叠
  const minLabelSpacingPx = 80;
  const minSpacingHours = minLabelSpacingPx / pxPerHour;

  // 选择合适的步长，大于等于最小间距
  const candidates = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168];
  for (const c of candidates) {
    if (c >= minSpacingHours) {
      return c;
    }
  }

  // 如果跨度太大，使用更大的步长
  return Math.ceil(spanHours / 10);
}

function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function getUIScaleRatio() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale-ratio');
  const ratio = parseFloat(raw);
  return ratio > 0 ? ratio : 1;
}

function clientXToChartX(container, clientX) {
  const rect = container.getBoundingClientRect();
  return (clientX - rect.left) / getUIScaleRatio();
}

function interpolateColor(base, v, alpha = 1) {
  const t = Math.min(1, Math.abs(v) / 10);
  const factor = 1 - t;
  const r = Math.round(255 * factor + (base >> 16) * t);
  const g = Math.round(255 * factor + ((base >> 8) & 0xff) * t);
  const b = Math.round(255 * factor + (base & 0xff) * t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function colorForValue(v, theme, alpha = 1) {
  if (v === 0) {
    const rgb = hexToInt(theme.neutralColor);
    const r = rgb >> 16;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const base = hexToInt(v > 0 ? theme.positiveColor : theme.negativeColor);
  return interpolateColor(base, v, alpha);
}

function clampDisplayRange(displayMinTime, displayMaxTime, maxRangeMs) {
  const range = displayMaxTime - displayMinTime;
  if (range <= maxRangeMs) {
    return { displayMinTime, displayMaxTime, truncated: false };
  }
  return { displayMinTime: displayMaxTime - maxRangeMs, displayMaxTime, truncated: true };
}

function clearYAxisOverlays(wrap) {
  wrap.querySelectorAll('.y-axis-overlay').forEach(el => {
    if (el._scrollHandler) wrap.removeEventListener('scroll', el._scrollHandler);
    el.remove();
  });
}

function renderYAxisOverlay(wrap, side, labels, textColor, height) {
  const isLeft = side === 'left';
  const width = isLeft ? PADDING.left : PADDING.right;
  const cls = `y-axis-overlay ${side}`;
  let overlay = wrap.querySelector(`.y-axis-overlay.${side}`);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = cls;
    wrap.appendChild(overlay);
  }
  overlay.innerHTML = '';
  // 浮层需锚定在图表内容区顶部（chart-wrap 的 padding-top），
  // 否则右侧药效比例尺与左侧刻度会整体比曲线/网格偏高
  const padTop = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
  overlay.style.top = `${padTop}px`;
  overlay.style.height = `${height}px`;

  const svg = createSVGElement('svg', {
    width: '100%',
    height: '100%',
    viewBox: `0 0 ${width} ${height}`
  });

  labels.forEach(labelData => {
    if (labelData.isBar) {
      // 可交互的药效比例尺背景条
      const rect = createSVGElement('rect', {
        x: labelData.x - labelData.barWidth / 2,
        y: labelData.barY,
        width: labelData.barWidth,
        height: labelData.barHeight,
        fill: labelData.barColor,
        opacity: labelData.opacity !== undefined ? labelData.opacity : '0.15',
        class: 'effect-axis-bar',
        'data-med-idx': labelData.medIdx
      });
      svg.appendChild(rect);
      return;
    }
    if (labelData.isTick) {
      // 比例尺上的小刻度横线
      const tick = createSVGElement('line', {
        x1: labelData.x1, y1: labelData.y, x2: labelData.x2, y2: labelData.y,
        stroke: labelData.color || textColor,
        'stroke-width': labelData.strokeWidth || 1.5,
        'stroke-linecap': 'round',
        class: 'effect-axis-tick'
      });
      svg.appendChild(tick);
      return;
    }
    const x = labelData.x !== undefined ? labelData.x : (isLeft ? width - 10 : 10);
    const label = createSVGElement('text', {
      x,
      y: labelData.y + 4,
      'text-anchor': labelData.x !== undefined ? 'middle' : (isLeft ? 'end' : 'start'),
      fill: labelData.color || textColor,
      'font-size': '11'
    });
    label.textContent = labelData.value;
    svg.appendChild(label);
  });

  overlay.appendChild(svg);

  function update() {
    overlay.style.transform = `translateX(${wrap.scrollLeft}px)`;
  }
  update();
  if (overlay._scrollHandler) wrap.removeEventListener('scroll', overlay._scrollHandler);
  overlay._scrollHandler = update;
  wrap.addEventListener('scroll', update);
}

// 血药浓度“上限/下限”标注浮层：与右侧比例尺一样固定在视口右侧并跟随滚动，
// 无需滑动到图表最右端即可看到；文本带描边光晕，叠在曲线上仍清晰可读。
function renderTherapeuticLabelsOverlay(wrap, labels, height) {
  const width = 110;
  let overlay = wrap.querySelector('.therapeutic-labels-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'therapeutic-labels-overlay y-axis-overlay right';
    wrap.appendChild(overlay);
  }
  overlay.innerHTML = '';
  const padTop = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
  overlay.style.top = `${padTop}px`;
  overlay.style.height = `${height}px`;
  overlay.style.width = `${width}px`;
  overlay.style.background = 'transparent';

  const svg = createSVGElement('svg', {
    width: '100%',
    height: '100%',
    viewBox: `0 0 ${width} ${height}`
  });

  labels.forEach(l => {
    const text = createSVGElement('text', {
      x: width - 4, y: l.y - 4, 'text-anchor': 'end', fill: l.color, 'font-size': '10',
      class: 'therapeutic-label-text'
    });
    text.textContent = l.text;
    svg.appendChild(text);
  });

  overlay.appendChild(svg);

  function update() {
    overlay.style.transform = `translateX(${wrap.scrollLeft}px)`;
  }
  update();
  if (overlay._scrollHandler) wrap.removeEventListener('scroll', overlay._scrollHandler);
  overlay._scrollHandler = update;
  wrap.addEventListener('scroll', update);
}

function isMoodRecord(r) {
  return r.type !== 'medication';
}
export function extractDoses(records) {
  const doses = [];
  records.forEach(r => {
    (r.doses || []).forEach(d => {
      doses.push({ ...d, timestamp: r.timestamp, note: r.note });
    });
  });
  return doses;
}

function generateHistoricalDoses(maxTime) {
  const history = store.data.medHistory || [];
  if (history.length === 0) return [];

  const actualByMed = {};
  store.data.records.forEach(r => {
    (r.doses || []).forEach(d => {
      const key = d.medicationId || d.name;
      if (!actualByMed[key]) actualByMed[key] = [];
      actualByMed[key].push({ ...d, timestamp: r.timestamp });
    });
  });

  const historyByMed = {};
  history.forEach(h => {
    const key = h.medicationId || h.name;
    if (!historyByMed[key]) historyByMed[key] = [];
    historyByMed[key].push(h);
  });

  const capTime = maxTime || (Date.now() + MAX_EFFECT_FUTURE_MS);
  const virtualDoses = [];

  Object.values(historyByMed).forEach(entries => {
    const sorted = entries.sort((a, b) => a.timestamp - b.timestamp);
    const medKey = sorted[0].medicationId || sorted[0].name;
    const actuals = actualByMed[medKey] || [];
    const firstActualTs = actuals.length ? Math.min(...actuals.map(d => d.timestamp)) : Infinity;

    sorted.forEach((entry, idx) => {
      const nextEntry = sorted[idx + 1];
      const endTime = Math.min(
        nextEntry ? nextEntry.timestamp : Infinity,
        firstActualTs,
        capTime
      );
      // 用药历史中的 amount 表示“每日总剂量”，按时间表次数均分到各次服药；
      // 无时间表时视为每天一次，避免每日剂量被静默忽略。
      const schedule = Array.isArray(entry.schedule) ? entry.schedule : [];
      const dailyAmount = Number(entry.amount) || 0;
      if (dailyAmount <= 0) return;
      const times = schedule.length
        ? schedule
        : [String(new Date(entry.timestamp).getHours()).padStart(2, '0') + ':' + String(new Date(entry.timestamp).getMinutes()).padStart(2, '0')];
      const perDoseAmount = dailyAmount / times.length;

      const startDay = new Date(entry.timestamp);
      startDay.setHours(0, 0, 0, 0);
      for (let dayTs = startDay.getTime(); dayTs < endTime; dayTs += DAY_MS) {
        times.forEach(time => {
          const [h, min] = String(time).split(':').map(Number);
          if (Number.isNaN(h) || Number.isNaN(min)) return;
          const doseTs = dayTs + h * HOUR_MS + min * 60 * 1000;
          if (doseTs < entry.timestamp || doseTs >= endTime) return;
          virtualDoses.push({
            ...entry,
            timestamp: doseTs,
            amount: perDoseAmount,
            historical: true
          });
        });
      }
    });
  });

  return virtualDoses;
}

export function getEffectiveDoses(records, options = {}) {
  const actual = extractDoses(records);
  const historical = generateHistoricalDoses(options.maxTime);
  return [...actual, ...historical, ...(options.projectedDoses || [])];
}

function pkEffect(dtHours, onsetHours, peakHours, halfLifeHours) {
  if (dtHours < 0 || dtHours < onsetHours) return 0;
  if (dtHours <= peakHours) {
    const denom = Math.max(0.1, peakHours - onsetHours);
    return (dtHours - onsetHours) / denom;
  }
  return Math.exp(-(dtHours - peakHours) * Math.LN2 / halfLifeHours);
}

function doseMass(dose) {
  return (dose.amount || 0) * (dose.dosePerTablet || 1);
}

function effectAt(dtHours, dose, variant = 'upper', pk) {
  const shape = pk || dose;
  if (variant === 'upper') {
    return doseMass(dose) * pkEffect(dtHours, shape.onsetMinHours, shape.peakMinHours, shape.halfLifeMaxHours);
  }
  return doseMass(dose) * pkEffect(dtHours, shape.onsetMaxHours, shape.peakMaxHours, shape.halfLifeMinHours);
}

export function effectEndTime(dose, threshold = 0.01) {
  const timestamp = dose.timestamp;
  const mass = doseMass(dose);
  const med = (dose.medicationId ? store.data.meds.find(m => m.id === dose.medicationId) : null)
    || (dose.name ? store.data.meds.find(m => m.name === dose.name) : null);
  const shape = med ? medPkFor({ medicationId: med.id, name: med.name }) : dose;
  const peakHours = shape.peakMaxHours ?? shape.peakHours ?? 0;
  const halfLifeHours = shape.halfLifeMaxHours ?? shape.halfLifeHours ?? 0.1;
  if (!mass || mass <= threshold || !halfLifeHours || halfLifeHours <= 0) {
    return timestamp + Math.max(0, peakHours) * HOUR_MS;
  }
  const decayEndHours = peakHours + halfLifeHours * Math.log(mass / threshold) / Math.LN2;
  return timestamp + decayEndHours * HOUR_MS;
}

// 在相邻采样点之间线性插值，返回 upper 恰好达到 threshold 的截断点
function thresholdCrossingPoint(p0, p1, threshold) {
  const u0 = p0.upper;
  const u1 = p1.upper;
  if (u0 === u1) return null;
  const f = (threshold - u0) / (u1 - u0);
  if (f <= 0 || f >= 1) return null;
  return {
    t: p0.t + f * (p1.t - p0.t),
    upper: threshold,
    lower: p0.lower + f * (p1.lower - p0.lower)
  };
}

// 截取采样数据中 upper >= threshold 的可见区段，并在两端插值补齐截断点；不可见时返回 null
function truncateSeriesData(data, threshold) {
  const firstIdx = data.findIndex(p => p.upper >= threshold);
  if (firstIdx === -1) return null;
  let lastIdx = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].upper >= threshold) { lastIdx = i; break; }
  }
  const visible = data.slice(firstIdx, lastIdx + 1);
  if (firstIdx > 0) {
    const c = thresholdCrossingPoint(data[firstIdx - 1], data[firstIdx], threshold);
    if (c) visible.unshift(c);
  }
  if (lastIdx < data.length - 1) {
    const c = thresholdCrossingPoint(data[lastIdx], data[lastIdx + 1], threshold);
    if (c) visible.push(c);
  }
  return visible;
}

function groupDosesByMed(doses) {
  const groups = {};
  doses.forEach(d => {
    const key = d.medicationId || d.name;
    if (!groups[key]) {
      groups[key] = {
        medicationId: d.medicationId,
        name: d.name,
        unit: d.unit,
        doseMassUnit: d.doseMassUnit || 'mg',
        doses: []
      };
    }
    groups[key].doses.push(d);
  });
  return Object.values(groups);
}

function medColor(index, medId) {
  // 优先使用药品自身的标记颜色，未设置时回退到默认调色板（按顺序循环）
  if (medId) {
    const med = store.data.meds.find(m => m.id === medId);
    if (med && med.color) return med.color;
  }
  return DEFAULT_MED_COLORS[index % DEFAULT_MED_COLORS.length];
}

// 读取治疗窗（血药浓度范围）：兼容内置 DB 的 therapeuticRange 数组与已保存药品的扁平字段。
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

// 依据服药记录组匹配对应药品的治疗窗：优先按 id，其次按名称，最后回退到剂量对象自带的字段。
function therapeuticWindowFor(group) {
  const byId = group.medicationId ? store.data.meds.find(m => m.id === group.medicationId) : null;
  const med = byId || (group.name ? store.data.meds.find(m => m.name === group.name) : null);
  const tw = readTherapeuticWindow(med);
  if (tw) return tw;
  const dose = (group.doses || []).find(d => d.therapeuticMax != null || d.therapeuticMin != null || d.therapeuticRange);
  return readTherapeuticWindow(dose);
}

// 真实血药浓度换算：C(t) = F × 剂量质量(mg) / Vd(L) × pkShape(t)。
// mg/L 与 µg/mL 数值相等；ng/mL 需 ×1000；mmol/L 需再乘 activeRatio / molarMass。
const MGL_PER_UNIT = { 'mg/L': 1, 'µg/mL': 1, 'ng/mL': 1000 };

// 用户体重（kg），用于把 Vd(L/kg) 换算成个体 Vd(L)；默认 70 kg。
function bodyWeightKg() {
  const w = Number(getTheme().bodyWeightKg);
  return Number.isFinite(w) && w > 0 ? w : 70;
}

function readConcentrationParams(med) {
  if (!med) return null;
  const vdPerKg = Number(med.vdPerKg);
  const f = Number(med.bioavailability);
  if (!Number.isFinite(vdPerKg) || vdPerKg <= 0) return null;
  if (!Number.isFinite(f) || f <= 0 || f > 1) return null;
  const vd = vdPerKg * bodyWeightKg();
  const unit = med.therapeuticUnit || med.concentrationUnit || 'mg/L';
  const molarMass = Number(med.molarMass);
  if (unit === 'mmol/L' && (!Number.isFinite(molarMass) || molarMass <= 0)) return null;
  return { vd, f, unit, molarMass, activeRatio: Number(med.activeRatio) };
}

function concentrationParamsFor(group) {
  const byId = group.medicationId ? store.data.meds.find(m => m.id === group.medicationId) : null;
  const med = byId || (group.name ? store.data.meds.find(m => m.name === group.name) : null);
  const cp = readConcentrationParams(med);
  if (cp) return cp;
  const dose = (group.doses || []).find(d => d.vdPerKg != null || d.bioavailability != null);
  return readConcentrationParams(dose);
}

// 该药当前配置的 PK 形状参数（起效/达峰/半衰期）。
// 统一取当前药品配置，而不是记录创建时的快照，保证实际记录、用药历史与未来预测使用同一套计算逻辑。
function medPkFor(group) {
  const byId = group.medicationId ? store.data.meds.find(m => m.id === group.medicationId) : null;
  const med = byId || (group.name ? store.data.meds.find(m => m.name === group.name) : null);
  if (!med) return null;
  return {
    onsetMinHours: med.onsetMinHours ?? med.onsetHours ?? 1,
    onsetMaxHours: med.onsetMaxHours ?? med.onsetHours ?? 1,
    peakMinHours: med.peakMinHours ?? med.peakHours ?? 2,
    peakMaxHours: med.peakMaxHours ?? med.peakHours ?? 2,
    halfLifeMinHours: med.halfLifeMinHours ?? med.halfLifeHours ?? 12,
    halfLifeMaxHours: med.halfLifeMaxHours ?? med.halfLifeHours ?? 12
  };
}

// 单剂血药峰浓度，单位由 cp.unit 决定；缺少换算所需的 molarMass 等时返回 null。
function concentrationCmax(dose, cp) {
  const cMgL = cp.f * doseMass(dose) / cp.vd;
  if (cp.unit === 'mmol/L') {
    if (!Number.isFinite(cp.molarMass) || cp.molarMass <= 0) return null;
    const ratio = Number.isFinite(cp.activeRatio) && cp.activeRatio > 0 ? cp.activeRatio : 1;
    return cMgL * ratio / cp.molarMass;
  }
  return cMgL * (MGL_PER_UNIT[cp.unit] ?? 1);
}

function concentrationAt(dtHours, dose, variant, cp, pk) {
  const peak = concentrationCmax(dose, cp);
  if (peak === null) return null;
  const shape = pk || dose;
  if (variant === 'upper') {
    return peak * pkEffect(dtHours, shape.onsetMinHours, shape.peakMinHours, shape.halfLifeMaxHours);
  }
  return peak * pkEffect(dtHours, shape.onsetMaxHours, shape.peakMaxHours, shape.halfLifeMinHours);
}

// 某药本次曲线使用的“值函数”：有 Vd/F 时返回真实血药浓度，否则回退到剂量质量（估算药效）。
// PK 形状参数统一取自当前药品配置，使实际记录与预测使用同一套参数。
function groupValueFn(group) {
  const cp = concentrationParamsFor(group);
  const pk = medPkFor(group);
  if (cp) {
    return { at: (dt, d, v) => concentrationAt(dt, d, v, cp, pk), unit: cp.unit, concentration: true };
  }
  return { at: (dt, d, v) => effectAt(dt, d, v, pk), unit: null, concentration: false };
}

// 绘制药物治疗窗上下限两条横向实心直线：仅当该药具备 Vd/F（纵轴为真实浓度）时绘制，
// 上下限直接按真实浓度值定位，线旁标注浓度数值。
// 传入 labelOut 数组时，浓度标注文本不再画进可滚动内容区（需滑到最右端才能看见），
// 而是收集起来由固定在视口右侧的浮层渲染，保证始终可见。
function drawTherapeuticWindow(container, group, yFor, xMin, xMax, color, labelOut) {
  const cp = concentrationParamsFor(group);
  const tw = therapeuticWindowFor(group);
  if (!cp || !tw || tw.min >= tw.max) return;
  if (tw.unit && cp.unit !== tw.unit) return;
  const unit = tw.unit || cp.unit;
  const fmt = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  const drawLine = (value, text) => {
    const y = yFor(value);
    container.appendChild(createSVGElement('line', {
      x1: xMin, y1: y, x2: xMax, y2: y,
      stroke: color, 'stroke-width': 2, 'stroke-opacity': 0.85
    }));
    if (labelOut) {
      labelOut.push({ y, text, color });
      return;
    }
    const label = createSVGElement('text', {
      x: xMax - 4, y: y - 4, 'text-anchor': 'end', fill: color, 'font-size': '10'
    });
    label.textContent = text;
    container.appendChild(label);
  };
  drawLine(tw.max, `${t('chart.therapeuticUpper')} ${fmt(tw.max)} ${unit}`);
  drawLine(tw.min, `${t('chart.therapeuticLower')} ${fmt(tw.min)} ${unit}`);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
// ===================== 多图表同步 =====================
// 拆分后的多张图表共享同一时间窗口与像素密度（宽度一致），勾选“同步滚动”后：
// - 拖动任一图表的滚动条，其余图表同步滚动；
// - 手指/鼠标停留在某张图表上时，其余图表在同一时刻显示竖线（及各自数值对应的横线）与提示。
let scrollSyncEnabled = false;
const syncListeners = new Set();
const scrollWraps = new Set();
let applyingScrollSync = false;

export function setChartSyncEnabled(enabled) {
  scrollSyncEnabled = enabled;
}

export function registerChartWrap(wrap) {
  if (!wrap || scrollWraps.has(wrap)) return;
  scrollWraps.add(wrap);
  wrap.addEventListener('scroll', () => {
    if (!scrollSyncEnabled || applyingScrollSync) return;
    applyingScrollSync = true;
    scrollWraps.forEach(w => {
      if (w !== wrap) w.scrollLeft = wrap.scrollLeft;
    });
    applyingScrollSync = false;
  });
}

function emitCrosshair(payload) {
  syncListeners.forEach(fn => {
    try { fn(payload); } catch {}
  });
}

function subscribeCrosshair(cb) {
  syncListeners.add(cb);
  return () => syncListeners.delete(cb);
}

// 依据当前页全部数据计算所有图表共享的时间窗口（含药效衰减延伸），
// 保证各图表宽度一致，滚动同步才能按 scrollLeft 直接对齐。
export function computeChartDisplayRange(records, sleeps, events, doses = [], options = {}) {
  const { displayRange } = options;
  const padMs = PAD_HOURS * HOUR_MS;
  const padStart = !(displayRange && displayRange.padStart === false);
  const padEnd = !(displayRange && displayRange.padEnd === false);

  let dataMaxTime;
  let displayMinTime;
  let displayMaxTime;
  if (displayRange) {
    dataMaxTime = displayRange.max;
    displayMinTime = displayRange.min - (padStart ? padMs : 0);
    displayMaxTime = displayRange.max + (padEnd ? padMs : 0);
  } else {
    const allTimestamps = records.map(r => r.timestamp)
      .concat(sleeps.flatMap(s => [s.startTime, s.endTime, ...(s.bedTime ? [s.bedTime] : []), ...(s.getOutOfBedTime ? [s.getOutOfBedTime] : [])]))
      .concat(events.map(e => e.timestamp))
      .concat(doses.map(d => d.timestamp));
    dataMaxTime = allTimestamps.length ? Math.max(...allTimestamps) : Date.now();
    const dataMinTime = allTimestamps.length ? Math.min(...allTimestamps) : Date.now() - DAY_MS;
    displayMinTime = dataMinTime - padMs;
    displayMaxTime = dataMaxTime + padMs;
  }

  if (doses.length) {
    const maxEffectEnd = Math.max(...doses.map(d => effectEndTime(d, EFFECT_VISIBLE_THRESHOLD)));
    displayMaxTime = Math.max(displayMaxTime, Math.min(maxEffectEnd, dataMaxTime + (padEnd ? MAX_EFFECT_FUTURE_MS : 0)));
  }

  if (!displayRange) {
    const clamped = clampDisplayRange(displayMinTime, displayMaxTime, MAX_MOOD_RANGE_MS);
    displayMinTime = clamped.displayMinTime;
    displayMaxTime = clamped.displayMaxTime;
  }

  return { displayMinTime, displayMaxTime };
}

// 创建图表基础几何（宽度/高度/坐标映射），并清理旧内容与同步监听
function chartBase(wrap, container, displayMinTime, displayMaxTime, pxPerHour = PX_PER_HOUR) {
  if (container._syncOff) {
    container._syncOff();
    container._syncOff = null;
  }
  container.innerHTML = '';
  clearYAxisOverlays(wrap);
  const rect = wrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrap);
  const padTop = parseFloat(wrapStyle.paddingTop) || 0;
  const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
  const padLeft = parseFloat(wrapStyle.paddingLeft) || 0;
  const padRight = parseFloat(wrapStyle.paddingRight) || 0;
  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;
  const absoluteChartW = displaySpanHours * pxPerHour;
  const minChartW = Math.max(0, rect.width - 40 - PADDING.left - PADDING.right);
  const chartW = Math.max(absoluteChartW, minChartW);
  const width = PADDING.left + chartW + PADDING.right;
  container.setAttribute('width', width);
  const height = wrap.clientHeight - padTop - padBottom;
  const chartH = height - PADDING.top - PADDING.bottom;
  container.setAttribute('height', height);
  container.setAttribute('viewBox', `0 0 ${width} ${height}`);
  container.removeAttribute('preserveAspectRatio');
  return {
    width, height, chartW, chartH, padLeft, padRight, padTop, padBottom,
    displaySpan, displaySpanHours,
    xFor: ts => PADDING.left + ((ts - displayMinTime) / HOUR_MS) * pxPerHour
  };
}

function chartColors(theme) {
  return {
    positive: theme.positiveColor,
    negative: theme.negativeColor,
    neutral: theme.neutralColor,
    accent: theme.accentColor,
    bg: theme.backgroundColor,
    textMuted: cssVar('--theme-surface-text-muted') || theme.textMutedColor
  };
}

// 时间轴（含网格竖线），各图表共用，保证刻度一致
function renderTimeAxis(container, base, colors, theme, displayMinTime, displayMaxTime, pxPerHour) {
  const timeAxisGroup = createSVGElement('g', { class: 'time-axis' });
  const timeStepHours = getTimeStepHours(base.displaySpanHours, pxPerHour);
  const refDate = new Date(displayMinTime);
  refDate.setHours(0, 0, 0, 0);
  const refTime = refDate.getTime();
  const hoursSinceRef = (displayMinTime - refTime) / HOUR_MS;
  const startHours = Math.ceil(hoursSinceRef / timeStepHours) * timeStepHours;
  const startTs = refTime + startHours * HOUR_MS;
  const endHours = Math.floor((displayMaxTime - refTime) / HOUR_MS / timeStepHours) * timeStepHours;
  const endTs = refTime + endHours * HOUR_MS;
  const yBottom = base.height - PADDING.bottom;
  for (let ts = startTs; ts <= endTs; ts += timeStepHours * HOUR_MS) {
    const x = base.xFor(ts);
    const isMidnight = new Date(ts).getHours() === 0;
    const gridLine = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: yBottom,
      stroke: isMidnight ? `rgba(${hexToRgb(colors.accent)}, 0.6)` : `rgba(${hexToRgb(theme.neutralColor)}, 0.5)`,
      'stroke-width': isMidnight ? 1.5 : 1,
      'stroke-dasharray': isMidnight ? '2 6' : '3 3'
    });
    timeAxisGroup.appendChild(gridLine);
    const label = createSVGElement('text', {
      x, y: yBottom + 16, 'text-anchor': 'middle',
      fill: isMidnight ? colors.accent : colors.textMuted, 'font-size': '10'
    });
    label.textContent = formatAxisTime(ts, base.displaySpanHours, timeStepHours);
    timeAxisGroup.appendChild(label);
  }
  container.appendChild(timeAxisGroup);
}

// 当前时间线
function renderNowLine(container, base, colors, displayMinTime, displayMaxTime) {
  const now = Date.now();
  if (now < displayMinTime || now > displayMaxTime) return;
  const x = base.xFor(now);
  const nowGroup = createSVGElement('g', { class: 'current-time-line' });
  nowGroup.appendChild(createSVGElement('line', {
    x1: x, y1: PADDING.top, x2: x, y2: base.height - PADDING.bottom,
    stroke: `rgba(${hexToRgb(colors.textMuted)}, 0.6)`,
    'stroke-width': 1.5,
    'stroke-dasharray': '5 3'
  }));
  const nowLabel = createSVGElement('text', {
    x, y: PADDING.top - 8, 'text-anchor': 'middle',
    fill: colors.textMuted, 'font-size': '10'
  });
  nowLabel.textContent = t('chart.now');
  nowGroup.appendChild(nowLabel);
  container.appendChild(nowGroup);
}

// 十字线组（竖线 + 横线）
function createCrosshair(container, colors, base) {
  const group = createSVGElement('g', { class: 'crosshair', display: 'none' });
  const stroke = `rgba(${hexToRgb(colors.textMuted)}, 0.5)`;
  const vLine = createSVGElement('line', {
    x1: 0, y1: PADDING.top, x2: 0, y2: base.height - PADDING.bottom,
    stroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  const hLine = createSVGElement('line', {
    x1: PADDING.left, y1: 0, x2: base.width - PADDING.right, y2: 0,
    stroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  group.appendChild(vLine);
  group.appendChild(hLine);
  container.appendChild(group);
  return { group, vLine, hLine };
}

function showChartEmpty(container, colors, msg) {
  const empty = createSVGElement('text', {
    x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
  });
  empty.textContent = msg;
  container.appendChild(empty);
}

// 将 tooltip 固定定位到图表可视区附近（visibleX/Y 为 wrap 内可见偏移）
function positionTooltip(wrap, tooltip, visibleX, visibleY) {
  const wrapRect = wrap.getBoundingClientRect();
  const tRect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const vx = wrapRect.left + visibleX;
  const vy = wrapRect.top + visibleY;
  let left = vx + 16;
  if (left + tRect.width + 12 > vw) left = vx - tRect.width - 16;
  if (left < 8) left = 8;
  let top = vy - tRect.height - 12;
  if (top < 8) top = vy + 12;
  if (top + tRect.height + 8 > vh) top = vh - tRect.height - 8;
  if (top < 8) top = 8;
  tooltip.style.position = 'fixed';
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// 绑定鼠标/触摸交互：本地显示十字线并广播给其他图表；
// show(ts) 返回吸附后的时间戳，供广播使用
function bindChartPointer({ container, wrap, cross, base, displayMinTime, pxPerHour, show, hide }) {
  function handle(xLogical) {
    if (xLogical < PADDING.left || xLogical > base.width - PADDING.right) {
      hide();
      emitCrosshair({ type: 'hide', source: cross });
      return;
    }
    const ts = displayMinTime + (xLogical - PADDING.left) * HOUR_MS / pxPerHour;
    const snapped = show(ts) || ts;
    emitCrosshair({ type: 'crosshair', source: cross, ts: snapped });
  }

  container.addEventListener('mousemove', e => {
    handle(clientXToChartX(container, e.clientX));
  });
  container.addEventListener('mouseleave', () => {
    hide();
    emitCrosshair({ type: 'hide', source: cross });
  });

  function updateTouch(e) {
    const touch = e.touches[0];
    if (!touch) return;
    handle(clientXToChartX(container, touch.clientX));
  }
  container.addEventListener('touchstart', updateTouch, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!isScrollLocked()) return;
    if (e.cancelable) e.preventDefault();
    updateTouch(e);
  }, { passive: false });
  const endTouch = () => {
    hide();
    emitCrosshair({ type: 'hide', source: cross });
  };
  container.addEventListener('touchend', endTouch, { passive: true });
  container.addEventListener('touchcancel', endTouch, { passive: true });
}

// 接收其他图表的十字线同步
function subscribeCrosshairSync(container, cross, show, hide) {
  container._syncOff = subscribeCrosshair(payload => {
    if (payload.source === cross) return;
    if (payload.type === 'crosshair') {
      show(payload.ts);
    } else {
      hide();
    }
  });
}
// ===================== 情绪图 =====================
export function renderMoodChart(records, container, tooltip, legendContainer, options = {}) {
  const { pxPerHour = PX_PER_HOUR, displayMinTime, displayMaxTime, boundaryRecords = [] } = options;
  const theme = getTheme();
  const colors = chartColors(theme);
  const useCurve = theme.curveLine !== 'line';
  const connectMoodDots = theme.connectMoodDots !== false;
  const uid = 'mood';

  const wrap = container.parentElement;
  const base = chartBase(wrap, container, displayMinTime, displayMaxTime, pxPerHour);
  const defs = createSVGElement('defs');
  container.appendChild(defs);
  if (legendContainer) legendContainer.innerHTML = '';

  records = records.filter(isMoodRecord)
    .filter(r => r.timestamp >= displayMinTime && r.timestamp <= displayMaxTime);

  if (records.length === 0) {
    showChartEmpty(container, colors, t('chart.empty'));
    return;
  }

  const yFor = v => PADDING.top + ((10 - v) / 20) * base.chartH;
  const yTop = yFor(10);
  const yBottom = yFor(-10);

  const mainGradient = createSVGElement('linearGradient', { id: `grad-main-${uid}`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  mainGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
  mainGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': colors.neutral }));
  mainGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
  defs.appendChild(mainGradient);

  const posGradient = createSVGElement('linearGradient', { id: `grad-pos-${uid}`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  posGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
  posGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.05)` }));
  defs.appendChild(posGradient);

  const negGradient = createSVGElement('linearGradient', { id: `grad-neg-${uid}`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  negGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.05)` }));
  negGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
  defs.appendChild(negGradient);

  const mixedGradient = createSVGElement('linearGradient', { id: `grad-mixed-${uid}`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  mixedGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.45)` }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': `rgba(${hexToRgb(colors.neutral)}, 0.15)` }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.45)` }));
  defs.appendChild(mixedGradient);

  // 网格（情绪 Y 轴）
  const gridGroup = createSVGElement('g', { class: 'grid' });
  const yLabels = [];
  for (let v = -10; v <= 10; v += 2) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: base.width - PADDING.right, y2: y,
      stroke: v === 0 ? colors.neutral : theme.neutralColor,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    yLabels.push({ value: v > 0 ? `+${v}` : String(v), y });
  }
  container.appendChild(gridGroup);
  renderYAxisOverlay(wrap, 'left', yLabels, colors.textMuted, base.height);

  renderTimeAxis(container, base, colors, theme, displayMinTime, displayMaxTime, pxPerHour);
  renderNowLine(container, base, colors, displayMinTime, displayMaxTime);

  // 情绪曲线与面积（含相邻页边界记录，保证跨页斜率连续）
  if (connectMoodDots) {
    const curveRecords = [...records, ...boundaryRecords].sort((a, b) => a.timestamp - b.timestamp);
    const chartClipId = `chart-area-clip-${uid}`;
    const chartClip = createSVGElement('clipPath', { id: chartClipId });
    chartClip.appendChild(createSVGElement('rect', { x: PADDING.left, y: PADDING.top, width: base.chartW, height: base.chartH }));
    defs.appendChild(chartClip);

    function curveSegment(x1, y1, x2, y2) {
      if (!useCurve) return ` L ${x2} ${y2}`;
      const cp1x = x1 + (x2 - x1) * 0.35;
      const cp2x = x2 - (x2 - x1) * 0.35;
      return ` C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
    }
    function makeCurveD(items, getValue) {
      if (items.length === 0) return '';
      let d = `M ${base.xFor(items[0].timestamp)} ${yFor(getValue(items[0]))}`;
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1], curr = items[i];
        d += curveSegment(base.xFor(prev.timestamp), yFor(getValue(prev)), base.xFor(curr.timestamp), yFor(getValue(curr)));
      }
      return d;
    }
    function makeAreaUnderCurveD(items, getValue, baselineY) {
      if (items.length === 0) return '';
      let d = `M ${base.xFor(items[0].timestamp)} ${baselineY}`;
      d += ` L ${base.xFor(items[0].timestamp)} ${yFor(getValue(items[0]))}`;
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1], curr = items[i];
        d += curveSegment(base.xFor(prev.timestamp), yFor(getValue(prev)), base.xFor(curr.timestamp), yFor(getValue(curr)));
      }
      d += ` L ${base.xFor(items[items.length - 1].timestamp)} ${baselineY} Z`;
      return d;
    }

    const hasMixed = curveRecords.some(r => r.mixed);
    if (hasMixed) {
      const mixedRecords = curveRecords.map(r => ({
        ...r,
        upper: r.mixed ? Math.max(r.value, r.mixedValue) : r.value,
        lower: r.mixed ? Math.min(r.value, r.mixedValue) : r.value
      }));
      let areaD = `M ${base.xFor(mixedRecords[0].timestamp)} ${yFor(mixedRecords[0].upper)}`;
      for (let i = 1; i < mixedRecords.length; i++) {
        const prev = mixedRecords[i - 1], curr = mixedRecords[i];
        areaD += curveSegment(base.xFor(prev.timestamp), yFor(prev.upper), base.xFor(curr.timestamp), yFor(curr.upper));
      }
      for (let i = mixedRecords.length - 1; i >= 0; i--) {
        const curr = mixedRecords[i];
        const x2 = base.xFor(curr.timestamp), y2l = yFor(curr.lower);
        if (i === mixedRecords.length - 1) {
          areaD += ` L ${x2} ${y2l}`;
        } else {
          const next = mixedRecords[i + 1];
          areaD += curveSegment(base.xFor(next.timestamp), yFor(next.lower), x2, y2l);
        }
      }
      areaD += ' Z';
      container.appendChild(createSVGElement('path', { d: areaD, fill: `url(#grad-mixed-${uid})`, stroke: 'none', 'clip-path': `url(#${chartClipId})` }));
      container.appendChild(createSVGElement('path', {
        d: makeCurveD(mixedRecords, r => r.upper),
        fill: 'none', stroke: colors.positive, 'stroke-width': 2.5,
        'clip-path': `url(#${chartClipId})`
      }));
      container.appendChild(createSVGElement('path', {
        d: makeCurveD(mixedRecords, r => r.lower),
        fill: 'none', stroke: colors.negative, 'stroke-width': 2.5,
        'clip-path': `url(#${chartClipId})`
      }));
    } else {
      container.appendChild(createSVGElement('path', {
        d: makeCurveD(curveRecords, r => r.value),
        fill: 'none', stroke: `url(#grad-main-${uid})`, 'stroke-width': 3,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'clip-path': `url(#${chartClipId})`
      }));
      const zeroY = yFor(0);
      const areaD = makeAreaUnderCurveD(curveRecords, r => r.value, zeroY);
      if (areaD) {
        container.appendChild(createSVGElement('path', { d: areaD, fill: `url(#grad-main-${uid})`, stroke: 'none', opacity: '0.12', 'clip-path': `url(#${chartClipId})` }));
      }
    }
  }

  // 情绪数据点
  records.forEach(r => {
    const x = base.xFor(r.timestamp);
    const values = r.mixed ? [r.value, r.mixedValue] : [r.value];
    values.forEach(v => {
      const y = yFor(v);
      const circle = createSVGElement('circle', {
        cx: x, cy: y, r: 5,
        fill: colorForValue(v, theme, 1),
        stroke: colors.bg,
        'stroke-width': 2,
        class: 'chart-point'
      });
      circle.style.transition = 'r 0.2s ease';
      container.appendChild(circle);
    });
  });

  // 图例
  if (legendContainer) {
    const moodLegend = document.createElement('span');
    moodLegend.className = 'legend-item';
    moodLegend.innerHTML = `<i class="dot" style="background:${colors.positive}"></i><span data-i18n="chart.legend.manic">${t('chart.legend.manic')}</span>`;
    legendContainer.appendChild(moodLegend);
    const moodLegend2 = document.createElement('span');
    moodLegend2.className = 'legend-item';
    moodLegend2.innerHTML = `<i class="dot" style="background:${colors.negative}"></i><span data-i18n="chart.legend.depressed">${t('chart.legend.depressed')}</span>`;
    legendContainer.appendChild(moodLegend2);
  }

  // 十字线与交互
  const cross = createCrosshair(container, colors, base);

  let activePoint = null;

  function hideMoodTooltip() {
    cross.group.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
    if (activePoint) {
      activePoint.setAttribute('r', 5);
      activePoint = null;
    }
  }

  // 吸附到最近的情绪数据点（24px 阈值内），返回吸附后的时间戳供跨图表同步
  function showMoodTooltip(ts) {
    let snapped = ts;
    let nearest = null;
    let minDiff = Infinity;
    records.forEach(r => {
      const diff = Math.abs(r.timestamp - ts);
      if (diff < minDiff) { minDiff = diff; nearest = r; }
    });

    cross.group.setAttribute('display', 'block');
    if (nearest) {
      const pxDist = Math.abs(base.xFor(nearest.timestamp) - base.xFor(ts));
      if (pxDist <= 24) snapped = nearest.timestamp;
    }
    const x = base.xFor(snapped);
    cross.vLine.setAttribute('x1', x);
    cross.vLine.setAttribute('x2', x);

    if (!nearest || Math.abs(base.xFor(nearest.timestamp) - base.xFor(ts)) > 24) {
      tooltip.classList.remove('visible');
      return snapped;
    }
    const displayValue = nearest.mixed
      ? (Math.abs(nearest.value) >= Math.abs(nearest.mixedValue) ? nearest.value : nearest.mixedValue)
      : nearest.value;
    const mixedText = nearest.mixed ? ` / ${nearest.mixedValue > 0 ? '+' : ''}${nearest.mixedValue}` : '';
    const medText = (nearest.doses || []).length
      ? `<div class="med">${nearest.doses.map(d => `${d.name} ${d.amount}${d.unit}`).join('、')}</div>`
      : '';
    let content = `<time>${formatDateTime(snapped)}</time>`;
    content += `<div class="value">${t('chart.tooltip.value')}: ${nearest.value > 0 ? '+' : ''}${nearest.value}${mixedText}</div>${medText}`;
    if (nearest.note) content += `<div class="note">${nearest.note}</div>`;
    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    positionTooltip(wrap, tooltip, base.padLeft + x - wrap.scrollLeft, base.padTop + yFor(displayValue));
    return snapped;
  }

  // 数据点悬停：放大并显示该记录的详情
  const points = Array.from(container.querySelectorAll('.chart-point'));
  let flatIndex = 0;
  records.forEach(r => {
    const values = r.mixed ? [r.value, r.mixedValue] : [r.value];
    values.forEach(() => {
      const pt = points[flatIndex++];
      if (pt) {
        pt.addEventListener('mouseenter', () => {
          activePoint = pt;
          pt.setAttribute('r', 8);
          showMoodTooltip(r.timestamp);
        });
        pt.addEventListener('mouseleave', hideMoodTooltip);
      }
    });
  });

  bindChartPointer({ container, wrap, cross, base, displayMinTime, pxPerHour, show: showMoodTooltip, hide: hideMoodTooltip });
  subscribeCrosshairSync(container, cross, showMoodTooltip, hideMoodTooltip);
}
// ===================== 药效图 =====================
export function renderEffectChart(doses, container, tooltip, legendContainer, options = {}) {
  const { pxPerHour = PX_PER_HOUR, displayMinTime, displayMaxTime, markerDoses = null, depletionData = [] } = options;
  const theme = getTheme();
  const colors = chartColors(theme);

  const wrap = container.parentElement;
  const base = chartBase(wrap, container, displayMinTime, displayMaxTime, pxPerHour);
  const defs = createSVGElement('defs');
  container.appendChild(defs);
  if (legendContainer) legendContainer.innerHTML = '';

  doses = doses.filter(d => d.timestamp <= displayMaxTime);
  if (doses.length === 0) {
    showChartEmpty(container, colors, t('chart.effectEmpty'));
    return;
  }

  // 右侧药效比例尺（刻度 + 可交互背景条）
  const sampleHours = Math.max(1, Math.floor(base.displaySpanHours / 200));
  const samplePoints = [];
  for (let h = 0; h <= base.displaySpanHours; h += sampleHours) {
    samplePoints.push(displayMinTime + h * HOUR_MS);
  }
  if (samplePoints[samplePoints.length - 1] < displayMaxTime) {
    samplePoints.push(displayMaxTime);
  }

  // 判断该药在当前视图范围内是否有服药记录（跨视图延续的药效尾巴不占用图例/工具提示空间）
  const hasDoseInView = g => g.doses.some(d => d.timestamp >= displayMinTime && d.timestamp <= displayMaxTime);

  const groups = groupDosesByMed(doses);
  const series = groups.map((g, idx) => {
    const valueFn = groupValueFn(g);
    const tw = valueFn.concentration ? therapeuticWindowFor(g) : null;
    const data = samplePoints.map(ts => {
      let upper = 0;
      let lower = 0;
      g.doses.forEach(d => {
        const dt = (ts - d.timestamp) / HOUR_MS;
        upper += valueFn.at(dt, d, 'upper');
        lower += valueFn.at(dt, d, 'lower');
      });
      return { t: ts, upper, lower };
    });
    let maxUpper = Math.max(0.1, ...data.map(p => p.upper));
    if (tw && tw.max > maxUpper) maxUpper = tw.max;
    const yMax = Math.ceil(maxUpper * 1.1);
    const yEffectFor = v => PADDING.top + ((yMax - v) / yMax) * base.chartH;
    const visible = truncateSeriesData(data, EFFECT_VISIBLE_THRESHOLD);
    return {
      ...g,
      color: medColor(idx, g.medicationId),
      data,
      activeInView: hasDoseInView(g),
      yMax,
      peakUpper: maxUpper,
      concentration: valueFn.concentration,
      valueUnit: valueFn.unit,
      yEffectFor,
      visible
    };
  }).filter(s => s.visible);

  if (series.length === 0) {
    showChartEmpty(container, colors, t('chart.effectEmpty'));
    return;
  }

  // 左侧血药浓度比例尺：只显示等距的小刻度横线；悬停/长按时绘制横向实线并弹出各药浓度
  const axisYTop = PADDING.top;
  const axisYBottom = base.height - PADDING.bottom;
  const axisCenterX = PADDING.left / 2;
  const tickCount = 10;
  const tickHalfLen = 5;
  const effectScaleLabels = [];
  for (let i = 0; i < tickCount; i++) {
    const y = axisYTop + (i / (tickCount - 1)) * (axisYBottom - axisYTop);
    effectScaleLabels.push({
      isTick: true, y,
      x1: axisCenterX - tickHalfLen, x2: axisCenterX + tickHalfLen,
      color: colors.textMuted
    });
  }
  effectScaleLabels.push({
    value: '', y: 0, color: 'transparent', x: axisCenterX,
    isBar: true, barY: axisYTop, barHeight: axisYBottom - axisYTop,
    barWidth: PADDING.left, medIdx: null, barColor: 'transparent', opacity: '1'
  });
  renderYAxisOverlay(wrap, 'left', effectScaleLabels, colors.textMuted, base.height);

  // 收集血药浓度“上限/下限”标注，绘制到固定在视口右侧的浮层（始终可见）
  const therapeuticLabels = [];

  // 绘制药效区间（最高/最低两条曲线）
  series.forEach(s => {
    const visible = s.visible;
    const yEffectFor = s.yEffectFor;

    let bandD = `M ${base.xFor(visible[0].t)} ${yEffectFor(visible[0].upper)}`;
    for (let i = 1; i < visible.length; i++) {
      bandD += ` L ${base.xFor(visible[i].t)} ${yEffectFor(visible[i].upper)}`;
    }
    for (let i = visible.length - 1; i >= 0; i--) {
      bandD += ` L ${base.xFor(visible[i].t)} ${yEffectFor(visible[i].lower)}`;
    }
    bandD += ' Z';
    container.appendChild(createSVGElement('path', {
      d: bandD,
      fill: `rgba(${hexToRgb(s.color)}, 0.15)`,
      stroke: 'none'
    }));

    let upperD = `M ${base.xFor(visible[0].t)} ${yEffectFor(visible[0].upper)}`;
    let lowerD = `M ${base.xFor(visible[0].t)} ${yEffectFor(visible[0].lower)}`;
    for (let i = 1; i < visible.length; i++) {
      upperD += ` L ${base.xFor(visible[i].t)} ${yEffectFor(visible[i].upper)}`;
      lowerD += ` L ${base.xFor(visible[i].t)} ${yEffectFor(visible[i].lower)}`;
    }
    container.appendChild(createSVGElement('path', {
      d: upperD,
      fill: 'none',
      stroke: s.color,
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));
    container.appendChild(createSVGElement('path', {
      d: lowerD,
      fill: 'none',
      stroke: s.color,
      'stroke-width': 1.5,
      'stroke-dasharray': '4 4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));

    drawTherapeuticWindow(container, s, s.yEffectFor, PADDING.left, base.width - PADDING.right, s.color, therapeuticLabels);

    // 当前视图范围内没有再服用的药不显示在图例里
    if (legendContainer && s.activeInView) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.innerHTML = `<i class="dot" style="background:${s.color}"></i><span>${s.name}</span>`;
      legendContainer.appendChild(item);
    }
  });

  // 右侧比例尺悬停/长按：横向实线 + 各药浓度
  const scaleCrosshair = createSVGElement('g', { class: 'scale-crosshair', display: 'none' });
  const scaleHLine = createSVGElement('line', {
    x1: PADDING.left, y1: axisYTop, x2: base.width - PADDING.right, y2: axisYTop,
    stroke: colors.accent, 'stroke-width': 1.5, 'stroke-linecap': 'round'
  });
  scaleCrosshair.appendChild(scaleHLine);
  container.appendChild(scaleCrosshair);

  const effectAxisBars = wrap.querySelectorAll('.y-axis-overlay.left .effect-axis-bar');
  const showScaleTooltip = (bar, clientX, clientY) => {
    if (!series.length) return;
    const overlay = wrap.querySelector('.y-axis-overlay.left');
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();
    // 与 X 轴逻辑一致：除以界面缩放比例，修正设置了界面缩放时指针与识别位置的偏差
    const y = Math.min(Math.max((clientY - overlayRect.top) / getUIScaleRatio(), axisYTop), axisYBottom);
    scaleCrosshair.setAttribute('display', 'block');
    scaleHLine.setAttribute('y1', y);
    scaleHLine.setAttribute('y2', y);
    const rows = series.map(s => {
      const val = s.yMax * (axisYBottom - y) / base.chartH;
      const unit = s.valueUnit || s.doseMassUnit || '';
      return `<div style="color:${s.color}">${s.name}: ${val.toFixed(2)} ${unit}</div>`;
    }).join('');
    tooltip.innerHTML = rows;
    tooltip.classList.add('visible');
    // 以比例尺触摸条的实际视口位置定位 tooltip（置于其右侧），
    // 避免按滚动偏移计算导致 tooltip 被定位到视口外
    const barRect = bar.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    positionTooltip(wrap, tooltip,
      barRect.left - wrapRect.left + barRect.width + 8,
      base.padTop + (y - axisYTop));
  };
  const hideScaleTooltip = () => {
    scaleCrosshair.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
  };
  effectAxisBars.forEach(bar => {
    bar.addEventListener('mouseenter', e => showScaleTooltip(bar, e.clientX, e.clientY));
    bar.addEventListener('mousemove', e => showScaleTooltip(bar, e.clientX, e.clientY));
    bar.addEventListener('mouseleave', hideScaleTooltip);
    bar.addEventListener('touchstart', e => {
      if (isScrollLocked()) {
        const touch = e.touches[0];
        showScaleTooltip(bar, touch.clientX, touch.clientY);
      }
    }, { passive: true });
    bar.addEventListener('touchmove', e => {
      if (isScrollLocked()) {
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        showScaleTooltip(bar, touch.clientX, touch.clientY);
      }
    }, { passive: false });
    bar.addEventListener('touchend', hideScaleTooltip, { passive: true });
    bar.addEventListener('touchcancel', hideScaleTooltip, { passive: true });
  });

  // 血药浓度“上限/下限”标注浮层（固定在视口右侧，始终可见）
  if (therapeuticLabels.length) {
    renderTherapeuticLabelsOverlay(wrap, therapeuticLabels, base.height);
  }

  renderTimeAxis(container, base, colors, theme, displayMinTime, displayMaxTime, pxPerHour);
  renderNowLine(container, base, colors, displayMinTime, displayMaxTime);

  // 药品耗尽点虚线（始终显示）
  const reminderDays = theme.depletionReminderDays || 3;
  if (depletionData.length > 0) {
    const depletionGroup = createSVGElement('g', { class: 'depletion-lines' });
    depletionData.forEach(dep => {
      const lineColor = dep.color || medColor(dep.medIndex);
      const dx = base.xFor(dep.depletionTime);
      if (dx >= PADDING.left && dx <= base.width - PADDING.right) {
        depletionGroup.appendChild(createSVGElement('line', {
          x1: dx, y1: PADDING.top, x2: dx, y2: base.height - PADDING.bottom,
          stroke: lineColor, 'stroke-width': 2, 'stroke-dasharray': '6 4',
          class: 'depletion-line'
        }));
      }
      const warningTime = dep.depletionTime - reminderDays * DAY_MS;
      if (warningTime > displayMinTime) {
        const wx = base.xFor(warningTime);
        if (wx >= PADDING.left && wx <= base.width - PADDING.right) {
          depletionGroup.appendChild(createSVGElement('line', {
            x1: wx, y1: PADDING.top, x2: wx, y2: base.height - PADDING.bottom,
            stroke: lineColor, 'stroke-width': 1.5, 'stroke-dasharray': '3 6',
            opacity: '0.6',
            class: 'depletion-warning-line'
          }));
        }
      }
    });
    container.appendChild(depletionGroup);

    if (legendContainer) {
      const depletionLegend = document.createElement('span');
      depletionLegend.className = 'legend-item';
      depletionLegend.innerHTML = `<i class="dot" style="background:${depletionData[0].color || medColor(0)}; width: 2px; height: 16px; border-radius: 0;"></i><span data-i18n="chart.legend.depletion">${t('chart.legend.depletion')}</span>`;
      legendContainer.appendChild(depletionLegend);
      const warningLegend = document.createElement('span');
      warningLegend.className = 'legend-item';
      warningLegend.innerHTML = `<i class="dot" style="background:${depletionData[0].color || medColor(0)}; width: 2px; height: 16px; border-radius: 0; opacity: 0.6;"></i><span data-i18n="chart.legend.depletionWarning">${t('chart.legend.depletionWarning')}</span>`;
      legendContainer.appendChild(warningLegend);
    }
  }

  // 服药记录点（菱形标记，同一时刻多种药垂直排开）
  const markerDoseList = markerDoses !== null ? markerDoses : doses.filter(d => !d.projected);
  const doseMarkerMap = new Map();
  const doseGroups = groupDosesByMed(markerDoseList);
  doseGroups.forEach((g, idx) => {
    const color = medColor(idx, g.medicationId);
    g.doses.forEach(d => doseMarkerMap.set(d, color));
  });
  const MARKER_STEP = 9;
  const markerStacks = new Map();
  markerDoseList.forEach(d => {
    const dx = base.xFor(d.timestamp);
    if (dx < PADDING.left || dx > base.width - PADDING.right) return;
    const color = doseMarkerMap.get(d) || medColor(0);
    const medKey = d.medicationId || d.name;
    let stack = markerStacks.get(d.timestamp);
    if (!stack) {
      stack = new Map();
      markerStacks.set(d.timestamp, stack);
    }
    let row = stack.get(medKey);
    if (row === undefined) {
      row = stack.size;
      stack.set(medKey, row);
    }
    const markerY = PADDING.top + 10 + row * MARKER_STEP;
    const size = 4;
    const diamond = createSVGElement('polygon', {
      points: `${dx},${markerY - size} ${dx + size},${markerY} ${dx},${markerY + size} ${dx - size},${markerY}`,
      fill: color,
      stroke: colors.bg,
      'stroke-width': 1.5,
      class: 'dose-marker',
      'data-dose-time': d.timestamp
    });
    diamond.style.pointerEvents = 'auto';
    diamond.style.cursor = 'pointer';
    container.appendChild(diamond);
  });

  if (legendContainer && markerDoseList.length > 0) {
    const doseLegend = document.createElement('span');
    doseLegend.className = 'legend-item';
    doseLegend.innerHTML = `<i class="dot" style="background:${colors.textMuted}; transform: rotate(45deg); border-radius: 0;"></i><span data-i18n="chart.legend.dose">${t('chart.legend.dose')}</span>`;
    legendContainer.appendChild(doseLegend);
  }

  // 十字线与交互
  const cross = createCrosshair(container, colors, base);

  function showEffectTooltip(ts) {
    cross.group.setAttribute('display', 'block');
    const x = base.xFor(ts);
    cross.vLine.setAttribute('x1', x);
    cross.vLine.setAttribute('x2', x);
    const rows = series.map(s => {
      const closest = s.data.reduce((best, p) =>
        Math.abs(p.t - ts) < Math.abs(best.t - ts) ? p : best, s.data[0]);
      return `<div style="color:${s.color}">${s.name}: ${closest.lower.toFixed(2)} ~ ${closest.upper.toFixed(2)} ${s.valueUnit || s.doseMassUnit || 'mg'}</div>`;
    }).join('');
    let content = `<time>${formatDateTime(ts)}</time>`;
    content += `<div class="value">${t('chart.effectTooltip')}</div>${rows}`;
    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    positionTooltip(wrap, tooltip, base.padLeft + x - wrap.scrollLeft, base.padTop + PADDING.top);
    return ts;
  }

  function hideEffectTooltip() {
    cross.group.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
  }

  bindChartPointer({ container, wrap, cross, base, displayMinTime, pxPerHour, show: showEffectTooltip, hide: hideEffectTooltip });
  subscribeCrosshairSync(container, cross, showEffectTooltip, hideEffectTooltip);
}
// ===================== 睡眠图 =====================
export function renderSleepChart(sleeps, container, tooltip, legendContainer, options = {}) {
  const { pxPerHour = PX_PER_HOUR, displayMinTime, displayMaxTime } = options;
  const theme = getTheme();
  const colors = chartColors(theme);

  const wrap = container.parentElement;
  const base = chartBase(wrap, container, displayMinTime, displayMaxTime, pxPerHour);
  const defs = createSVGElement('defs');
  container.appendChild(defs);
  if (legendContainer) legendContainer.innerHTML = '';

  sleeps = sleeps.filter(s => {
    const bedStart = s.bedTime || s.startTime;
    const bedEnd = s.getOutOfBedTime || s.endTime;
    return bedEnd >= displayMinTime && bedStart <= displayMaxTime;
  });

  if (sleeps.length === 0) {
    showChartEmpty(container, colors, t('chart.empty'));
    return;
  }

  // 睡眠条水平居中基线
  const sleepBarHeight = 14;
  const sleepY = PADDING.top + (base.chartH - sleepBarHeight) / 2;
  const baseline = createSVGElement('line', {
    x1: PADDING.left, y1: sleepY + sleepBarHeight / 2,
    x2: base.width - PADDING.right, y2: sleepY + sleepBarHeight / 2,
    stroke: `rgba(${hexToRgb(theme.neutralColor)}, 0.5)`, 'stroke-width': 1
  });
  container.appendChild(baseline);

  sleeps.forEach((sleep, sleepIdx) => {
    const xStart = base.xFor(sleep.startTime);
    const xEnd = base.xFor(sleep.endTime);
    const bedStart = Math.min(sleep.bedTime || sleep.startTime, sleep.startTime);
    const bedEnd = Math.max(sleep.getOutOfBedTime || sleep.endTime, sleep.endTime);
    const xBedStart = base.xFor(bedStart);
    const xBedEnd = base.xFor(bedEnd);
    const clipWidth = xBedEnd - xBedStart;
    if (clipWidth <= 0) return;

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

    const clipId = `sleep-bar-clip-${sleepIdx}`;
    const clipPath = createSVGElement('clipPath', { id: clipId });
    clipPath.appendChild(createSVGElement('rect', {
      x: xBedStart, y: sleepY, width: clipWidth, height: sleepBarHeight,
      rx: sleepBarHeight / 2, ry: sleepBarHeight / 2
    }));
    defs.appendChild(clipPath);

    const group = createSVGElement('g', { class: 'sleep-bar-group', 'clip-path': `url(#${clipId})` });
    const overlayGroup = createSVGElement('g', { class: 'sleep-bar-overlay' });

    // 在床上底色（包含入睡前和醒来后仍躺床上的时段）
    group.appendChild(createSVGElement('rect', {
      x: xBedStart, y: sleepY, width: clipWidth, height: sleepBarHeight,
      fill: '#c4b5fd'
    }));

    segments.forEach(seg => {
      const sx = base.xFor(seg.start);
      const sw = base.xFor(seg.end) - sx;
      if (sw <= 0) return;
      group.appendChild(createSVGElement('rect', {
        x: sx, y: sleepY, width: sw, height: sleepBarHeight,
        fill: seg.type === 'asleep' ? '#8b5cf6' : theme.surface2Color
      }));
    });

    interruptions.forEach(i => {
      const ix1 = base.xFor(i.awakeAt);
      const ix2 = base.xFor(i.asleepAt);
      if (ix1 >= xStart && ix1 <= xEnd) {
        group.appendChild(createSVGElement('line', {
          x1: ix1, y1: sleepY - 2, x2: ix1, y2: sleepY + sleepBarHeight + 2,
          stroke: '#ef4444', 'stroke-width': 1.5
        }));
      }
      if (ix2 >= xStart && ix2 <= xEnd) {
        group.appendChild(createSVGElement('line', {
          x1: ix2, y1: sleepY - 2, x2: ix2, y2: sleepY + sleepBarHeight + 2,
          stroke: '#ef4444', 'stroke-width': 1.5
        }));
      }
    });

    container.appendChild(group);

    // 质量标记 Qx（放在 clipPath 外避免被裁剪）
    const centerX = (xStart + xEnd) / 2;
    const qualityLabel = createSVGElement('text', {
      x: centerX, y: sleepY - 6, 'text-anchor': 'middle',
      fill: '#8b5cf6', 'font-size': '11', 'font-weight': '600'
    });
    qualityLabel.textContent = `Q${sleep.quality}`;
    overlayGroup.appendChild(qualityLabel);
    container.appendChild(overlayGroup);
  });

  renderTimeAxis(container, base, colors, theme, displayMinTime, displayMaxTime, pxPerHour);
  renderNowLine(container, base, colors, displayMinTime, displayMaxTime);

  // 图例
  if (legendContainer) {
    const sleepLegend = document.createElement('span');
    sleepLegend.className = 'legend-item';
    sleepLegend.innerHTML = `<i class="dot" style="background:#8b5cf6"></i><span data-i18n="chart.legend.sleep">${t('chart.legend.sleep')}</span>`;
    legendContainer.appendChild(sleepLegend);
    const bedLegend = document.createElement('span');
    bedLegend.className = 'legend-item';
    bedLegend.innerHTML = `<i class="dot" style="background:#c4b5fd"></i><span data-i18n="chart.legend.bed">${t('chart.legend.bed')}</span>`;
    legendContainer.appendChild(bedLegend);
  }

  // 十字线与交互
  const cross = createCrosshair(container, colors, base);

  function showSleepTooltip(ts) {
    cross.group.setAttribute('display', 'block');
    const x = base.xFor(ts);
    cross.vLine.setAttribute('x1', x);
    cross.vLine.setAttribute('x2', x);

    const overlapping = sleeps.filter(s => {
      const bedStart = s.bedTime || s.startTime;
      const bedEnd = s.getOutOfBedTime || s.endTime;
      return ts >= bedStart && ts <= bedEnd;
    });
    if (!overlapping.length) {
      tooltip.classList.remove('visible');
      return ts;
    }

    let content = `<time>${formatDateTime(ts)}</time>`;
    overlapping.forEach(s => {
      let stateText;
      const bedEnd = s.getOutOfBedTime || s.endTime;
      if (s.bedTime && ts >= s.bedTime && ts < s.startTime) {
        stateText = t('records.history.bed');
      } else if (s.getOutOfBedTime && ts > s.endTime && ts <= s.getOutOfBedTime) {
        stateText = t('records.history.bed');
      } else {
        const inInterruption = (s.interruptions || []).some(i => ts >= i.awakeAt && ts <= i.asleepAt);
        stateText = inInterruption ? t('records.history.awake') : t('records.history.asleep');
      }
      const rangeText = s.bedTime || s.getOutOfBedTime
        ? `${formatDateTime(s.bedTime || s.startTime)} ~ ${formatDateTime(s.getOutOfBedTime || s.endTime)}`
        : `${formatDateTime(s.startTime)} ~ ${formatDateTime(s.endTime)}`;
      content += `<div style="color:#8b5cf6">${t('records.history.sleep')}: ${stateText} (${rangeText})</div>`;
      if (s.quality != null) content += `<div class="note">Q${s.quality}</div>`;
    });
    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    positionTooltip(wrap, tooltip, base.padLeft + x - wrap.scrollLeft, base.padTop + PADDING.top);
    return ts;
  }

  function hideSleepTooltip() {
    cross.group.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
  }

  bindChartPointer({ container, wrap, cross, base, displayMinTime, pxPerHour, show: showSleepTooltip, hide: hideSleepTooltip });
  subscribeCrosshairSync(container, cross, showSleepTooltip, hideSleepTooltip);
}
// ===================== 事件图 =====================
export function renderEventsChart(events, container, tooltip, legendContainer, options = {}) {
  const { pxPerHour = PX_PER_HOUR, displayMinTime, displayMaxTime } = options;
  const theme = getTheme();
  const colors = chartColors(theme);

  const wrap = container.parentElement;
  const base = chartBase(wrap, container, displayMinTime, displayMaxTime, pxPerHour);
  const defs = createSVGElement('defs');
  container.appendChild(defs);
  if (legendContainer) legendContainer.innerHTML = '';

  events = events.filter(e => e.timestamp >= displayMinTime && e.timestamp <= displayMaxTime);

  if (events.length === 0) {
    showChartEmpty(container, colors, t('chart.empty'));
    return;
  }

  // 事件竖线 + 顶部圆点（点击交互通过 tooltip 提供详情）
  events.forEach(ev => {
    const ex = base.xFor(ev.timestamp);
    if (ex < PADDING.left || ex > base.width - PADDING.right) return;
    const line = createSVGElement('line', {
      x1: ex, y1: PADDING.top, x2: ex, y2: base.height - PADDING.bottom,
      stroke: ev.color || colors.accent, 'stroke-width': 2, class: 'event-line', 'data-event-id': ev.id
    });
    line.style.pointerEvents = 'none';
    container.appendChild(line);

    const dot = createSVGElement('circle', {
      cx: ex, cy: PADDING.top, r: 4, fill: ev.color || colors.accent, class: 'event-dot', 'data-event-id': ev.id
    });
    dot.style.pointerEvents = 'auto';
    dot.style.cursor = 'pointer';
    container.appendChild(dot);

    // 事件标题（截断避免溢出）
    const title = String(ev.title || '');
    const shortTitle = title.length > 12 ? title.slice(0, 12) + '…' : title;
    const label = createSVGElement('text', {
      x: ex, y: PADDING.top - 8, 'text-anchor': 'middle',
      fill: ev.color || colors.accent, 'font-size': '10',
      class: 'event-title-label'
    });
    label.textContent = shortTitle;
    container.appendChild(label);
  });

  renderTimeAxis(container, base, colors, theme, displayMinTime, displayMaxTime, pxPerHour);
  renderNowLine(container, base, colors, displayMinTime, displayMaxTime);

  // 图例
  if (legendContainer) {
    const eventLegend = document.createElement('span');
    eventLegend.className = 'legend-item';
    eventLegend.innerHTML = `<i class="dot" style="background:${colors.accent}; width: 2px; border-radius: 0;"></i><span data-i18n="chart.legend.event">${t('chart.legend.event')}</span>`;
    legendContainer.appendChild(eventLegend);
  }

  // 十字线与交互
  const cross = createCrosshair(container, colors, base);

  function showEventsTooltip(ts) {
    let snapped = ts;
    let nearest = null;
    let minDist = Infinity;
    events.forEach(ev => {
      const d = Math.abs(ev.timestamp - ts);
      if (d < minDist) { minDist = d; nearest = ev; }
    });

    cross.group.setAttribute('display', 'block');
    if (nearest && Math.abs(base.xFor(nearest.timestamp) - base.xFor(ts)) <= 24) {
      snapped = nearest.timestamp;
    }
    const x = base.xFor(snapped);
    cross.vLine.setAttribute('x1', x);
    cross.vLine.setAttribute('x2', x);

    if (!nearest || Math.abs(base.xFor(nearest.timestamp) - base.xFor(ts)) > 24) {
      tooltip.classList.remove('visible');
      return snapped;
    }
    let content = `<time>${formatDateTime(snapped)}</time>`;
    content += `<div style="color:${nearest.color || colors.accent}; font-weight:600;">${t('chart.tooltip.event')}: ${nearest.title}</div>`;
    if (nearest.showElapsedTime) {
      const diff = Date.now() - nearest.timestamp;
      const suffix = diff >= 0 ? 'past' : 'future';
      const elapsed = formatDuration(Math.abs(diff));
      content += `<div class="note">${t(`chart.tooltip.eventElapsed.${suffix}`, { duration: elapsed })}</div>`;
    }
    if (nearest.note) content += `<div class="note">${nearest.note}</div>`;
    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    positionTooltip(wrap, tooltip, base.padLeft + x - wrap.scrollLeft, base.padTop + PADDING.top);
    return snapped;
  }

  function hideEventsTooltip() {
    cross.group.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
  }

  bindChartPointer({ container, wrap, cross, base, displayMinTime, pxPerHour, show: showEventsTooltip, hide: hideEventsTooltip });
  subscribeCrosshairSync(container, cross, showEventsTooltip, hideEventsTooltip);
}
