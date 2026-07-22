import { formatDateTime, formatDuration } from './store.js';
import { t } from './i18n.js';
import { getTheme } from './theme.js';

const PADDING = { top: 30, right: 40, bottom: 40, left: 44 };
const PX_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PAD_HOURS = 6;
export const MAX_MOOD_RANGE_MS = 30 * DAY_MS;
const MAX_EFFECT_RANGE_MS = 7 * DAY_MS;
const MAX_EFFECT_FUTURE_MS = 7 * DAY_MS;

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
  overlay.style.height = `${height}px`;

  const svg = createSVGElement('svg', {
    width: '100%',
    height: '100%',
    viewBox: `0 0 ${width} ${height}`
  });

  labels.forEach(({ value, y }) => {
    const label = createSVGElement('text', {
      x: isLeft ? width - 10 : 10,
      y: y + 4,
      'text-anchor': isLeft ? 'end' : 'start',
      fill: textColor,
      'font-size': '11'
    });
    label.textContent = value;
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
  const connectMoodDots = theme.connectMoodDots !== false;

  const wrap = container.parentElement;
  container.innerHTML = '';
  clearYAxisOverlays(wrap);
  if (records.length === 0) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.empty');
    container.appendChild(empty);
    return;
  }

  const rect = wrap.getBoundingClientRect();
  const wrapStyle = getComputedStyle(wrap);
  const padTop = parseFloat(wrapStyle.paddingTop) || 0;
  const padBottom = parseFloat(wrapStyle.paddingBottom) || 0;
  const padLeft = parseFloat(wrapStyle.paddingLeft) || 0;
  const padRight = parseFloat(wrapStyle.paddingRight) || 0;
  const minTime = records[0].timestamp;
  const maxTime = records[records.length - 1].timestamp;
  const padMs = PAD_HOURS * HOUR_MS;
  let displayMinTime = minTime - padMs;
  let displayMaxTime = maxTime + padMs;
  const clamped = clampDisplayRange(displayMinTime, displayMaxTime, MAX_MOOD_RANGE_MS);
  displayMinTime = clamped.displayMinTime;
  displayMaxTime = clamped.displayMaxTime;
  records = records.filter(r => r.timestamp >= displayMinTime);
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
  const yLabels = [];
  for (let v = -10; v <= 10; v += 2) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? colors.neutral : theme.surface2Color,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    yLabels.push({ value: v > 0 ? `+${v}` : String(v), y });
  }
  container.appendChild(gridGroup);
  renderYAxisOverlay(wrap, 'left', yLabels, colors.textMuted, height);

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

  if (connectMoodDots) {
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
    const x = clientXToChartX(container, e.clientX);
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

  function updateTooltipFromTouch(e) {
    const touch = e.touches[0];
    const x = clientXToChartX(container, touch.clientX);
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
  }

  container.addEventListener('touchstart', e => {
    updateTooltipFromTouch(e);
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!isScrollLocked()) return;
    if (e.cancelable) e.preventDefault();
    updateTooltipFromTouch(e);
  }, { passive: false });
  container.addEventListener('touchend', hideTooltip, { passive: true });
}

const DEFAULT_MED_COLORS = ['#22c55e', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

export function extractDoses(records) {
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

function doseMass(dose) {
  return (dose.amount || 0) * (dose.dosePerTablet || 1);
}

function effectAt(dtHours, dose, variant = 'upper') {
  if (variant === 'upper') {
    return doseMass(dose) * pkEffect(dtHours, dose.onsetMinHours, dose.peakMinHours, dose.halfLifeMaxHours);
  }
  return doseMass(dose) * pkEffect(dtHours, dose.onsetMaxHours, dose.peakMaxHours, dose.halfLifeMinHours);
}

export function effectEndTime(dose, threshold = 0.01) {
  const timestamp = dose.timestamp;
  const mass = doseMass(dose);
  const peakHours = dose.peakMaxHours ?? dose.peakHours ?? 0;
  const halfLifeHours = dose.halfLifeMaxHours ?? dose.halfLifeHours ?? 0.1;
  if (!mass || mass <= threshold || !halfLifeHours || halfLifeHours <= 0) {
    return timestamp + Math.max(0, peakHours) * HOUR_MS;
  }
  const decayEndHours = peakHours + halfLifeHours * Math.log(mass / threshold) / Math.LN2;
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
        doseMassUnit: d.doseMassUnit || 'mg',
        doses: []
      };
    }
    groups[key].doses.push(d);
  });
  return Object.values(groups);
}

