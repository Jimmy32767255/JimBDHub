import { store } from './store.js';
import { platform } from './platform.js';
import { t, setLanguage, getLanguage, subscribe, updateDOM } from './i18n.js';
import {
  getTheme, setTheme, resetTheme, applySystemTheme, sanitizeCustomCSS, subscribe as subscribeTheme,
  extractImageAverageColor, takeAutoColorSnapshot, buildAutoColorTheme, isAutoColorActive,
  formatTimestamp, DEFAULT_TIME_FORMAT
} from './theme.js';
import { showAlert, showConfirm } from './dialog.js';
import { enable as enableSync, disable as disableSync, subscribeStatus, getStatus } from './sync.js';
import {
  subscribeAutoBackup,
  chooseBackupFolder,
  restoreAutoBackup,
  deleteAutoBackup,
  backupNow,
  getAutoBackupReasonLabel,
  setAutoBackupEnabled,
  setAutoBackupMaxCount,
  getAutoBackupMaxCount
} from './autobackup.js';
import { runUpgrade } from './dbUpgrade.js';
import { UPDATE_CHANNELS, getUpdateChannel, setUpdateChannel } from './update.js';

function defaultFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `jimbdhub_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

async function exportBackup() {
  try {
    const data = store.buildBackup();
    let content = JSON.stringify(data, null, 2);
    if (store.hasPassword()) {
      // 加密状态下仅允许在解锁后导出加密备份，绝不落盘明文
      if (!store.isFileEncryptionEnabled()) {
        await showAlert(t('settings.backup.exportLocked'));
        return;
      }
      content = await store.encryptFilePayload(content);
    }
    await platform.saveBackup(content, defaultFileName());
  } catch (err) {
    await showAlert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function importBackup(text) {
  try {
    let data = JSON.parse(text);
    // 加密备份：请求创建备份时使用的主密码解密，无需本机启用加密或密码一致
    if (store.isEncryptedPayload(data)) {
      let plain = null;
      while (!plain) {
        const pw = await showPasswordDialog('backup');
        if (!pw || !pw.oldPassword) return; // 用户取消导入
        try {
          plain = await store.decryptFilePayload(text, pw.oldPassword);
        } catch {
          const retry = await showConfirm(t('settings.backup.decryptWrongPassword'));
          if (!retry) return;
        }
      }
      data = JSON.parse(plain);
    }
    if (!store.validateBackup(data)) {
      await showAlert(t('settings.backup.invalidFormat'));
      return;
    }

    const upgradeResult = runUpgrade(data);
    if (!upgradeResult.success) {
      await showAlert(t('settings.backup.upgradeFailed', { message: upgradeResult.error }));
      return;
    }
    if (upgradeResult.upgraded) {
      const proceed = await showConfirm(t('settings.backup.upgradeConfirm'));
      if (!proceed) return;
    }
    data = upgradeResult.data;

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
  'backgroundType', 'backgroundImage', 'backgroundImageAutoColor', 'backgroundGradient',
  'customCSS'
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
    // 自定义 CSS 属于安全敏感内容：先提示来源可信再应用，并做安全校验，非法内容不生效
    if (data.theme.customCSS !== undefined) {
      const importedCss = typeof data.theme.customCSS === 'string' ? data.theme.customCSS : '';
      if (importedCss.trim()) {
        if (!(await showConfirm(t('settings.appearance.customCssImportConfirm')))) {
          return;
        }
        try {
          preset.customCSS = sanitizeCustomCSS(importedCss);
        } catch {
          preset.customCSS = '';
        }
      } else {
        preset.customCSS = '';
      }
    }
    // 功能类设置（自动记录、简化模式、缩放、边距等）保持本机现状，仅覆盖外观
    setTheme({ ...preset, useSystemTheme: false }, 'ThemeImport');
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

  // 「获取系统主题」依赖原生桥读取系统调色板：纯浏览器不可用，自动隐藏。
  // 桌面端（如 AppImage）pywebview 可能晚于页面脚本注入，轮询等待能力就绪。
  if (systemBtn) {
    const updateSystemThemeVisible = () => {
      systemBtn.hidden = !platform.isSystemThemeSupported();
    };
    updateSystemThemeVisible();
    let checks = 0;
    const platformTimer = setInterval(() => {
      checks++;
      updateSystemThemeVisible();
      if (platform.isSystemThemeSupported() || checks >= 30) {
        clearInterval(platformTimer);
      }
    }, 100);
  }

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
      setTheme({ [key]: input.value, useSystemTheme: false }, 'ColorChange');
    });
  });

  curveLineGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    setTheme({ curveLine: btn.dataset.line, useSystemTheme: false }, 'ChartStyleChange');
  });

  fontColorModeGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    setTheme({ fontColorMode: btn.dataset.mode, useSystemTheme: false }, 'DisplayChange');
  });

  systemBtn?.addEventListener('click', applySystemTheme);
  resetBtn?.addEventListener('click', resetTheme);

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindCustomCssControl() {
  const input = document.getElementById('custom-css-input');
  const saveBtn = document.getElementById('custom-css-save-btn');
  if (!input || !saveBtn) return;

  function updateUIFromTheme(theme) {
    input.value = theme.customCSS || '';
  }

  saveBtn.addEventListener('click', () => {
    let css;
    try {
      css = sanitizeCustomCSS(input.value);
    } catch (err) {
      const msg = err.message === 'custom-css-too-long'
        ? t('settings.appearance.customCssTooLong')
        : t('settings.appearance.customCssSyntaxError');
      showAlert(msg);
      return;
    }
    setTheme({ customCSS: css, useSystemTheme: false }, 'CustomCSSChange');
    input.value = css;
    // 轻量反馈：按钮短暂显示“已应用”
    const original = saveBtn.textContent;
    saveBtn.textContent = t('settings.appearance.customCssSaved');
    setTimeout(() => { saveBtn.textContent = original; }, 1500);
  });

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
  const autoColorCheckbox = document.getElementById('theme-background-image-auto-color');
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
          setTheme({ backgroundImage: dataUrl, backgroundType: 'image', useSystemTheme: false }, 'BackgroundChange');
          if (autoColorCheckbox?.checked) await recomputeAutoColors();
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

  function updateManualColorControlsDisabled(disabled) {
    const ids = [
      'theme-positive-color', 'theme-negative-color', 'theme-neutral-color',
      'theme-background-color', 'theme-surface-color', 'theme-surface-alt-color', 'theme-accent-color'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
    const fontGroup = document.getElementById('theme-font-color-mode');
    if (fontGroup) {
      fontGroup.querySelectorAll('.segment-btn').forEach(btn => { btn.disabled = disabled; });
    }
  }

  async function recomputeAutoColors() {
    const theme = getTheme();
    if (!isAutoColorActive(theme)) return;
    try {
      const avg = await extractImageAverageColor(theme.backgroundImage);
      const computed = buildAutoColorTheme(theme, avg);
      setTheme({ ...computed, autoColorSnapshot: theme.autoColorSnapshot, useSystemTheme: false }, 'AutoColorRecompute');
    } catch (err) {
      await showAlert(t('settings.background.imageError', { message: err.message }));
    }
  }

  async function setAutoColorEnabled(enabled) {
    const theme = getTheme();
    if (enabled) {
      if (!theme.backgroundImage) {
        await showAlert(t('settings.background.autoColorNoImage'));
        if (autoColorCheckbox) autoColorCheckbox.checked = false;
        return;
      }
      const snapshot = theme.autoColorSnapshot || takeAutoColorSnapshot(theme);
      try {
        const avg = await extractImageAverageColor(theme.backgroundImage);
        const computed = buildAutoColorTheme(theme, avg);
        setTheme({ ...computed, backgroundImageAutoColor: true, autoColorSnapshot: snapshot, useSystemTheme: false }, 'AutoColorEnable');
      } catch (err) {
        await showAlert(t('settings.background.imageError', { message: err.message }));
        if (autoColorCheckbox) autoColorCheckbox.checked = false;
      }
    } else {
      const snapshot = theme.autoColorSnapshot || {};
      setTheme({ ...snapshot, backgroundImageAutoColor: false, autoColorSnapshot: null }, 'AutoColorDisable');
    }
  }

  function updateUIFromTheme(theme) {
    const type = theme.backgroundType || 'solid';
    updatePanels(type);
    typeGroup.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
    if (backgroundInput) backgroundInput.value = theme.backgroundColor;
    if (autoColorCheckbox) autoColorCheckbox.checked = theme.backgroundImageAutoColor === true;
    updateManualColorControlsDisabled(theme.backgroundImageAutoColor === true);
    const parsed = parseGradient(theme.backgroundGradient);
    if (gradientStart) gradientStart.value = parsed.start;
    if (gradientEnd) gradientEnd.value = parsed.end;
    if (gradientDirection) gradientDirection.value = parsed.direction;
  }

  typeGroup.addEventListener('click', async (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    const newType = btn.dataset.type;
    const theme = getTheme();
    if (newType !== 'image' && theme.backgroundImageAutoColor) {
      await setAutoColorEnabled(false);
    }
    setTheme({ backgroundType: newType, useSystemTheme: false }, 'BackgroundChange');
  });

  backgroundInput?.addEventListener('input', () => {
    setTheme({ backgroundColor: backgroundInput.value, useSystemTheme: false }, 'BackgroundChange');
  });

  imageInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      setTheme({ backgroundImage: dataUrl, backgroundType: 'image', useSystemTheme: false }, 'BackgroundChange');
      if (autoColorCheckbox?.checked) await recomputeAutoColors();
    } catch (err) {
      await showAlert(t('settings.background.imageError', { message: err.message }));
    }
    e.target.value = '';
  });

  clearImageBtn?.addEventListener('click', async () => {
    const theme = getTheme();
    if (theme.backgroundImageAutoColor) {
      await setAutoColorEnabled(false);
    }
    setTheme({ backgroundImage: '', backgroundType: 'solid', useSystemTheme: false }, 'BackgroundChange');
  });

  autoColorCheckbox?.addEventListener('change', async () => {
    await setAutoColorEnabled(autoColorCheckbox.checked);
  });

  function updateGradient() {
    const start = gradientStart?.value || '#0f172a';
    const end = gradientEnd?.value || '#1e293b';
    const direction = gradientDirection?.value || 'to bottom';
    setTheme({ backgroundGradient: buildGradient(direction, start, end), useSystemTheme: false }, 'BackgroundChange');
  }

  gradientStart?.addEventListener('input', updateGradient);
  gradientEnd?.addEventListener('input', updateGradient);
  gradientDirection?.addEventListener('change', updateGradient);

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindDisplayControls() {
  const scaleSelect = document.getElementById('ui-scale-select');
  const marginSelect = document.getElementById('edge-margin-select');
  const animCheckbox = document.getElementById('dynamic-animation-speed');
  const disableAnimCheckbox = document.getElementById('disable-animations');
  const recordAddToastCheckbox = document.getElementById('record-add-toast');
  const recordsLoadLimitInput = document.getElementById('records-load-limit');

  function updateUIFromTheme(theme) {
    if (scaleSelect) scaleSelect.value = String(theme.uiScale);
    if (marginSelect) marginSelect.value = String(theme.edgeMargin);
    if (animCheckbox) animCheckbox.checked = theme.dynamicAnimationSpeed !== false;
    if (disableAnimCheckbox) disableAnimCheckbox.checked = theme.disableAnimations === true;
    if (recordAddToastCheckbox) recordAddToastCheckbox.checked = theme.recordAddToast !== false;
    if (recordsLoadLimitInput) recordsLoadLimitInput.value = String(theme.maxLoadedRecords ?? 100);
  }

  scaleSelect?.addEventListener('change', () => {
    setTheme({ uiScale: Number(scaleSelect.value) }, 'DisplayChange');
  });
  marginSelect?.addEventListener('change', () => {
    setTheme({ edgeMargin: Number(marginSelect.value) }, 'DisplayChange');
  });
  animCheckbox?.addEventListener('change', () => {
    setTheme({ dynamicAnimationSpeed: animCheckbox.checked }, 'DisplayChange');
  });
  disableAnimCheckbox?.addEventListener('change', () => {
    setTheme({ disableAnimations: disableAnimCheckbox.checked }, 'DisplayChange');
  });
  recordAddToastCheckbox?.addEventListener('change', () => {
    setTheme({ recordAddToast: recordAddToastCheckbox.checked }, 'DisplayChange');
  });
  recordsLoadLimitInput?.addEventListener('change', () => {
    const value = Math.max(100, Math.min(1000, Number(recordsLoadLimitInput.value) || 100));
    setTheme({ maxLoadedRecords: value }, 'DisplayChange');
    recordsLoadLimitInput.value = String(value);
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindFormatControls() {
  const formatInput = document.getElementById('time-format-input');
  const formatPreview = document.getElementById('time-format-preview');
  if (!formatInput) return;

  function updatePreview() {
    if (formatPreview) {
      formatPreview.textContent = t('settings.format.previewLabel') + formatTimestamp(new Date(), formatInput.value);
    }
  }

  function updateUIFromTheme(theme) {
    formatInput.value = theme.timeFormat || DEFAULT_TIME_FORMAT;
    updatePreview();
  }

  formatInput.addEventListener('change', () => {
    const value = formatInput.value.trim() || DEFAULT_TIME_FORMAT;
    setTheme({ timeFormat: value }, 'FormatChange');
    formatInput.value = value;
    updatePreview();
  });
  formatInput.addEventListener('input', updatePreview);

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
    setTheme({ connectMoodDots: checkbox.checked }, 'ChartStyleChange');
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
    setTheme({ sleepDisplayMode: checkbox.checked ? 'overlay' : 'bar' }, 'DisplayChange');
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
    setTheme({ autoMedLog: checkbox.checked }, 'MedSettingsChange');
  });

  updateUIFromTheme(getTheme());
  subscribeTheme(updateUIFromTheme);
}

function bindBodyWeightControl() {
  const input = document.getElementById('body-weight-kg');
  if (!input) return;

  function updateUIFromTheme(theme) {
    input.value = theme.bodyWeightKg ?? 70;
  }

  input.addEventListener('change', () => {
    const value = Math.max(20, Math.min(300, Number(input.value) || 70));
    setTheme({ bodyWeightKg: value }, 'MedSettingsChange');
    input.value = String(value);
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
    setTheme({ simpleMode: enableCheckbox.checked }, 'SimpleModeChange');
  });

  moodCheckbox?.addEventListener('change', () => {
    setTheme({ simpleModeMood: moodCheckbox.checked }, 'SimpleModeChange');
  });

  medicationCheckbox?.addEventListener('change', () => {
    setTheme({ simpleModeMedication: medicationCheckbox.checked }, 'SimpleModeChange');
  });

  granularityGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn || !enableCheckbox.checked) return;
    setTheme({ simpleModeGranularity: btn.dataset.granularity }, 'SimpleModeChange');
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
    setTheme({ depletionReminderDays: Math.max(0, Math.min(30, Number(input.value) || 3)) }, 'MedSettingsChange');
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
    const pad3 = n => String(n).padStart(3, '0');
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日${pad(d.getHours())}时${pad(d.getMinutes())}分${pad(d.getSeconds())}秒${pad3(d.getMilliseconds())}`;
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
          <span class="autobackup-name">${escapeHtml(getAutoBackupReasonLabel(item.name))}</span>
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

