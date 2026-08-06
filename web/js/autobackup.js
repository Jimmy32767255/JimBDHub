import { store } from './store.js';
import { platform } from './platform.js';
import { t, getLanguage, setLanguage } from './i18n.js';
import { getTheme, setTheme } from './theme.js';
import { showAlert, showConfirm } from './dialog.js';

// 自动备份：以事件钩子形式（监听 store 数据变化）写入用户选择的文件夹。
// 有意不做定时备份，避免后台保活，减少与用户设备上其它常驻软件的资源争夺。
const DEFAULT_MAX_COUNT = 10;
const DEBOUNCE_MS = 3000;

let debounceTimer = null;
let unsubscribeStore = null;
let running = false;
let statusListeners = [];
let currentStatus = { enabled: false, folder: '', maxCount: DEFAULT_MAX_COUNT, list: [], loaded: false };

export function subscribeAutoBackup(fn) {
  statusListeners.push(fn);
  fn(currentStatus);
  return () => {
    statusListeners = statusListeners.filter(l => l !== fn);
  };
}

function notifyStatus(partial) {
  currentStatus = { ...currentStatus, ...partial };
  statusListeners.forEach(fn => fn(currentStatus));
}

function readSettings() {
  const theme = getTheme();
  const maxCount = Number(theme.autoBackupMaxCount);
  return {
    enabled: theme.autoBackupEnabled === true,
    folder: theme.autoBackupFolder || '',
    maxCount: Number.isInteger(maxCount) && maxCount >= 1 ? maxCount : DEFAULT_MAX_COUNT
  };
}

export function getAutoBackupMaxCount() {
  return readSettings().maxCount;
}

export function setAutoBackupEnabled(enabled) {
  setTheme({ autoBackupEnabled: enabled });
  if (enabled) {
    refreshList();
  } else {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    notifyStatus({ list: [], loaded: false });
  }
}

export function setAutoBackupMaxCount(n) {
  const maxCount = Math.max(1, Math.min(100, Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_COUNT));
  setTheme({ autoBackupMaxCount: maxCount });
  return maxCount;
}

async function performBackup(showResult) {
  const settings = readSettings();
  if (!settings.enabled || !settings.folder) return;
  if (running) return;
  running = true;
  try {
    const json = JSON.stringify(store.buildBackup());
    const result = await platform.writeAutoBackup(settings.folder, json, settings.maxCount);
    if (!result || !result.ok) {
      if (showResult) {
        await showAlert(t('settings.backup.autoError', { message: result?.error || '' }));
      }
    } else if (showResult) {
      await showAlert(t('settings.backup.autoSuccess', { name: result.name }));
    }
    await refreshList();
  } catch (err) {
    if (showResult) {
      await showAlert(t('settings.backup.autoError', { message: err.message }));
    }
  } finally {
    running = false;
  }
}

export async function backupNow() {
  await performBackup(true);
}

function onStoreChange() {
  const settings = readSettings();
  if (!settings.enabled || !settings.folder) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => performBackup(false), DEBOUNCE_MS);
}

export async function chooseBackupFolder() {
  try {
    const result = await platform.chooseBackupFolder();
    if (!result || !result.ok) {
      if (result && !result.cancelled && result.error) {
        await showAlert(t('settings.backup.autoChooseError', { message: result.error }));
      }
      return false;
    }
    setTheme({ autoBackupFolder: result.path || result.uri || '' });
    await refreshList();
    return true;
  } catch (err) {
    await showAlert(t('settings.backup.autoChooseError', { message: err.message }));
    return false;
  }
}

export async function refreshList() {
  const settings = readSettings();
  if (!settings.folder) {
    notifyStatus({ list: [], loaded: false });
    return;
  }
  try {
    const result = await platform.listAutoBackups(settings.folder);
    if (!result || !result.ok) {
      notifyStatus({ list: [], loaded: false });
      return;
    }
    notifyStatus({ list: result.backups || [], loaded: true });
  } catch {
    notifyStatus({ list: [], loaded: false });
  }
}

export async function restoreAutoBackup(name) {
  if (!(await showConfirm(t('settings.backup.autoRestoreConfirm', { name })))) {
    return;
  }
  const settings = readSettings();
  try {
    const result = await platform.readAutoBackup(settings.folder, name);
    if (!result || !result.ok) {
      await showAlert(t('settings.backup.autoRestoreError', { message: result?.error || '' }));
      return;
    }
    const data = JSON.parse(result.content);
    if (!store.validateBackup(data)) {
      await showAlert(t('settings.backup.invalidFormat'));
      return;
    }
    const restoredLang = store.restoreBackup(data);
    if (restoredLang) {
      await showAlert(t('settings.backup.autoRestoreSuccess'));
      if (restoredLang !== getLanguage()) {
        await setLanguage(restoredLang);
      }
    } else {
      await showAlert(t('settings.backup.importFail'));
    }
  } catch (err) {
    await showAlert(t('settings.backup.autoRestoreError', { message: err.message }));
  }
  await refreshList();
}

export async function deleteAutoBackup(name) {
  if (!(await showConfirm(t('settings.backup.autoDeleteConfirm', { name })))) {
    return;
  }
  const settings = readSettings();
  try {
    const result = await platform.deleteAutoBackup(settings.folder, name);
    if (!result || !result.ok) {
      await showAlert(t('settings.backup.autoDeleteError', { message: result?.error || '' }));
      return;
    }
    await refreshList();
  } catch (err) {
    await showAlert(t('settings.backup.autoDeleteError', { message: err.message }));
  }
}

export function initAutoBackup() {
  if (unsubscribeStore) {
    unsubscribeStore();
  }
  unsubscribeStore = store.subscribe(onStoreChange);
  const settings = readSettings();
  notifyStatus({
    enabled: settings.enabled,
    folder: settings.folder,
    maxCount: settings.maxCount
  });
  if (settings.enabled && settings.folder && platform.isAutoBackupSupported()) {
    refreshList();
  }
}
