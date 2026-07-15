import { t } from './i18n.js';

function downloadJson(jsonString, fileName) {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readJsonFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('platform.readError')));
    reader.readAsText(file);
  });
}

function pickFileWithInput() {
  return new Promise((resolve, reject) => {
    let input = document.getElementById('platform-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'platform-file-input';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.value = '';

    const onChange = async () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await readJsonFromFile(file);
        resolve(text);
      } catch (err) {
        reject(err);
      }
    };

    const onBlur = () => {
      setTimeout(() => {
        if (!input.value) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      window.removeEventListener('focus', onBlur);
    };

    input.addEventListener('change', onChange);
    window.addEventListener('focus', onBlur);
    input.click();
  });
}

function waitForAndroidCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidBackupCallback;
    const previousError = window.__androidBackupError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidBackupCallback = previousCallback;
      window.__androidBackupError = previousError;
    };

    window.__androidBackupCallback = (text) => {
      cleanup();
      resolve(text);
    };

    window.__androidBackupError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

function waitForAndroidSyncCallback() {
  return new Promise((resolve, reject) => {
    const previousCallback = window.__androidSyncCallback;
    const previousError = window.__androidSyncError;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(t('platform.androidTimeout')));
    }, 60000);

    const cleanup = () => {
      clearTimeout(timeout);
      window.__androidSyncCallback = previousCallback;
      window.__androidSyncError = previousError;
    };

    window.__androidSyncCallback = (json) => {
      cleanup();
      try {
        resolve(JSON.parse(json));
      } catch {
        resolve({ ok: false, error: t('platform.androidError') });
      }
    };

    window.__androidSyncError = (message) => {
      cleanup();
      reject(new Error(message || t('platform.androidError')));
    };
  });
}

export const platform = {
  isAndroid() {
    return typeof window.AndroidBridge !== 'undefined';
  },

  isDesktop() {
    return typeof window.pywebview !== 'undefined';
  },

  async saveBackup(jsonString, fileName) {
    if (this.isAndroid()) {
      window.AndroidBridge.saveBackup(jsonString, fileName);
      return;
    }
    if (this.isDesktop()) {
      await window.pywebview.api.saveBackup(jsonString, fileName);
      return;
    }
    downloadJson(jsonString, fileName);
  },

  async pickBackup() {
    if (this.isAndroid()) {
      window.AndroidBridge.pickBackup();
      const text = await waitForAndroidCallback();
      return text;
    }
    if (this.isDesktop()) {
      const text = await window.pywebview.api.pickBackup();
      return text || null;
    }
    return pickFileWithInput();
  },

  isSyncSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  isWidgetSupported() {
    return this.isAndroid() || this.isDesktop();
  },

  async addWidget() {
    if (this.isAndroid()) {
      window.AndroidBridge.addWidget();
      return { ok: true };
    }
    if (this.isDesktop()) {
      return window.pywebview.api.addWidgetShortcut() || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.widgetUnsupported') };
  },

  async enableSync() {
    if (this.isAndroid()) {
      window.AndroidBridge.enableSync();
      return waitForAndroidSyncCallback();
    }
    if (this.isDesktop()) {
      return window.pywebview.api.enableSync() || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  async disableSync() {
    if (this.isAndroid()) {
      window.AndroidBridge.disableSync();
      return { ok: true };
    }
    if (this.isDesktop()) {
      await window.pywebview.api.disableSync();
      return { ok: true };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  async writeSyncFile(jsonString) {
    if (this.isAndroid()) {
      window.AndroidBridge.writeSyncFile(jsonString);
      return waitForAndroidSyncCallback();
    }
    if (this.isDesktop()) {
      return window.pywebview.api.writeSyncFile(jsonString) || { ok: false, error: t('platform.desktopError') };
    }
    return { ok: false, error: t('platform.syncUnsupported') };
  },

  onSyncFileChanged(callback) {
    window.__syncthingCallback = callback;
  }
};