// ===== 数据加密 =====
// 密码强度：0~4 分，至少 8 位且包含大小写、数字、符号
function passwordStrength(pwd) {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return Math.min(4, score);
}

const STRENGTH_COLORS = ['', '#ef4444', '#f59e0b', '#eab308', '#22c55e'];

const encryptDialog = document.getElementById('encrypt-dialog');
let encryptDialogResolver = null;

// 打开密码对话框
// mode: 'enable'（新密码 + 确认）| 'change'（当前密码 + 新密码 + 确认）
//       | 'verify'（仅当前密码）| 'backup'（仅备份文件密码）
// resolve：null = 取消；{ oldPassword, newPassword } = 提交结果
function showPasswordDialog(mode) {
  return new Promise(resolve => {
    encryptDialogResolver = resolve;
    const form = document.getElementById('encrypt-dialog-form');
    if (form) form.dataset.mode = mode;
    const title = document.getElementById('encrypt-dialog-title');
    const desc = document.getElementById('encrypt-dialog-desc');
    const oldField = document.getElementById('encrypt-old-field');
    const newField = document.getElementById('encrypt-new-field');
    const confirmField = document.getElementById('encrypt-confirm-field');
    const oldInput = document.getElementById('encrypt-old-password');
    const newInput = document.getElementById('encrypt-new-password');
    const confirmInput = document.getElementById('encrypt-confirm-password');
    const strength = document.getElementById('encrypt-strength');
    const err = document.getElementById('encrypt-dialog-error');
    const oldLabel = document.querySelector('label[for="encrypt-old-password"]');

    // 单密码字段模式（仅输入一个密码）共用的显隐规则
    const singleField = mode === 'verify' || mode === 'backup';

    if (title) title.textContent = t(
      mode === 'change' ? 'settings.encryption.changePasswordTitle'
        : mode === 'verify' ? 'settings.encryption.verifyPasswordTitle'
          : mode === 'backup' ? 'settings.backup.decryptTitle'
            : 'settings.encryption.enableTitle'
    );
    if (desc) desc.textContent = t(
      mode === 'change' ? 'settings.encryption.changePasswordDesc'
        : mode === 'verify' ? 'settings.encryption.verifyPasswordDesc'
          : mode === 'backup' ? 'settings.backup.decryptDesc'
            : 'settings.encryption.enableDesc'
    );
    if (oldLabel) {
      oldLabel.textContent = t(mode === 'backup'
        ? 'settings.backup.decryptPasswordLabel'
        : 'settings.encryption.oldPassword');
    }
    if (oldField) oldField.hidden = mode === 'enable';
    if (newField) newField.hidden = singleField;
    if (confirmField) confirmField.hidden = singleField;
    if (strength) strength.hidden = singleField;
    if (oldInput) oldInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
    if (err) err.textContent = '';
    if (encryptDialog) encryptDialog.setAttribute('aria-hidden', 'false');
    (mode === 'enable' ? newInput : oldInput)?.focus();
  });
}