function medColor(index) {
  const theme = getTheme();
  const colors = Array.isArray(theme.medColors) && theme.medColors.length > 0
    ? theme.medColors
    : DEFAULT_MED_COLORS;
  return colors[index % colors.length];
}

export function renderCombinedChart(records, sleeps = [], events = [], container, tooltip, legendContainer, options = {}) {
  const { showMood = true, showEffect = true, showSleep = true, projectedDoses = [], pxPerHour, displayRange, boundaryRecords = [], doses: explicitDoses = null } = options;
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
  const connectMoodDots = theme.connectMoodDots !== false;

  const wrap = container.parentElement;
  container.innerHTML = '';
  clearYAxisOverlays(wrap);
  if (legendContainer) legendContainer.innerHTML = '';

  let actualDoses = explicitDoses !== null ? explicitDoses : extractDoses(records);
  let doses = [...actualDoses, ...projectedDoses];
  let hasMoodData = records.length > 0 && showMood;
  let hasEffectData = doses.length > 0 && showEffect;
  let hasSleepData = sleeps.length > 0 && showSleep;
  let hasEventData = events.length > 0;

  if (!hasMoodData && !hasEffectData && !hasSleepData && !hasEventData) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.empty');
    container.appendChild(empty);
    return;
  }

  // 确定数据时间窗
  let dataMinTime;
  let dataMaxTime;
  if (displayRange) {
    dataMinTime = displayRange.min;
    dataMaxTime = displayRange.max;
  } else {
    const allTimestamps = records.map(r => r.timestamp)
      .concat(doses.map(d => d.timestamp))
      .concat(sleeps.flatMap(s => [s.startTime, s.endTime, ...(s.bedTime ? [s.bedTime] : []), ...(s.getOutOfBedTime ? [s.getOutOfBedTime] : [])]))
      .concat(events.map(e => e.timestamp));
    dataMinTime = Math.min(...allTimestamps);
    dataMaxTime = Math.max(...allTimestamps);
  }

  // 过滤掉超出范围的数据
  records = records.filter(r => r.timestamp >= dataMinTime && r.timestamp <= dataMaxTime);
  sleeps = sleeps.filter(s => {
    const bedStart = s.bedTime || s.startTime;
    const bedEnd = s.getOutOfBedTime || s.endTime;
    return bedEnd >= dataMinTime && bedStart <= dataMaxTime;
  });
  events = events.filter(e => e.timestamp >= dataMinTime && e.timestamp <= dataMaxTime);
  if (explicitDoses === null) {
    actualDoses = extractDoses(records);
    doses = [...actualDoses, ...projectedDoses];
  }
  hasMoodData = records.length > 0 && showMood;
  hasEffectData = doses.length > 0 && showEffect;
  hasSleepData = sleeps.length > 0 && showSleep;
  hasEventData = events.length > 0;

  if (!hasMoodData && !hasEffectData && !hasSleepData && !hasEventData) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: colors.textMuted, 'font-size': '14'
    });
    empty.textContent = t('chart.empty');
    container.appendChild(empty);
    return;
  }

  // 计算显示范围（含药效衰减延伸）
  const padMs = PAD_HOURS * HOUR_MS;
  const padStart = !(displayRange && displayRange.padStart === false);
  const padEnd = !(displayRange && displayRange.padEnd === false);
  let displayMinTime = dataMinTime - (padStart ? padMs : 0);
  let displayMaxTime = dataMaxTime + (padEnd ? padMs : 0);
  if (hasEffectData) {
    const maxEffectEnd = Math.max(...doses.map(d => effectEndTime(d, 0.01)));
    displayMaxTime = Math.max(displayMaxTime, Math.min(maxEffectEnd, dataMaxTime + (padEnd ? MAX_EFFECT_FUTURE_MS : 0)));
  }
  if (!displayRange) {
    const clamped = clampDisplayRange(displayMinTime, displayMaxTime, MAX_MOOD_RANGE_MS);
    displayMinTime = clamped.displayMinTime;
    displayMaxTime = clamped.displayMaxTime;
  }

  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;

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

  // Clip mood/effect curves to the visible chart area so boundary helper points
  // do not draw outside the page.
  const chartClipId = 'chart-area-clip';
  const chartClip = createSVGElement('clipPath', { id: chartClipId });
  chartClip.appendChild(createSVGElement('rect', {
    x: PADDING.left, y: PADDING.top, width: chartW, height: chartH
  }));
  defs.appendChild(chartClip);

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
  const moodYLabels = [];
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
      moodYLabels.push({ value: v > 0 ? `+${v}` : String(v), y });
    }
  }
  container.appendChild(gridGroup);
  if (hasMoodData) {
    renderYAxisOverlay(wrap, 'left', moodYLabels, colors.textMuted, height);
  }

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
        let upper = 0;
        let lower = 0;
        g.doses.forEach(d => {
          const dt = (ts - d.timestamp) / HOUR_MS;
          upper += effectAt(dt, d, 'upper');
          lower += effectAt(dt, d, 'lower');
        });
        return { t: ts, upper, lower };
      });
      return { ...g, color: medColor(idx), data };
    });

    const maxEffect = Math.max(0.1, ...series.flatMap(s => s.data.map(p => p.upper)));
    const yMax = Math.ceil(maxEffect * 1.1);
    const yEffectFor = v => PADDING.top + ((yMax - v) / yMax) * chartH;

    // 右侧 Y 轴标签
    const effectYLabels = [];
    for (let v = 0; v <= yMax; v += Math.max(1, Math.round(yMax / 4))) {
      const y = yEffectFor(v);
      effectYLabels.push({ value: String(v), y });
    }
    renderYAxisOverlay(wrap, 'right', effectYLabels, colors.textMuted, height);

    const unitSet = new Set(groups.map(g => g.doseMassUnit));
    const effectUnit = unitSet.size === 1 ? [...unitSet][0] : t('chart.effectUnit');
    if (effectUnit) {
      const unitLabel = createSVGElement('text', {
        x: width - PADDING.right + 4, y: PADDING.top - 6, 'text-anchor': 'start',
        fill: colors.textMuted, 'font-size': '10'
      });
      unitLabel.textContent = effectUnit;
      container.appendChild(unitLabel);
    }

    // 绘制药效区间（最高/最低两条曲线）
    series.forEach(s => {
      let bandD = `M ${xFor(s.data[0].t)} ${yEffectFor(s.data[0].upper)}`;
      for (let i = 1; i < s.data.length; i++) {
        bandD += ` L ${xFor(s.data[i].t)} ${yEffectFor(s.data[i].upper)}`;
      }
      for (let i = s.data.length - 1; i >= 0; i--) {
        bandD += ` L ${xFor(s.data[i].t)} ${yEffectFor(s.data[i].lower)}`;
      }
      bandD += ' Z';
      container.appendChild(createSVGElement('path', {
        d: bandD,
        fill: `rgba(${hexToRgb(s.color)}, 0.15)`,
        stroke: 'none'
      }));

      let upperD = `M ${xFor(s.data[0].t)} ${yEffectFor(s.data[0].upper)}`;
      let lowerD = `M ${xFor(s.data[0].t)} ${yEffectFor(s.data[0].lower)}`;
      for (let i = 1; i < s.data.length; i++) {
        upperD += ` L ${xFor(s.data[i].t)} ${yEffectFor(s.data[i].upper)}`;
        lowerD += ` L ${xFor(s.data[i].t)} ${yEffectFor(s.data[i].lower)}`;
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
      const bedStart = Math.min(sleep.bedTime || sleep.startTime, sleep.startTime);
      const bedEnd = Math.max(sleep.getOutOfBedTime || sleep.endTime, sleep.endTime);
      const xBedStart = xFor(bedStart);
      const xBedEnd = xFor(bedEnd);
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

      const clipId = `${sleepClipId}-${sleepIdx}`;
      const clipPath = createSVGElement('clipPath', { id: clipId });
      clipPath.appendChild(createSVGElement('rect', {
        x: xBedStart, y: sleepY, width: clipWidth, height: sleepBarHeight,
        rx: sleepBarHeight / 2, ry: sleepBarHeight / 2
      }));
      defs.appendChild(clipPath);

      const group = createSVGElement('g', { class: 'sleep-bar-group', 'clip-path': `url(#${clipId})` });
      const overlayGroup = createSVGElement('g', { class: 'sleep-bar-overlay' });

      // 在床上底色（包含入睡前和醒来后仍躺床上的时段）
      const bedRect = createSVGElement('rect', {
        x: xBedStart, y: sleepY, width: clipWidth, height: sleepBarHeight,
        fill: '#c4b5fd'
      });
      group.appendChild(bedRect);

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

    if (connectMoodDots) {
      // Include adjacent-page records when drawing the curve so the slope at the
      // page boundary stays continuous; the actual points are still only rendered
      // for records inside the page.
      const curveRecords = [...records, ...boundaryRecords].sort((a, b) => a.timestamp - b.timestamp);

      const hasMixed = curveRecords.some(r => r.mixed);
      if (hasMixed) {
        const mixedRecords = curveRecords.map(r => ({
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
        container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-mixed)', stroke: 'none', 'clip-path': `url(#${chartClipId})` }));

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
          fill: 'none', stroke: 'url(#grad-main)', 'stroke-width': 3,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'clip-path': `url(#${chartClipId})`
        }));

        const zeroY = yMoodFor(0);
        const areaD = makeAreaUnderCurveD(curveRecords, r => r.value, zeroY);
        if (areaD) {
          container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-main)', stroke: 'none', opacity: '0.12', 'clip-path': `url(#${chartClipId})` }));
        }
      }
    }

    // 情绪数据点（仅渲染当前页内的记录）
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

  if (hasSleepData && legendContainer) {
    const sleepLegend = document.createElement('span');
    sleepLegend.className = 'legend-item';
    sleepLegend.innerHTML = `<i class="dot" style="background:#8b5cf6"></i><span data-i18n="chart.legend.sleep">${t('chart.legend.sleep')}</span>`;
    legendContainer.appendChild(sleepLegend);

    const bedLegend = document.createElement('span');
    bedLegend.className = 'legend-item';
    bedLegend.innerHTML = `<i class="dot" style="background:#c4b5fd"></i><span data-i18n="chart.legend.bed">${t('chart.legend.bed')}</span>`;
    legendContainer.appendChild(bedLegend);
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
      if (nearestEvent.showElapsedTime) {
        const diff = Date.now() - nearestEvent.timestamp;
        const suffix = diff >= 0 ? 'past' : 'future';
        const elapsed = formatDuration(Math.abs(diff));
        content += `<div class="note">${t(`chart.tooltip.eventElapsed.${suffix}`, { duration: elapsed })}</div>`;
      }
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
        let upper = 0;
        let lower = 0;
        g.doses.forEach(d => {
          const dt = (tooltipTs - d.timestamp) / HOUR_MS;
          upper += effectAt(dt, d, 'upper');
          lower += effectAt(dt, d, 'lower');
        });
        if (upper > 0) {
          const unit = g.doseMassUnit || 'mg';
          content += `<div style="color:${medColor(idx)}">${g.name}: ${lower.toFixed(2)} ~ ${upper.toFixed(2)} ${unit}</div>`;
        }
      });
    }

    // 睡眠信息
    if (hasSleepData) {
      const overlapping = sleeps.filter(s => {
        const bedStart = s.bedTime || s.startTime;
        const bedEnd = s.getOutOfBedTime || s.endTime;
        return tooltipTs >= bedStart && tooltipTs <= bedEnd;
      });
      overlapping.forEach(s => {
        let stateText;
        const bedEnd = s.getOutOfBedTime || s.endTime;
        if (s.bedTime && tooltipTs >= s.bedTime && tooltipTs < s.startTime) {
          stateText = t('records.history.bed');
        } else if (s.getOutOfBedTime && tooltipTs > s.endTime && tooltipTs <= s.getOutOfBedTime) {
          stateText = t('records.history.bed');
        } else {
          const inInterruption = (s.interruptions || []).some(i => tooltipTs >= i.awakeAt && tooltipTs <= i.asleepAt);
          stateText = inInterruption ? t('records.history.awake') : t('records.history.asleep');
        }
        const rangeText = s.bedTime || s.getOutOfBedTime
          ? `${formatDateTime(s.bedTime || s.startTime)} ~ ${formatDateTime(s.getOutOfBedTime || s.endTime)}`
          : `${formatDateTime(s.startTime)} ~ ${formatDateTime(s.endTime)}`;
        content += `<div style="color:#8b5cf6">${t('records.history.sleep')}: ${stateText} (${rangeText})</div>`;
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
    const x = clientXToChartX(container, e.clientX);
    if (x < PADDING.left || x > width - PADDING.right) {
      hideTooltip();
      return;
    }
    const ts = displayMinTime + (x - PADDING.left) * HOUR_MS / effectivePxPerHour;
    showCombinedTooltip(ts, x);
  });
  container.addEventListener('mouseleave', hideTooltip);

  function updateTooltipFromTouch(e) {
    const touch = e.touches[0];
    const x = clientXToChartX(container, touch.clientX);
    if (x < PADDING.left || x > width - PADDING.right) return;
    const ts = displayMinTime + (x - PADDING.left) * HOUR_MS / effectivePxPerHour;
    showCombinedTooltip(ts, x);
  }

  container.addEventListener('touchstart', e => {
    updateTooltipFromTouch(e);
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!isScrollLocked()) return;
    if (e.cancelable) e.preventDefault();
    updateTooltipFromTouch(e);
  }, { passive: false });
  container.addEventListener('touchend', hideTooltip, { passive: true });
}

