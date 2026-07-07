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
const menuToggle = document.getElementById('menu-toggle');
const showMoodCheckbox = document.getElementById('show-mood');
const showEffectCheckbox = document.getElementById('show-effect');
const showSleepCheckbox = document.getElementById('show-sleep');
const showForwardCheckbox = document.getElementById('show-forward');

const BASE_PX_PER_HOUR = 12;
let currentPxPerHour = BASE_PX_PER_HOUR;
const ZOOM_FACTOR = 1.4;
const FORWARD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SHOW_FORWARD_KEY = 'jimbdhub_show_forward';

function setActiveView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('view-active', key === name);
  });
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === name);
  });
  pageTitle.textContent = t('page.' + name);
  sidebar.classList.remove('open');
  if (name === 'overview') {
    setTimeout(() => drawChart(), 50);
  }
}

function resetZoom() {
  currentPxPerHour = BASE_PX_PER_HOUR;
}

function zoomIn() {
  currentPxPerHour *= ZOOM_FACTOR;
}

function zoomOut() {
  currentPxPerHour /= ZOOM_FACTOR;
  if (currentPxPerHour < BASE_PX_PER_HOUR) currentPxPerHour = BASE_PX_PER_HOUR;
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
  renderCombinedChart(records, sleeps, events, combinedChartSvg, combinedChartTooltip, combinedLegend, {
    showMood: showMoodCheckbox.checked,
    showEffect: showEffectCheckbox.checked,
    showSleep: showSleepCheckbox.checked,
    projectedDoses,
    pxPerHour: currentPxPerHour
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      setActiveView(link.dataset.view);
    });
  });

  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  document.getElementById('zoom-in')?.addEventListener('click', () => {
    zoomIn();
    drawChart();
  });
  document.getElementById('zoom-out')?.addEventListener('click', () => {
    zoomOut();
    drawChart();
  });
  document.getElementById('zoom-reset')?.addEventListener('click', () => {
    resetZoom();
    drawChart();
  });

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
