import { store } from './store.js';
import { renderCombinedChart } from './chart.js';
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

function computeProjectedDoses(meds, startTs, endTs) {
  const doses = [];
  const now = Date.now();
  const projectionStart = Math.max(startTs, now);
  meds.forEach(med => {
    if (!med.schedule || med.schedule.length === 0) return;
    const startDay = new Date(projectionStart);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(endTs);
    endDay.setHours(23, 59, 59, 999);
    for (let d = startDay.getTime(); d <= endDay.getTime(); d += DAY_MS) {
      med.schedule.forEach(time => {
        const [h, min] = time.split(':').map(Number);
        const ts = d + h * HOUR_MS + min * 60 * 1000;
        if (ts >= projectionStart && ts <= endTs) {
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
        }
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

function drawChart() {
  const records = store.getRecordsInRange('all');
  const sleeps = store.getSleepsInRange('all');
  const events = store.getEventsInRange('all');
  let projectedDoses = [];
  if (showForwardCheckbox.checked) {
    const range = getChartTimeRange(records, sleeps, events);
    const forwardEnd = range.max + FORWARD_DAYS * DAY_MS;
    projectedDoses = computeProjectedDoses(store.data.meds, range.min, forwardEnd);
  }

  // 保存缩放前的视口中心比例，使缩放后相同时间点保持在视口中心
  const wrap = combinedChartSvg.parentElement;
  const oldScrollable = wrap.scrollWidth - wrap.clientWidth;
  // scrollLeft 实际范围是 [0, oldScrollable]
  const centerFraction = oldScrollable > 0
    ? (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth
    : 0.5;

  renderCombinedChart(records, sleeps, events, combinedChartSvg, combinedChartTooltip, combinedLegend, {
    showMood: showMoodCheckbox.checked,
    showEffect: showEffectCheckbox.checked,
    showSleep: showSleepCheckbox.checked,
    projectedDoses,
    pxPerHour: currentPxPerHour
  });

  // 恢复视口中心到相同比例位置
  const newScrollable = wrap.scrollWidth - wrap.clientWidth;
  if (newScrollable > 0) {
    wrap.scrollLeft = Math.max(0, Math.min(newScrollable,
      centerFraction * wrap.scrollWidth - wrap.clientWidth / 2));
  }
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
