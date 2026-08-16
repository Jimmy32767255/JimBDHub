import { store, getMaxLoadedRecords } from './store.js';
import { renderCombinedChart, MAX_MOOD_RANGE_MS, getEffectiveDoses, effectEndTime, EFFECT_VISIBLE_THRESHOLD } from './chart.js';
import { initMeds, predictDepletion } from './meds.js';
import { initRecords } from './records.js';
import { initSettings } from './settings.js';
import { initI18n, t, subscribe, updateDOM } from './i18n.js';
import { initTheme, getTheme, setTheme, subscribe as subscribeTheme, DEFAULT_MED_COLORS } from './theme.js';
import { initSync } from './sync.js';
import { initAutoBackup } from './autobackup.js';
import { initAbout } from './about.js';
import { initAiSummary } from './aiSummary.js';
import { platform } from './platform.js';
import { showAlert } from './dialog.js';

const views = {
  overview: document.getElementById('overview-view'),
  meds: document.getElementById('meds-view'),
  records: document.getElementById('records-view'),
  'ai-summary': document.getElementById('ai-summary-view'),
  settings: document.getElementById('settings-view'),
  about: document.getElementById('about-view')
};
const pageTitle = document.getElementById('page-title');
const combinedChartSvg = document.getElementById('combined-chart');
const combinedChartTooltip = document.getElementById('combined-chart-tooltip');
const combinedLegend = document.getElementById('combined-legend');
const chartDisclaimer = document.getElementById('chart-disclaimer');
const sidebar = document.getElementById('sidebar');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const menuToggle = document.getElementById('menu-toggle');