function closePasswordDialog(result) {
  if (encryptDialog) encryptDialog.setAttribute('aria-hidden', 'true');
  if (encryptDialogResolver) {
    encryptDialogResolver(result);
    encryptDialogResolver = null;
  }
}

function updateStrengthUI() {
  const input = document.getElementById('encrypt-new-password');
  const strength = document.getElementById('encrypt-strength');
  const bar = document.getElementById('encrypt-strength-bar');
  const label = document.getElementById('encrypt-strength-label');
  if (!input || !strength || !bar || !label) return;
  const score = passwordStrength(input.value);
  strength.hidden = false;
  bar.style.width = `${score * 25}%`;
  bar.style.background = STRENGTH_COLORS[score] || '';
  const keys = ['settings.encryption.strengthNone', 'settings.encryption.strengthWeak',
    'settings.encryption.strengthMedium', 'settings.encryption.strengthStrong',
    'settings.encryption.strengthExcellent'];
  label.textContent = t(keys[score]);
}

function bindPasswordDialogEvents() {
  const form = document.getElementById('encrypt-dialog-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const mode = form.dataset.mode || 'enable';
    const oldInput = document.getElementById('encrypt-old-password');
    const newInput = document.getElementById('encrypt-new-password');
    const confirmInput = document.getElementById('encrypt-confirm-password');
    const err = document.getElementById('encrypt-dialog-error');
    if (err) err.textContent = '';

    const oldPassword = oldInput ? oldInput.value : '';
    const newPassword = newInput ? newInput.value : '';
    const confirmPassword = confirmInput ? confirmInput.value : '';

    // 单密码字段模式（verify/backup）：只校验并返回当前/备份密码
    const singleField = mode === 'verify' || mode === 'backup';

    // 仅 change 模式需要当前密码；enable 模式下旧密码字段被隐藏，不应校验
    if (mode === 'change' && !oldPassword) {
      if (err) err.textContent = t('settings.encryption.oldPasswordRequired');
      return;
    }
    if (singleField && !oldPassword) {
      if (err) err.textContent = t('settings.encryption.oldPasswordRequired');
      return;
    }
    if (!singleField) {
      if (newPassword.length < 4) {
        if (err) err.textContent = t('settings.encryption.passwordTooShort');
        return;
      }
      if (newPassword !== confirmPassword) {
        if (err) err.textContent = t('settings.encryption.passwordMismatch');
        return;
      }
    }
    if (mode === 'change' && newPassword === oldPassword) {
      if (err) err.textContent = t('settings.encryption.samePassword');
      return;
    }
    closePasswordDialog({ oldPassword, newPassword });
  });
  document.getElementById('encrypt-dialog-cancel')?.addEventListener('click', () => closePasswordDialog(null));
  encryptDialog?.querySelector('.modal-backdrop')?.addEventListener('click', () => closePasswordDialog(null));
  document.getElementById('encrypt-new-password')?.addEventListener('input', updateStrengthUI);
}

