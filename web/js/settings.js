import { store } from './store.js';
import { platform } from './platform.js';
import { t, setLanguage, getLanguage, subscribe, updateDOM } from './i18n.js';

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
    alert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function importBackup(text) {
  try {
    const data = JSON.parse(text);
    if (!store.validateBackup(data)) {
      alert(t('settings.backup.invalidFormat'));
      return;
    }
    if (!confirm(t('settings.backup.importConfirm'))) {
      return;
    }
    const restoredLang = store.restoreBackup(data);
    if (restoredLang) {
      alert(t('settings.backup.importSuccess'));
      if (restoredLang !== getLanguage()) {
        await setLanguage(restoredLang);
      }
    } else {
      alert(t('settings.backup.importFail'));
    }
  } catch (err) {
    alert(t('settings.backup.exportError', { message: err.message }));
  }
}

async function onImportClick() {
  try {
    const text = await platform.pickBackup();
    if (text) {
      await importBackup(text);
    }
  } catch (err) {
    alert(t('settings.backup.readError', { message: err.message }));
  }
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
      alert(t('settings.backup.readError', { message: err.message }));
    }
    e.target.value = '';
  });

  subscribe(() => {
    updateDOM();
    if (languageSelect) {
      languageSelect.value = getLanguage();
    }
  });
}
