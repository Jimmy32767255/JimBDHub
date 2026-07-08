import { store } from './store.js';
import { renderCombinedChart, MAX_MOOD_RANGE_MS, extractDoses, effectEndTime } from './chart.js';
import { initMeds } from './meds.js';
import { initRecords } from './records.js';
import { initSettings } from './settings.js';
import { initI18n, t, subscribe, updateDOM } from './i18n.js';
import { initTheme, subscribe as subscribeTheme } from './theme.js';

const views = {
  overview: document.getElementById('overview-view'),
  meds: document.getElementById('meds-view'),
  records: document.getElementById('records-view'),
  settings: document.getElementById('settings-view')
};
const pageTitle = document.getElementById('page-title');
const combinedChartSvg = document.getElementById('combined-chart');
const combinedChartTooltip = document.getElementById('combined-chart-tooltip');
const combinedLegend = document.getElementById('combined-legend');
const sidebar = document.getElementById('sidebar');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const menuToggle = document.getElementById('menu-toggle');

const SIDEBAR_COLLAPSED_KEY = 'jimbdhub_sidebar_collapsed';
const showMoodCheckbox = document.getElementById('show-mood');
const showEffectCheckbox = document.getElementById('show-effect');
const showSleepCheckbox = document.getElementById('show-sleep');
const showForwardCheckbox = document.getElementById('show-forward');

const BASE_PX_PER_HOUR = 12;
const MIN_PX_PER_HOUR = 3;
const MAX_PX_PER_HOUR = 60;
let currentPxPerHour = BASE_PX_PER_HOUR;
const ZOOM_FACTOR = 1.4;
const FORWARD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SHOW_FORWARD_KEY = 'jimbdhub_show_forward';
const PAGE_KEY = 'jimbdhub_chart_page';
const PAGE_SIZE_MS = MAX_MOOD_RANGE_MS;
let currentPage = null;
let totalPages = 1;
let _resetScrollOnNextDraw = false;

function loadSidebarCollapsed() {
  try {
    const val = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
  } catch { return null; }
}

function saveSidebarCollapsed(collapsed) {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'true' : 'false'); } catch {}
}

function applySidebarCollapsed(collapsed) {
  if (window.innerWidth > 767) {
    sidebar.classList.toggle('collapsed', collapsed);
  }
}

function toggleSidebar() {
  if (window.innerWidth <= 767) {
    sidebar.classList.toggle('open');
  } else {
    const collapsed = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', collapsed);
    saveSidebarCollapsed(collapsed);
  }
}

function setActiveView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('view-active', key === name);
  });
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === name);
  });
  pageTitle.textContent = t('page.' + name);
  if (window.innerWidth <= 767) {
    sidebar.classList.remove('open');
  }
  if (name === 'overview') {
    setTimeout(() => drawChart(), 50);
  }
}

function resetZoom() {
  currentPxPerHour = BASE_PX_PER_HOUR;
  updateZoomDisplay();
}

function zoomIn() {
  currentPxPerHour = Math.min(MAX_PX_PER_HOUR, currentPxPerHour * ZOOM_FACTOR);
  updateZoomDisplay();
}

function zoomOut() {
  currentPxPerHour = Math.max(MIN_PX_PER_HOUR, currentPxPerHour / ZOOM_FACTOR);
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const infoEl = document.getElementById('zoom-info');
  const rangeEl = document.getElementById('zoom-range');
  if (infoEl) {
    infoEl.textContent = `${Math.round(currentPxPerHour)}px/hr`;
  }
  if (rangeEl) {
    const minPct = Math.round((MIN_PX_PER_HOUR / BASE_PX_PER_HOUR) * 100);
    const curPct = Math.round((currentPxPerHour / BASE_PX_PER_HOUR) * 100);
    const maxPct = Math.round((MAX_PX_PER_HOUR / BASE_PX_PER_HOUR) * 100);
    rangeEl.textContent = `(${minPct}%/${curPct}%/${maxPct}%)`;
  }
}

const VIEW_KEY = 'jimbdhub_chart_view';

