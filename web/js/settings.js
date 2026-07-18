import { store } from './store.js';
import { platform } from './platform.js';
import { t, setLanguage, getLanguage, subscribe, updateDOM } from './i18n.js';
import { getTheme, setTheme, resetTheme, applySystemTheme, subscribe as subscribeTheme } from './theme.js';
import { showAlert, showConfirm } from './dialog.js';
import { enable as enableSync, disable as disableSync, subscribeStatus, getStatus } from './sync.js';

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

function bindThemeControls() {
  const positiveInput = document.getElementById('theme-positive-color');
  const negativeInput = document.getElementById('theme-negative-color');
  const neutralInput = document.getElementById('theme-neutral-color');
  const surfaceInput = document.getElementById('theme-surface-color');
  const accentInput = document.getElementById('theme-accent-color');
  const curveLineGroup = document.getElementById('theme-curve-line');
  const systemBtn = document.getElementById('theme-system-btn');
  const resetBtn = document.getElementById('theme-reset-btn');

  function updateUIFromTheme(theme) {
    if (positiveInput) positiveInput.value = theme.positiveColor;
    if (negativeInput) negativeInput.value = theme.negativeColor;
    if (neutralInput) neutralInput.value = theme.neutralColor;
    if (surfaceInput) surfaceInput.value = theme.surfaceColor;
    if (accentInput) accentInput.value = theme.accentColor;
    if (curveLineGroup) {
      curveLineGroup.querySelectorAll('.segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.line === theme.curveLine);
      });
    }
  }

  const colorMap = [
    [positiveInput, 'positiveColor'],
    [negativeInput, 'negativeColor'],
    [neutralInput, 'neutralColor'],
    [surfaceInput, 'surfaceColor'],
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

  function updateUIFromTheme(theme) {
    if (scaleSelect) scaleSelect.value = String(theme.uiScale);
    if (marginSelect) marginSelect.value = String(theme.edgeMargin);
  }

  scaleSelect?.addEventListener('change', () => {
    setTheme({ uiScale: Number(scaleSelect.value) });
  });
  marginSelect?.addEventListener('change', () => {
    setTheme({ edgeMargin: Number(marginSelect.value) });
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

function bindSyncControls() {
  const enableCheckbox = document.getElementById('syncthing-enable');
  const chooseBtn = document.getElementById('syncthing-choose-folder');
  const pathText = document.getElementById('syncthing-path');
  const statusText = document.getElementById('syncthing-status');
  const card = document.getElementById('syncthing-card');

  if (!card) return;

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
        pathText.textContent = t('settings.sync.webHint');
      } else if (status.path) {
        pathText.textContent = t('settings.sync.desktopPath', { path: status.path });
      } else if (status.folderName) {
        pathText.textContent = t('settings.sync.androidFolder', { name: status.folderName });
      } else {
        pathText.textContent = '';
      }
    }
    if (statusText) {
      if (status.error) {
        statusText.textContent = t('settings.sync.error', { message: status.error });
        statusText.classList.add('sync-error');
      } else if (status.enabled) {
        statusText.textContent = t('settings.sync.enabled');
        statusText.classList.remove('sync-error');
      } else {
        statusText.textContent = t('settings.sync.disabled');
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

  bindThemeControls();
  bindBackgroundControls();
  bindMedColorControls();
  bindDisplayControls();
  bindConnectMoodDotsControl();
  bindAutoMedLogControl();
  bindSyncControls();
  bindWidgetControls();
  bindWipeControls();

  subscribe(() => {
    updateDOM();
    if (languageSelect) {
      languageSelect.value = getLanguage();
    }
  });
}