export function renderEffectChart(records, container, tooltip, legendContainer) {
  const theme = getTheme();
  const textMuted = theme.textMutedColor;
  const wrap = container.parentElement;
  container.innerHTML = '';
  clearYAxisOverlays(wrap);
  if (legendContainer) legendContainer.innerHTML = '';

  let doses = extractDoses(records);
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
  let displayMinTime = minTime - padMs;
  let displayMaxTime = maxTime + padMs;
  const clamped = clampDisplayRange(displayMinTime, displayMaxTime, MAX_EFFECT_RANGE_MS);
  displayMinTime = clamped.displayMinTime;
  displayMaxTime = clamped.displayMaxTime;
  doses = doses.filter(d => d.timestamp >= displayMinTime);
  const displaySpan = Math.max(1, displayMaxTime - displayMinTime);
  const displaySpanHours = displaySpan / HOUR_MS;

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
      let upper = 0;
      let lower = 0;
      g.doses.forEach(d => {
        const dt = (t - d.timestamp) / HOUR_MS;
        upper += effectAt(dt, d, 'upper');
        lower += effectAt(dt, d, 'lower');
      });
      return { t, upper, lower };
    });
    return { ...g, color: medColor(idx), data };
  });

  const maxEffect = Math.max(0.1, ...series.flatMap(s => s.data.map(p => p.upper)));
  const yMax = Math.ceil(maxEffect * 1.1);
  const yFor = v => PADDING.top + ((yMax - v) / yMax) * chartH;

  const defs = createSVGElement('defs');
  container.appendChild(defs);

  const gridGroup = createSVGElement('g', { class: 'grid' });
  const yLabels = [];
  for (let v = 0; v <= yMax; v += Math.max(1, Math.round(yMax / 4))) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? theme.neutralColor : theme.surface2Color,
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    yLabels.push({ value: String(v), y });
  }
  container.appendChild(gridGroup);
  renderYAxisOverlay(wrap, 'left', yLabels, textMuted, height);

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
    let bandD = `M ${xFor(s.data[0].t)} ${yFor(s.data[0].upper)}`;
    for (let i = 1; i < s.data.length; i++) {
      bandD += ` L ${xFor(s.data[i].t)} ${yFor(s.data[i].upper)}`;
    }
    for (let i = s.data.length - 1; i >= 0; i--) {
      bandD += ` L ${xFor(s.data[i].t)} ${yFor(s.data[i].lower)}`;
    }
    bandD += ' Z';
    container.appendChild(createSVGElement('path', {
      d: bandD,
      fill: `rgba(${hexToRgb(s.color)}, 0.15)`,
      stroke: 'none'
    }));

    let upperD = `M ${xFor(s.data[0].t)} ${yFor(s.data[0].upper)}`;
    let lowerD = `M ${xFor(s.data[0].t)} ${yFor(s.data[0].lower)}`;
    for (let i = 1; i < s.data.length; i++) {
      upperD += ` L ${xFor(s.data[i].t)} ${yFor(s.data[i].upper)}`;
      lowerD += ` L ${xFor(s.data[i].t)} ${yFor(s.data[i].lower)}`;
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
      const closest = s.data.reduce((best, p) =>
        Math.abs(p.t - timestamp) < Math.abs(best.t - timestamp) ? p : best, s.data[0]);
      return `<div style="color:${s.color}">${s.name}: ${closest.lower.toFixed(2)} ~ ${closest.upper.toFixed(2)} ${s.doseMassUnit || 'mg'}</div>`;
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
    const x = clientXToChartX(container, e.clientX);
    if (x < PADDING.left || x > width - PADDING.right) {
      hideEffectTooltip();
      return;
    }
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    showEffectTooltip(t);
  });
  container.addEventListener('mouseleave', hideEffectTooltip);

  function updateTooltipFromTouch(e) {
    const touch = e.touches[0];
    const x = clientXToChartX(container, touch.clientX);
    if (x < PADDING.left || x > width - PADDING.right) return;
    const t = displayMinTime + (x - PADDING.left) * HOUR_MS / PX_PER_HOUR;
    showEffectTooltip(t);
  }

  container.addEventListener('touchstart', e => {
    updateTooltipFromTouch(e);
  }, { passive: true });
  container.addEventListener('touchmove', e => {
    if (!isScrollLocked()) return;
    if (e.cancelable) e.preventDefault();
    updateTooltipFromTouch(e);
  }, { passive: false });
  container.addEventListener('touchend', hideEffectTooltip, { passive: true });
}