function saveViewPosition() {
  const wrap = combinedChartSvg.parentElement;
  try {
    const centerFraction = wrap.scrollWidth > 0
      ? (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth
      : 0.5;
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      pxPerHour: Math.round(currentPxPerHour * 100) / 100,
      centerFraction
    }));
  } catch {}
}

function loadViewPosition() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadShowForward() {
  try {
    return localStorage.getItem(SHOW_FORWARD_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveShowForward(value) {
  try {
    localStorage.setItem(SHOW_FORWARD_KEY, value ? 'true' : 'false');
  } catch {}
}

function loadPage() {
  try {
    const raw = localStorage.getItem(PAGE_KEY);
    if (raw === null) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch { return null; }
}

function savePage(page) {
  try { localStorage.setItem(PAGE_KEY, String(page)); } catch {}
}

function getPaginationBounds(records, sleeps, events) {
  const range = getChartTimeRange(records, sleeps, events);
  const totalSpan = range.max - range.min;
  const pages = Math.max(1, Math.ceil(totalSpan / PAGE_SIZE_MS));
  return { ...range, totalPages: pages };
}

function filterDataForPage(records, sleeps, events, page, globalRange) {
  const pageStart = globalRange.min + page * PAGE_SIZE_MS;
  const pageEnd = Math.min(globalRange.max, pageStart + PAGE_SIZE_MS);

  const pageRecords = records.filter(r => r.timestamp >= pageStart && r.timestamp <= pageEnd);

  // Boundary records from adjacent pages to keep the curve slope continuous
  const prevRecord = records
    .filter(r => r.timestamp < pageStart)
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  const nextRecord = records
    .filter(r => r.timestamp > pageEnd)
    .sort((a, b) => a.timestamp - b.timestamp)[0] || null;

  // Include doses whose pharmacological effect reaches into this page
  const allDoses = extractDoses(records);
  const affectingDoses = allDoses.filter(d => d.timestamp <= pageEnd && effectEndTime(d, 0.01) >= pageStart);

  return {
    records: pageRecords,
    boundaryRecords: [prevRecord, nextRecord].filter(Boolean),
    sleeps: sleeps.filter(s => s.endTime >= pageStart && s.startTime <= pageEnd),
    events: events.filter(e => e.timestamp >= pageStart && e.timestamp <= pageEnd),
    doses: affectingDoses,
    pageStart,
    pageEnd,
    padStart: page === 0,
    padEnd: page >= globalRange.totalPages - 1
  };
}

function updatePageControls() {
  const controls = document.getElementById('page-controls');
  const prevBtn = document.getElementById('chart-prev-page');
  const nextBtn = document.getElementById('chart-next-page');
  const info = document.getElementById('page-info');
  if (!controls || !prevBtn || !nextBtn || !info) return;

  const visible = totalPages > 1;
  controls.classList.toggle('hidden', !visible);
  prevBtn.disabled = currentPage <= 0;
  nextBtn.disabled = currentPage >= totalPages - 1;
  info.textContent = t('chart.pageInfo').replace('{current}', String(currentPage + 1)).replace('{total}', String(totalPages));
}

function goToPage(delta) {
  const newPage = Math.max(0, Math.min(totalPages - 1, currentPage + delta));
  if (newPage === currentPage) return;
  currentPage = newPage;
  savePage(currentPage);
  _resetScrollOnNextDraw = true;
  drawChart();
}

function computeProjectedDoses(meds, records, endTs) {
  const doses = [];
  const now = Date.now();

  // 每种药物的实际摄入时间集合，用于去重和确定起始点
  const firstIntakeByMed = {};
  const actualDoseTimesByMed = {};
  records.forEach(r => {
    (r.doses || []).forEach(d => {
      const medId = d.medicationId || d.name;
      const ts = d.timestamp || r.timestamp;
      if (!ts) return;
      if (!firstIntakeByMed[medId] || ts < firstIntakeByMed[medId]) {
        firstIntakeByMed[medId] = ts;
      }
      if (!actualDoseTimesByMed[medId]) actualDoseTimesByMed[medId] = [];
      actualDoseTimesByMed[medId].push(ts);
    });
  });

  meds.forEach(med => {
    if (!med.schedule || med.schedule.length === 0) return;
    const medId = med.id || med.name;
    const firstIntake = firstIntakeByMed[medId];
    const projectionStart = firstIntake !== undefined ? Math.max(firstIntake, now) : now;
    if (projectionStart > endTs) return;
    const actualTimes = actualDoseTimesByMed[medId] || [];
    const startDay = new Date(projectionStart);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(endTs);
    endDay.setHours(23, 59, 59, 999);
    for (let d = startDay.getTime(); d <= endDay.getTime(); d += DAY_MS) {
      med.schedule.forEach(time => {
        const [h, min] = time.split(':').map(Number);
        const ts = d + h * HOUR_MS + min * 60 * 1000;
        if (ts < projectionStart || ts > endTs) return;
        // 如果该药物在预计时间前后已有实际摄入记录，则不再追加预测剂量，避免重叠
        const hasNearbyActual = actualTimes.some(actualTs => Math.abs(actualTs - ts) <= HOUR_MS);
        if (hasNearbyActual) return;
        doses.push({
          medicationId: med.id,
          name: med.name,
          amount: 1,
          unit: med.unit,
          timestamp: ts,
          onsetHours: med.onsetHours ?? 1,
          peakHours: med.peakHours ?? 2,
          halfLifeHours: med.halfLifeHours ?? 12,
          projected: true
        });
      });
    }
  });
  return doses;
}

function getChartTimeRange(records, sleeps, events) {
  const doseTimestamps = records.flatMap(r => (r.doses || []).map(d => d.timestamp || r.timestamp));
  const timestamps = [
    ...records.map(r => r.timestamp),
    ...sleeps.flatMap(s => [s.startTime, s.endTime]),
    ...events.map(e => e.timestamp),
    ...doseTimestamps
  ].filter(Boolean);
  const now = Date.now();
  if (timestamps.length === 0) {
    return { min: now - DAY_MS, max: now };
  }
  return { min: Math.min(...timestamps), max: Math.max(...timestamps, now) };
}

let _viewRestored = false;

function drawChart() {
  const records = store.getRecordsInRange('all');
  const sleeps = store.getSleepsInRange('all');
  const events = store.getEventsInRange('all');

  // 计算分页边界并校正当前页（默认打开最新一页）
  const globalRange = getPaginationBounds(records, sleeps, events);
  totalPages = globalRange.totalPages;
  if (currentPage === null) {
    currentPage = totalPages - 1;
  }
  currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));

  // 仅最新页显示未来预测
  let projectedDoses = [];
  if (showForwardCheckbox.checked && currentPage === totalPages - 1) {
    const forwardEnd = globalRange.max + FORWARD_DAYS * DAY_MS;
    projectedDoses = computeProjectedDoses(store.data.meds, records, forwardEnd);
  }

  // 过滤当前页数据
  const pageData = filterDataForPage(records, sleeps, events, currentPage, globalRange);

  const wrap = combinedChartSvg.parentElement;

  // 首次绘表：尝试恢复保存的视图位置
  let centerFraction;
  if (!_viewRestored) {
    const saved = loadViewPosition();
    if (saved) {
      currentPxPerHour = saved.pxPerHour;
      updateZoomDisplay();
      centerFraction = saved.centerFraction;
    } else {
      centerFraction = 0.5;
    }
    _viewRestored = true;
  } else if (_resetScrollOnNextDraw) {
    centerFraction = 0.5;
    _resetScrollOnNextDraw = false;
  } else {
    // 非首次：从当前滚动位置计算，使缩放后视口中心不变
    const oldScrollable = wrap.scrollWidth - wrap.clientWidth;
    centerFraction = oldScrollable > 0
      ? (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth
      : 0.5;
  }

  renderCombinedChart(pageData.records, pageData.sleeps, pageData.events, combinedChartSvg, combinedChartTooltip, combinedLegend, {
    showMood: showMoodCheckbox.checked,
    showEffect: showEffectCheckbox.checked,
    showSleep: showSleepCheckbox.checked,
    projectedDoses,
    pxPerHour: currentPxPerHour,
    displayRange: { min: pageData.pageStart, max: pageData.pageEnd, padStart: pageData.padStart, padEnd: pageData.padEnd },
    boundaryRecords: pageData.boundaryRecords,
    doses: pageData.doses
  });

  // 恢复视口中心到相同比例位置
  const newScrollable = wrap.scrollWidth - wrap.clientWidth;
  if (newScrollable > 0) {
    wrap.scrollLeft = Math.max(0, Math.min(newScrollable,
      centerFraction * wrap.scrollWidth - wrap.clientWidth / 2));
  }

  // 保存当前视图位置与页码
  saveViewPosition();
  savePage(currentPage);
  updatePageControls();
}

function setupLongPress(el, action) {
  if (!el) return;
  let timer = null;
  const start = (e) => {
    e.preventDefault();
    action();
    timer = setInterval(action, 120);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  el.addEventListener('mousedown', start);
  el.addEventListener('mouseup', stop);
  el.addEventListener('mouseleave', stop);
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', stop);
  el.addEventListener('touchcancel', stop);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      setActiveView(link.dataset.view);
    });
  });

  menuToggle.addEventListener('click', toggleSidebar);

  sidebarCloseBtn.addEventListener('click', toggleSidebar);

  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    resetZoom();
    drawChart();
  });

  setupLongPress(document.getElementById('zoom-in'), () => { zoomIn(); drawChart(); });
  setupLongPress(document.getElementById('zoom-out'), () => { zoomOut(); drawChart(); });

  const prevPageBtn = document.getElementById('chart-prev-page');
  const nextPageBtn = document.getElementById('chart-next-page');
  if (prevPageBtn) {
    setupLongPress(prevPageBtn, () => goToPage(-1));
  }
  if (nextPageBtn) {
    setupLongPress(nextPageBtn, () => goToPage(1));
  }

  updateZoomDisplay();

  // 复选框控制图表显示
  showMoodCheckbox.addEventListener('change', drawChart);
  showEffectCheckbox.addEventListener('change', drawChart);
  showSleepCheckbox.addEventListener('change', drawChart);
  showForwardCheckbox.addEventListener('change', () => {
    saveShowForward(showForwardCheckbox.checked);
    drawChart();
  });
}

