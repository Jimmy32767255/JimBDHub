import { store } from './store.js';
import { platform } from './platform.js';
import { t, subscribe } from './i18n.js';
import { showAlert } from './dialog.js';

const modal = document.getElementById('mdexport-modal');
const countInput = document.getElementById('mdexport-count');
const totalHintEl = document.getElementById('mdexport-total');
const cancelBtn = document.getElementById('mdexport-cancel');
const confirmBtn = document.getElementById('mdexport-confirm');

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mdFileName() {
  const d = new Date();
  return `jimbdhub_export_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
}

// 转义 Markdown 表格单元格内容：竖线转义、换行转为 <br>
function escapeCell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function countStats() {
  return {
    mood: store.data.records.filter(r => r.type === 'mood').length,
    medication: store.data.records.filter(r => r.type === 'medication').length,
    sleep: store.data.sleeps.length,
    event: store.data.events.length
  };
}

// 将情绪/用药/睡眠/事件合并为按时间排序的时间线条目
function buildTimelineEntries() {
  const entries = [];
  store.data.records.forEach(r => {
    if (r.type === 'mood') {
      let type = t('mdexport.mood', { v: signed(r.value) });
      if (r.mixed) type += t('mdexport.mixed', { v: r.mixedValue });
      entries.push({ ts: r.timestamp, type, detail: r.note || '' });
    } else if (r.type === 'medication') {
      const doses = (r.doses || [])
        .map(d => `${d.name} ${d.amount}${d.unit || ''}`)
        .filter(Boolean)
        .join(', ');
      entries.push({ ts: r.timestamp, type: t('mdexport.medication'), detail: [doses, r.note].filter(Boolean).join('; ') });
    }
  });
  store.data.sleeps.forEach(s => {
    const hours = ((s.endTime - s.startTime) / 3600000).toFixed(1);
    let type = t('mdexport.sleep', { h: hours });
    if (s.quality) type += t('mdexport.quality', { q: s.quality });
    const ints = (s.interruptions || []).length;
    if (ints) type += t('mdexport.interruptions', { n: ints });
    entries.push({ ts: s.startTime, type, detail: s.note || '' });
  });
  store.data.events.forEach(ev => {
    entries.push({ ts: ev.timestamp, type: t('mdexport.event'), detail: [ev.title, ev.note].filter(Boolean).join('; ') });
  });
  return entries;
}

// 用药历史表示一段服药时间段：起点为 entry.timestamp，
// 终点为同一种药的下一段历史起点；最后一段未结束则视为开放区间（至今）
function buildMedHistoryRows() {
  const byMed = {};
  store.data.medHistory.forEach(h => {
    const key = h.medicationId || h.name;
    if (!byMed[key]) byMed[key] = [];
    byMed[key].push(h);
  });
  const rows = [];
  Object.values(byMed).forEach(entries => {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    entries.forEach((h, idx) => {
      rows.push({ h, endTime: entries[idx + 1] ? entries[idx + 1].timestamp : null });
    });
  });
  return rows.sort((a, b) => a.h.timestamp - b.h.timestamp);
}

function buildMarkdown(count) {
  const meds = store.data.meds;
  const medHistoryRows = buildMedHistoryRows();
  const entries = buildTimelineEntries().sort((a, b) => a.ts - b.ts);
  const selected = count > 0 ? entries.slice(-count) : entries;

  const lines = [];
  lines.push(`# ${t('mdexport.heading')}`);
  lines.push('');
  lines.push(`> ${t('mdexport.exportedAt')}：${formatDateTime(Date.now())}`);
  lines.push(`> ${t('mdexport.moodScale')}`);
  lines.push('');

  if (meds.length) {
    lines.push(`## ${t('mdexport.section.meds', { n: meds.length })}`);
    lines.push(`| ${t('mdexport.col.med')} | ${t('mdexport.col.dose')} | ${t('mdexport.col.unit')} |`);
    lines.push('|---|---|---|');
    meds.forEach(m => lines.push(`| ${escapeCell(m.name)} | ${m.doseAmount} | ${escapeCell(m.unit || '')} |`));
    lines.push('');
  }

  if (medHistoryRows.length) {
    lines.push(`## ${t('mdexport.section.medHistory', { n: medHistoryRows.length })}`);
    lines.push(`| ${t('mdexport.col.time')} | ${t('mdexport.col.med')} | ${t('mdexport.col.dose')} |`);
    lines.push('|---|---|---|');
    medHistoryRows.forEach(({ h, endTime }) => {
      const timeText = endTime
        ? `${formatDateTime(h.timestamp)} ~ ${formatDateTime(endTime)}`
        : `${formatDateTime(h.timestamp)} ~ ${t('mdexport.present')}`;
      lines.push(`| ${timeText} | ${escapeCell(h.name)} | ${h.amount}${escapeCell(h.unit || '')} |`);
    });
    lines.push('');
  }

  lines.push(`## ${t('mdexport.section.records', { n: selected.length })}`);
  if (!selected.length) {
    lines.push(t('mdexport.empty'));
  } else {
    lines.push(`| ${t('mdexport.col.time')} | ${t('mdexport.col.type')} | ${t('mdexport.col.detail')} |`);
    lines.push('|---|---|---|');
    selected.forEach(e => lines.push(`| ${formatDateTime(e.ts)} | ${escapeCell(e.type)} | ${escapeCell(e.detail)} |`));
  }
  lines.push('');

  return lines.join('\n');
}

function getTotal(stats = countStats()) {
  return stats.mood + stats.medication + stats.sleep + stats.event;
}

function updateHint(stats) {
  if (!totalHintEl) return;
  const total = getTotal(stats);
  const count = Math.min(Math.max(1, Number(countInput.value) || total), total || 1);
  totalHintEl.textContent = `${t('settings.mdexport.totalHint', { total, mood: stats.mood, medication: stats.medication, sleep: stats.sleep, event: stats.event })} ${t('settings.mdexport.selectedHint', { count })}`;
}

function openModal() {
  if (!modal) return;
  const stats = countStats();
  const total = getTotal(stats);
  countInput.value = total || 1;
  updateHint(stats);
  modal.setAttribute('aria-hidden', 'false');
  countInput.focus();
  countInput.select();
}

function closeModal() {
  if (modal) modal.setAttribute('aria-hidden', 'true');
}

async function onConfirm() {
  const stats = countStats();
  const total = getTotal(stats);
  if (total === 0) {
    closeModal();
    await showAlert(t('settings.mdexport.empty'));
    return;
  }
  const count = Math.min(Math.max(1, Number(countInput.value) || total), total);
  const md = buildMarkdown(count);
  try {
    await platform.saveTextFile(md, mdFileName());
    closeModal();
  } catch (err) {
    await showAlert(t('settings.mdexport.exportError', { message: err.message }));
  }
}

export function initMdExport() {
  document.getElementById('export-md-btn')?.addEventListener('click', openModal);
  cancelBtn?.addEventListener('click', closeModal);
  confirmBtn?.addEventListener('click', onConfirm);
  countInput?.addEventListener('input', () => updateHint(countStats()));
  modal?.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
  });
  // 语言切换时若弹窗已打开，用新语言刷新提示文案
  subscribe(() => {
    if (modal && modal.getAttribute('aria-hidden') === 'false') {
      updateHint(countStats());
    }
  });
}
