import { formatDateTime } from './store.js';
import { t } from './i18n.js';
import { getTheme } from './theme.js';

const PADDING = { top: 30, right: 40, bottom: 40, left: 44 };
const PX_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;
const PAD_HOURS = 6;

function formatAxisTime(ts, spanHours) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  const hour = `${pad(d.getHours())}:00`;
  if (spanHours <= 24) return hour;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hour}`;
}

function getTimeStepHours(spanHours) {
  if (spanHours <= 24) return 6;
  if (spanHours <= 72) return 12;
  if (spanHours <= 168) return 24;
  return 24 * Math.ceil(spanHours / 168);
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

function formatMedicationInfo(r) {
  if (!r.medication) return '';
  return t('chart.tooltip.medicationStrength', { strength: r.medicationStrength });
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
  const height = rect.height;
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
  const chartH = height - PADDING.top - PADDING.bottom;
  const width = PADDING.left + chartW + PADDING.right;

  container.setAttribute('width', width);
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
  const startHour = Math.ceil(displayMinTime / HOUR_MS / timeStepHours) * timeStepHours;
  const endHour = Math.floor(displayMaxTime / HOUR_MS / timeStepHours) * timeStepHours;
  for (let h = startHour; h <= endHour; h += timeStepHours) {
    const t = h * HOUR_MS;
    const x = xFor(t);
    const gridLine = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: height - PADDING.bottom,
      stroke: `rgba(${hexToRgb(theme.surface2Color)}, 0.5)`, 'stroke-width': 1, 'stroke-dasharray': '3 3'
    });
    timeAxisGroup.appendChild(gridLine);
    const label = createSVGElement('text', {
      x: x, y: height - PADDING.bottom + 16, 'text-anchor': 'middle',
      fill: colors.textMuted, 'font-size': '10'
    });
    label.textContent = formatAxisTime(t, displaySpanHours);
    timeAxisGroup.appendChild(label);
  }
  container.appendChild(timeAxisGroup);

  records.forEach(r => {
    if (!r.medication) return;
    const x = xFor(r.timestamp);
    const strength = r.medicationStrength || 0;
    if (strength <= 0) return;
    const yTop = yFor(strength);
    const yBottom = yFor(-strength);
    const medLineTop = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: yTop,
      stroke: `rgba(${hexToRgb(colors.textMuted)}, 0.35)`, 'stroke-width': 2, 'stroke-dasharray': '3 3'
    });
    const medLineBottom = createSVGElement('line', {
      x1: x, y1: height - PADDING.bottom, x2: x, y2: yBottom,
      stroke: `rgba(${hexToRgb(colors.textMuted)}, 0.35)`, 'stroke-width': 2, 'stroke-dasharray': '3 3'
    });
    container.appendChild(medLineTop);
    container.appendChild(medLineBottom);
  });

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
    const medText = r.medication ? `<div class="med">${formatMedicationInfo(r)}</div>` : '';
    tooltip.innerHTML = `
      <time>${formatDateTime(r.timestamp)}</time>
      <div class="value">${t('chart.tooltip.value')}: ${r.value > 0 ? '+' : ''}${r.value}${mixedText}</div>
      ${medText}
      ${r.note ? `<div class="note">${r.note}</div>` : ''}
    `;
    tooltip.classList.add('visible');

    const tRect = tooltip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const visibleX = x - wrap.scrollLeft;
    let left = visibleX + 16;
    let top = y - 16;
    if (left + tRect.width > wrapRect.width) left = visibleX - tRect.width - 16;
    if (left < 0) left = 0;
    if (top + tRect.height > wrapRect.height) top = wrapRect.height - tRect.height - 8;
    if (top < PADDING.top) top = PADDING.top;
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
    const x = e.clientX - rect.left + wrap.scrollLeft;
    if (x < PADDING.left || x > width - PADDING.right) {
      hideTooltip();
      return;
    }
    const t = displayMinTime + ((x - PADDING.left) / chartW) * displaySpan;
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
    const x = touch.clientX - rect.left + wrap.scrollLeft;
    if (x < PADDING.left || x > width - PADDING.right) return;
    const t = displayMinTime + ((x - PADDING.left) / chartW) * displaySpan;
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
