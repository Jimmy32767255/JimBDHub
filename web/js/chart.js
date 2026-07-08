import { formatDateTime } from './store.js';
import { t } from './i18n.js';
import { getTheme } from './theme.js';

const PADDING = { top: 30, right: 40, bottom: 40, left: 44 };
const PX_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;
const PAD_HOURS = 6;

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

export function renderChart(records, container, tooltip) {
  const theme = getTheme();
  const colors = {
    positive: theme.positiveColor,
    negative: theme.negativeColor,
    neutral: theme.neutralColor,
    accent: theme.accentColor,
    bg: theme.backgroundColor,
    textMuted: theme.textMutedColor
  };
  const useCurve = theme.curveLine !== 'line';

  container.innerHTML = '';
  if (records.length === 0) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.empty');
    container.appendChild(empty);
    return;
  }

  const wrap = container.parentElement;
  const rect = wrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrap);
  const padTop = parseFloat(wrapStyle.paddingTop) || 0;
  const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
  const padLeft = parseFloat(wrapStyle.paddingLeft) || 0;
  const padRight = parseFloat(wrapStyle.paddingRight) || 0;
  const minTime = records[0].timestamp;
  const maxTime = records[records.length - 1].timestamp;
  const padMs = PAD_HOURS * HOUR_MS;
  const displayMinTime = minTime - padMs;
  const displayMaxTime = maxTime + padMs;
  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;

  const absoluteChartW = displaySpanHours * PX_PER_HOUR;
  const minChartW = Math.max(0, rect.width - 40 - PADDING.left - PADDING.right);
  const chartW = Math.max(absoluteChartW, minChartW);
  const width = PADDING.left + chartW + PADDING.right;

  container.setAttribute('width', width);
  const height = wrap.clientHeight - padTop - padBottom;
  const chartH = height - PADDING.top - PADDING.bottom;
  container.setAttribute('height', height);
  container.setAttribute('viewBox', `0 0 ${width} ${height}`);
  container.removeAttribute('preserveAspectRatio');

  const defs = createSVGElement('defs');

  const xFor = t => PADDING.left + ((t - displayMinTime) / HOUR_MS) * PX_PER_HOUR;
  const yFor = v => PADDING.top + ((10 - v) / 20) * chartH;
  const yTop = yFor(10);
  const yBottom = yFor(-10);

  const posGradient = createSVGElement('linearGradient', { id: 'grad-pos', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  posGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
  posGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.05)` }));
  defs.appendChild(posGradient);

  const negGradient = createSVGElement('linearGradient', { id: 'grad-neg', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  negGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.05)` }));
  negGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
  defs.appendChild(negGradient);

  const mixedGradient = createSVGElement('linearGradient', { id: 'grad-mixed', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  mixedGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.45)` }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': `rgba(${hexToRgb(colors.neutral)}, 0.15)` }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.45)` }));
  defs.appendChild(mixedGradient);

  container.appendChild(defs);

  const gridGroup = createSVGElement('g', { class: 'grid' });
  for (let v = -10; v <= 10; v += 2) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? colors.neutral : theme.surface2Color,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    const label = createSVGElement('text', {
      x: PADDING.left - 10, y: y + 4, 'text-anchor': 'end', fill: colors.textMuted, 'font-size': '11'
    });
    label.textContent = v > 0 ? `+${v}` : String(v);
    gridGroup.appendChild(label);
  }
  container.appendChild(gridGroup);

  const timeAxisGroup = createSVGElement('g', { class: 'time-axis' });
  const timeStepHours = getTimeStepHours(displaySpanHours);

  // 对齐到本地时间的午夜，而不是UTC午夜
  const refDate = new Date(displayMinTime);
  refDate.setHours(0, 0, 0, 0);
  const refTime = refDate.getTime();
  const hoursSinceRef = (displayMinTime - refTime) / HOUR_MS;
  const startHours = Math.ceil(hoursSinceRef / timeStepHours) * timeStepHours;
  const startTs = refTime + startHours * HOUR_MS;
  const endHours = Math.floor((displayMaxTime - refTime) / HOUR_MS / timeStepHours) * timeStepHours;
  const endTs = refTime + endHours * HOUR_MS;

  for (let ts = startTs; ts <= endTs; ts += timeStepHours * HOUR_MS) {
    const x = xFor(ts);
    const gridLine = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: height - PADDING.bottom,
      stroke: `rgba(${hexToRgb(theme.surface2Color)}, 0.5)`, 'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    timeAxisGroup.appendChild(gridLine);
    const label = createSVGElement('text', {
      x: x, y: height - PADDING.bottom + 16, 'text-anchor': 'middle',
      fill: colors.textMuted, 'font-size': '10'
    });
    label.textContent = formatAxisTime(ts, displaySpanHours, timeStepHours);
    timeAxisGroup.appendChild(label);
  }
  container.appendChild(timeAxisGroup);

  function curveSegment(x1, y1, x2, y2) {
    if (!useCurve) return ` L ${x2} ${y2}`;
    const cp1x = x1 + (x2 - x1) * 0.35;
    const cp2x = x2 - (x2 - x1) * 0.35;
    return ` C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
  }

  function makeCurveD(items, getValue) {
    if (items.length === 0) return '';
    let d = `M ${xFor(items[0].timestamp)} ${yFor(getValue(items[0]))}`;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1], curr = items[i];
      const x1 = xFor(prev.timestamp), y1 = yFor(getValue(prev));
      const x2 = xFor(curr.timestamp), y2 = yFor(getValue(curr));
      d += curveSegment(x1, y1, x2, y2);
    }
    return d;
  }

  function makeAreaUnderCurveD(items, getValue, baselineY) {
    if (items.length === 0) return '';
    let d = `M ${xFor(items[0].timestamp)} ${baselineY}`;
    d += ` L ${xFor(items[0].timestamp)} ${yFor(getValue(items[0]))}`;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1], curr = items[i];
      const x1 = xFor(prev.timestamp), y1 = yFor(getValue(prev));
      const x2 = xFor(curr.timestamp), y2 = yFor(getValue(curr));
      d += curveSegment(x1, y1, x2, y2);
    }
    d += ` L ${xFor(items[items.length - 1].timestamp)} ${baselineY} Z`;
    return d;
  }

  const hasMixed = records.some(r => r.mixed);
  if (hasMixed) {
    const mixedRecords = records.map(r => ({
      ...r,
      upper: r.mixed ? Math.max(r.value, r.mixedValue) : r.value,
      lower: r.mixed ? Math.min(r.value, r.mixedValue) : r.value
    }));

    let areaD = `M ${xFor(mixedRecords[0].timestamp)} ${yFor(mixedRecords[0].upper)}`;
    for (let i = 1; i < mixedRecords.length; i++) {
      const prev = mixedRecords[i - 1], curr = mixedRecords[i];
      const x1 = xFor(prev.timestamp), y1u = yFor(prev.upper);
      const x2 = xFor(curr.timestamp), y2u = yFor(curr.upper);
      areaD += curveSegment(x1, y1u, x2, y2u);
    }
    for (let i = mixedRecords.length - 1; i >= 0; i--) {
      const curr = mixedRecords[i];
      const x2 = xFor(curr.timestamp), y2l = yFor(curr.lower);
      if (i === mixedRecords.length - 1) {
        areaD += ` L ${x2} ${y2l}`;
      } else {
        const next = mixedRecords[i + 1];
        const x1 = xFor(next.timestamp), y1l = yFor(next.lower);
        areaD += curveSegment(x1, y1l, x2, y2l);
      }
    }
    areaD += ' Z';
    container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-mixed)', stroke: 'none' }));

    container.appendChild(createSVGElement('path', {
      d: makeCurveD(mixedRecords, r => r.upper),
      fill: 'none', stroke: colors.positive, 'stroke-width': 2.5
    }));
    container.appendChild(createSVGElement('path', {
      d: makeCurveD(mixedRecords, r => r.lower),
      fill: 'none', stroke: colors.negative, 'stroke-width': 2.5
    }));
  } else {
    const mainGradient = createSVGElement('linearGradient', { id: 'grad-main', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    mainGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': colors.neutral }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
    defs.appendChild(mainGradient);

    container.appendChild(createSVGElement('path', {
      d: makeCurveD(records, r => r.value),
      fill: 'none', stroke: 'url(#grad-main)', 'stroke-width': 3,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    const zeroY = yFor(0);
    const areaD = makeAreaUnderCurveD(records, r => r.value, zeroY);
    if (areaD) {
      container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-main)', stroke: 'none', opacity: '0.12' }));
    }
  }

  const crosshairGroup = createSVGElement('g', { class: 'crosshair', display: 'none' });
  const crosshairStroke = `rgba(${hexToRgb(colors.textMuted)}, 0.5)`;
  const vLine = createSVGElement('line', {
    x1: 0, y1: PADDING.top, x2: 0, y2: height - PADDING.bottom,
    stroke: crosshairStroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  const hLine = createSVGElement('line', {
    x1: PADDING.left, y1: 0, x2: width - PADDING.right, y2: 0,
    stroke: crosshairStroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  crosshairGroup.appendChild(vLine);
  crosshairGroup.appendChild(hLine);
  container.appendChild(crosshairGroup);

  records.forEach((r, i) => {
    const x = xFor(r.timestamp);
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

      const anim = createSVGElement('circle', {
        cx: x, cy: y, r: 5, fill: colorForValue(v, theme, 0.3), class: 'point-pulse'
      });
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = `@keyframes pulse-${i} { 0% { r: 5; opacity: 0.5; } 100% { r: 12; opacity: 0; } }`;
      defs.appendChild(style);
      anim.setAttribute('style', `animation: pulse-${i} 1.8s ease-out ${i * 60}ms infinite;`);
      container.appendChild(anim);
    });
  });

  let activePoint = null;

  function showTooltip(r, v) {
    crosshairGroup.setAttribute('display', 'block');
    const x = xFor(r.timestamp);
    const y = yFor(v);
    vLine.setAttribute('x1', x);
    vLine.setAttribute('x2', x);
    hLine.setAttribute('y1', y);
    hLine.setAttribute('y2', y);

    const mixedText = r.mixed ? ` / ${r.mixedValue > 0 ? '+' : ''}${r.mixedValue}` : '';
    const medText = (r.doses || []).length
      ? `<div class="med">${r.doses.map(d => `${d.name} ${d.amount}${d.unit}`).join('、')}</div>`
      : '';
    tooltip.innerHTML = `
      <time>${formatDateTime(r.timestamp)}</time>
      <div class="value">${t('chart.tooltip.value')}: ${r.value > 0 ? '+' : ''}${r.value}${mixedText}</div>
      ${medText}
      ${r.note ? `<div class="note">${r.note}</div>` : ''}
    `;
    tooltip.classList.add('visible');

    const tRect = tooltip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const contentW = wrapRect.width - padLeft - padRight;
    const contentH = wrapRect.height - padTop - padBottom;
    const visibleX = padLeft + x - wrap.scrollLeft;
    let left = padLeft + x + 16;
    if (visibleX + 16 + tRect.width > contentW) left = padLeft + x - tRect.width - 16;
    if (left - wrap.scrollLeft < 0) left = wrap.scrollLeft;
    let top = padTop + y - 16;
    if (padTop + y - 16 + tRect.height > contentH) top = padTop + y - tRect.height - 16;
    if (top - wrap.scrollTop < padTop + PADDING.top) top = wrap.scrollTop + padTop + PADDING.top;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    crosshairGroup.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
    if (activePoint) {
      activePoint.setAttribute('r', 5);
      activePoint = null;
    }
  }

  const points = Array.from(container.querySelectorAll('.chart-point'));
  let flatIndex = 0;
  records.forEach(r => {
    const values = r.mixed ? [r.value, r.mixedValue] : [r.value];
    values.forEach(v => {
      const pt = points[flatIndex++];
      pt.addEventListener('mouseenter', () => {
        activePoint = pt;
        pt.setAttribute('r', 8);
        showTooltip(r, v);
      });
      pt.addEventListener('mouseleave', hideTooltip);
    });
  });

  container.addEventListener('mousemove', e => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) {
      hideTooltip();
      return;
    }
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    let nearest = records[0];
    let minDiff = Infinity;
    records.forEach(r => {
      const diff = Math.abs(r.timestamp - t);
      if (diff < minDiff) { minDiff = diff; nearest = r; }
    });
    const v = nearest.mixed ? (Math.abs(nearest.value) >= Math.abs(nearest.mixedValue) ? nearest.value : nearest.mixedValue) : nearest.value;
    showTooltip(nearest, v);
  });
  container.addEventListener('mouseleave', hideTooltip);

  container.addEventListener('touchstart', e => {
    const rect = container.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) return;
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    let nearest = records[0];
    let minDiff = Infinity;
    records.forEach(r => {
      const diff = Math.abs(r.timestamp - t);
      if (diff < minDiff) { minDiff = diff; nearest = r; }
    });
    const v = nearest.mixed ? (Math.abs(nearest.value) >= Math.abs(nearest.mixedValue) ? nearest.value : nearest.mixedValue) : nearest.value;
    showTooltip(nearest, v);
  }, { passive: true });
  container.addEventListener('touchend', hideTooltip, { passive: true });
}

const MED_COLORS = ['#22c55e', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

function extractDoses(records) {
  const doses = [];
  records.forEach(r => {
    (r.doses || []).forEach(d => {
      doses.push({ ...d, timestamp: r.timestamp });
    });
  });
  return doses;
}

function pkEffect(dtHours, onsetHours, peakHours, halfLifeHours) {
  if (dtHours < 0 || dtHours < onsetHours) return 0;
  if (dtHours <= peakHours) {
    const denom = Math.max(0.1, peakHours - onsetHours);
    return (dtHours - onsetHours) / denom;
  }
  return Math.exp(-(dtHours - peakHours) * Math.LN2 / halfLifeHours);
}

function effectEndTime(dose, threshold = 0.01) {
  const { timestamp, amount, peakHours, halfLifeHours } = dose;
  if (!amount || amount <= threshold || !halfLifeHours || halfLifeHours <= 0) {
    return timestamp + Math.max(0, peakHours || 0) * HOUR_MS;
  }
  const decayEndHours = peakHours + halfLifeHours * Math.log(amount / threshold) / Math.LN2;
  return timestamp + decayEndHours * HOUR_MS;
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
        doses: []
      };
    }
    groups[key].doses.push(d);
  });
  return Object.values(groups);
}

function medColor(index) {
  return MED_COLORS[index % MED_COLORS.length];
}

export function renderCombinedChart(records, sleeps = [], events = [], container, tooltip, legendContainer, options = {}) {
  const { showMood = true, showEffect = true, showSleep = true, projectedDoses = [], pxPerHour } = options;
  const effectivePxPerHour = pxPerHour || PX_PER_HOUR;
  const theme = getTheme();
  const colors = {
    positive: theme.positiveColor,
    negative: theme.negativeColor,
    neutral: theme.neutralColor,
    accent: theme.accentColor,
    bg: theme.backgroundColor,
    textMuted: theme.textMutedColor
  };
  const useCurve = theme.curveLine !== 'line';

  container.innerHTML = '';
  if (legendContainer) legendContainer.innerHTML = '';

  const actualDoses = extractDoses(records);
  const doses = [...actualDoses, ...projectedDoses];
  const hasMoodData = records.length > 0 && showMood;
  const hasEffectData = doses.length > 0 && showEffect;
  const hasSleepData = sleeps.length > 0 && showSleep;

  if (!hasMoodData && !hasEffectData && !hasSleepData) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.empty');
    container.appendChild(empty);
    return;
  }

  // 计算时间范围
  const allTimestamps = records.map(r => r.timestamp)
    .concat(doses.map(d => d.timestamp))
    .concat(sleeps.flatMap(s => [s.startTime, s.endTime]))
    .concat(events.map(e => e.timestamp));
  const minTime = Math.min(...allTimestamps);
  let maxTime = Math.max(...allTimestamps);
  if (hasEffectData) {
    const maxEffectEnd = Math.max(...doses.map(d => effectEndTime(d, 0.01)));
    maxTime = Math.max(maxTime, maxEffectEnd);
  }
  const padMs = PAD_HOURS * HOUR_MS;
  const displayMinTime = minTime - padMs;
  const displayMaxTime = maxTime + padMs;
  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;

  const wrap = container.parentElement;
  const rect = wrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrap);
  const padTop = parseFloat(wrapStyle.paddingTop) || 0;
  const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
  const padLeft = parseFloat(wrapStyle.paddingLeft) || 0;
  const containerChartW = Math.max(0, rect.width - 40 - PADDING.left - PADDING.right);
  const absoluteChartW = displaySpanHours * effectivePxPerHour;
  const chartW = Math.max(absoluteChartW, containerChartW);
  const width = PADDING.left + chartW + PADDING.right;

  container.setAttribute('width', width);
  const height = wrap.clientHeight - padTop - padBottom;
  const chartH = height - PADDING.top - PADDING.bottom;
  container.setAttribute('height', height);
  container.setAttribute('viewBox', `0 0 ${width} ${height}`);
  container.removeAttribute('preserveAspectRatio');

  const xFor = ts => PADDING.left + ((ts - displayMinTime) / HOUR_MS) * effectivePxPerHour;
  const yMoodFor = v => PADDING.top + ((10 - v) / 20) * chartH;
  const yTop = yMoodFor(10);
  const yBottom = yMoodFor(-10);

  const defs = createSVGElement('defs');
  container.appendChild(defs);

  // 情绪渐变
  if (hasMoodData) {
    const mainGradient = createSVGElement('linearGradient', { id: 'grad-main', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    mainGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': colors.neutral }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
    defs.appendChild(mainGradient);

    const posGradient = createSVGElement('linearGradient', { id: 'grad-pos', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    posGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': colors.positive }));
    posGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.05)` }));
    defs.appendChild(posGradient);

    const negGradient = createSVGElement('linearGradient', { id: 'grad-neg', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    negGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.05)` }));
    negGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': colors.negative }));
    defs.appendChild(negGradient);

    const mixedGradient = createSVGElement('linearGradient', { id: 'grad-mixed', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    mixedGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': `rgba(${hexToRgb(colors.positive)}, 0.45)` }));
    mixedGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': `rgba(${hexToRgb(colors.neutral)}, 0.15)` }));
    mixedGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': `rgba(${hexToRgb(colors.negative)}, 0.45)` }));
    defs.appendChild(mixedGradient);
  }

  // 绘制网格（情绪 Y 轴）
  const gridGroup = createSVGElement('g', { class: 'grid' });
  for (let v = -10; v <= 10; v += 2) {
    const y = yMoodFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? colors.neutral : theme.surface2Color,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    if (hasMoodData) {
      const label = createSVGElement('text', {
        x: PADDING.left - 10, y: y + 4, 'text-anchor': 'end', fill: colors.textMuted, 'font-size': '11'
      });
      label.textContent = v > 0 ? `+${v}` : String(v);
      gridGroup.appendChild(label);
    }
  }
  container.appendChild(gridGroup);

  // 药效 Y 轴（右侧）
  if (hasEffectData) {
    const groups = groupDosesByMed(doses);
    const sampleHours = Math.max(1, Math.floor(displaySpanHours / 200));
    const samplePoints = [];
    for (let h = 0; h <= displaySpanHours; h += sampleHours) {
      samplePoints.push(displayMinTime + h * HOUR_MS);
    }
    if (samplePoints[samplePoints.length - 1] < displayMaxTime) {
      samplePoints.push(displayMaxTime);
    }

    const series = groups.map((g, idx) => {
      const data = samplePoints.map(ts => {
        let effect = 0;
        g.doses.forEach(d => {
          const dt = (ts - d.timestamp) / HOUR_MS;
          effect += d.amount * pkEffect(dt, d.onsetHours, d.peakHours, d.halfLifeHours);
        });
        return { t: ts, effect };
      });
      return { ...g, color: medColor(idx), data };
    });

    const maxEffect = Math.max(0.1, ...series.flatMap(s => s.data.map(p => p.effect)));
    const yMax = Math.ceil(maxEffect * 1.1);
    const yEffectFor = v => PADDING.top + ((yMax - v) / yMax) * chartH;

    // 右侧 Y 轴标签
    for (let v = 0; v <= yMax; v += Math.max(1, Math.round(yMax / 4))) {
      const y = yEffectFor(v);
      const label = createSVGElement('text', {
        x: width - PADDING.right + 10, y: y + 4, 'text-anchor': 'start', fill: colors.textMuted, 'font-size': '11'
      });
      label.textContent = String(v);
      gridGroup.appendChild(label);
    }

    // 绘制药效曲线
    series.forEach(s => {
      const areaD = s.data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.t)} ${yEffectFor(p.effect)}`).join(' ')
        + ` L ${xFor(s.data[s.data.length - 1].t)} ${yEffectFor(0)} L ${xFor(s.data[0].t)} ${yEffectFor(0)} Z`;
      container.appendChild(createSVGElement('path', {
        d: areaD,
        fill: `rgba(${hexToRgb(s.color)}, 0.15)`,
        stroke: 'none'
      }));

      let lineD = '';
      s.data.forEach((p, i) => {
        lineD += `${i === 0 ? 'M' : 'L'} ${xFor(p.t)} ${yEffectFor(p.effect)}`;
      });
      container.appendChild(createSVGElement('path', {
        d: lineD,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }));

      if (legendContainer) {
        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML = `<i class="dot" style="background:${s.color}"></i><span>${s.name}</span>`;
        legendContainer.appendChild(item);
      }
    });
  }

  // 时间轴
  const timeAxisGroup = createSVGElement('g', { class: 'time-axis' });
  const timeStepHours = getTimeStepHours(displaySpanHours, effectivePxPerHour);

  // 对齐到本地时间的午夜，而不是UTC午夜
  const refDate = new Date(displayMinTime);
  refDate.setHours(0, 0, 0, 0);
  const refTime = refDate.getTime();
  const hoursSinceRef = (displayMinTime - refTime) / HOUR_MS;
  const startHours = Math.ceil(hoursSinceRef / timeStepHours) * timeStepHours;
  const startTs = refTime + startHours * HOUR_MS;
  const endHours = Math.floor((displayMaxTime - refTime) / HOUR_MS / timeStepHours) * timeStepHours;
  const endTs = refTime + endHours * HOUR_MS;

  for (let ts = startTs; ts <= endTs; ts += timeStepHours * HOUR_MS) {
    const x = xFor(ts);
    const gridLine = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: height - PADDING.bottom,
      stroke: `rgba(${hexToRgb(theme.surface2Color)}, 0.5)`, 'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    timeAxisGroup.appendChild(gridLine);
    const label = createSVGElement('text', {
      x: x, y: height - PADDING.bottom + 16, 'text-anchor': 'middle',
      fill: colors.textMuted, 'font-size': '10'
    });
    label.textContent = formatAxisTime(ts, displaySpanHours, timeStepHours);
    timeAxisGroup.appendChild(label);
  }
  container.appendChild(timeAxisGroup);

  // 当前时间线
  const now = Date.now();
  if (now >= displayMinTime && now <= displayMaxTime) {
    const nowX = xFor(now);
    const nowGroup = createSVGElement('g', { class: 'current-time-line' });
    nowGroup.appendChild(createSVGElement('line', {
      x1: nowX, y1: PADDING.top, x2: nowX, y2: height - PADDING.bottom,
      stroke: `rgba(${hexToRgb(colors.textMuted)}, 0.6)`,
      'stroke-width': 1.5,
      'stroke-dasharray': '5 3'
    }));
    const nowLabel = createSVGElement('text', {
      x: nowX, y: PADDING.top - 8, 'text-anchor': 'middle',
      fill: colors.textMuted, 'font-size': '10'
    });
    nowLabel.textContent = t('chart.now');
    nowGroup.appendChild(nowLabel);
    container.appendChild(nowGroup);
  }

  // 绘制睡眠条（在零值基线上）
  if (hasSleepData) {
    const sleepBarHeight = 14;
    const sleepY = yMoodFor(0) - sleepBarHeight / 2;
    const sleepClipId = 'sleep-bar-clip';

    sleeps.forEach((sleep, sleepIdx) => {
      const xStart = xFor(sleep.startTime);
      const xEnd = xFor(sleep.endTime);
      const totalWidth = xEnd - xStart;
      if (totalWidth <= 0) return;

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

      const clipId = `${sleepClipId}-${sleepIdx}`;
      const clipPath = createSVGElement('clipPath', { id: clipId });
      clipPath.appendChild(createSVGElement('rect', {
        x: xStart, y: sleepY, width: totalWidth, height: sleepBarHeight,
        rx: sleepBarHeight / 2, ry: sleepBarHeight / 2
      }));
      defs.appendChild(clipPath);

      const group = createSVGElement('g', { class: 'sleep-bar-group', 'clip-path': `url(#${clipId})` });
      const overlayGroup = createSVGElement('g', { class: 'sleep-bar-overlay' });

      segments.forEach(seg => {
        const sx = xFor(seg.start);
        const sw = xFor(seg.end) - sx;
        if (sw <= 0) return;
        const segRect = createSVGElement('rect', {
          x: sx, y: sleepY, width: sw, height: sleepBarHeight,
          fill: seg.type === 'asleep' ? '#8b5cf6' : theme.surface2Color
        });
        group.appendChild(segRect);
      });

      interruptions.forEach(i => {
        const ix1 = xFor(i.awakeAt);
        const ix2 = xFor(i.asleepAt);
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
      const labelY = sleepY - 6;
      const qualityLabel = createSVGElement('text', {
        x: centerX, y: labelY, 'text-anchor': 'middle',
        fill: '#8b5cf6', 'font-size': '11', 'font-weight': '600'
      });
      qualityLabel.textContent = `Q${sleep.quality}`;
      overlayGroup.appendChild(qualityLabel);
      container.appendChild(overlayGroup);
    });
  }

  // 绘制情绪曲线
  if (hasMoodData) {
    function curveSegment(x1, y1, x2, y2) {
      if (!useCurve) return ` L ${x2} ${y2}`;
      const cp1x = x1 + (x2 - x1) * 0.35;
      const cp2x = x2 - (x2 - x1) * 0.35;
      return ` C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
    }

    function makeCurveD(items, getValue) {
      if (items.length === 0) return '';
      let d = `M ${xFor(items[0].timestamp)} ${yMoodFor(getValue(items[0]))}`;
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1], curr = items[i];
        const x1 = xFor(prev.timestamp), y1 = yMoodFor(getValue(prev));
        const x2 = xFor(curr.timestamp), y2 = yMoodFor(getValue(curr));
        d += curveSegment(x1, y1, x2, y2);
      }
      return d;
    }

    function makeAreaUnderCurveD(items, getValue, baselineY) {
      if (items.length === 0) return '';
      let d = `M ${xFor(items[0].timestamp)} ${baselineY}`;
      d += ` L ${xFor(items[0].timestamp)} ${yMoodFor(getValue(items[0]))}`;
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1], curr = items[i];
        const x1 = xFor(prev.timestamp), y1 = yMoodFor(getValue(prev));
        const x2 = xFor(curr.timestamp), y2 = yMoodFor(getValue(curr));
        d += curveSegment(x1, y1, x2, y2);
      }
      d += ` L ${xFor(items[items.length - 1].timestamp)} ${baselineY} Z`;
      return d;
    }

    const hasMixed = records.some(r => r.mixed);
    if (hasMixed) {
      const mixedRecords = records.map(r => ({
        ...r,
        upper: r.mixed ? Math.max(r.value, r.mixedValue) : r.value,
        lower: r.mixed ? Math.min(r.value, r.mixedValue) : r.value
      }));

      let areaD = `M ${xFor(mixedRecords[0].timestamp)} ${yMoodFor(mixedRecords[0].upper)}`;
      for (let i = 1; i < mixedRecords.length; i++) {
        const prev = mixedRecords[i - 1], curr = mixedRecords[i];
        const x1 = xFor(prev.timestamp), y1u = yMoodFor(prev.upper);
        const x2 = xFor(curr.timestamp), y2u = yMoodFor(curr.upper);
        areaD += curveSegment(x1, y1u, x2, y2u);
      }
      for (let i = mixedRecords.length - 1; i >= 0; i--) {
        const curr = mixedRecords[i];
        const x2 = xFor(curr.timestamp), y2l = yMoodFor(curr.lower);
        if (i === mixedRecords.length - 1) {
          areaD += ` L ${x2} ${y2l}`;
        } else {
          const next = mixedRecords[i + 1];
          const x1 = xFor(next.timestamp), y1l = yMoodFor(next.lower);
          areaD += curveSegment(x1, y1l, x2, y2l);
        }
      }
      areaD += ' Z';
      container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-mixed)', stroke: 'none' }));

      container.appendChild(createSVGElement('path', {
        d: makeCurveD(mixedRecords, r => r.upper),
        fill: 'none', stroke: colors.positive, 'stroke-width': 2.5
      }));
      container.appendChild(createSVGElement('path', {
        d: makeCurveD(mixedRecords, r => r.lower),
        fill: 'none', stroke: colors.negative, 'stroke-width': 2.5
      }));
    } else {
      container.appendChild(createSVGElement('path', {
        d: makeCurveD(records, r => r.value),
        fill: 'none', stroke: 'url(#grad-main)', 'stroke-width': 3,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));

      const zeroY = yMoodFor(0);
      const areaD = makeAreaUnderCurveD(records, r => r.value, zeroY);
      if (areaD) {
        container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-main)', stroke: 'none', opacity: '0.12' }));
      }
    }

    // 情绪数据点
    records.forEach(r => {
      const x = xFor(r.timestamp);
      const values = r.mixed ? [r.value, r.mixedValue] : [r.value];
      values.forEach(v => {
        const y = yMoodFor(v);
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
  }

  // 事件竖线（始终显示）
  if (events.length > 0) {
    events.forEach(ev => {
      const ex = xFor(ev.timestamp);
      if (ex < PADDING.left || ex > width - PADDING.right) return;
      const line = createSVGElement('line', {
        x1: ex, y1: PADDING.top, x2: ex, y2: height - PADDING.bottom,
        stroke: colors.accent, 'stroke-width': 2, class: 'event-line', 'data-event-id': ev.id
      });
      line.style.pointerEvents = 'none';
      container.appendChild(line);

      const dot = createSVGElement('circle', {
        cx: ex, cy: PADDING.top, r: 4, fill: colors.accent, class: 'event-dot', 'data-event-id': ev.id
      });
      dot.style.pointerEvents = 'auto';
      dot.style.cursor = 'pointer';
      container.appendChild(dot);
    });
  }

  // 情绪图例
  if (hasMoodData && legendContainer) {
    const moodLegend = document.createElement('span');
    moodLegend.className = 'legend-item';
    moodLegend.innerHTML = `<i class="dot" style="background:${colors.positive}"></i><span data-i18n="chart.legend.manic">${t('chart.legend.manic')}</span>`;
    legendContainer.appendChild(moodLegend);

    const moodLegend2 = document.createElement('span');
    moodLegend2.className = 'legend-item';
    moodLegend2.innerHTML = `<i class="dot" style="background:${colors.negative}"></i><span data-i18n="chart.legend.depressed">${t('chart.legend.depressed')}</span>`;
    legendContainer.appendChild(moodLegend2);
  }

  if (events.length > 0 && legendContainer) {
    const eventLegend = document.createElement('span');
    eventLegend.className = 'legend-item';
    eventLegend.innerHTML = `<i class="dot" style="background:${colors.accent}; width: 2px; border-radius: 0;"></i><span data-i18n="chart.legend.event">${t('chart.legend.event')}</span>`;
    legendContainer.appendChild(eventLegend);
  }

  // 十字线和交互
  const crosshairGroup = createSVGElement('g', { class: 'crosshair', display: 'none' });
  const crosshairStroke = `rgba(${hexToRgb(colors.textMuted)}, 0.5)`;
  const vLine = createSVGElement('line', {
    x1: 0, y1: PADDING.top, x2: 0, y2: height - PADDING.bottom,
    stroke: crosshairStroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  crosshairGroup.appendChild(vLine);
  container.appendChild(crosshairGroup);

  let activePoint = null;

  function showCombinedTooltip(ts, cursorX = null) {
    let nearest = null;
    let nearestValue = null;
    let nearestPxDist = Infinity;
    if (hasMoodData) {
      let minDiff = Infinity;
      records.forEach(r => {
        const diff = Math.abs(r.timestamp - ts);
        if (diff < minDiff) { minDiff = diff; nearest = r; }
      });
      if (nearest) {
        nearestValue = nearest.mixed
          ? (Math.abs(nearest.value) >= Math.abs(nearest.mixedValue) ? nearest.value : nearest.mixedValue)
          : nearest.value;
        nearestPxDist = Math.abs(xFor(nearest.timestamp) - xFor(ts));
      }
    }

    // 附近的事件
    const NEAR_THRESHOLD_PX = 24;
    let nearestEvent = null;
    let nearestEventPxDist = Infinity;
    events.forEach(ev => {
      const dist = Math.abs(xFor(ev.timestamp) - xFor(ts));
      if (dist < nearestEventPxDist) { nearestEventPxDist = dist; nearestEvent = ev; }
    });
    const showEventDetail = nearestEvent && (cursorX === null || nearestEventPxDist <= NEAR_THRESHOLD_PX);

    // 仅当光标与情绪数据点足够接近时才显示情绪详情，并吸附到该点
    const snapToPoint = hasMoodData && nearest && (cursorX === null || nearestPxDist <= NEAR_THRESHOLD_PX);
    const showMoodDetail = snapToPoint;
    let tooltipTs = snapToPoint ? nearest.timestamp : ts;
    if (showEventDetail && !snapToPoint) tooltipTs = nearestEvent.timestamp;

    crosshairGroup.setAttribute('display', 'block');
    const x = xFor(tooltipTs);
    vLine.setAttribute('x1', x);
    vLine.setAttribute('x2', x);

    if (!showMoodDetail && !hasEffectData && !hasSleepData && !showEventDetail) {
      hideTooltip();
      return;
    }

    let content = `<time>${formatDateTime(tooltipTs)}</time>`;

    // 事件信息
    if (showEventDetail) {
      content += `<div style="color:${colors.accent}; font-weight:600;">${t('chart.tooltip.event')}: ${nearestEvent.title}</div>`;
      if (nearestEvent.note) content += `<div class="note">${nearestEvent.note}</div>`;
    }

    // 情绪信息
    if (showMoodDetail) {
      const mixedText = nearest.mixed ? ` / ${nearest.mixedValue > 0 ? '+' : ''}${nearest.mixedValue}` : '';
      const medText = (nearest.doses || []).length
        ? `<div class="med">${nearest.doses.map(d => `${d.name} ${d.amount}${d.unit}`).join('、')}</div>`
        : '';
      content += `<div class="value">${t('chart.tooltip.value')}: ${nearest.value > 0 ? '+' : ''}${nearest.value}${mixedText}</div>${medText}`;
      if (nearest.note) content += `<div class="note">${nearest.note}</div>`;
    }

    // 药效信息
    if (hasEffectData) {
      const groups = groupDosesByMed(doses);
      groups.forEach((g, idx) => {
        let effect = 0;
        g.doses.forEach(d => {
          const dt = (tooltipTs - d.timestamp) / HOUR_MS;
          effect += d.amount * pkEffect(dt, d.onsetHours, d.peakHours, d.halfLifeHours);
        });
        if (effect > 0) {
          content += `<div style="color:${medColor(idx)}">${g.name}: ${effect.toFixed(2)}</div>`;
        }
      });
    }

    // 睡眠信息
    if (hasSleepData) {
      const overlapping = sleeps.filter(s => tooltipTs >= s.startTime && tooltipTs <= s.endTime);
      overlapping.forEach(s => {
        const inInterruption = (s.interruptions || []).some(i => tooltipTs >= i.awakeAt && tooltipTs <= i.asleepAt);
        const stateText = inInterruption ? t('records.history.awake') : t('records.history.asleep');
        content += `<div style="color:#8b5cf6">${t('records.history.sleep')}: ${stateText} (${formatDateTime(s.startTime)} ~ ${formatDateTime(s.endTime)})</div>`;
      });
    }

    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    tooltip.style.position = 'fixed';

    const tRect = tooltip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const viewportX = wrapRect.left + padLeft + x - wrap.scrollLeft;
    let viewportY = wrapRect.top + padTop + PADDING.top;
    if (nearestValue !== null) viewportY = wrapRect.top + padTop + yMoodFor(nearestValue);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = viewportX + 16;
    let top = viewportY - tRect.height - 16;
    if (left + tRect.width + 12 > vw) left = viewportX - tRect.width - 16;
    if (left < 8) left = 8;
    if (top < 8) top = viewportY + 16;
    if (top + tRect.height + 8 > vh) top = vh - tRect.height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    crosshairGroup.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
    if (activePoint) {
      activePoint.setAttribute('r', 5);
      activePoint = null;
    }
  }

  // 数据点悬停
  if (hasMoodData) {
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
            showCombinedTooltip(r.timestamp);
          });
          pt.addEventListener('mouseleave', hideTooltip);
        }
      });
    });
  }

  container.addEventListener('mousemove', e => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) {
      hideTooltip();
      return;
    }
    const ts = displayMinTime + (x - PADDING.left) * HOUR_MS / effectivePxPerHour;
    showCombinedTooltip(ts, x);
  });
  container.addEventListener('mouseleave', hideTooltip);

  container.addEventListener('touchstart', e => {
    const rect = container.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) return;
    const ts = displayMinTime + (x - PADDING.left) * HOUR_MS / effectivePxPerHour;
    showCombinedTooltip(ts, x);
  }, { passive: true });
  container.addEventListener('touchend', hideTooltip, { passive: true });
}

export function renderEffectChart(records, container, tooltip, legendContainer) {
  const theme = getTheme();
  const textMuted = theme.textMutedColor;
  container.innerHTML = '';
  if (legendContainer) legendContainer.innerHTML = '';

  const doses = extractDoses(records);
  if (doses.length === 0) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.effectEmpty');
    container.appendChild(empty);
    return;
  }

  const allTimestamps = records.map(r => r.timestamp).concat(doses.map(d => d.timestamp));
  const minTime = Math.min(...allTimestamps);
  const maxTime = Math.max(...allTimestamps);
  const padMs = PAD_HOURS * HOUR_MS;
  const displayMinTime = minTime - padMs;
  const displayMaxTime = maxTime + padMs;
  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;

  const wrap = container.parentElement;
  const rect = wrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrap);
  const padTop = parseFloat(wrapStyle.paddingTop) || 0;
  const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
  const padLeft = parseFloat(wrapStyle.paddingLeft) || 0;
  const padRight = parseFloat(wrapStyle.paddingRight) || 0;
  const absoluteChartW = displaySpanHours * PX_PER_HOUR;
  const minChartW = Math.max(0, rect.width - 40 - PADDING.left - PADDING.right);
  const chartW = Math.max(absoluteChartW, minChartW);
  const width = PADDING.left + chartW + PADDING.right;

  container.setAttribute('width', width);
  const height = wrap.clientHeight - padTop - padBottom;
  const chartH = height - PADDING.top - PADDING.bottom;
  container.setAttribute('height', height);
  container.setAttribute('viewBox', `0 0 ${width} ${height}`);
  container.removeAttribute('preserveAspectRatio');

  const xFor = t => PADDING.left + ((t - displayMinTime) / HOUR_MS) * PX_PER_HOUR;

  const groups = groupDosesByMed(doses);
  const sampleHours = Math.max(1, Math.floor(displaySpanHours / 200));
  const samplePoints = [];
  for (let h = 0; h <= displaySpanHours; h += sampleHours) {
    samplePoints.push(displayMinTime + h * HOUR_MS);
  }
  if (samplePoints[samplePoints.length - 1] < displayMaxTime) {
    samplePoints.push(displayMaxTime);
  }

  const series = groups.map((g, idx) => {
    const data = samplePoints.map(t => {
      let effect = 0;
      g.doses.forEach(d => {
        const dt = (t - d.timestamp) / HOUR_MS;
        effect += d.amount * pkEffect(dt, d.onsetHours, d.peakHours, d.halfLifeHours);
      });
      return { t, effect };
    });
    return { ...g, color: medColor(idx), data };
  });

  const maxEffect = Math.max(0.1, ...series.flatMap(s => s.data.map(p => p.effect)));
  const yMax = Math.ceil(maxEffect * 1.1);
  const yFor = v => PADDING.top + ((yMax - v) / yMax) * chartH;

  const defs = createSVGElement('defs');
  container.appendChild(defs);

  const gridGroup = createSVGElement('g', { class: 'grid' });
  for (let v = 0; v <= yMax; v += Math.max(1, Math.round(yMax / 4))) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? theme.neutralColor : theme.surface2Color,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    const label = createSVGElement('text', {
      x: PADDING.left - 10, y: y + 4, 'text-anchor': 'end', fill: textMuted, 'font-size': '11'
    });
    label.textContent = String(v);
    gridGroup.appendChild(label);
  }
  container.appendChild(gridGroup);

  const timeAxisGroup = createSVGElement('g', { class: 'time-axis' });
  const timeStepHours = getTimeStepHours(displaySpanHours);

  // 对齐到本地时间的午夜，而不是UTC午夜
  const refDate = new Date(displayMinTime);
  refDate.setHours(0, 0, 0, 0);
  const refTime = refDate.getTime();
  const hoursSinceRef = (displayMinTime - refTime) / HOUR_MS;
  const startHours = Math.ceil(hoursSinceRef / timeStepHours) * timeStepHours;
  const startTs = refTime + startHours * HOUR_MS;
  const endHours = Math.floor((displayMaxTime - refTime) / HOUR_MS / timeStepHours) * timeStepHours;
  const endTs = refTime + endHours * HOUR_MS;

  for (let ts = startTs; ts <= endTs; ts += timeStepHours * HOUR_MS) {
    const x = xFor(ts);
    const gridLine = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: height - PADDING.bottom,
      stroke: `rgba(${hexToRgb(theme.surface2Color)}, 0.5)`, 'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    timeAxisGroup.appendChild(gridLine);
    const label = createSVGElement('text', {
      x: x, y: height - PADDING.bottom + 16, 'text-anchor': 'middle',
      fill: textMuted, 'font-size': '10'
    });
    label.textContent = formatAxisTime(ts, displaySpanHours, timeStepHours);
    timeAxisGroup.appendChild(label);
  }
  container.appendChild(timeAxisGroup);

  series.forEach(s => {
    const areaD = s.data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.t)} ${yFor(p.effect)}`).join(' ')
      + ` L ${xFor(s.data[s.data.length - 1].t)} ${yFor(0)} L ${xFor(s.data[0].t)} ${yFor(0)} Z`;
    container.appendChild(createSVGElement('path', {
      d: areaD,
      fill: `rgba(${hexToRgb(s.color)}, 0.15)`,
      stroke: 'none'
    }));

    let lineD = '';
    s.data.forEach((p, i) => {
      lineD += `${i === 0 ? 'M' : 'L'} ${xFor(p.t)} ${yFor(p.effect)}`;
    });
    container.appendChild(createSVGElement('path', {
      d: lineD,
      fill: 'none',
      stroke: s.color,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));

    if (legendContainer) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.innerHTML = `<i class="dot" style="background:${s.color}"></i><span>${s.name}</span>`;
      legendContainer.appendChild(item);
    }
  });

  const crosshairGroup = createSVGElement('g', { class: 'crosshair', display: 'none' });
  const crosshairStroke = `rgba(${hexToRgb(textMuted)}, 0.5)`;
  const vLine = createSVGElement('line', {
    x1: 0, y1: PADDING.top, x2: 0, y2: height - PADDING.bottom,
    stroke: crosshairStroke, 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  crosshairGroup.appendChild(vLine);
  container.appendChild(crosshairGroup);

  function showEffectTooltip(timestamp) {
    crosshairGroup.setAttribute('display', 'block');
    const x = xFor(timestamp);
    vLine.setAttribute('x1', x);
    vLine.setAttribute('x2', x);

    const rows = series.map(s => {
      const effect = s.data.reduce((closest, p) =>
        Math.abs(p.t - timestamp) < Math.abs(closest.t - timestamp) ? p : closest, s.data[0]).effect;
      return `<div style="color:${s.color}">${s.name}: ${effect.toFixed(2)}</div>`;
    }).join('');

    tooltip.innerHTML = `
      <time>${formatDateTime(timestamp)}</time>
      <div class="value">${t('chart.effectTooltip')}</div>
      ${rows}
    `;
    tooltip.classList.add('visible');

    const tRect = tooltip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const contentW = wrapRect.width - padLeft - padRight;
    const contentH = wrapRect.height - padTop - padBottom;
    const visibleX = padLeft + x - wrap.scrollLeft;
    let left = padLeft + x + 16;
    if (visibleX + 16 + tRect.width > contentW) left = padLeft + x - tRect.width - 16;
    if (left - wrap.scrollLeft < 0) left = wrap.scrollLeft;
    let top = padTop + PADDING.top;
    if (top + tRect.height > contentH) top = contentH - tRect.height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideEffectTooltip() {
    crosshairGroup.setAttribute('display', 'none');
    tooltip.classList.remove('visible');
  }

  container.addEventListener('mousemove', e => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) {
      hideEffectTooltip();
      return;
    }
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    showEffectTooltip(t);
  });
  container.addEventListener('mouseleave', hideEffectTooltip);

  container.addEventListener('touchstart', e => {
    const rect = container.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    if (x < PADDING.left || x > width - PADDING.right) return;
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    showEffectTooltip(t);
  }, { passive: true });
  container.addEventListener('touchend', hideEffectTooltip, { passive: true });
}