function reasonText(result) {
  if (!result) return '';
  if (result.reason === 'wrong-password') return t('settings.encryption.wrongPassword');
  if (result.reason === 'weak-password') return t('settings.encryption.passwordTooShort');
  if (result.reason === 'already-enabled') return t('settings.encryption.alreadyEnabled');
  if (result.reason === 'not-enabled') return t('settings.encryption.notEnabled');
  if (result.reason === 'error') return result.error || t('settings.encryption.operationError');
  return '';
}

async function enableEncryptionFlow() {
  const result = await showPasswordDialog('enable');
  if (!result) return;
  const res = await store.enableEncryption(result.newPassword);
  if (res.ok) {
    await showAlert(t('settings.encryption.enableSuccess'));
  } else {
    await showAlert(t('settings.encryption.enableError', { message: reasonText(res) }));
    return;
  }
  await showAlert(t('settings.encryption.forgotWarning'));
  updateEncryptionUI();
}

async function changePasswordFlow() {
  const result = await showPasswordDialog('change');
  if (!result) return;
  const res = await store.changePassword(result.oldPassword, result.newPassword);
  if (res.ok) {
    // 生物认证已启用时同步更新设备安全存储中的主密码
    if (getTheme().biometricUnlock === true && platform.isBiometricSupported()) {
      try {
        await platform.saveMasterPasswordToKeystore(result.newPassword);
      } catch { /* 保存失败不阻断修改密码 */ }
    }
    await showAlert(t('settings.encryption.changePasswordSuccess'));
  } else {
    await showAlert(t('settings.encryption.changePasswordError', { message: reasonText(res) }));
  }
  updateEncryptionUI();
}

