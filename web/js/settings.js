import { store } from './store.js';
import { platform } from './platform.js';
import { t, setLanguage, getLanguage, subscribe, updateDOM } from './i18n.js';
import { getTheme, setTheme, resetTheme, applySystemTheme, subscribe as subscribeTheme } from './theme.js';
import { showAlert, showConfirm } from './dialog.js';
import { enable as enableSync, disable as disableSync, subscribeStatus, getStatus } from './sync.js';
import {
  subscribeAutoBackup,
  chooseBackupFolder,
  restoreAutoBackup,
  deleteAutoBackup,
  backupNow,
  setAutoBackupEnabled,
  setAutoBackupMaxCount,
  getAutoBackupMaxCount
} from './autobackup.js';

function defaultFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `jimbdhub_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

async function exportBackup() {
  try {
    const data = store.buildBackup();
    const json = JSON.stringify(data, null, 2);
    await platform.saveBackup(json, defaultFileName());
  } catch (err) {
    await showAlert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function importBackup(text) {
  try {
    const data = JSON.parse(text);
    if (!store.validateBackup(data)) {
      await showAlert(t('settings.backup.invalidFormat'));
      return;
    }
    if (!(await showConfirm(t('settings.backup.importConfirm')))) {
      return;
    }
    const restoredLang = store.restoreBackup(data);
    if (restoredLang) {
      await showAlert(t('settings.backup.importSuccess'));
      if (restoredLang !== getLanguage()) {
        await setLanguage(restoredLang);
      }
    } else {
      await showAlert(t('settings.backup.importFail'));
    }
  } catch (err) {
    await showAlert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function onImportClick() {
  try {
    const text = await platform.pickBackup();
    if (text) {
      await importBackup(text);
    }
  } catch (err) {
    await showAlert(t('settings.backup.readError', { message: err.message }));
  }
}

// 主题分享：仅导出外观相关设置，不含任何个人数据
// 功能类设置（缩放、边距、动画、自动记录、睡眠显示方式等）不随主题导出
const THEME_EXPORT_KEYS = [
  'curveLine', 'connectMoodDots',
  'positiveColor', 'negativeColor', 'neutralColor',
  'backgroundColor', 'surfaceColor', 'surface2Color', 'surface3Color', 'surfaceAltColor',
  'textColor', 'textMutedColor', 'fontColorMode', 'accentColor',
  'backgroundType', 'backgroundImage', 'backgroundGradient', 'medColors'
];

function themeFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `jimbdhub_theme_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

function buildThemePreset() {
  const theme = getTheme();
  const preset = {};
  THEME_EXPORT_KEYS.forEach(key => {
    if (theme[key] !== undefined) preset[key] = theme[key];
  });
  return {
    type: 'jimbdhub-theme',
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: preset
  };
}

async function exportTheme() {
  try {
    const json = JSON.stringify(buildThemePreset(), null, 2);
    await platform.saveBackup(json, themeFileName());
  } catch (err) {
    await showAlert(t('settings.backup.exportError', { message: err.message }));
  }
}

function validateTheme(data) {
  return !!data && typeof data === 'object'
    && data.type === 'jimbdhub-theme'
    && data.version === 1
    && !!data.theme && typeof data.theme === 'object';
}

