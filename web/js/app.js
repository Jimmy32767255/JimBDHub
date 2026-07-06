import { store } from './store.js';
import { renderChart } from './chart.js';
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
const chartSvg = document.getElementById('mood-chart');
const chartTooltip = document.getElementById('chart-tooltip');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');

let currentRange = 'week';

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

function drawChart() {
  const records = store.getRecordsInRange(currentRange);
  renderChart(records, chartSvg, chartTooltip);
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

  document.querySelectorAll('.range-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentRange = tab.dataset.range;
      drawChart();
    });
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