const SIDEBAR_COLLAPSED_KEY = 'jimbdhub_sidebar_collapsed';
const showMoodCheckbox = document.getElementById('show-mood');
const showEffectCheckbox = document.getElementById('show-effect');
const showSleepCheckbox = document.getElementById('show-sleep');
const showForwardCheckbox = document.getElementById('show-forward');
const scrollLockCheckbox = document.getElementById('chart-scroll-lock');

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
// 药效/显示选项变化后，重新以"现在"为锚点居中（图表宽度变化会导致原居中位置偏移）
let _centerOnNowNextDraw = false;

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
  // 通知各模块视图已切换（bottom-nav 点击走 setActiveView 不改变 hash，
  // 故需显式派发事件，供记录页等在切换时重置状态）
  window.dispatchEvent(new CustomEvent('viewchange', { detail: { name } }));
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
  const allDoses = getEffectiveDoses(records, { maxTime: pageEnd });
  const affectingDoses = allDoses.filter(d => d.timestamp <= pageEnd && effectEndTime(d, EFFECT_VISIBLE_THRESHOLD) >= pageStart);

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

  // 每种药物的首次实际摄入时间，用于确定预测起点
  const firstIntakeByMed = {};
  records.forEach(r => {
    (r.doses || []).forEach(d => {
      const medId = d.medicationId || d.name;
      const ts = d.timestamp || r.timestamp;
      if (!ts) return;
      if (!firstIntakeByMed[medId] || ts < firstIntakeByMed[medId]) {
        firstIntakeByMed[medId] = ts;
      }
    });
  });

  meds.forEach(med => {
    if (!med.schedule || med.schedule.length === 0) return;
    const medId = med.id || med.name;
    const firstIntake = firstIntakeByMed[medId];
    const projectionStart = firstIntake !== undefined ? Math.max(firstIntake, now) : now;
    if (projectionStart > endTs) return;
    const startDay = new Date(projectionStart);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(endTs);
    endDay.setHours(23, 59, 59, 999);
    for (let d = startDay.getTime(); d <= endDay.getTime(); d += DAY_MS) {
      med.schedule.forEach(time => {
        const [h, min] = time.split(':').map(Number);
        const ts = d + h * HOUR_MS + min * 60 * 1000;
        if (ts < projectionStart || ts > endTs) return;
        // 固定服药时间优先于手动记录：预测剂量按计划始终生成，
        // 不再因附近已有的手动实际摄入而跳过（避免手动记录阻断未来药效预测导致曲线归零）
        doses.push({
          medicationId: med.id,
          name: med.name,
          amount: med.doseAmount ?? 1,
          unit: med.unit,
          dosePerTablet: med.dosePerTablet ?? 1,
          doseMassUnit: med.doseMassUnit ?? 'mg',
          timestamp: ts,
          onsetMinHours: med.onsetMinHours ?? med.onsetHours ?? 1,
          onsetMaxHours: med.onsetMaxHours ?? med.onsetHours ?? 1,
          peakMinHours: med.peakMinHours ?? med.peakHours ?? 2,
          peakMaxHours: med.peakMaxHours ?? med.peakHours ?? 2,
          halfLifeMinHours: med.halfLifeMinHours ?? med.halfLifeHours ?? 12,
          halfLifeMaxHours: med.halfLifeMaxHours ?? med.halfLifeHours ?? 12,
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

function updateChartDisclaimer() {
  if (!chartDisclaimer) return;
  const { connectMoodDots } = getTheme();
  const moodKey = connectMoodDots !== false ? 'chart.disclaimer.connected' : 'chart.disclaimer.dotsOnly';
  chartDisclaimer.textContent = t(moodKey) + ' ' + t('chart.disclaimer.effect');
}

function computeDepletionData() {
  return store.data.meds
    .map((med, idx) => {
      const depletionTs = predictDepletion(med);
      if (!depletionTs || depletionTs <= 0) return null;
      return {
        medName: med.name,
        depletionTime: depletionTs,
        medIndex: idx,
        color: med.color || DEFAULT_MED_COLORS[idx % DEFAULT_MED_COLORS.length]
      };
    })
    .filter(Boolean);
}

function drawChart() {
  const records = store.getRecordsInRange('all');
  const sleeps = store.getSleepsInRange('all');
  const events = store.getEventsInRange('all');

  // 分页基于全量数据计算并校正当前页（默认打开最新一页）。
  // 不再全局截断记录：每页独立加载，翻到哪页只处理哪页的数据，旧页面也能正常访问
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

  // 单页记录数上限（每页独立）：仅当该页数据过多时截取该页最近部分，不影响其他页
  const chartLimitHint = document.getElementById('chart-limit-hint');
  const maxLoaded = getMaxLoadedRecords();
  const pageRecordsLimited = pageData.records.length > maxLoaded;
  if (pageRecordsLimited) {
    pageData.records = pageData.records.slice(-maxLoaded);
  }
  if (chartLimitHint) {
    chartLimitHint.hidden = !pageRecordsLimited;
    if (pageRecordsLimited) chartLimitHint.textContent = t('chart.limitHint', { count: maxLoaded });
  }

  const wrap = combinedChartSvg.parentElement;

  // 首次绘表或显示选项变化后：以"现在"为锚点居中（不恢复上次浏览位置）
  let centerFraction;
  if (!_viewRestored || _centerOnNowNextDraw) {
    _viewRestored = true;
    _centerOnNowNextDraw = false;
    // 先以 0.5 绘制一帧以得到实际 scrollWidth，再按"现在"重新居中
    // （见下方 scrollLeft 计算分支：以 now 时间计算）
    centerFraction = null;
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

  // 最新页时，将显示范围右端扩展到"现在 + 半视口宽度对应时长"，
  // 保证"现在"右侧有足够空间可以真正居中（每次绘制保持一致宽度）
  let displayMax = pageData.pageEnd;
  if (currentPage === totalPages - 1) {
    const halfViewMs = (wrap.clientWidth / 2) / Math.max(1, currentPxPerHour) * HOUR_MS;
    const now = Date.now();
    displayMax = Math.max(displayMax, now + halfViewMs);
  }

  renderCombinedChart(pageData.records, pageData.sleeps, pageData.events, combinedChartSvg, combinedChartTooltip, combinedLegend, {
    showMood: showMoodCheckbox.checked,
    showEffect: showEffectCheckbox.checked,
    showSleep: showSleepCheckbox.checked,
    projectedDoses,
    pxPerHour: currentPxPerHour,
    displayRange: { min: pageData.pageStart, max: displayMax, padStart: pageData.padStart, padEnd: pageData.padEnd },
    boundaryRecords: pageData.boundaryRecords,
    doses: pageData.doses,
    depletionData: computeDepletionData()
  });

  // 恢复视口中心：首次绘制以"现在"时间居中；其余按比例位置
  const newScrollable = wrap.scrollWidth - wrap.clientWidth;
  if (newScrollable > 0) {
    if (centerFraction === null) {
      // 首次：将"现在"对应的图表 x 位置置于视口中心
      // 与 chart.js 中 xFor(ts) = PADDING.left + ((ts - displayMinTime) / HOUR_MS) * pxPerHour 保持一致
      const PADDING_LEFT = 44;
      const PAD_HOURS = 6;
      const displayMinTime = pageData.pageStart - (pageData.padStart ? PAD_HOURS * HOUR_MS : 0);
      const nowX = PADDING_LEFT + ((Date.now() - displayMinTime) / HOUR_MS) * currentPxPerHour;
      wrap.scrollLeft = Math.max(0, Math.min(newScrollable, nowX - wrap.clientWidth / 2));
    } else {
      wrap.scrollLeft = Math.max(0, Math.min(newScrollable,
        centerFraction * wrap.scrollWidth - wrap.clientWidth / 2));
    }
  }

  // 保存当前视图位置与页码
  saveViewPosition();
  savePage(currentPage);
  updatePageControls();
  updateChartDisclaimer();
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

  // 复选框控制图表显示：药效等选项会影响图表宽度，切换后重新以"现在"居中，
  // 避免因宽度变化导致"现在"位置偏移
  const centerNowOnChange = () => {
    _centerOnNowNextDraw = true;
    drawChart();
  };
  showMoodCheckbox.addEventListener('change', centerNowOnChange);
  showEffectCheckbox.addEventListener('change', centerNowOnChange);
  showSleepCheckbox.addEventListener('change', centerNowOnChange);
  showForwardCheckbox.addEventListener('change', () => {
    saveShowForward(showForwardCheckbox.checked);
    centerNowOnChange();
  });
  if (scrollLockCheckbox) {
    scrollLockCheckbox.addEventListener('change', () => {
      setTheme({ scrollLock: scrollLockCheckbox.checked }, 'DisplayChange');
    });
  }
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

function runAutoMedLog() {
  if (!getTheme().autoMedLog) return;
  const theme = getTheme();
  const now = Date.now();
  const lastCheck = theme.autoMedLogLastCheck || 0;
  const WINDOW_MS = 5 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const startTs = lastCheck > 0 ? lastCheck : now - DAY_MS;

  let loggedAny = false;
  store.data.meds.forEach(med => {
    if (!Array.isArray(med.schedule) || med.schedule.length === 0) return;

    med.schedule.forEach(timeStr => {
      const [h, min] = timeStr.split(':').map(Number);
      // 按该服药时间点所在时段取对应剂量（早/午/晚/睡前）
      const periodKey = getPeriodKey(h);
      const doseAmounts = getMedDoseAmounts(med);
      const doseAmount = doseAmounts[periodKey] > 0 ? doseAmounts[periodKey] : (Number(med.doseAmount) || 1);
      if (doseAmount <= 0) return;

      const startDay = new Date(startTs);
      startDay.setHours(0, 0, 0, 0);
      const endDay = new Date(now);
      endDay.setHours(0, 0, 0, 0);
      const daysDiff = Math.round((endDay - startDay) / DAY_MS);

      for (let d = 0; d <= daysDiff; d++) {
        const day = new Date(startDay);
        day.setDate(day.getDate() + d);
        const scheduledTs = new Date(day).setHours(h, min, 0, 0);
        if (scheduledTs > now) continue;
        if (scheduledTs < startTs - WINDOW_MS) continue;

        const existing = store.data.logs.some(l =>
          l.medicationId === med.id &&
          Math.abs(l.timestamp - scheduledTs) < WINDOW_MS
        );
        if (existing) continue;

        store.changeMedStock(med.id, -doseAmount, t('meds.autoLog.note'), scheduledTs);
        loggedAny = true;
      }
    });
  });

  // 内部计时标记，不触发自动备份
  setTheme({ autoMedLogLastCheck: now }, 'Internal');
}

/** 根据小时返回时段键：早/午/晚/睡前 */
function getPeriodKey(hour) {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'bedtime';
}

/** 读取药品四时段剂量，兼容旧数据（无 doseAmounts 时用 doseAmount 填充） */
function getMedDoseAmounts(med) {
  const fallback = Number(med.doseAmount) > 0 ? Number(med.doseAmount) : 1;
  const da = med.doseAmounts && typeof med.doseAmounts === 'object' ? med.doseAmounts : {};
  // 仅当字段缺失/非法时回退；0 表示该时段不服药，保持 0
  const read = v => (v === undefined || v === null || !Number.isFinite(Number(v)) ? fallback : Number(v));
  return {
    morning: read(da.morning),
    afternoon: read(da.afternoon),
    evening: read(da.evening),
    bedtime: read(da.bedtime)
  };
}

function scheduleAutoMedLog() {
  runAutoMedLog();
  setInterval(runAutoMedLog, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) runAutoMedLog();
  });
}

async function init() {
  await initI18n();
  initTheme();

  const needs = store.checkNeedsUpgrade();
  if (needs) {
    const blockingEl = document.getElementById('upgrade-blocking');
    const backupBtn = document.getElementById('upgrade-backup-btn');
    if (blockingEl) blockingEl.hidden = false;

    const performUpgrade = async () => {
      try {
        store.init();
        if (blockingEl) blockingEl.hidden = true;
        await showAlert(t('app.upgrade.success'));
        continueInit();
      } catch (err) {
        await showAlert(t('app.upgrade.failed', { message: err.message }));
        store.clearAll();
        if (blockingEl) blockingEl.hidden = true;
        await showAlert(t('app.upgrade.cleared'));
        continueInit();
      }
    };

    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        try {
          const data = store.buildBackup();
          const json = JSON.stringify(data, null, 2);
          await platform.saveBackup(json, `pre_upgrade_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
          await showAlert(t('app.upgrade.backupSuccess'));
          await performUpgrade();
        } catch (err) {
          await showAlert(t('app.upgrade.backupFailed', { message: err.message }));
        }
      });
    }

    return;
  }

  store.init();
  continueInit();
}

function continueInit() {
  showForwardCheckbox.checked = loadShowForward();
  // 每次启动默认打开最新一页（drawChart 中 currentPage === null 时取最后一页），
  // 不再恢复上次浏览的页码，配合首次绘制以"现在"居中
  currentPage = null;

  function updateChartScrollLock(theme) {
    document.querySelectorAll('.chart-wrap').forEach(wrap => {
      wrap.classList.toggle('scroll-lock', theme.scrollLock === true);
    });
    if (scrollLockCheckbox) {
      scrollLockCheckbox.checked = theme.scrollLock === true;
    }
  }
  subscribeTheme(updateChartScrollLock);
  updateChartScrollLock(getTheme());

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
  initAbout();
  initSync();
  initAutoBackup();
  initAiSummary();
  initResize();
  scheduleAutoMedLog();
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
    updateChartDisclaimer();
    pageTitle.textContent = t('page.' + (location.hash.slice(1) || 'overview'));
    if (views.overview.classList.contains('view-active')) {
      drawChart();
    }
  });
  subscribeTheme(() => {
    updateChartDisclaimer();
    if (views.overview.classList.contains('view-active')) {
      drawChart();
    }
  });
}

init();