async function disableEncryptionFlow() {
  if (!(await showConfirm(t('settings.encryption.disableConfirm')))) return;
  const result = await showPasswordDialog('verify');
  if (!result) return;
  const res = await store.disableEncryption(result.oldPassword);
  if (res.ok) {
    if (getTheme().biometricUnlock === true) {
      setTheme({ biometricUnlock: false }, 'Internal');
      try {
        await platform.removeMasterPasswordFromKeystore();
      } catch { /* 忽略 */ }
    }
    setTheme({ autoLockTimeout: -1 }, 'Internal');
    await showAlert(t('settings.encryption.disableSuccess'));
  } else {
    await showAlert(t('settings.encryption.disableError', { message: reasonText(res) }));
  }
  updateEncryptionUI();
}

function updateEncryptionUI() {
  const enabled = store.hasPassword();
  const status = document.getElementById('encryption-status');
  const enableBtn = document.getElementById('encryption-enable-btn');
  const changeBtn = document.getElementById('encryption-change-pwd-btn');
  const disableBtn = document.getElementById('encryption-disable-btn');
  const biometricGroup = document.getElementById('encryption-biometric-group');
  const biometricCheckbox = document.getElementById('encryption-biometric-enable');
  const autoLockGroup = document.getElementById('encryption-autolock-group');
  const autoLockSelect = document.getElementById('encryption-autolock-select');

  if (status) {
    status.dataset.i18n = enabled ? 'settings.encryption.statusEnabled' : 'settings.encryption.statusDisabled';
    status.textContent = t(enabled ? 'settings.encryption.statusEnabled' : 'settings.encryption.statusDisabled');
  }
  if (enableBtn) enableBtn.hidden = enabled;
  if (changeBtn) changeBtn.hidden = !enabled;
  if (disableBtn) disableBtn.hidden = !enabled;
  if (biometricGroup) {
    biometricGroup.hidden = !enabled || !platform.isBiometricSupported();
  }
  if (biometricCheckbox) {
    biometricCheckbox.checked = getTheme().biometricUnlock === true && enabled;
    biometricCheckbox.disabled = !enabled;
  }
  if (autoLockGroup) autoLockGroup.hidden = !enabled;
  if (autoLockSelect) {
    autoLockSelect.disabled = !enabled;
    autoLockSelect.value = String(getTheme().autoLockTimeout ?? -1);
  }
}