async function importTheme(text) {
  try {
    const data = JSON.parse(text);
    if (!validateTheme(data)) {
      await showAlert(t('settings.appearance.invalidTheme'));
      return;
    }
    if (!(await showConfirm(t('settings.appearance.themeImportConfirm')))) {
      return;
    }
    const preset = {};
    THEME_EXPORT_KEYS.forEach(key => {
      if (data.theme[key] !== undefined) preset[key] = data.theme[key];
    });
    // 功能类设置（自动记录、简化模式、缩放、边距等）保持本机现状，仅覆盖外观
    setTheme({ ...preset, useSystemTheme: false });
    await showAlert(t('settings.appearance.themeImportSuccess'));
  } catch (err) {
    await showAlert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function onThemeImportClick() {
  try {
    const text = await platform.pickBackup();
    if (text) {
      await importTheme(text);
    }
  } catch (err) {
    await showAlert(t('settings.backup.readError', { message: err.message }));
  }
}

function bindThemeControls() {
  const positiveInput = document.getElementById('theme-positive-color');
  const negativeInput = document.getElementById('theme-negative-color');
  const neutralInput = document.getElementById('theme-neutral-color');
  const surfaceInput = document.getElementById('theme-surface-color');
  const surfaceAltInput = document.getElementById('theme-surface-alt-color');
  const accentInput = document.getElementById('theme-accent-color');
  const curveLineGroup = document.getElementById('theme-curve-line');
  const fontColorModeGroup = document.getElementById('theme-font-color-mode');
  const systemBtn = document.getElementById('theme-system-btn');
  const resetBtn = document.getElementById('theme-reset-btn');

  function updateUIFromTheme(theme) {
    if (positiveInput) positiveInput.value = theme.positiveColor;
    if (negativeInput) negativeInput.value = theme.negativeColor;
    if (neutralInput) neutralInput.value = theme.neutralColor;
    if (surfaceInput) surfaceInput.value = theme.surfaceColor;
    if (surfaceAltInput) surfaceAltInput.value = theme.surfaceAltColor;
    if (accentInput) accentInput.value = theme.accentColor;
    if (curveLineGroup) {
      curveLineGroup.querySelectorAll('.segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.line === theme.curveLine);
      });
    }
    if (fontColorModeGroup) {
      fontColorModeGroup.querySelectorAll('.segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === (theme.fontColorMode || 'auto'));
      });
    }
  }

  const colorMap = [
    [positiveInput, 'positiveColor'],
    [negativeInput, 'negativeColor'],
    [neutralInput, 'neutralColor'],
    [surfaceInput, 'surfaceColor'],
    [surfaceAltInput, 'surfaceAltColor'],
    [accentInput, 'accentColor']
  ];

  colorMap.forEach(([input, key]) => {
    if (!input) return;
    input.addEventListener('input', () => {
      setTheme({ [key]: input.value, useSystemTheme: false });
    });
  });

  curveLineGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    setTheme({ curveLine: btn.dataset.line, useSystemTheme: false });
  });

  fontColorModeGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    setTheme({ fontColorMode: btn.dataset.mode, useSystemTheme: false });
  });

  systemBtn?.addEventListener('click', applySystemTheme);
  resetBtn?.addEventListener('click', resetTheme);

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function parseGradient(gradient = '') {
  const match = gradient.match(/linear-gradient\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)/i);
  if (!match) return { direction: 'to bottom', start: '#0f172a', end: '#1e293b' };
  return { direction: match[1].trim(), start: match[2].trim(), end: match[3].trim() };
}

function buildGradient(direction, start, end) {
  return `linear-gradient(${direction}, ${start}, ${end})`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('settings.background.imageError')));
    reader.readAsDataURL(file);
  });
}

