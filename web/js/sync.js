import { store } from './store.js';
import { platform } from './platform.js';
import { t, getLanguage, setLanguage } from './i18n.js';

const ENABLED_KEY = 'jimbdhub_syncthing_enabled';

const WRITE_DEBOUNCE_MS = 500;
const READ_SUPPRESS_MS = 1000;
const WRITE_SUPPRESS_MS = 1000;

let lastWriteAt = 0;
let lastReadAt = 0;
let unsubscribeStore = null;
let writeTimer = null;
let statusListeners = [];
let currentStatus = { enabled: false };

function setStatus(partial) {
  currentStatus = { ...currentStatus, ...partial };
  statusListeners.forEach(fn => fn(currentStatus));
}

export function subscribeStatus(fn) {
  statusListeners.push(fn);
  fn(currentStatus);
  return () => {
    statusListeners = statusListeners.filter(l => l !== fn);
  };
}

export function getStatus() {
  return { ...currentStatus };
}

function isWithinReadSuppressWindow() {
  return lastReadAt > 0 && Date.now() - lastReadAt < READ_SUPPRESS_MS;
}

function isWithinWriteSuppressWindow() {
  return lastWriteAt > 0 && Date.now() - lastWriteAt < WRITE_SUPPRESS_MS;
}

async function writeSyncFile() {
  if (!currentStatus.enabled) return;
  if (isWithinWriteSuppressWindow()) return;
  try {
    const backup = store.buildBackup();
    backup.syncedAt = new Date().toISOString();
    const result = await platform.writeSyncFile(JSON.stringify(backup));
    if (!result.ok) {
      setStatus({ error: result.error || t('settings.sync.writeError') });
      return;
    }
    lastWriteAt = Date.now();
    setStatus({ error: null });
  } catch (err) {
    setStatus({ error: err.message || t('settings.sync.writeError') });
  }
}

function onStoreChange() {
  if (!currentStatus.enabled) return;
  if (writeTimer) clearTimeout(writeTimer);
  if (isWithinReadSuppressWindow()) return;
  writeTimer = setTimeout(() => writeSyncFile(), WRITE_DEBOUNCE_MS);
}

export async function onFileChanged(jsonText) {
  if (!currentStatus.enabled) return;
  if (isWithinWriteSuppressWindow()) return;
  try {
    const data = JSON.parse(jsonText);
    if (!store.validateBackup(data)) {
      setStatus({ error: t('settings.sync.importError') });
      return;
    }
    lastReadAt = Date.now();
    const oldLang = getLanguage();
    const restoredLang = store.restoreBackup(data);
    if (restoredLang && restoredLang !== oldLang) {
      await setLanguage(restoredLang);
    }
    setStatus({ error: null });
  } catch {
    setStatus({ error: t('settings.sync.importError') });
  }
}

export async function enable() {
  if (!platform.isSyncSupported()) {
    setStatus({ enabled: false, error: t('settings.sync.webHint') });
    localStorage.setItem(ENABLED_KEY, 'false');
    return;
  }
  try {
    const result = await platform.enableSync();
    if (!result.ok) {
      setStatus({ enabled: false, error: result.error || t('settings.sync.error') });
      localStorage.setItem(ENABLED_KEY, 'false');
      return;
    }
    currentStatus = {
      enabled: true,
      path: result.path || null,
      folderName: result.folderName || null,
      error: null
    };
    statusListeners.forEach(fn => fn(currentStatus));
    localStorage.setItem(ENABLED_KEY, 'true');
    if (result.content) {
      await onFileChanged(result.content);
    } else {
      await writeSyncFile();
    }
    if (unsubscribeStore) unsubscribeStore();
    unsubscribeStore = store.subscribe(onStoreChange);
  } catch (err) {
    setStatus({ enabled: false, error: err.message || t('settings.sync.error') });
    localStorage.setItem(ENABLED_KEY, 'false');
  }
}

export async function disable() {
  try {
    await platform.disableSync();
  } catch {
    // ignore cleanup errors
  }
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  setStatus({ enabled: false, path: null, folderName: null, error: null });
  localStorage.setItem(ENABLED_KEY, 'false');
}

export function initSync() {
  platform.onSyncFileChanged(onFileChanged);
  setStatus({ enabled: false });

  const tryEnable = () => {
    if (localStorage.getItem(ENABLED_KEY) === 'true') {
      enable();
    }
  };

  if (platform.isSyncSupported()) {
    tryEnable();
    return;
  }

  // pywebview 在 AppImage 等打包环境下可能比页面脚本注入稍晚，轮询等待
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (platform.isSyncSupported()) {
      clearInterval(timer);
      tryEnable();
    } else if (attempts >= 30) {
      clearInterval(timer);
    }
  }, 100);
}