function initRouting() {
  const hash = location.hash.slice(1);
  if (views[hash]) {
    setActiveView(hash);
  } else {
    setActiveView('overview');
  }
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (views[h]) setActiveView(h);
  });
}

function initResize() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (views.overview.classList.contains('view-active')) {
        drawChart();
      }
    }, 150);
  });
}

async function init() {
  await initI18n();
  initTheme();
  store.init();
  showForwardCheckbox.checked = loadShowForward();
  currentPage = loadPage();

  // 恢复侧边栏状态
  const savedCollapsed = loadSidebarCollapsed();
  if (savedCollapsed !== null) {
    applySidebarCollapsed(savedCollapsed);
  }

  initNavigation();
  initRouting();
  initMeds();
  initRecords();
  initSettings();
  initResize();
  drawChart();

  // 滚动时保存视图位置（防抖）
  const chartWrap = document.getElementById('combined-chart-wrap');
  if (chartWrap) {
    let scrollTimer;
    chartWrap.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(saveViewPosition, 300);
    });
  }

  // 页面关闭/刷新前保存
  window.addEventListener('beforeunload', saveViewPosition);

  store.subscribe(() => {
    if (views.overview.classList.contains('view-active')) {
      drawChart();
    }
  });
  subscribe(() => {
    updateDOM();
    pageTitle.textContent = t('page.' + (location.hash.slice(1) || 'overview'));
    if (views.overview.classList.contains('view-active')) {
      drawChart();
    }
  });
  subscribeTheme(() => {
    if (views.overview.classList.contains('view-active')) {
      drawChart();
    }
  });
}

init();
