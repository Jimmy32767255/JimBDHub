import { store } from './store.js';
import { platform } from './platform.js';
import { t, getLanguage, setLanguage } from './i18n.js';
import { getTheme, setTheme, subscribe as subscribeTheme } from './theme.js';
import { subscribeStatus as subscribeSyncStatus } from './sync.js';
import { showAlert, showConfirm } from './dialog.js';

// 自动备份：以事件钩子形式（监听 store 数据变化）写入用户选择的文件夹。
// 有意不做定时备份，避免后台保活，减少与用户设备上其它常驻软件的资源争夺。
const DEFAULT_MAX_COUNT = 10;
const DEBOUNCE_MS = 3000;

// 备份文件名格式：JimBDHub_AutoBackup_{操作}_{yyyyMMddHHmm毫秒}.json
// 操作（触发原因）固定英文，仅在 UI 展示时按当前语言翻译
export const AUTO_BACKUP_FILE_PREFIX = 'JimBDHub_AutoBackup_';

const AUTO_BACKUP_REASON_KEYS = {
  Manual: 'settings.backup.autoReason.manual',
  DataChange: 'settings.backup.autoReason.dataChange',
  AddRecord: 'settings.backup.autoReason.addRecord',
  UpdateRecord: 'settings.backup.autoReason.updateRecord',
  DeleteRecord: 'settings.backup.autoReason.deleteRecord',
  AddSleep: 'settings.backup.autoReason.addSleep',
  UpdateSleep: 'settings.backup.autoReason.updateSleep',
  DeleteSleep: 'settings.backup.autoReason.deleteSleep',
  AddEvent: 'settings.backup.autoReason.addEvent',
  UpdateEvent: 'settings.backup.autoReason.updateEvent',
  DeleteEvent: 'settings.backup.autoReason.deleteEvent',
  AddMed: 'settings.backup.autoReason.addMed',
  UpdateMed: 'settings.backup.autoReason.updateMed',
  DeleteMed: 'settings.backup.autoReason.deleteMed',
  AddMedHistory: 'settings.backup.autoReason.addMedHistory',
  UpdateMedHistory: 'settings.backup.autoReason.updateMedHistory',
  DeleteMedHistory: 'settings.backup.autoReason.deleteMedHistory',
  AddLog: 'settings.backup.autoReason.addLog',
  UpdateLog: 'settings.backup.autoReason.updateLog',
  DeleteLog: 'settings.backup.autoReason.deleteLog',
  TakeMed: 'settings.backup.autoReason.takeMed',
  AddHistoricalLog: 'settings.backup.autoReason.addHistoricalLog',
  RestoreBackup: 'settings.backup.autoReason.restoreBackup',
  ClearAll: 'settings.backup.autoReason.clearAll',
  ThemeChange: 'settings.backup.autoReason.themeChange',
  ThemeReset: 'settings.backup.autoReason.themeReset',
  SystemTheme: 'settings.backup.autoReason.systemTheme',
  ThemeImport: 'settings.backup.autoReason.themeImport',
  ColorChange: 'settings.backup.autoReason.colorChange',
  ChartStyleChange: 'settings.backup.autoReason.chartStyleChange',
  BackgroundChange: 'settings.backup.autoReason.backgroundChange',
  DisplayChange: 'settings.backup.autoReason.displayChange',
  MedSettingsChange: 'settings.backup.autoReason.medSettingsChange',
  SimpleModeChange: 'settings.backup.autoReason.simpleModeChange',
  SyncEnabled: 'settings.backup.autoReason.syncEnabled',
  SyncDisabled: 'settings.backup.autoReason.syncDisabled'
};

/** 将备份文件名转为可读的展示名：去掉前缀，并把操作部分翻译成当前语言。 */
export function formatAutoBackupName(name) {
  let display = name;
  if (display.startsWith(AUTO_BACKUP_FILE_PREFIX)) {
    display = display.slice(AUTO_BACKUP_FILE_PREFIX.length);
  }
  const idx = display.indexOf('_');
  if (idx > 0) {
    const reason = display.slice(0, idx);
    const key = AUTO_BACKUP_REASON_KEYS[reason];
    if (key) {
      display = `${t(key)}${display.slice(idx)}`;
    }
  }
  return display;
}

/** 仅提取并翻译备份文件名中的操作原因（用于列表标题），识别失败时回退到完整展示名。 */
export function getAutoBackupReasonLabel(name) {
  let display = name;
  if (display.startsWith(AUTO_BACKUP_FILE_PREFIX)) {
    display = display.slice(AUTO_BACKUP_FILE_PREFIX.length);
  }
  const idx = display.indexOf('_');
  if (idx > 0) {
    const reason = display.slice(0, idx);
    const key = AUTO_BACKUP_REASON_KEYS[reason];
    if (key) return t(key);
  }
  return formatAutoBackupName(name);
}

let debounceTimer = null;
let unsubscribeStore = null;
let unsubscribeTheme = null;
let unsubscribeSync = null;
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
  // 自动备份自身设置是内部状态，不触发新的备份
  setTheme({ autoBackupEnabled: enabled }, 'Internal');
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
  setTheme({ autoBackupMaxCount: maxCount }, 'Internal');
  return maxCount;
}

async function performBackup(showResult, reason) {
  const settings = readSettings();
  if (!settings.enabled || !settings.folder) return;
  if (running) return;
  running = true;
  try {
    const json = JSON.stringify(store.buildBackup());
    const result = await platform.writeAutoBackup(settings.folder, json, settings.maxCount, reason);
    if (!result || !result.ok) {
      if (showResult) {
        await showAlert(t('settings.backup.autoError', { message: result?.error || '' }));
      }
    } else if (showResult) {
      await showAlert(t('settings.backup.autoSuccess', { name: formatAutoBackupName(result.name) }));
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
  await performBackup(true, 'Manual');
}

// 统一触发入口：store 数据变更、主题/设置变更、同步开关都会调用此处
function onAutoBackupTrigger(reason) {
  // 恢复备份后立即再自动备份会导致冗余且令人困惑的备份条目，跳过
  // Internal 为内部状态更新（自动备份自身设置、计时标记等），不构成用户操作，跳过
  if (reason === 'RestoreBackup' || reason === 'Internal') return;
  const settings = readSettings();
  if (!settings.enabled || !settings.folder) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => performBackup(false, reason), DEBOUNCE_MS);
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
    setTheme({ autoBackupFolder: result.path || result.uri || '' }, 'Internal');
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
  if (!(await showConfirm(t('settings.backup.autoRestoreConfirm', { name: formatAutoBackupName(name) })))) {
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
  if (!(await showConfirm(t('settings.backup.autoDeleteConfirm', { name: formatAutoBackupName(name) })))) {
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
  if (unsubscribeStore) unsubscribeStore();
  if (unsubscribeTheme) unsubscribeTheme();
  if (unsubscribeSync) unsubscribeSync();

  // store 数据变更：取最后一次变更原因
  unsubscribeStore = store.subscribe((_, reason) => onAutoBackupTrigger(reason || store.lastMutation?.reason || 'DataChange'));
  // 主题/设置变更：强调色、界面缩放等均不经过 store
  unsubscribeTheme = subscribeTheme((_, reason) => onAutoBackupTrigger(reason || 'ThemeChange'));
  // 同步开关：启用/关闭同步本身不修改 store 数据
  unsubscribeSync = subscribeSyncStatus(status => {
    if (status.reason === 'SyncEnabled' || status.reason === 'SyncDisabled') {
      onAutoBackupTrigger(status.reason);
    }
  });

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
