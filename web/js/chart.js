import { formatDateTime } from './store.js';

const PADDING = { top: 30, right: 40, bottom: 40, left: 44 };

function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function colorForValue(v, alpha = 1) {
  if (v >= 0) {
    const t = Math.min(1, v / 10);
    return `rgba(239, ${68 + Math.round(100 * (1 - t))}, ${68 + Math.round(130 * (1 - t))}, ${alpha})`;
  }
  const t = Math.min(1, -v / 10);
  return `rgba(${59 + Math.round(100 * (1 - t))}, ${130 + Math.round(100 * (1 - t))}, 246, ${alpha})`;
}

function formatMedicationInfo(r) {
  if (!r.medication) return '';
  return `药效强度: ±${r.medicationStrength}`;
}

export function renderChart(records, container, tooltip) {
  container.innerHTML = '';
  if (records.length === 0) {
    const empty = createSVGElement('text', {
      x: '50%', y: '50%', 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '14'
    });
    empty.textContent = '暂无记录';
    container.appendChild(empty);
    return;
  }

  const rect = container.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  container.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const defs = createSVGElement('defs');

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;
  const minTime = records[0].timestamp;
  const maxTime = records[records.length - 1].timestamp;
  const timeSpan = Math.max(1, maxTime - minTime);

  const xFor = t => PADDING.left + ((t - minTime) / timeSpan) * chartW;
  const yFor = v => PADDING.top + ((10 - v) / 20) * chartH;
  const yTop = yFor(10);
  const yBottom = yFor(-10);

  const posGradient = createSVGElement('linearGradient', { id: 'grad-pos', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  posGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': '#ef4444' }));
  posGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': 'rgba(239,68,68,0.05)' }));
  defs.appendChild(posGradient);

  const negGradient = createSVGElement('linearGradient', { id: 'grad-neg', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  negGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': 'rgba(59,130,246,0.05)' }));
  negGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': '#3b82f6' }));
  defs.appendChild(negGradient);

  const mixedGradient = createSVGElement('linearGradient', { id: 'grad-mixed', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
  mixedGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': 'rgba(239,68,68,0.45)' }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': 'rgba(148,163,184,0.15)' }));
  mixedGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': 'rgba(59,130,246,0.45)' }));
  defs.appendChild(mixedGradient);

  container.appendChild(defs);

  const gridGroup = createSVGElement('g', { class: 'grid' });
  for (let v = -10; v <= 10; v += 2) {
    const y = yFor(v);
    const line = createSVGElement('line', {
      x1: PADDING.left, y1: y, x2: width - PADDING.right, y2: y,
      stroke: v === 0 ? '#94a3b8' : '#334155',
      'stroke-width': v === 0 ? 1.5 : 1,
      'stroke-dasharray': v === 0 ? '' : '4 4'
    });
    gridGroup.appendChild(line);
    const label = createSVGElement('text', {
      x: PADDING.left - 10, y: y + 4, 'text-anchor': 'end', fill: '#94a3b8', 'font-size': '11'
    });
    label.textContent = v > 0 ? `+${v}` : String(v);
    gridGroup.appendChild(label);
  }
  container.appendChild(gridGroup);

  records.forEach(r => {
    if (!r.medication) return;
    const x = xFor(r.timestamp);
    const strength = r.medicationStrength || 0;
    if (strength <= 0) return;
    const yTop = yFor(strength);
    const yBottom = yFor(-strength);
    const medLineTop = createSVGElement('line', {
      x1: x, y1: PADDING.top, x2: x, y2: yTop,
      stroke: 'rgba(148,163,184,0.35)', 'stroke-width': 2, 'stroke-dasharray': '3 3'
    });
    const medLineBottom = createSVGElement('line', {
      x1: x, y1: height - PADDING.bottom, x2: x, y2: yBottom,
      stroke: 'rgba(148,163,184,0.35)', 'stroke-width': 2, 'stroke-dasharray': '3 3'
    });
    container.appendChild(medLineTop);
    container.appendChild(medLineBottom);
  });

  function makeCurveD(items, getValue) {
    if (items.length === 0) return '';
    let d = `M ${xFor(items[0].timestamp)} ${yFor(getValue(items[0]))}`;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1], curr = items[i];
      const x1 = xFor(prev.timestamp), y1 = yFor(getValue(prev));
      const x2 = xFor(curr.timestamp), y2 = yFor(getValue(curr));
      const cp1x = x1 + (x2 - x1) * 0.35;
      const cp2x = x2 - (x2 - x1) * 0.35;
      d += ` C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`;
    }
    return d;
  }

  function makeAreaD(items, getValue, baselineY, filterFn) {
    if (items.length === 0) return '';
    const accepted = items.filter(r => filterFn(getValue(r)));
    if (accepted.length === 0) return '';
    let d = '';
    let last = null;
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      if (!filterFn(getValue(r))) continue;
      const x = xFor(r.timestamp), y = yFor(getValue(r));
      if (d === '') {
        d += `M ${x} ${baselineY} L ${x} ${y}`;
      } else {
        const prev = last;
        const x1 = xFor(prev.timestamp), y1 = yFor(getValue(prev));
        const cp1x = x1 + (x - x1) * 0.35, cp2x = x - (x - x1) * 0.35;
        d += ` C ${cp1x} ${y1}, ${cp2x} ${y}, ${x} ${y}`;
      }
      last = r;
    }
    if (d === '') return '';
    d += ` L ${xFor(last.timestamp)} ${baselineY} Z`;
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
      const cp1x = x1 + (x2 - x1) * 0.35, cp2x = x2 - (x2 - x1) * 0.35;
      areaD += ` C ${cp1x} ${y1u}, ${cp2x} ${y2u}, ${x2} ${y2u}`;
    }
    for (let i = mixedRecords.length - 1; i >= 0; i--) {
      const curr = mixedRecords[i];
      const x2 = xFor(curr.timestamp), y2l = yFor(curr.lower);
      if (i === mixedRecords.length - 1) {
        areaD += ` L ${x2} ${y2l}`;
      } else {
        const next = mixedRecords[i + 1];
        const x1 = xFor(next.timestamp), y1l = yFor(next.lower);
        const cp1x = x1 + (x2 - x1) * 0.35, cp2x = x2 - (x2 - x1) * 0.35;
        areaD += ` C ${cp1x} ${y1l}, ${cp2x} ${y2l}, ${x2} ${y2l}`;
      }
    }
    areaD += ' Z';
    container.appendChild(createSVGElement('path', { d: areaD, fill: 'url(#grad-mixed)', stroke: 'none' }));

    container.appendChild(createSVGElement('path', {
      d: makeCurveD(mixedRecords, r => r.upper),
      fill: 'none', stroke: '#ef4444', 'stroke-width': 2.5
    }));
    container.appendChild(createSVGElement('path', {
      d: makeCurveD(mixedRecords, r => r.lower),
      fill: 'none', stroke: '#3b82f6', 'stroke-width': 2.5
    }));
  } else {
    const mainGradient = createSVGElement('linearGradient', { id: 'grad-main', gradientUnits: 'userSpaceOnUse', x1: 0, y1: yTop, x2: 0, y2: yBottom });
    mainGradient.appendChild(createSVGElement('stop', { offset: '0%', 'stop-color': '#ef4444' }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '50%', 'stop-color': '#64748b' }));
    mainGradient.appendChild(createSVGElement('stop', { offset: '100%', 'stop-color': '#3b82f6' }));
    defs.appendChild(mainGradient);

    container.appendChild(createSVGElement('path', {
      d: makeCurveD(records, r => r.value),
      fill: 'none', stroke: 'url(#grad-main)', 'stroke-width': 3,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));

    const zeroY = yFor(0);
    const positiveAreaD = makeAreaD(records, r => r.value, zeroY, v => v >= 0);
    const negativeAreaD = makeAreaD(records, r => r.value, zeroY, v => v < 0);
    if (positiveAreaD) {
      container.appendChild(createSVGElement('path', { d: positiveAreaD, fill: 'url(#grad-pos)', stroke: 'none', opacity: '0.25' }));
    }
    if (negativeAreaD) {
      container.appendChild(createSVGElement('path', { d: negativeAreaD, fill: 'url(#grad-neg)', stroke: 'none', opacity: '0.25' }));
    }
  }

  const crosshairGroup = createSVGElement('g', { class: 'crosshair', display: 'none' });
  const vLine = createSVGElement('line', {
    x1: 0, y1: PADDING.top, x2: 0, y2: height - PADDING.bottom,
    stroke: '#e2e8f0', 'stroke-width': 1, 'stroke-dasharray': '4 4'
  });
  const hLine = createSVGElement('line', {
    x1: PADDING.left, y1: 0, x2: width - PADDING.right, y2: 0,
    stroke: '#e2e8f0', 'stroke-width': 1, 'stroke-dasharray': '4 4'
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
        fill: colorForValue(v, 1),
        stroke: '#0f172a',
        'stroke-width': 2,
        class: 'chart-point'
      });
      circle.style.transition = 'r 0.2s ease';
      container.appendChild(circle);

      const anim = createSVGElement('circle', {
        cx: x, cy: y, r: 5, fill: colorForValue(v, 0.3), class: 'point-pulse'
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
      <div class="value">情绪值: ${r.value > 0 ? '+' : ''}${r.value}${mixedText}</div>
      ${medText}
      ${r.note ? `<div class="note">${r.note}</div>` : ''}
    `;
    tooltip.classList.add('visible');

    const tRect = tooltip.getBoundingClientRect();
    const wrapRect = container.parentElement.getBoundingClientRect();
    let left = x + 16;
    let top = y - 16;
    if (left + tRect.width > wrapRect.width) left = x - tRect.width - 16;
    if (top + tRect.height > wrapRect.height) top = wrapRect.height - tRect.height - 8;
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
    const t = minTime + ((x - PADDING.left) / chartW) * timeSpan;
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
    const t = minTime + ((x - PADDING.left) / chartW) * timeSpan;
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
