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
  const backgroundInput = document.getElementById('theme-background-color');
  const surfaceInput = document.getElementById('theme-surface-color');
  const accentInput = document.getElementById('theme-accent-color');
  const curveLineGroup = document.getElementById('theme-curve-line');
  const systemBtn = document.getElementById('theme-system-btn');
  const resetBtn = document.getElementById('theme-reset-btn');

  function updateUIFromTheme(theme) {
    if (positiveInput) positiveInput.value = theme.positiveColor;
    if (negativeInput) negativeInput.value = theme.negativeColor;
    if (neutralInput) neutralInput.value = theme.neutralColor;
    if (backgroundInput) backgroundInput.value = theme.backgroundColor;
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
    [backgroundInput, 'backgroundColor'],
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
  bindDisplayControls();
  bindConnectMoodDotsControl();
  bindSyncControls();

  subscribe(() => {
    updateDOM();
    if (languageSelect) {
      languageSelect.value = getLanguage();
    }
  });
}