function bindEncryptionControls() {
  const enableBtn = document.getElementById('encryption-enable-btn');
  const changeBtn = document.getElementById('encryption-change-pwd-btn');
  const disableBtn = document.getElementById('encryption-disable-btn');
  const biometricCheckbox = document.getElementById('encryption-biometric-enable');
  const autoLockSelect = document.getElementById('encryption-autolock-select');

  bindPasswordDialogEvents();

  enableBtn?.addEventListener('click', enableEncryptionFlow);
  changeBtn?.addEventListener('click', changePasswordFlow);
  disableBtn?.addEventListener('click', disableEncryptionFlow);

  biometricCheckbox?.addEventListener('change', async () => {
    if (!store.hasPassword()) return;
    if (biometricCheckbox.checked) {
      // 启用生物认证前验证主密码，并保存到设备安全存储
      const result = await showPasswordDialog('verify');
      if (!result || !result.oldPassword) {
        biometricCheckbox.checked = false;
        return;
      }
      if (!(await store.unlock(result.oldPassword))) {
        await showAlert(t('settings.encryption.wrongPassword'));
        biometricCheckbox.checked = false;
        return;
      }
      try {
        await platform.saveMasterPasswordToKeystore(result.oldPassword);
        setTheme({ biometricUnlock: true }, 'Internal');
        await showAlert(t('settings.encryption.biometricEnabled'));
      } catch (err) {
        await showAlert(t('settings.encryption.biometricError', { message: err.message }));
        biometricCheckbox.checked = false;
      }
    } else {
      setTheme({ biometricUnlock: false }, 'Internal');
      try {
        await platform.removeMasterPasswordFromKeystore();
      } catch { /* 忽略 */ }
    }
  });

  autoLockSelect?.addEventListener('change', () => {
    const value = Number(autoLockSelect.value);
    setTheme({ autoLockTimeout: value }, 'Internal');
  });

  updateEncryptionUI();
  subscribeTheme(() => updateEncryptionUI());
  subscribe(() => updateEncryptionUI());
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

function bindUpdateChannelControls() {
  const select = document.getElementById('update-channel-select');
  if (!select) return;
  UPDATE_CHANNELS.forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.code;
    opt.dataset.i18n = ch.key;
    opt.textContent = t(ch.key);
    select.appendChild(opt);
  });
  select.value = getUpdateChannel();
  select.addEventListener('change', () => {
    setUpdateChannel(select.value);
  });
  // 语言切换时选项文案由 updateDOM 刷新，这里同步选中值
  subscribe(() => {
    select.value = getUpdateChannel();
  });
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
  bindCustomCssControl();
  bindDisplayControls();
  bindFormatControls();
  bindConnectMoodDotsControl();
  bindSleepOverlayModeControl();
  bindAutoMedLogControl();
  bindDepletionReminderDaysControl();
  bindBodyWeightControl();
  bindSimpleModeControls();
  bindMedHistoryControls();
  bindEncryptionControls();
  bindSyncControls();
  bindAutoBackupControls();
  bindWidgetControls();
  bindUpdateChannelControls();
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