function bindBackgroundControls() {
  const typeGroup = document.getElementById('theme-background-type');
  const solidControl = document.getElementById('background-solid-control');
  const imageControl = document.getElementById('background-image-control');
  const gradientControl = document.getElementById('background-gradient-control');
  const backgroundInput = document.getElementById('theme-background-color');
  const imageInput = document.getElementById('theme-background-image');
  const clearImageBtn = document.getElementById('theme-clear-background-image');
  const gradientStart = document.getElementById('theme-gradient-start');
  const gradientEnd = document.getElementById('theme-gradient-end');
  const gradientDirection = document.getElementById('theme-gradient-direction');

  if (!typeGroup) return;

  if (platform.isAndroid() && imageInput && !imageControl.querySelector('.choose-image-btn')) {
    imageInput.hidden = true;
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'btn btn-ghost btn-sm choose-image-btn';
    chooseBtn.dataset.i18n = 'settings.background.chooseImage';
    chooseBtn.textContent = t('settings.background.chooseImage');
    chooseBtn.addEventListener('click', async () => {
      try {
        const dataUrl = await platform.pickBackgroundImage();
        if (dataUrl) {
          setTheme({ backgroundImage: dataUrl, backgroundType: 'image', useSystemTheme: false });
        }
      } catch (err) {
        await showAlert(t('settings.background.imageError', { message: err.message }));
      }
    });
    imageControl.insertBefore(chooseBtn, clearImageBtn);
  }

  function updatePanels(type) {
    solidControl.hidden = type !== 'solid';
    imageControl.hidden = type !== 'image';
    gradientControl.hidden = type !== 'gradient';
  }

  function updateUIFromTheme(theme) {
    const type = theme.backgroundType || 'solid';
    updatePanels(type);
    typeGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
    if (backgroundInput) backgroundInput.value = theme.backgroundColor;
    const parsed = parseGradient(theme.backgroundGradient);
    if (gradientStart) gradientStart.value = parsed.start;
    if (gradientEnd) gradientEnd.value = parsed.end;
    if (gradientDirection) gradientDirection.value = parsed.direction;
  }

  typeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    setTheme({ backgroundType: btn.dataset.type, useSystemTheme: false });
  });

  backgroundInput?.addEventListener('input', () => {
    setTheme({ backgroundColor: backgroundInput.value, useSystemTheme: false });
  });

  imageInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      setTheme({ backgroundImage: dataUrl, backgroundType: 'image', useSystemTheme: false });
    } catch (err) {
      await showAlert(t('settings.background.imageError', { message: err.message }));
    }
    e.target.value = '';
  });

  clearImageBtn?.addEventListener('click', () => {
    setTheme({ backgroundImage: '', backgroundType: 'solid', useSystemTheme: false });
  });

  function updateGradient() {
    const start = gradientStart?.value || '#0f172a';
    const end = gradientEnd?.value || '#1e293b';
    const direction = gradientDirection?.value || 'to bottom';
    setTheme({ backgroundGradient: buildGradient(direction, start, end), useSystemTheme: false });
  }

  gradientStart?.addEventListener('input', updateGradient);
  gradientEnd?.addEventListener('input', updateGradient);
  gradientDirection?.addEventListener('change', updateGradient);

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindMedColorControls() {
  const container = document.getElementById('theme-med-colors');
  const resetBtn = document.getElementById('theme-reset-med-colors');
  if (!container) return;

  function updateUIFromTheme(theme) {
    const colors = Array.isArray(theme.medColors) ? theme.medColors : [];
    container.innerHTML = '';
    colors.forEach((color, idx) => {
      const label = document.createElement('label');
      label.className = 'color-field';
      const span = document.createElement('span');
      span.dataset.i18n = 'settings.appearance.medColorN';
      span.dataset.i18nParams = JSON.stringify({ n: idx + 1 });
      span.textContent = t('settings.appearance.medColorN', { n: idx + 1 });
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.addEventListener('input', () => {
        const next = [...colors];
        next[idx] = input.value;
        setTheme({ medColors: next, useSystemTheme: false });
      });
      label.appendChild(span);
      label.appendChild(input);
      container.appendChild(label);
    });
  }

  resetBtn?.addEventListener('click', () => {
    setTheme({ medColors: undefined, useSystemTheme: false });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindDisplayControls() {
  const scaleSelect = document.getElementById('ui-scale-select');
  const marginSelect = document.getElementById('edge-margin-select');
  const animCheckbox = document.getElementById('dynamic-animation-speed');
  const disableAnimCheckbox = document.getElementById('disable-animations');
  const recordAddToastCheckbox = document.getElementById('record-add-toast');

  function updateUIFromTheme(theme) {
    if (scaleSelect) scaleSelect.value = String(theme.uiScale);
    if (marginSelect) marginSelect.value = String(theme.edgeMargin);
    if (animCheckbox) animCheckbox.checked = theme.dynamicAnimationSpeed !== false;
    if (disableAnimCheckbox) disableAnimCheckbox.checked = theme.disableAnimations === true;
    if (recordAddToastCheckbox) recordAddToastCheckbox.checked = theme.recordAddToast !== false;
  }

  scaleSelect?.addEventListener('change', () => {
    setTheme({ uiScale: Number(scaleSelect.value) });
  });
  marginSelect?.addEventListener('change', () => {
    setTheme({ edgeMargin: Number(marginSelect.value) });
  });
  animCheckbox?.addEventListener('change', () => {
    setTheme({ dynamicAnimationSpeed: animCheckbox.checked });
  });
  disableAnimCheckbox?.addEventListener('change', () => {
    setTheme({ disableAnimations: disableAnimCheckbox.checked });
  });
  recordAddToastCheckbox?.addEventListener('change', () => {
    setTheme({ recordAddToast: recordAddToastCheckbox.checked });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindConnectMoodDotsControl() {
  const checkbox = document.getElementById('connect-mood-dots');
  if (!checkbox) return;

  function updateUIFromTheme(theme) {
    checkbox.checked = theme.connectMoodDots !== false;
  }

  checkbox.addEventListener('change', () => {
    setTheme({ connectMoodDots: checkbox.checked });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindSleepOverlayModeControl() {
  const checkbox = document.getElementById('sleep-overlay-mode');
  if (!checkbox) return;

  function updateUIFromTheme(theme) {
    checkbox.checked = theme.sleepDisplayMode === 'overlay';
  }

  checkbox.addEventListener('change', () => {
    setTheme({ sleepDisplayMode: checkbox.checked ? 'overlay' : 'bar' });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindAutoMedLogControl() {
  const checkbox = document.getElementById('auto-med-log');
  if (!checkbox) return;

  function updateUIFromTheme(theme) {
    checkbox.checked = theme.autoMedLog === true;
  }

  checkbox.addEventListener('change', () => {
    setTheme({ autoMedLog: checkbox.checked });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindSimpleModeControls() {
  const enableCheckbox = document.getElementById('simple-mode-enable');
  const moodCheckbox = document.getElementById('simple-mode-mood');
  const medicationCheckbox = document.getElementById('simple-mode-medication');
  const scopeGroup = document.getElementById('simple-mode-scope-group');
  const granularityGroup = document.getElementById('simple-mode-granularity');
  const granularityGroupContainer = document.getElementById('simple-mode-granularity-group');
  if (!enableCheckbox || !granularityGroup) return;

  function updateUIFromTheme(theme) {
    const enabled = theme.simpleMode === true;
    enableCheckbox.checked = enabled;
    if (moodCheckbox) moodCheckbox.checked = theme.simpleModeMood !== false;
    if (medicationCheckbox) medicationCheckbox.checked = theme.simpleModeMedication !== false;
    granularityGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.granularity === theme.simpleModeGranularity);
    });
    granularityGroup.disabled = !enabled;
    granularityGroup.style.opacity = enabled ? '1' : '0.5';
    if (scopeGroup) {
      scopeGroup.style.opacity = enabled ? '1' : '0.5';
      scopeGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = !enabled; });
    }
    if (granularityGroupContainer) {
      granularityGroupContainer.hidden = !enabled || moodCheckbox === null || theme.simpleModeMood === false;
    }
  }

  enableCheckbox.addEventListener('change', () => {
    setTheme({ simpleMode: enableCheckbox.checked });
  });

  moodCheckbox?.addEventListener('change', () => {
    setTheme({ simpleModeMood: moodCheckbox.checked });
  });

  medicationCheckbox?.addEventListener('change', () => {
    setTheme({ simpleModeMedication: medicationCheckbox.checked });
  });

  granularityGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn || !enableCheckbox.checked) return;
    setTheme({ simpleModeGranularity: btn.dataset.granularity });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindDepletionReminderDaysControl() {
  const input = document.getElementById('depletion-reminder-days');
  if (!input) return;

  function updateUIFromTheme(theme) {
    input.value = theme.depletionReminderDays ?? 3;
  }

  input.addEventListener('change', () => {
    setTheme({ depletionReminderDays: Math.max(0, Math.min(30, Number(input.value) || 3)) });
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindMedHistoryControls() {
  const group = document.getElementById('med-history-group');
  const list = document.getElementById('med-history-list');
  const form = document.getElementById('med-history-form');
  const addBtn = document.getElementById('med-history-add-btn');
  const cancelBtn = document.getElementById('med-history-cancel');
  const saveBtn = document.getElementById('med-history-save');
  const idInput = document.getElementById('med-history-id');
  const medSelect = document.getElementById('med-history-med-id');
  const timeInput = document.getElementById('med-history-time');
  const amountInput = document.getElementById('med-history-amount');
  const unitInput = document.getElementById('med-history-unit');

  if (!group) return;

  function formatDateTimeLocal(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function populateMedSelect(selectedId = '') {
    if (!medSelect) return;
    medSelect.innerHTML = '';
    if (store.data.meds.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.dataset.i18n = 'records.moodForm.noMeds';
      option.textContent = t('records.moodForm.noMeds');
      medSelect.appendChild(option);
      return;
    }
    store.data.meds.forEach(med => {
      const option = document.createElement('option');
      option.value = med.id;
      option.textContent = med.name;
      if (med.id === selectedId) option.selected = true;
      medSelect.appendChild(option);
    });
  }

  function updateUnitFromSelection() {
    const med = store.data.meds.find(m => m.id === medSelect.value);
    unitInput.value = med ? med.unit : '';
    if (!idInput.value && med) {
      amountInput.value = med.doseAmount ?? 1;
    }
  }

  function renderList() {
    if (!list) return;
    list.innerHTML = '';
    const entries = [...store.data.medHistory].sort((a, b) => a.timestamp - b.timestamp);
    if (entries.length === 0) {
      list.innerHTML = `<div class="med-history-empty">${t('settings.meds.historyEmpty')}</div>`;
      return;
    }
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'med-history-item';
      item.innerHTML = `
        <div class="med-history-info">
          <span class="med-history-name">${entry.name}</span>
          <span class="med-history-meta">${formatDateTimeLocal(entry.timestamp)} · ${entry.amount}${entry.unit}</span>
        </div>
        <div class="med-history-actions">
          <button type="button" class="btn btn-icon btn-sm" data-action="edit" data-id="${entry.id}">${t('common.edit')}</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="${entry.id}">${t('common.delete')}</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  function openForm(entry = null) {
    populateMedSelect(entry?.medicationId);
    if (entry) {
      idInput.value = entry.id;
      medSelect.value = entry.medicationId;
      timeInput.value = formatDateTimeLocal(entry.timestamp);
      amountInput.value = entry.amount;
      unitInput.value = entry.unit;
    } else {
      idInput.value = '';
      timeInput.value = formatDateTimeLocal(Date.now());
      updateUnitFromSelection();
    }
    form.hidden = false;
    addBtn.hidden = true;
  }

  function closeForm() {
    form.hidden = true;
    addBtn.hidden = false;
    idInput.value = '';
    if (timeInput) timeInput.value = '';
    if (amountInput) amountInput.value = '';
    if (unitInput) unitInput.value = '';
  }

  async function saveEntry() {
    const medId = medSelect.value;
    const med = store.data.meds.find(m => m.id === medId);
    if (!med) {
      await showAlert(t('records.moodForm.noMeds'));
      return;
    }
    const timestamp = new Date(timeInput.value).getTime();
    if (Number.isNaN(timestamp)) {
      await showAlert(t('records.validation.endAfterStart'));
      return;
    }
    const amount = Math.max(0.1, Number(amountInput.value) || 0.1);
    const payload = {
      timestamp,
      medicationId: medId,
      name: med.name,
      amount,
      unit: med.unit,
      dosePerTablet: med.dosePerTablet,
      doseMassUnit: med.doseMassUnit,
      schedule: Array.isArray(med.schedule) ? [...med.schedule] : [],
      onsetMinHours: med.onsetMinHours,
      onsetMaxHours: med.onsetMaxHours,
      peakMinHours: med.peakMinHours,
      peakMaxHours: med.peakMaxHours,
      halfLifeMinHours: med.halfLifeMinHours,
      halfLifeMaxHours: med.halfLifeMaxHours
    };
    if (idInput.value) {
      store.updateMedHistory(idInput.value, payload);
    } else {
      store.addMedHistory(payload);
    }
    closeForm();
  }

  addBtn?.addEventListener('click', () => {
    if (store.data.meds.length === 0) {
      showAlert(t('records.moodForm.noMeds'));
      return;
    }
    openForm();
  });
  cancelBtn?.addEventListener('click', closeForm);
  saveBtn?.addEventListener('click', saveEntry);
  medSelect?.addEventListener('change', updateUnitFromSelection);

  list?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const entry = store.data.medHistory.find(e => e.id === id);
    if (!entry) return;
    if (action === 'edit') {
      openForm(entry);
    } else if (action === 'delete') {
      if (await showConfirm(t('settings.meds.historyConfirmDelete', { name: entry.name }))) {
        store.deleteMedHistory(id);
      }
    }
  });

  store.subscribe(() => {
    renderList();
    if (form && !form.hidden) {
      populateMedSelect(medSelect.value);
      updateUnitFromSelection();
    }
  });
  subscribe(() => renderList());
  renderList();
}

function bindSyncControls() {
  const enableCheckbox = document.getElementById('syncthing-enable');
  const chooseBtn = document.getElementById('syncthing-choose-folder');
  const pathText = document.getElementById('syncthing-path');
  const statusText = document.getElementById('syncthing-status');
  const card = document.getElementById('syncthing-card');

  if (!card) return;

  // 设置文本的同时标注 data-i18n，语言切换时 updateDOM 会自动用新语言重算
  function setI18nText(el, key, params) {
    if (!el) return;
    el.dataset.i18n = key;
    if (params) {
      el.dataset.i18nParams = JSON.stringify(params);
    } else {
      delete el.dataset.i18nParams;
    }
    el.textContent = t(key, params);
  }

  function updateUI(status) {
    if (enableCheckbox) {
      enableCheckbox.checked = status.enabled;
      enableCheckbox.disabled = !platform.isSyncSupported();
    }
    if (chooseBtn) {
      chooseBtn.hidden = !platform.isAndroid() || !status.enabled;
    }
    if (pathText) {
      if (!platform.isSyncSupported()) {
        setI18nText(pathText, 'settings.sync.webHint');
      } else if (status.path) {
        setI18nText(pathText, 'settings.sync.desktopPath', { path: status.path });
      } else if (status.folderName) {
        setI18nText(pathText, 'settings.sync.androidFolder', { name: status.folderName });
      } else {
        delete pathText.dataset.i18n;
        delete pathText.dataset.i18nParams;
        pathText.textContent = '';
      }
    }
    if (statusText) {
      if (status.error) {
        setI18nText(statusText, 'settings.sync.error', { message: status.error });
        statusText.classList.add('sync-error');
      } else if (status.enabled) {
        setI18nText(statusText, 'settings.sync.enabled');
        statusText.classList.remove('sync-error');
      } else {
        setI18nText(statusText, 'settings.sync.disabled');
        statusText.classList.remove('sync-error');
      }
    }
  }

  enableCheckbox?.addEventListener('change', async () => {
    if (enableCheckbox.checked) {
      await enableSync();
    } else {
      await disableSync();
    }
  });

  chooseBtn?.addEventListener('click', async () => {
    await disableSync();
    await enableSync();
  });

  updateUI(getStatus());
  subscribeStatus(updateUI);

  // 在打包后的桌面端（如 AppImage）中，pywebview 对象可能晚于页面脚本注入
  let checks = 0;
  const platformTimer = setInterval(() => {
    checks++;
    updateUI(getStatus());
    if (platform.isSyncSupported() || checks >= 30) {
      clearInterval(platformTimer);
    }
  }, 100);
}

function bindAutoBackupControls() {
  const enableCheckbox = document.getElementById('autobackup-enable');
  const chooseBtn = document.getElementById('autobackup-choose-folder');
  const pathText = document.getElementById('autobackup-path');
  const maxCountInput = document.getElementById('autobackup-max-count');
  const backupNowBtn = document.getElementById('autobackup-now-btn');
  const listEl = document.getElementById('autobackup-list');
  if (!enableCheckbox) return;

  let lastStatus = null;

  function setI18nText(el, key, params) {
    if (!el) return;
    el.dataset.i18n = key;
    if (params) {
      el.dataset.i18nParams = JSON.stringify(params);
    } else {
      delete el.dataset.i18nParams;
    }
    el.textContent = t(key, params);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatBackupDate(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function renderList(status) {
    lastStatus = status;
    if (!listEl) return;
    const theme = getTheme();
    const enabled = theme.autoBackupEnabled === true;
    const folder = theme.autoBackupFolder || '';
    if (!enabled || !folder || !status.loaded) {
      listEl.innerHTML = '';
      return;
    }
    if (!status.list.length) {
      listEl.innerHTML = `<div class="autobackup-empty">${t('settings.backup.autoEmpty')}</div>`;
      return;
    }
    listEl.innerHTML = status.list.map(item => `
      <div class="autobackup-item">
        <div class="autobackup-info">
          <span class="autobackup-name">${escapeHtml(item.name)}</span>
          <span class="autobackup-meta">${formatBackupDate(item.modified)} · ${formatSize(item.size)}</span>
        </div>
        <div class="autobackup-actions">
          <button type="button" class="btn btn-icon btn-sm" data-action="restore" data-name="${escapeHtml(item.name)}">${t('settings.backup.autoRestore')}</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete" data-name="${escapeHtml(item.name)}">${t('settings.backup.autoDelete')}</button>
        </div>
      </div>
    `).join('');
  }

  function updateUI(theme) {
    const supported = platform.isAutoBackupSupported();
    const enabled = theme.autoBackupEnabled === true;
    const folder = theme.autoBackupFolder || '';
    enableCheckbox.checked = enabled;
    enableCheckbox.disabled = !supported;
    if (chooseBtn) chooseBtn.hidden = !supported || !enabled;
    if (backupNowBtn) backupNowBtn.disabled = !supported || !enabled || !folder;
    if (maxCountInput) {
      maxCountInput.disabled = !supported || !enabled;
      maxCountInput.value = String(getAutoBackupMaxCount());
    }
    if (pathText) {
      if (!supported) {
        setI18nText(pathText, 'settings.backup.autoWebHint');
      } else if (folder) {
        setI18nText(pathText, 'settings.backup.autoFolder', { path: folder });
      } else if (enabled) {
        setI18nText(pathText, 'settings.backup.autoChooseHint');
      } else {
        delete pathText.dataset.i18n;
        delete pathText.dataset.i18nParams;
        pathText.textContent = '';
      }
    }
  }

  enableCheckbox.addEventListener('change', () => {
    setAutoBackupEnabled(enableCheckbox.checked);
  });

  chooseBtn?.addEventListener('click', async () => {
    chooseBtn.disabled = true;
    try {
      await chooseBackupFolder();
    } finally {
      chooseBtn.disabled = false;
    }
  });

  maxCountInput?.addEventListener('change', () => {
    const n = setAutoBackupMaxCount(Number(maxCountInput.value));
    maxCountInput.value = String(n);
  });

  backupNowBtn?.addEventListener('click', async () => {
    backupNowBtn.disabled = true;
    try {
      await backupNow();
    } finally {
      backupNowBtn.disabled = false;
    }
  });

  listEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const name = btn.dataset.name;
    if (btn.dataset.action === 'restore') {
      await restoreAutoBackup(name);
    } else if (btn.dataset.action === 'delete') {
      await deleteAutoBackup(name);
    }
  });

  subscribeTheme(updateUI);
  subscribeAutoBackup(renderList);
  // 语言切换时用新文案重绘备份列表
  subscribe(() => renderList(lastStatus));
  updateUI(getTheme());

  // 打包后的桌面端（如 AppImage）中 pywebview 可能晚注入，轮询等待能力就绪
  let checks = 0;
  const platformTimer = setInterval(() => {
    checks++;
    updateUI(getTheme());
    if (platform.isAutoBackupSupported() || checks >= 30) {
      clearInterval(platformTimer);
    }
  }, 100);
}

function bindWidgetControls() {
  const addBtn = document.getElementById('widget-add-btn');
  if (!addBtn) return;

  async function onAddClick() {
    addBtn.disabled = true;
    try {
      const result = await platform.addWidget();
      if (result?.ok) {
        await showAlert(t('settings.widget.addSuccess'));
      } else {
        await showAlert(t('settings.widget.addError', { message: result?.error || t('platform.widgetUnsupported') }));
      }
    } catch (err) {
      await showAlert(t('settings.widget.addError', { message: err.message }));
    } finally {
      addBtn.disabled = false;
    }
  }

  addBtn.addEventListener('click', onAddClick);
}

function bindWipeControls() {
  const wipeBtn = document.getElementById('wipe-data-btn');
  if (!wipeBtn) return;

  wipeBtn.addEventListener('click', async () => {
    if (!(await showConfirm(t('settings.dangerZone.wipeConfirm')))) {
      return;
    }
    try {
      await disableSync();
      store.clearAll();
      localStorage.clear();
      window.location.reload();
    } catch (err) {
      await showAlert(t('settings.dangerZone.wipeError', { message: err.message }));
    }
  });
}

const SETTINGS_COLLAPSE_KEY = 'jimbdhub_settings_collapsed';
let settingsCollapseState = {};

function loadSettingsCollapseState() {
  try {
    settingsCollapseState = JSON.parse(localStorage.getItem(SETTINGS_COLLAPSE_KEY)) || {};
  } catch {
    settingsCollapseState = {};
  }
}

function saveSettingsCollapseState() {
  try {
    localStorage.setItem(SETTINGS_COLLAPSE_KEY, JSON.stringify(settingsCollapseState));
  } catch { /* ignore */ }
}

function applyCollapsedState(card) {
  const id = card.dataset.settingsCard;
  if (!id) return;
  // 默认折叠
  const collapsed = settingsCollapseState[id] ?? true;
  card.classList.toggle('collapsed', collapsed);
}

function initSettingsCollapse() {
  loadSettingsCollapseState();
  const cards = document.querySelectorAll('#settings-view [data-settings-card]');
  cards.forEach(card => {
    const id = card.dataset.settingsCard;
    applyCollapsedState(card);
    card.querySelector(':scope > .card-header')?.addEventListener('click', () => {
      const collapsed = !card.classList.contains('collapsed');
      card.classList.toggle('collapsed', collapsed);
      settingsCollapseState[id] = collapsed;
      saveSettingsCollapseState();
    });
  });
}

function bindSettingsSearch() {
  const input = document.getElementById('settings-search');
  const emptyHint = document.getElementById('settings-search-empty');
  if (!input) return;
  const cards = Array.from(document.querySelectorAll('#settings-view [data-settings-card]'));

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (emptyHint) emptyHint.hidden = true;
    if (!q) {
      cards.forEach(card => {
        card.classList.remove('search-hidden');
        card.querySelectorAll('.setting-group.search-hidden').forEach(g => g.classList.remove('search-hidden'));
        applyCollapsedState(card);
      });
      return;
    }

    let anyMatch = false;
    let firstMatch = null;
    cards.forEach(card => {
      const headerEl = card.querySelector(':scope > .card-header');
      const titleMatch = headerEl ? headerEl.textContent.toLowerCase().includes(q) : false;
      const groups = Array.from(card.querySelectorAll(':scope > .settings-section > .setting-group'));
      let cardMatch = titleMatch;
      if (groups.length) {
        groups.forEach(g => {
          const m = g.textContent.toLowerCase().includes(q);
          g.classList.toggle('search-hidden', !m && !titleMatch);
          if (m) {
            cardMatch = true;
            if (!firstMatch) firstMatch = g;
          }
        });
      } else if (card.textContent.toLowerCase().includes(q)) {
        cardMatch = true;
      }
      card.classList.toggle('search-hidden', !cardMatch);
      if (cardMatch) {
        card.classList.remove('collapsed');
        anyMatch = true;
      }
    });
    if (emptyHint) emptyHint.hidden = anyMatch;
    if (firstMatch) {
      firstMatch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

export function initSettings() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const importInput = document.getElementById('import-backup-input');
  const languageSelect = document.getElementById('language-select');

  if (languageSelect) {
    languageSelect.value = getLanguage();
    languageSelect.addEventListener('change', () => {
      setLanguage(languageSelect.value);
    });
  }

  exportBtn?.addEventListener('click', exportBackup);
  importBtn?.addEventListener('click', () => {
    if (platform.isAndroid()) {
      onImportClick();
    } else {
      importInput?.click();
    }
  });

  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importBackup(text);
    } catch (err) {
      await showAlert(t('settings.backup.readError', { message: err.message }));
    }
    e.target.value = '';
  });

  const themeExportBtn = document.getElementById('export-theme-btn');
  const themeImportBtn = document.getElementById('import-theme-btn');
  const themeImportInput = document.getElementById('import-theme-input');

  themeExportBtn?.addEventListener('click', exportTheme);
  themeImportBtn?.addEventListener('click', () => {
    if (platform.isAndroid()) {
      onThemeImportClick();
    } else {
      themeImportInput?.click();
    }
  });

  themeImportInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importTheme(text);
    } catch (err) {
      await showAlert(t('settings.backup.readError', { message: err.message }));
    }
    e.target.value = '';
  });

  bindThemeControls();
  bindBackgroundControls();
  bindMedColorControls();
  bindDisplayControls();
  bindConnectMoodDotsControl();
  bindSleepOverlayModeControl();
  bindAutoMedLogControl();
  bindDepletionReminderDaysControl();
  bindSimpleModeControls();
  bindMedHistoryControls();
  bindSyncControls();
  bindAutoBackupControls();
  bindWidgetControls();
  bindWipeControls();
  initSettingsCollapse();
  bindSettingsSearch();

  subscribe(() => {
    updateDOM();
    if (languageSelect) {
      languageSelect.value = getLanguage();
    }
  });
}
