import { store } from './store.js';
import { platform } from './platform.js';
import { t, setLanguage, getLanguage, subscribe, updateDOM } from './i18n.js';
import { getTheme, setTheme, resetTheme, applySystemTheme, subscribe as subscribeTheme } from './theme.js';
import { showAlert, showConfirm } from './dialog.js';

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

  subscribe(() => {
    updateDOM();
    if (languageSelect) {
      languageSelect.value = getLanguage();
    }
  });
}
